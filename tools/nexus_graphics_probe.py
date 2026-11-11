#!/usr/bin/env python3
"""Nexus Cross-API Read-Only Graphics Probe v0.6.9.

Read-only Windows x64 process/module inspection. Does NOT inject DLLs,
launch games, patch processes, alter registries, or change Nexus databases.
DLL presence is a HEURISTIC, not proof of the active graphics API.
"""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
import json
import ntpath
import os
from pathlib import Path
import platform
import sys
import time

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE = 0x00100000
TH32CS_SNAPPROCESS = 0x00000002
TH32CS_SNAPMODULE = 0x00000008
TH32CS_SNAPMODULE32 = 0x00000010
ERROR_BAD_LENGTH = 24
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
GRAPHICS_DLLS = (
    'dxgi.dll', 'd3d11.dll', 'd3d12.dll', 'd3d12core.dll', 'd3d11on12.dll',
    'd3d10.dll', 'd3d10_1.dll', 'd3d9.dll', 'vulkan-1.dll', 'opengl32.dll',
    'gdi32.dll', 'nvoglv64.dll', 'atio6axx.dll'
)


def norm_windows_path(path: str) -> str:
    value = str(path).replace('/', '\\')
    if value.startswith('\\\\?\\'):
        value = value[4:]
    return ntpath.normcase(ntpath.normpath(value))


def classify_modules(modules: set[str] | dict[str, str]) -> dict:
    """Identify candidate APIs from DLL presence. Never claim proof of active use."""
    names = {str(name).casefold() for name in modules}
    evidence = []
    if 'd3d12.dll' in names or 'd3d12core.dll' in names:
        evidence.append({'api': 'D3D12', 'reason': 'd3d12.dll / d3d12core.dll loaded'})
    if 'd3d11.dll' in names:
        evidence.append({'api': 'D3D11', 'reason': 'd3d11.dll loaded'})
    if 'vulkan-1.dll' in names:
        evidence.append({'api': 'Vulkan', 'reason': 'vulkan-1.dll loaded'})
    if 'opengl32.dll' in names:
        evidence.append({'api': 'OpenGL', 'reason': 'opengl32.dll loaded'})
    if 'd3d9.dll' in names:
        evidence.append({'api': 'D3D9', 'reason': 'd3d9.dll loaded'})
    if 'd3d10.dll' in names or 'd3d10_1.dll' in names:
        evidence.append({'api': 'D3D10', 'reason': 'd3d10*.dll loaded'})
    active = [item['api'] for item in evidence]
    if not active:
        conclusion = 'UNKNOWN'
        status = 'No recognizable API runtime DLL detected yet.'
    elif len(active) == 1:
        conclusion = active[0] + '_CANDIDATE'
        status = 'One graphics API candidate based on loaded DLLs, not active render calls.'
    else:
        conclusion = 'AMBIGUOUS'
        status = 'Multiple API DLLs present. Native render-path inspection is required.'
    # The current native renderer calls IDXGISwapChain::GetDevice(ID3D11Device).
    # Neither DXGI nor d3d11.dll alone establishes an active D3D11 swap chain.
    if 'D3D11' in active and not any(x in active for x in ('D3D12', 'Vulkan', 'OpenGL', 'D3D9', 'D3D10')):
        next_step = 'TRY_D3D11_WITH_NATIVE_TELEMETRY'
    elif 'D3D12' in active:
        next_step = 'D3D12_BACKEND_REQUIRED_OR_CONFIRM_ACTIVE_PATH'
    elif 'Vulkan' in active:
        next_step = 'VULKAN_LAYER_BACKEND_REQUIRED_OR_CONFIRM_ACTIVE_PATH'
    elif 'OpenGL' in active:
        next_step = 'D3D9_OR_OPENGL_BACKEND_REQUIRED_OR_CONFIRM_ACTIVE_PATH' if 'D3D9' in active else 'OPENGL_BACKEND_REQUIRED_OR_CONFIRM_ACTIVE_PATH'
    elif 'D3D9' in active or 'D3D10' in active:
        next_step = 'LEGACY_RENDERER_REQUIRED_OR_CONFIRM_ACTIVE_PATH'
    else:
        next_step = 'INSPECT_ACTUAL_PRESENT_PATH'
    return {
        'candidate_apis': active,
        'dll_evidence': evidence,
        'classification': conclusion,
        'statement': status,
        'next_step': next_step,
        'dxgi_loaded': 'dxgi.dll' in names,
        'd3d11on12_loaded': 'd3d11on12.dll' in names,
        'reliable_active_api': None,  # Module enumeration is not device inspection.
    }


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD), ('cntUsage', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD), ('th32DefaultHeapID', ctypes.c_size_t),
        ('th32ModuleID', wintypes.DWORD), ('cntThreads', wintypes.DWORD),
        ('th32ParentProcessID', wintypes.DWORD), ('pcPriClassBase', wintypes.LONG),
        ('dwFlags', wintypes.DWORD), ('szExeFile', wintypes.WCHAR * 260),
    ]


