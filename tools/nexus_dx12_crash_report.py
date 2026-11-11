#!/usr/bin/env python3
"""Read-only Windows DX12 crash diagnostics. No game launch, injection or settings changes."""
from __future__ import annotations
import argparse
import json
import os
import platform
import subprocess
import sys


def parse_events(payload: str) -> list[dict]:
    """Accept zero, one or many PowerShell event objects without logging private paths."""
    if not payload.strip():
        return []
    raw = json.loads(payload)
    if raw is None:
        return []
    if not isinstance(raw, list):
        raw = [raw]
    result = []
    for event in raw:
        if not isinstance(event, dict):
            continue
        try:
            event_id = int(event.get('Id', -1))
        except (TypeError, ValueError):
            continue
        if event_id < 0:
            continue
        # Avoid dumping full Windows Error Reporting records or local file paths.
        result.append({'time': str(event.get('TimeCreated', ''))[:32],
                       'source': str(event.get('ProviderName', ''))[:80],
                       'id': event_id, 'log': str(event.get('LogName', ''))[:24]})
    return result


def build_ps(hours: int) -> str:
    # Deliberately no commands that update Windows settings, drivers or registry.
    return r'''$ErrorActionPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$since=(Get-Date).AddHours(-''' + str(hours) + r''')
$rows=@()
try {
    $rows+=@(Get-WinEvent -FilterHashtable @{LogName='System'; StartTime=$since} -MaxEvents 700 |
      Where-Object { $_.Id -eq 4101 -or $_.ProviderName -match '(?i)display|dxgkrnl|nvlddmkm|amdkmdag|amdwddmg|igfx' } |
      Select-Object -Property TimeCreated,Id,ProviderName,LogName)
} catch {}
try {
    $rows+=@(Get-WinEvent -FilterHashtable @{LogName='Application'; StartTime=$since; Id=@(1000,1001,1002)} -MaxEvents 400 |
      Where-Object { $_.Message -match '(?i)fatalframeii|d3d12|electron' } |
      Select-Object -Property TimeCreated,Id,ProviderName,LogName)
} catch {}
$rows=@($rows | Where-Object { $_ -ne $null } | Sort-Object -Property TimeCreated | Select-Object -Last 40)
ConvertTo-Json -InputObject $rows -Depth 3 -Compress
'''


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description='Read-only GPU/driver event summary after DX12 crash')
    parser.add_argument('--hours', type=int, default=24, help='Look back 1-168 hours (default 24)')
    args = parser.parse_args(argv)
    if not 1 <= args.hours <= 168:
        parser.error('--hours must be between 1 and 168')
    if os.name != 'nt':
        print('[DIAG] This tool reads Windows Event Viewer; run it on Windows.')
        return 2
    print('[SAFE] Reading Windows Event Viewer only. No driver reset, elevation, game launch, or injection.')
    executable = os.path.join(os.environ.get('SystemRoot', r'C:\Windows'),
                              'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try:
        process = subprocess.run([executable, '-NoProfile', '-NonInteractive', '-Command', build_ps(args.hours)],
                                 capture_output=True, text=True, errors='replace', timeout=50)
    except (OSError, subprocess.TimeoutExpired) as error:
        print('[DIAG] Event Viewer query unavailable:', type(error).__name__, file=sys.stderr)
        return 2
    if process.returncode:
        print('[DIAG] Event Viewer returned a nonzero status. Use Reliability Monitor: perfmon /rel')
        return 2
    try:
        events = parse_events(process.stdout)
    except (ValueError, TypeError):
        print('[DIAG] Windows event output was not valid JSON; check Reliability Monitor: perfmon /rel')
        return 2
    print(f'[DIAG] Relevant recent events: {len(events)} (past {args.hours} hours; query limits apply)')
    for event in events:
        print(f"  {event['time']} | {event['log']} | {event['source']} | ID {event['id']}")
    if not events:
        print('[DIAG] No matched events returned. This does not rule out a driver reset or application crash.')
    print('[NEXT] For details, open Reliability Monitor with: perfmon /rel')
    print('[PRIVACY] Review any event details before sharing crash reports.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
