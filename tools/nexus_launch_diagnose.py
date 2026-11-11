"""Read-only diagnostics for Windows game launch failures (EACCES / UAC).

Does not execute the game, elevate privileges, change Compatibility flags,
modify NTFS ACLs, or disable Windows security.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


def manifest_level(xml_text):
    """Find UAC requestedExecutionLevel regardless of XML namespace."""
    try:
        root = ET.fromstring(xml_text.lstrip('\ufeff\x00 \t\r\n'))
        for node in root.iter():
            if node.tag.rsplit('}', 1)[-1] == 'requestedExecutionLevel':
                return node.attrib.get('level') or 'unspecified'
    except ET.ParseError:
        match = re.search(r'<(?:\w+:)?requestedExecutionLevel\b[^>]*\blevel=["\']([^"\']+)', xml_text, re.I)
        if match:
            return match.group(1)
    return None


def decode_manifest(raw):
    if raw.startswith((b'\xff\xfe', b'\xfe\xff')):
        return raw.decode('utf-16', errors='replace')
    if raw.startswith(b'\xef\xbb\xbf'):
        return raw.decode('utf-8-sig', errors='replace')
    if b'\x00' in raw[:64]:
        return raw.decode('utf-16-le', errors='replace')
    return raw.decode('utf-8', errors='replace')


def embedded_manifest(exe):
    if os.name != 'nt':
        return None, 'Windows-only embedded resource reader'
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LoadLibraryExW.argtypes = [wintypes.LPCWSTR, wintypes.HANDLE, wintypes.DWORD]
    kernel.LoadLibraryExW.restype = wintypes.HMODULE
    kernel.FindResourceW.argtypes = [wintypes.HMODULE, ctypes.c_void_p, ctypes.c_void_p]
    kernel.FindResourceW.restype = wintypes.HRSRC
    kernel.LoadResource.argtypes = [wintypes.HMODULE, wintypes.HRSRC]
    kernel.LoadResource.restype = wintypes.HGLOBAL
    kernel.SizeofResource.argtypes = [wintypes.HMODULE, wintypes.HRSRC]
    kernel.SizeofResource.restype = wintypes.DWORD
    kernel.LockResource.argtypes = [wintypes.HGLOBAL]
    kernel.LockResource.restype = ctypes.c_void_p
    kernel.FreeLibrary.argtypes = [wintypes.HMODULE]
    kernel.FreeLibrary.restype = wintypes.BOOL
    # LOAD_LIBRARY_AS_DATAFILE | LOAD_LIBRARY_AS_IMAGE_RESOURCE: no code execution.
    handle = kernel.LoadLibraryExW(str(exe), None, 0x00000002 | 0x00000020)
    if not handle:
        return None, f'Unable to inspect executable resources (Win32 {ctypes.get_last_error()})'
    try:
        # The embedded application manifest is normally RT_MANIFEST (24), ID 1.
        res = kernel.FindResourceW(handle, ctypes.c_void_p(1), ctypes.c_void_p(24))
        if not res:
            return None, 'No default RT_MANIFEST/1 resource found'
        size = kernel.SizeofResource(handle, res)
        ptr = kernel.LockResource(kernel.LoadResource(handle, res))
        if not size or not ptr:
            return None, 'Manifest resource is empty'
        return decode_manifest(ctypes.string_at(ptr, size)), None
    finally:
        kernel.FreeLibrary(handle)


def compatibility_layers(exe):
    if os.name != 'nt':
        return []
    import winreg
    subkey = r'Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers'
    result = []
    for hive, hive_name in ((winreg.HKEY_CURRENT_USER, 'HKCU'), (winreg.HKEY_LOCAL_MACHINE, 'HKLM')):
        try:
            with winreg.OpenKey(hive, subkey) as key:
                target = str(exe).lower()
                index = 0
                while True:
                    try:
                        name, value, _ = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    if name.lower() == target:
                        result.append((hive_name, str(value)))
                    index += 1
        except (OSError, PermissionError):
            continue
    return result


def blocked_zone(exe):
    if os.name != 'nt':
        return None
    try:
        with open(str(exe) + ':Zone.Identifier', 'r', encoding='utf-8', errors='replace') as stream:
            return stream.read(1024)
    except OSError:
        return None


def get_exe(argv):
    if argv.exe:
        return Path(argv.exe).expanduser(), argv.game or Path(argv.exe).stem
    if not argv.game:
        raise ValueError('Specify --game "Game Name" or --exe "C:\\...\\Game.exe"')
    data_path = Path(os.getenv('APPDATA') or Path.home()) / 'Nexus Game Launcher' / 'games.json'
    if not data_path.is_file():
        raise ValueError(f'Nexus library not found: {data_path}. Use --exe.')
    data = json.loads(data_path.read_text(encoding='utf-8-sig'))
    games = data if isinstance(data, list) else data.get('games', [])
    matches = [g for g in games if isinstance(g, dict) and
               g.get('name', '').casefold() == argv.game.casefold()]
    if len(matches) != 1:
        raise ValueError(f'Game name matched {len(matches)} entries; use --exe for the exact path.')
    return Path(matches[0]['path']), matches[0]['name']


def inspect(exe, name):
    print(f'[GAME] {name}')
    print(f'[EXE]  {exe}')
    if not exe.is_file():
        print('[RESULT] Executable not found. Check the path stored in Nexus.')
        return 2
    print(f'[FILE] Exists, {exe.stat().st_size:,} bytes. Executable is NOT being launched by this tool.')
    level = None
    external = Path(str(exe) + '.manifest')
    if external.is_file():
        try:
            level = manifest_level(decode_manifest(external.read_bytes()))
            print(f'[MANIFEST] External manifest: {level or "no requestedExecutionLevel"}')
        except OSError as err:
            print('[MANIFEST] External manifest unreadable:', err)
    embedded, error = embedded_manifest(exe)
    if embedded:
        embedded_level = manifest_level(embedded)
        print(f'[MANIFEST] Embedded requestedExecutionLevel: {embedded_level or "not declared"}')
        # External manifests may not override embedded ones. Print both.
        if level is None:
            level = embedded_level
    else:
        print('[MANIFEST]', error)
    layers = compatibility_layers(exe)
    if layers:
        for hive, value in layers:
            print(f'[COMPAT] {hive}: {value}')
    else:
        print('[COMPAT] No per-path RUNASADMIN flag found in the checked registry keys.')
    mark = blocked_zone(exe)
    print('[DOWNLOAD MARK] Zone.Identifier stream present' if mark else
          '[DOWNLOAD MARK] No Zone.Identifier stream was readable')
    run_as_admin = any('RUNASADMIN' in value.upper() for _, value in layers)
    if run_as_admin or level in ('requireAdministrator', 'highestAvailable'):
        print('[ASSESS] Elevation may be required by this EXE/Compatibility setting.')
        print('[NEXT] If Compatibility > Run as administrator is user-selected, disable it only if the game runs correctly without it.')
        print('[NEXT] An EXE that genuinely requires administrator privileges cannot reliably be forced to run as a standard user.')
    else:
        print('[ASSESS] No explicit administrator requirement detected by this read-only check.')
        print('[NEXT] If launching directly from File Explorer also fails, check Windows Security and NTFS permissions.')
        print('[NEXT] If Explorer works without elevation, check launch arguments, file quarantine, and the executable selected in Nexus.')
    print('[SAFE] No elevation, DLL injection, launch, registry changes, ACL changes, or file modifications.')
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description='Inspect a Nexus game executable without launching or elevating it')
    parser.add_argument('--game', help='Exact Nexus library display name')
    parser.add_argument('--exe', help='Full Windows executable path')
    args = parser.parse_args(argv)
    try:
        exe, name = get_exe(args)
        return inspect(exe, name)
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as err:
        print('[ERROR]', err)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