class MODULEENTRY32W(ctypes.Structure):
    _fields_ = [
        ('dwSize', wintypes.DWORD), ('th32ModuleID', wintypes.DWORD),
        ('th32ProcessID', wintypes.DWORD), ('GlblcntUsage', wintypes.DWORD),
        ('ProccntUsage', wintypes.DWORD), ('modBaseAddr', ctypes.c_void_p),
        ('modBaseSize', wintypes.DWORD), ('hModule', wintypes.HMODULE),
        ('szModule', wintypes.WCHAR * 256), ('szExePath', wintypes.WCHAR * 260),
    ]


class WindowsInspector:
    def __init__(self):
        if platform.system() != 'Windows' or ctypes.sizeof(ctypes.c_void_p) != 8:
            raise RuntimeError('This probe requires Windows x64 and 64-bit Python.')
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.k.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        self.k.OpenProcess.restype = wintypes.HANDLE
        self.k.CloseHandle.argtypes = (wintypes.HANDLE,)
        self.k.CloseHandle.restype = wintypes.BOOL
        self.k.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
        self.k.QueryFullProcessImageNameW.restype = wintypes.BOOL
        self.k.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        self.k.WaitForSingleObject.restype = wintypes.DWORD
        self.k.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
        self.k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        self.k.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
        self.k.Process32FirstW.restype = wintypes.BOOL
        self.k.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
        self.k.Process32NextW.restype = wintypes.BOOL
        self.k.Module32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W))
        self.k.Module32FirstW.restype = wintypes.BOOL
        self.k.Module32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W))
        self.k.Module32NextW.restype = wintypes.BOOL

    def snapshot(self, flags: int, pid: int):
        for _ in range(5):
            h = self.k.CreateToolhelp32Snapshot(flags, pid)
            if h not in (0, None, INVALID_HANDLE_VALUE):
                return h
            if ctypes.get_last_error() != ERROR_BAD_LENGTH:
                break
            time.sleep(.07)
        raise OSError(ctypes.get_last_error(), 'Windows process snapshot failed')

    def open_process(self, pid: int):
        h = self.k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, False, pid)
        if not h:
            raise OSError(ctypes.get_last_error(), f'OpenProcess({pid}) failed')
        return h

    def process_path(self, pid: int) -> str:
        h = self.open_process(pid)
        try:
            length = wintypes.DWORD(32768)
            buf = ctypes.create_unicode_buffer(length.value)
            if not self.k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(length)):
                raise OSError(ctypes.get_last_error(), f'QueryFullProcessImageNameW({pid}) failed')
            return buf.value
        finally:
            self.k.CloseHandle(h)

    def processes(self) -> list[int]:
        snap = self.snapshot(TH32CS_SNAPPROCESS, 0)
        try:
            entry = PROCESSENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            result = []
            if self.k.Process32FirstW(snap, ctypes.byref(entry)):
                while True:
                    result.append(int(entry.th32ProcessID))
                    entry.dwSize = ctypes.sizeof(entry)
                    if not self.k.Process32NextW(snap, ctypes.byref(entry)):
                        break
            return result
        finally:
            self.k.CloseHandle(snap)

    def modules(self, pid: int) -> dict[str, str]:
        snap = self.snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
        try:
            entry = MODULEENTRY32W()
            entry.dwSize = ctypes.sizeof(entry)
            result = {}
            if self.k.Module32FirstW(snap, ctypes.byref(entry)):
                while True:
                    result[entry.szModule.lower()] = entry.szExePath
                    entry.dwSize = ctypes.sizeof(entry)
                    if not self.k.Module32NextW(snap, ctypes.byref(entry)):
                        break
            return result
        finally:
            self.k.CloseHandle(snap)


def read_games(project: Path | None, explicit_library: Path | None) -> list[dict]:
    paths = []
    if explicit_library is not None:
        paths.append(explicit_library)
    else:
        if os.getenv('APPDATA'):
            paths.extend([
                Path(os.environ['APPDATA']) / 'Nexus Game Launcher' / 'games.json',
                Path(os.environ['APPDATA']) / 'mygamelauncher' / 'games.json',
            ])
        if project:
            paths.append(project / 'games.json')
    errors = []
    for path in paths:
        try:
            data = json.loads(path.read_text(encoding='utf-8-sig'))
            if not isinstance(data, list):
                raise ValueError('library must contain a JSON array')
            return [item for item in data if isinstance(item, dict)]
        except (OSError, ValueError) as exc:
            errors.append(f'{path}: {exc}')
    raise RuntimeError('Cannot read Nexus games.json. ' + ' | '.join(errors))


def target_from_args(args) -> tuple[str | None, dict | None]:
    if args.exe and args.game:
        raise ValueError('Specify either --game or --exe, not both')
    if args.game:
        games = read_games(Path(args.project) if args.project else None,
                           Path(args.library) if args.library else None)
        matches = [g for g in games if str(g.get('name', '')).strip().casefold() == args.game.strip().casefold()]
        if len(matches) != 1:
            raise RuntimeError(f'Expected one library entry for {args.game!r}; got {len(matches)}')
        exe = matches[0].get('path')
        if not exe or not str(exe).lower().endswith('.exe'):
            raise RuntimeError('Selected library entry has no executable path')
        return str(exe), matches[0]
    return args.exe, None


def inspect(args):
    win = WindowsInspector()
    target_path, selected = target_from_args(args)
    pid = args.pid
    if pid is None and not target_path:
        raise RuntimeError('Specify --game, --exe or --pid')
    if pid is None:
        exact = []
        for candidate in win.processes():
            if candidate <= 0 or candidate == os.getpid():
                continue
            try:
                path = win.process_path(candidate)
            except OSError:
                continue
            if norm_windows_path(path) == norm_windows_path(target_path):
                exact.append(candidate)
        if not exact:
            raise RuntimeError('Game process was not found. Start the game, wait at its menu, and retry. '
                               f'Expected EXE: {target_path}')
        if len(exact) > 1:
            raise RuntimeError(f'Multiple processes match the EXE ({exact}); choose --pid explicitly.')
        pid = exact[0]
    actual = win.process_path(pid)
    if target_path and norm_windows_path(actual) != norm_windows_path(target_path):
        raise RuntimeError(f'PID {pid} is {actual}, not the selected executable {target_path}')
    modules = win.modules(pid)
    result = classify_modules(modules)
    return {
        'tool': 'Nexus Cross-API Read-Only Probe v0.6.9',
        'process_id': pid,
        'process_exe': actual,
        'game_name': selected.get('name') if selected else None,
        'loaded_graphics_modules': {name: modules[name] for name in GRAPHICS_DLLS if name in modules},
        'graphics': result,
        'current_nexus_renderer': 'D3D11 x86/x64 only; D3D9/OpenGL/D3D12/Vulkan need separate backends',
        'readonly': True,
        'warning': 'Loaded DLLs are clues, not proof of the active swapchain/rendering API.',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', help='Nexus source directory containing games.json fallback')
    parser.add_argument('--library', help='Explicit Nexus games.json path')
    parser.add_argument('--game', help='Exact display name from games.json, e.g. Fatal Frame II Remake')
    parser.add_argument('--exe', help='Actual full path to a currently running game EXE')
    parser.add_argument('--pid', type=int, help='Exact live PID (can be used with --game for verification)')
    parser.add_argument('--json', action='store_true', help='Print machine-readable JSON')
    args = parser.parse_args(argv)
    try:
        result = inspect(args)
    except (ValueError, OSError, RuntimeError) as exc:
        print('[ERROR] ' + str(exc), file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    print(f"[GAME] {result['game_name'] or '(EXE/PID selected)'}")
    print(f"[TARGET] PID {result['process_id']} | {result['process_exe']}")
    names = result['loaded_graphics_modules']
    print('[MODULES] ' + (', '.join(names) if names else 'none of the checked graphics DLLs'))
    g = result['graphics']
    print(f"[CANDIDATES] {', '.join(g['candidate_apis']) or 'UNKNOWN'}")
    print(f"[CLASSIFICATION] {g['classification']}")
    print(f"[DISPATCH] {g['next_step']}")
    print('[CURRENT] Nexus draws through D3D11 (x86/x64), not D3D9/OpenGL/D3D12/Vulkan.')
    print('[IMPORTANT] Loaded DLLs are hints, not active render calls. D3D9/OpenGL detection requires API-specific telemetry.')
    print('[SAFE] No DLL injected, no game started, and no Nexus database/registry modified.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
