#!/usr/bin/env python3
"""Nexus D3D11 real-game POC. Windows x64 host; x86/x64 unprotected games only.

Read-only without --attach --confirm-unprotected. Never launches or changes a game,
never modifies Nexus statistics, and cannot uninstall a loaded DLL while game runs.
"""
from __future__ import annotations
import argparse
import ctypes
from ctypes import wintypes
import json
import ntpath
import os
import secrets
import queue
from pathlib import Path
import platform
import subprocess
import sys
import time
import threading

PROJECT = Path(__file__).resolve().parents[1]
BIN = PROJECT / "native" / "nexus-overlay" / "build" / "bin"


def native_paths_for_arch(arch: str) -> tuple[Path, Path]:
    """Never mix 32- and 64-bit injector/DLL pairs or CMake build trees."""
    if arch not in ("x86", "x64"):
        raise ValueError(f"Unsupported native architecture {arch!r}")
    directory = BIN if arch == "x64" else PROJECT / "native" / "nexus-overlay" / "build-x86" / "bin"
    return directory / "NexusOverlayInjector.exe", directory / "NexusOverlayHook.dll"


def native_opengl_dll_for_arch(arch: str) -> Path:
    if arch not in ('x86', 'x64'):
        raise ValueError(f'Unsupported native architecture {arch!r}')
    directory = BIN if arch == 'x64' else PROJECT / 'native' / 'nexus-overlay' / 'build-x86' / 'bin'
    return directory / 'NexusOpenGLHook.dll'


def native_d3d9_dll_for_arch(arch: str) -> Path:
    if arch not in ('x86', 'x64'):
        raise ValueError(f'Unsupported native architecture {arch!r}')
    directory = BIN if arch == 'x64' else PROJECT / 'native' / 'nexus-overlay' / 'build-x86' / 'bin'
    return directory / 'NexusD3D9Hook.dll'


def native_d3d12_dll_for_arch(arch: str) -> Path:
    """D3D12 pilot is currently x64 ONLY. Never inject an x64 DLL into x86."""
    if arch != 'x64':
        raise ValueError('D3D12 preview is supported on x64 only; no x86 DLL has been built')
    return BIN / 'NexusD3D12Hook.dll'


def choose_graphics_backend(modules: dict[str, str], preference: str = 'auto') -> str | None:
    """Only active Present telemetry proves the renderer: DLLs are provisional.

    D3D11/DXGI remains first choice for its known-good engine. In the legacy
    D3D9+OpenGL case D3D9 is tried first because OpenGL SwapBuffers was absent
    in Danganronpa v0.7.0. Override with --renderer opengl if needed.
    """
    if preference not in ('auto', 'd3d11', 'd3d12', 'd3d9', 'opengl'):
        raise ValueError('Unknown Nexus backend preference')
    d3d11 = 'd3d11.dll' in modules and 'dxgi.dll' in modules
    d3d12 = 'd3d12.dll' in modules and 'dxgi.dll' in modules
    # Only a provisional hint: both D3D12 and D3D12Core are required for
    # automatic DX12 trial when D3D11 is also present (Fatal Frame case).
    # The native backend still inspects the *actual* backbuffer at Present.
    d3d12_strong = d3d12 and 'd3d12core.dll' in modules
    d3d9 = 'd3d9.dll' in modules
    opengl = 'opengl32.dll' in modules
    if preference == 'd3d11': return 'd3d11' if d3d11 else None
    if preference == 'd3d12': return 'd3d12' if d3d12 else None
    if preference == 'd3d9': return 'd3d9' if d3d9 else None
    if preference == 'opengl': return 'opengl' if opengl else None
    if d3d12_strong: return 'd3d12'
    if d3d11: return 'd3d11'
    if d3d12: return 'd3d12'
    if d3d9: return 'd3d9'
    if opengl: return 'opengl'
    return None


# DX12 safety quarantine (v0.7.2.1). Do not remove before the D3D12 engine
# has passed a controlled synthetic-game GPU validation / queue-correlation test.
# A prior DX12 experiment ended in GPU-process exit and game fail-fast.  Blocking
# by both active module evidence and the affected game's executable prevents a
# race where optional DX12 DLLs load after the early architecture inspection.
DX12_CRASH_QUARANTINE_IMAGES = frozenset({'fatalframeii.exe'})


def dx12_safety_reason(backend: str, modules: dict[str, str], exe_path: str) -> str | None:
    image = ntpath.basename(str(exe_path).replace('/', '\\')).casefold()
    if image in DX12_CRASH_QUARANTINE_IMAGES:
        return ('This game is temporarily quarantined after a D3D12 GPU/game crash. '
                'The experimental DX12 DLL must not be injected.')
    if backend == 'd3d12':
        return ('The D3D12 renderer is temporarily disabled because it caused '
                'an unresolved GPU/game failure in testing.')
    # Even --renderer d3d11 cannot force past strong simultaneous DX12
    # evidence. The original process can load DX11 helper DLLs on a DX12 path.
    if all(name in modules for name in ('d3d12.dll', 'd3d12core.dll', 'dxgi.dll')):
        return ('Strong D3D12 module evidence is present. Renderer override '
                'cannot bypass the DX12 safety quarantine.')
    return None


def await_graphics_backend(win: 'WindowsProcess', pid: int, handle, delay: float, preference: str):
    start = time.monotonic()
    deadline = start + delay
    while True:
        if not win.running(handle):
            raise RuntimeError('The game exited during graphics API detection')
        modules = win.modules(pid)
        backend = choose_graphics_backend(modules, preference)
        if backend:
            # The Windows OpenGL loader can appear before the legacy D3D9
            # runtime. Give auto-dispatch a short grace period so we do not
            # prematurely choose WGL when the game later loads D3D9.
            if (backend == 'opengl' and preference == 'auto' and
                time.monotonic() < deadline and
                time.monotonic() < start + min(1.25, delay)):
                time.sleep(0.2)
                continue
            return backend, modules
        if time.monotonic() >= deadline:
            present = ', '.join(x for x in
                ('d3d11.dll', 'dxgi.dll', 'd3d12.dll', 'd3d12core.dll', 'd3d9.dll', 'vulkan-1.dll', 'opengl32.dll')
                if x in modules)
            raise RuntimeError('No supported D3D11/DXGI, D3D12/DXGI, D3D9 or OpenGL candidate. Loaded modules: ' +
                (present or 'none') + '. Vulkan renderer is NOT installed.')
        time.sleep(0.4)

TH32CS_SNAPPROCESS = 0x00000002
TH32CS_SNAPMODULE = 0x00000008
TH32CS_SNAPMODULE32 = 0x00000010
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
SYNCHRONIZE = 0x00100000
WAIT_OBJECT_0 = 0x00000000
WAIT_TIMEOUT = 0x00000102
ERROR_BAD_LENGTH = 24
INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value

# Not an anti-cheat detector. Just avoid clearly wrong targets, test harnesses, and launchers.
BLOCKED_EXES = {
    "electron.exe", "nexusoverlayinjector.exe", "nexusd3d11testgame.exe",
    "steam.exe", "epicgameslauncher.exe", "explorer.exe", "svchost.exe",
    "csrss.exe", "lsass.exe", "services.exe", "winlogon.exe", "dwm.exe",
    "taskmgr.exe", "cmd.exe", "powershell.exe", "pwsh.exe", "python.exe",
    "pythonw.exe", "bat_to_exe_converter_x64.exe", "crashreportclient.exe",
    "crashreporter.exe", "unins000.exe",
}


def normalized(path: str) -> str:
    """Lexical Windows path comparison; avoids confusing different game executables."""
    raw = str(path).replace("/", "\\")
    if raw.startswith("\\\\?\\"):
        raw = raw[4:]
    return ntpath.normcase(ntpath.normpath(raw))


def library_candidates(explicit: str | None = None) -> list[Path]:
    """Nexus database.js uses Electron app.getPath('userData'), not PROJECT/games.json.

    The packaged productName is Nexus Game Launcher; allow the npm package name
    and source checkout as fallbacks without writing to any of these files.
    """
    if explicit:
        return [Path(explicit).expanduser()]
    appdata = os.environ.get("APPDATA")
    candidates = []
    if appdata:
        candidates += [
            Path(appdata) / "Nexus Game Launcher" / "games.json",
            Path(appdata) / "mygamelauncher" / "games.json",
        ]
    candidates.append(PROJECT / "games.json")
    unique = []
    seen = set()
    for candidate in candidates:
        key = os.path.normcase(os.path.abspath(candidate))
        if key not in seen:
            seen.add(key)
            unique.append(candidate)
    return unique


def read_library(explicit: str | None = None) -> list[dict]:
    locations = library_candidates(explicit)
    errors = []
    for file in locations:
        try:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
            if not isinstance(data, list):
                raise ValueError("JSON root must be an array of game objects")
            games = [item for item in data if isinstance(item, dict) and
                     isinstance(item.get("path"), str) and
                     item["path"].lower().endswith(".exe")]
            print(f"[LIBRARY] Loaded {len(games)} executable entries from {file}", flush=True)
            return games
        except FileNotFoundError:
            errors.append(f"Missing: {file}")
        except (ValueError, TypeError, OSError, UnicodeError) as exc:
            errors.append(f"Cannot read {file}: {exc}")
    if explicit:
        raise RuntimeError("--library is unusable: " + "; ".join(errors))
    print("[WARN] Could not load a Nexus game library. Paths inspected:", flush=True)
    for issue in errors:
        print("  " + issue, flush=True)
    print("[TIP] You can specify --library <games.json> or --exe <absolute-running-game-path>.", flush=True)
    return []


def select_game(name: str, library: list[dict]) -> dict:
    matches = [item for item in library if str(item.get("name", "")).strip().casefold() == name.strip().casefold()]
    if not matches:
        raise RuntimeError(f"Game {name!r} not found in the loaded Nexus library. "
                           "Use --exe <actual-full-path> or --find <name-fragment>.")
    paths = {normalized(item["path"]) for item in matches}
    if len(paths) != 1:
        raise RuntimeError(f"Several library entries named {name!r} have different paths. "
                           "Specify --exe or --pid explicitly.")
    return matches[0]


def find_live_pid(win: "WindowsProcess", target_exe: str) -> int:
    """Bind to the current process by full path, never reuse an old session PID."""
    matches = []
    for candidate in win.all_processes():
        if candidate < 1 or candidate == os.getpid():
            continue
        try:
            handle = win.open(candidate)
        except OSError:
            continue
        try:
            if win.running(handle) and normalized(win.path(handle)) == normalized(target_exe):
                matches.append(candidate)
        except OSError:
            pass
        finally:
            win.k.CloseHandle(handle)
    if not matches:
        raise RuntimeError(f"No running process matches: {target_exe}. "
                           "Start the game and wait at its main menu, or use --find to identify the real executable.")
    if len(matches) != 1:
        raise RuntimeError(f"Found multiple running PIDs {matches} matching {target_exe}. "
                           "Specify --pid explicitly to choose one.")
    print(f"[SELECT] Current live PID automatically detected: {matches[0]}", flush=True)
    return matches[0]


def find_by_fragment(win: "WindowsProcess", fragment: str) -> None:
    query = fragment.strip().casefold()
    if len(query) < 2:
        raise RuntimeError("--find needs at least two characters")
    print(f"[FIND] Running executable paths containing {fragment!r}:", flush=True)
    found = 0
    for candidate in win.all_processes():
        if candidate < 1 or candidate == os.getpid():
            continue
        try:
            handle = win.open(candidate)
        except OSError:
            continue
        try:
            path = win.path(handle)
            if query in path.casefold():
                print(f"  PID {candidate} | {path}", flush=True)
                found += 1
        except OSError:
            pass
        finally:
            win.k.CloseHandle(handle)
    if not found:
        print("  None. Confirm the game is still running.", flush=True)
    print("[SAFE] Process discovery only; nothing was injected.", flush=True)


def library_match(path: str, library: list[dict]) -> dict | None:
    key = normalized(path)
    return next((game for game in library if normalized(game["path"]) == key), None)


class PROCESSENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD), ("th32DefaultHeapID", ctypes.c_size_t),
        ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
        ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG),
        ("dwFlags", wintypes.DWORD), ("szExeFile", wintypes.WCHAR * 260),
    ]


class MODULEENTRY32W(ctypes.Structure):
    _fields_ = [
        ("dwSize", wintypes.DWORD), ("th32ModuleID", wintypes.DWORD),
        ("th32ProcessID", wintypes.DWORD), ("GlblcntUsage", wintypes.DWORD),
        ("ProccntUsage", wintypes.DWORD), ("modBaseAddr", ctypes.c_void_p),
        ("modBaseSize", wintypes.DWORD), ("hModule", wintypes.HMODULE),
        ("szModule", wintypes.WCHAR * 256), ("szExePath", wintypes.WCHAR * 260),
    ]


class WindowsProcess:
    def __init__(self) -> None:
        self.k = ctypes.WinDLL("kernel32", use_last_error=True)
        k = self.k
        k.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k.OpenProcess.restype = wintypes.HANDLE
        k.CloseHandle.argtypes = (wintypes.HANDLE,)
        k.CloseHandle.restype = wintypes.BOOL
        k.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD,
                                                wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD))
        k.QueryFullProcessImageNameW.restype = wintypes.BOOL
        k.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        k.WaitForSingleObject.restype = wintypes.DWORD
        k.IsWow64Process.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL))
        k.IsWow64Process.restype = wintypes.BOOL
        k.CreateToolhelp32Snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
        k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
        k.Process32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
        k.Process32FirstW.restype = wintypes.BOOL
        k.Process32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(PROCESSENTRY32W))
        k.Process32NextW.restype = wintypes.BOOL
        k.Module32FirstW.argtypes = (wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W))
        k.Module32FirstW.restype = wintypes.BOOL
        k.Module32NextW.argtypes = (wintypes.HANDLE, ctypes.POINTER(MODULEENTRY32W))
        k.Module32NextW.restype = wintypes.BOOL
        k.GetTempPathW.argtypes = (wintypes.DWORD, wintypes.LPWSTR)
        k.GetTempPathW.restype = wintypes.DWORD

    def snapshot(self, flags: int, pid: int):
        for _ in range(6):
            handle = self.k.CreateToolhelp32Snapshot(flags, pid)
            if handle not in (None, 0, INVALID_HANDLE_VALUE):
                return handle
            if ctypes.get_last_error() != ERROR_BAD_LENGTH:
                break
            time.sleep(0.08)
        raise OSError(ctypes.get_last_error(), "Windows process/module snapshot failed")

    def open(self, pid: int):
        handle = self.k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE,
                                    False, pid)
        if not handle:
            raise OSError(ctypes.get_last_error(), f"Cannot inspect PID {pid}; access denied or closed")
        return handle

    def path(self, handle) -> str:
        size = wintypes.DWORD(32768)
        output = ctypes.create_unicode_buffer(size.value)
        if not self.k.QueryFullProcessImageNameW(handle, 0, output, ctypes.byref(size)):
            raise OSError(ctypes.get_last_error(), "QueryFullProcessImageNameW failed")
        return output.value

    def running(self, handle) -> bool:
        status = self.k.WaitForSingleObject(handle, 0)
        if status not in (WAIT_TIMEOUT, WAIT_OBJECT_0):
            raise OSError(ctypes.get_last_error(), "Unable to query process liveness")
        return status == WAIT_TIMEOUT

    def x64(self, handle) -> bool:
        wow = wintypes.BOOL()
        if not self.k.IsWow64Process(handle, ctypes.byref(wow)):
            raise OSError(ctypes.get_last_error(), "Unable to determine process architecture")
        return not bool(wow.value)  # On this x64 Windows host, WOW64 means a 32-bit game.

    def all_processes(self) -> list[int]:
        snapshot = self.snapshot(TH32CS_SNAPPROCESS, 0)
        try:
            item = PROCESSENTRY32W()
            item.dwSize = ctypes.sizeof(item)
            pids = []
            if self.k.Process32FirstW(snapshot, ctypes.byref(item)):
                while True:
                    pids.append(int(item.th32ProcessID))
                    item.dwSize = ctypes.sizeof(item)
                    if not self.k.Process32NextW(snapshot, ctypes.byref(item)):
                        break
            return pids
        finally:
            self.k.CloseHandle(snapshot)

    def modules(self, pid: int) -> dict[str, str]:
        # 64-bit Python needs SNAPMODULE32 as well to inspect x86 game DLLs.
        snapshot = self.snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)
        try:
            item = MODULEENTRY32W()
            item.dwSize = ctypes.sizeof(item)
            found = {}
            if self.k.Module32FirstW(snapshot, ctypes.byref(item)):
                while True:
                    found[item.szModule.lower()] = item.szExePath
                    item.dwSize = ctypes.sizeof(item)
                    if not self.k.Module32NextW(snapshot, ctypes.byref(item)):
                        break
            return found
        finally:
            self.k.CloseHandle(snapshot)

    def trace_path(self, pid: int) -> Path:
        output = ctypes.create_unicode_buffer(32768)
        length = self.k.GetTempPathW(len(output), output)
        if not length or length >= len(output):
            raise OSError(ctypes.get_last_error(), "Unable to determine Windows TEMP path")
        return Path(output.value) / f"NexusOverlayHook_{pid}.log"


def show_known_games(win: WindowsProcess, library: list[dict]) -> None:
    print("[NEXUS] Running game executables matching games.json (exact EXE path):", flush=True)
    results = []
    related = []
    game_dirs = [(normalized(ntpath.dirname(game["path"])) + "\\", game)
                 for game in library]
    for pid in win.all_processes():
        if not pid or pid == os.getpid():
            continue
        try:
            handle = win.open(pid)
        except OSError:
            continue
        try:
            executable = win.path(handle)
            if ntpath.basename(executable).lower() in BLOCKED_EXES:
                continue
            game = library_match(executable, library)
            if game:
                results.append((pid, game.get("name", "Unknown"), executable))
            else:
                match_dirs = [(folder, item) for folder, item in game_dirs
                              if normalized(executable).startswith(folder)]
                if match_dirs:
                    # Longest matching installation directory is the most specific.
                    _folder, item = max(match_dirs, key=lambda match: len(match[0]))
                    related.append((pid, item.get("name", "Unknown"), executable))
        except OSError:
            pass
        finally:
            win.k.CloseHandle(handle)
    for pid, name, exe in sorted(results, key=lambda x: x[1].lower()):
        print(f"  PID {pid:<7} | {name}\n      {exe}", flush=True)
    if related:
        print("[CANDIDATES] Processes under a registered game's installation folder "
              "(not automatically trusted as the game):", flush=True)
        for pid, name, exe in sorted(related, key=lambda item: item[1].lower()):
            print(f"  PID {pid:<7} | possible {name}\n      {exe}", flush=True)
    if not results and not related:
        print("  None. Confirm the game is still running, then retry.", flush=True)
    print("[TIP] If the saved EXE is a launcher, use --find <game-name-fragment> to "
          "get the real process path, then --exe <actual-full-path>.", flush=True)


def check_target(path: str, library: list[dict], explicit_exe: str | None) -> dict | None:
    name = ntpath.basename(path).lower()
    if name in BLOCKED_EXES or name.startswith("nexusoverlay"):
        raise RuntimeError(f"Refusing system/helper/wrapper executable: {name}")
    windows_root = normalized(os.environ.get("SystemRoot", r"C:\Windows"))
    if normalized(path).startswith(windows_root + "\\"):
        raise RuntimeError("Refusing to attach to a Windows system executable")
    if explicit_exe:
        if not Path(explicit_exe).is_file():
            raise RuntimeError(f"Explicit game EXE does not exist: {explicit_exe}")
        if normalized(path) != normalized(explicit_exe):
            raise RuntimeError("PID path differs from --exe; choose the actual running game EXE")
    game = library_match(path, library)
    if not game and not explicit_exe:
        raise RuntimeError("PID is not an exact path match in games.json. Provide --exe <full-path> to authorize it.")
    return game


def await_d3d11(win: WindowsProcess, pid: int, handle, delay: float) -> dict[str, str]:
    deadline = time.monotonic() + delay
    while True:
        if not win.running(handle):
            raise RuntimeError("The game exited during graphics API detection")
        modules = win.modules(pid)
        if "d3d11.dll" in modules and "dxgi.dll" in modules:
            return modules
        if time.monotonic() >= deadline:
            present = ", ".join(x for x in ("d3d11.dll", "dxgi.dll", "d3d12.dll", "vulkan-1.dll", "opengl32.dll") if x in modules)
            raise RuntimeError("D3D11 + DXGI were not both detected. Loaded graphics DLLs: " +
                               (present or "none (or unloaded)") +
                               ". This v0.3 renderer supports only D3D11; no injection attempted.")
        time.sleep(0.4)


def report_summary(seen: set[str], path: Path) -> None:
    for marker, label in (
        ("DLL_WORKER_STARTED", "Native DLL worker initialized"),
        ("HOOK_INSTALLED", "Native graphics hook installed"),
        ("PRESENT_CALLED", "Game's DXGI Present reached the hook"),
        ("OPENGL_SWAP_PRESENT", "Game actually reached OpenGL SwapBuffers"),
        ("D3D9_PRESENT_CALLED", "Game reached Direct3D9 Device Present"),
        ("D3D9_SWAPCHAIN_PRESENT_CALLED", "Game reached Direct3D9 SwapChain Present"),
        ("D3D9_PRESENTEX_CALLED", "Game reached Direct3D9Ex PresentEx"),
        ("D3D9_RENDERER_INITIALIZED", "Direct3D9 renderer initialized"),
        ("D3D12_DIRECT_QUEUE_OBSERVED", "Direct3D12 DIRECT queue observed"),
        ("D3D12_QUEUE_DEVICE_MATCH", "Direct3D12 queue matches backbuffer device"),
        ("D3D12_RENDERER_INITIALIZED", "D3D11On12 bridge renderer initialized"),
        ("OPENGL_RENDERER_INITIALIZED", "OpenGL renderer initialized"),
        ("PIPE_CONNECTED", "Native reader connected to Electron"),
        ("FRAME_RECEIVED", "Native reader received BGRA pixels"),
        ("FRAME_DRAWN", "First BGRA frame submitted to native renderer"),
        ("CURSOR_DRAWN", "Native full-game cursor drawn (v0.6.3)"),
    ):
        print(f"[{'OK' if marker in seen else 'UNKNOWN'}] {label}", flush=True)
    fullstates = sorted(x for x in seen if x.startswith("DXGI_FULLSCREEN_"))
    if fullstates:
        print("[DXGI] Swap-chain fullscreen observations: " + ", ".join(fullstates) +
              " (does not prove FSO disabled).", flush=True)
    if "OVERLAY_SHOWN" not in seen:
        print("[DIAG] Overlay SHOW was not confirmed by the native pipe. "
              "Check Ctrl+Shift+O or Start+Back before diagnosing rendering.", flush=True)
    elif "VISIBLE_PRESENT_CALLED" not in seen:
        print("[DIAG] Overlay SHOW arrived, but no visible Present was observed after it.", flush=True)
    if "PRESENT_SWAPCHAIN_D3D12" in seen:
        print("[DIAG] Actual DXGI Present swap chain exposes D3D12 device/back buffer.", flush=True)
    elif "PRESENT_SWAPCHAIN_D3D11" in seen:
        print("[DIAG] An actual DXGI Present swap chain exposes a D3D11 device.", flush=True)
    elif "PRESENT_SWAPCHAIN_UNKNOWN" in seen:
        print("[DIAG] The inspected DXGI Present swap chain could not be classified.", flush=True)
    if 'D3D12_PRESENT_HOOK_INSTALLED' in seen and 'PRESENT_CALLED' not in seen:
        print('[DIAG] D3D12 hook installed but no DXGI Present calls were observed.',flush=True)
    if 'OPENGL_HOOK_INSTALLED' in seen and 'OPENGL_SWAP_PRESENT' not in seen:
        print('[DIAG] OpenGL hook installed but no WGL/GDI SwapBuffers observed. The game may be using D3D9.', flush=True)
    if 'OPENGL_SWAP_PRESENT' in seen and 'OPENGL_VISIBLE_SWAP_PRESENT' not in seen:
        print('[DIAG] OpenGL swaps observed, but no swap after SHOW. Verify the game is still presenting.', flush=True)
    if 'D3D9_HOOK_INSTALLED' in seen and not any(x in seen for x in ('D3D9_PRESENT_CALLED', 'D3D9_SWAPCHAIN_PRESENT_CALLED', 'D3D9_PRESENTEX_CALLED')):
        print('[DIAG] D3D9 hooks installed but no D3D9 Present observed; try the explicit OpenGL renderer if this title uses OpenGL.', flush=True)
    if 'D3D9_VISIBLE_PRESENT_CALLED' in seen and 'FRAME_DRAWN' not in seen:
        print('[DIAG] D3D9 presented while visible but did not draw. Check D3D9_BEGINSCENE_FAILED and device/reset telemetry.', flush=True)
    if 'OPENGL_RENDERER_UNAVAILABLE' in seen:
        print('[DIAG] OpenGL context/shader requirements were not met. This preview needs OpenGL 3.0+.', flush=True)
    if "D3D12_QUEUE_NOT_CAPTURED_OR_AMBIGUOUS" in seen:
        print("[DIAG] Could not identify one matching DIRECT queue. Renderer refused to guess; re-test or inspect D3D12_QUEUE_AMBIGUOUS.",flush=True)
    if "D3D12_QUEUE_AMBIGUOUS" in seen:
        print("[DIAG] Multiple DIRECT queues on the swapchain device; automatic composition is intentionally disabled.",flush=True)
    if "D3D12_ON12_CREATE_FAILED" in seen:
        print("[DIAG] D3D11On12 bridge creation failed; review D3D12 device/queue and graphics driver.",flush=True)
    if "D3D12_BACKBUFFER_FORMAT_UNSUPPORTED" in seen:
        print("[DIAG] DX12 backbuffer uses HDR/unsupported format; pilot renderer skips it to protect the game.",flush=True)
    if "D3D12_CREATE_WRAPPED_FAILED" in seen:
        print("[DIAG] Could not wrap the game's D3D12 backbuffer for D3D11On12.",flush=True)
    if "OVERLAY_SHOWN" in seen and "FRAME_RECEIVED" not in seen:
        print("[DIAG] Overlay SHOW was received but no BGRA frame arrived from Electron.", flush=True)
    if "FRAME_DRAWN" in seen:
        print("[RESULT] C++ issued an overlay draw call. VISUALLY verify the widget in-game.", flush=True)
    else:
        print("[RESULT] No draw confirmation. Review SHOW, BGRA and actual swap-chain diagnostics above.", flush=True)
    print("[TRACE]", path, flush=True)


def run(args: argparse.Namespace) -> int:
    if platform.system() != "Windows" or ctypes.sizeof(ctypes.c_void_p) != 8:
        raise RuntimeError("Requires 64-bit Python on Windows x64")
    win = WindowsProcess()
    library = read_library(args.library)
    if args.find:
        find_by_fragment(win, args.find)
        return 0
    if args.list:
        show_known_games(win, library)
        return 0
    if not args.pid and not args.exe and not args.game:
        raise RuntimeError("Specify --game, --exe or --pid. Run --list or --find <fragment> first.")
    if args.game and args.exe:
        raise RuntimeError("Specify either --game or --exe, not both")
    if args.attach and not args.confirm_unprotected:
        raise RuntimeError("Attaching requires --confirm-unprotected; only test games you own without anti-cheat.")
    if args.managed:
        if not args.attach or not args.confirm_unprotected:
            raise RuntimeError('Managed mode requires the app-authorized unprotected-game attach flags')
        if not args.managed_actions_pipe or not args.managed_actions_token or not args.managed_game_id or not args.managed_session_id:
            raise RuntimeError('Managed mode needs the Nexus session control identity')
        if not args.managed_actions_pipe.startswith('\\\\.\\pipe\\nexus-app-session-'):
            raise RuntimeError('Unexpected Nexus app control pipe')
        if len(args.managed_actions_token) != 64 or any(c not in '0123456789abcdef' for c in args.managed_actions_token):
            raise RuntimeError('Invalid session control token')
    if args.confirm_unprotected and not args.attach:
        raise RuntimeError("--confirm-unprotected is only meaningful with --attach")
    target_exe = args.exe
    if args.game:
        selected = select_game(args.game, library)
        target_exe = selected["path"]
        print(f"[LIBRARY] Selected {selected.get('name', '<unnamed>')} "
              f"/ gameId {selected.get('id')}", flush=True)
    pid = args.pid if args.pid else find_live_pid(win, target_exe)
    handle = win.open(pid)
    try:
        if not win.running(handle):
            raise RuntimeError("Selected process is no longer running")
        actual = win.path(handle)
        match = check_target(actual, library, target_exe)
        target_arch = "x64" if win.x64(handle) else "x86"
        # Existing x86/x64 injectors are shared; DX12 preview itself is x64 only.
        injector, dll = native_paths_for_arch(target_arch)
        print(f"[ARCH] Game process: {target_arch}; matching native overlay selected", flush=True)
        print(f"[TARGET] PID: {pid}", flush=True)
        print(f"[TARGET] EXE: {actual}", flush=True)
        if match:
            print(f"[LIBRARY] {match.get('name', '<unnamed>')} / gameId {match.get('id')}", flush=True)
        backend, observed = await_graphics_backend(win, pid, handle, args.wait_d3d11, args.renderer)
        # Fail closed BEFORE Electron, input hooks, MinHook, or native injection.
        # Pure read-only mode is still permitted for diagnostics.
        if args.attach:
            blocked = dx12_safety_reason(backend, observed, actual)
            if blocked:
                print('[WARN] [DX12-SAFETY] BLOCKED: ' + blocked, flush=True)
                print('[WARN] [DX12-SAFETY] No Electron host, input bridge, or native DLL loaded. '
                      'D3D11/D3D9/OpenGL backends remain available.', flush=True)
                return 2
        if backend == 'd3d12':
            if target_arch != 'x64':
                raise RuntimeError('D3D12 pilot is x64 only; refusing an incompatible DLL')
            modules = observed
            dll = native_d3d12_dll_for_arch(target_arch)
            print('[API] D3D12/DXGI detected, trying independent D3D11On12 bridge (preview).',flush=True)
            print('[WARN] Graphics DLLs are hints; this backend verifies actual D3D12 backbuffers and observed queues.',flush=True)
        elif backend == 'd3d11':
            # Retain the verified D3D11 prerequisite for the stable DXGI path.
            modules = await_d3d11(win, pid, handle, args.wait_d3d11)
            print("[API] D3D11 and DXGI modules detected. This is a prerequisite, not proof of the renderer API.", flush=True)
            if 'd3d12.dll' in modules or 'vulkan-1.dll' in modules:
                print('[WARN] Other graphics APIs are also loaded. DXGI Present may use D3D12.', flush=True)
        elif backend == 'd3d9':
            modules = observed
            dll = native_d3d9_dll_for_arch(target_arch)
            print('[API] D3D9 module detected; trying legacy D3D9 Present/PresentEx/SwapChain hooks.', flush=True)
            if 'opengl32.dll' in modules:
                print('[WARN] OpenGL is ALSO loaded. D3D9 is a provisional candidate. --renderer opengl is available for manual comparison.', flush=True)
        else:
            modules = observed
            dll = native_opengl_dll_for_arch(target_arch)
            print('[API] OpenGL module detected; trying a real WGL/GDI SwapBuffers hook.', flush=True)
            if 'd3d9.dll' in modules:
                print('[WARN] D3D9 is ALSO loaded. OpenGL is a provisional candidate, not proven active.', flush=True)
        print(f'[GRAPHICS] Backend trial: {backend.upper()}', flush=True)
        if args.managed and (not match or str(match.get('id')) != args.managed_game_id):
            raise RuntimeError('Nexus-managed gameId no longer matches the installed library entry')
        if not args.attach:
            print("[READ-ONLY] Target validated. To attempt the overlay, append "
                  "--attach --confirm-unprotected.", flush=True)
            return 0
        electron = PROJECT / "node_modules" / "electron" / "dist" / "electron.exe"
        host_entry = PROJECT / "overlay" / "poc" / "host.cjs"
        for file in (injector, dll, electron, host_entry):
            if not file.is_file():
                raise RuntimeError(f"Missing {file}; build the {target_arch} native overlay first (v0.6.7)")
        trace = win.trace_path(pid)
        hook_names = {'d3d11': 'nexusoverlayhook.dll', 'opengl': 'nexusopenglhook.dll',
                      'd3d9': 'nexusd3d9hook.dll', 'd3d12': 'nexusd3d12hook.dll'}
        for other in (set(hook_names.values()) - {hook_names[backend]}):
            if other in modules:
                raise RuntimeError('Another Nexus graphics backend is loaded; restart the game before changing APIs.')
        selected_hook_name = hook_names[backend]
        hooked = modules.get(selected_hook_name)
        if hooked and normalized(hooked) != normalized(str(dll)):
            raise RuntimeError('An unexpected Nexus graphics hook DLL is already loaded. Refusing duplicate.')
        if hooked:
            print("[INFO] Same native DLL is already loaded; reconnecting Electron without reinjection.", flush=True)
        else:
            try:
                trace.unlink(missing_ok=True)  # Delete only this test's known trace, not game files.
            except OSError as exc:
                raise RuntimeError(f"Cannot reset test trace {trace}: {exc}") from exc
        env = os.environ.copy()
        env.pop("ELECTRON_RUN_AS_NODE", None)
        bridge = None
        control_token = secrets.token_hex(24) if not args.no_input else None
        host_args = [str(electron), str(host_entry), "--pid", str(pid)]
        session_game = match
        if session_game and session_game.get('id') is not None:
            host_args += ["--session-game-id", str(session_game['id'])]
            host_args += ["--session-game-name", str(session_game.get('name', ntpath.basename(actual)))]
        else:
            print('[SESSION] No matching gameId in Nexus library; live-session UI will stay NOT LINKED.', flush=True)
            host_args += ["--session-game-name", ntpath.basename(actual)]
        snapshot_file = (Path(args.session_file).expanduser() if args.session_file else
                         (Path(os.environ['APPDATA']) / 'Nexus Game Launcher' /
                          'nexus-overlay-session-v1.json') if os.environ.get('APPDATA') else None)
        if snapshot_file:
            host_args += ["--session-file", str(snapshot_file)]
            print('[SESSION] Read-only live source:', snapshot_file, flush=True)
        else:
            print('[SESSION] APPDATA unavailable; use --session-file <path> to select the session snapshot.', flush=True)
        if control_token:
            host_args += ["--control-token", control_token]
        if args.managed:
            host_args += ["--nexus-actions-pipe", args.managed_actions_pipe,
                          "--nexus-actions-token", args.managed_actions_token,
                          "--nexus-session-id", args.managed_session_id]
        print("[START] Electron offscreen host; it will NOT display a desktop window.", flush=True)
        managed_stop = threading.Event()
        if args.managed:
            # The app owns the helper's stdin; on Nexus shutdown its EOF is a
            # graceful stop request. The DLL is never forcibly unloaded.
            def listen_parent():
                try:
                    for line in sys.stdin:
                        if line.strip() == 'stop':
                            break
                except (OSError, ValueError):
                    pass
                managed_stop.set()
            threading.Thread(target=listen_parent, name='nexus-app-parent', daemon=True).start()
        host = subprocess.Popen(host_args, cwd=PROJECT, env=env)
        seen: set[str] = set()
        initial = time.monotonic()
        pointer = 0
        warned = False
        last_control_sync = 0.0
        tried_show = False
        try:
            time.sleep(1.4)
            if host.poll() is not None:
                raise RuntimeError(f"Electron host exited early ({host.returncode})")
            if control_token:
                from nexus_input_bridge import WindowsInputBridge, send_control
                response = send_control(pid, control_token, 'ping')
                if not response.get('ok'):
                    raise RuntimeError('Electron overlay control endpoint rejected the initial ping')
                bridge = WindowsInputBridge(pid, shortcut=args.overlay_shortcut)
                bridge.start()
                print(f'[CONTROL] Overlay initially HIDDEN; focus the game and press {bridge.hotkey_label}.', flush=True)
                print('[CONTROL] Xbox-compatible gamepad: press Start+Back to toggle.', flush=True)
            if not hooked:
                if not win.running(handle):
                    raise RuntimeError("Game exited before injection")
                if normalized(win.path(handle)) != normalized(actual):
                    raise RuntimeError("Game path changed since preflight; refusing injection")
                cmd = [str(injector), "--pid", str(pid), "--dll", str(dll),
                       "--expected-path", actual, "--allow-unprotected"]
                print(f"[ATTACH] Loading {dll.name} ({backend}) into the explicitly selected game PID.", flush=True)
                result = subprocess.run(cmd, cwd=PROJECT, check=False)
                if result.returncode:
                    raise RuntimeError(f"Native attach failed, exit status {result.returncode}")
            print(f"[TEST] Show the widget in-game with {bridge.hotkey_label if bridge else args.overlay_shortcut} or Start+Back.", flush=True)
            print("[TEST] Mouse: move the full-screen Nexus cursor freely; clicks on the widget are routed to HTML buttons.", flush=True)
            print("[TEST] Quit the game to unload DLL. Ctrl+C stops the host only.", flush=True)
            while win.running(handle) and not managed_stop.is_set():
                if bridge:
                    for _ in range(50):
                        try:
                            event, source = bridge.events.get_nowait()
                        except queue.Empty:
                            break
                        command = ('toggle' if event == 'toggle' else
                                   'pointer' if (event.startswith('mouse:') or event.startswith('mouse-screen:')) else 'navigate')
                        if command != 'toggle' and not bridge.visible.is_set():
                            continue
                        key = event.partition(':')[2] if command == 'pointer' else event
                        try:
                            reply = send_control(pid, control_token, command, key, source)
                            if reply.get('ok'):
                                bridge.set_visible(bool(reply.get('visible')))
                                if command == 'toggle':
                                    print(f"[CONTROL] {source} toggle: {'SHOW' if reply['visible'] else 'HIDE'}", flush=True)
                                    if reply.get('visible'): tried_show = True
                                elif command == 'navigate':
                                    print(f'[CONTROL] {source}: {event}', flush=True)
                                elif command == 'pointer' and (event.startswith('mouse:up:') or event.startswith('mouse-screen:up:')):
                                    print('[CONTROL] mouse: left click forwarded to Nexus UI', flush=True)
                        except (OSError, ValueError) as error:
                            print('[WARN] Input command delivery failed:', error, flush=True)
                    if time.monotonic() - last_control_sync >= 0.8:
                        last_control_sync = time.monotonic()
                        try:
                            reply = send_control(pid, control_token, 'ping')
                            if reply.get('ok'):
                                bridge.set_visible(bool(reply.get('visible')))
                        except (OSError, ValueError):
                            pass
                if trace.is_file():
                    try:
                        with trace.open("rb") as f:
                            f.seek(pointer)
                            chunk = f.read(32 * 1024)
                            pointer = f.tell()
                        for line in chunk.decode("utf-8", errors="replace").splitlines():
                            if "[NEXUS-HOOK] " in line:
                                milestone = line.partition("[NEXUS-HOOK] ")[2].strip()
                                if milestone and milestone not in seen:
                                    seen.add(milestone)
                                    print("[NATIVE]", milestone, flush=True)
                    except OSError as exc:
                        print("[WARN] Cannot read native trace:", exc, flush=True)
                if host.poll() is not None:
                    print("[ERROR] Electron host exited while the game is still running.", flush=True)
                    break
                if not warned and time.monotonic() - initial > 12 and "FRAME_DRAWN" not in seen and (not bridge or tried_show):
                    print(f'[DIAG] No confirmed {backend.upper()} draw yet; inspect D3D9_*PRESENT*, OPENGL_SWAP_PRESENT or PRESENT_CALLED, FRAME_RECEIVED and OVERLAY_SHOWN.', flush=True)
                    warned = True
                time.sleep(0.014 if bridge and bridge.visible.is_set() else 0.28)
            if managed_stop.is_set():
                print('[NEXUS OVERLAY] Nexus closed or the game session ended; stopping host.', flush=True)
            # Final trace read after game exits or host dies.
            if trace.is_file():
                for line in trace.read_text(encoding="utf-8", errors="replace").splitlines():
                    if "[NEXUS-HOOK] " in line:
                        seen.add(line.partition("[NEXUS-HOOK] ")[2].strip())
            report_summary(seen, trace)
            if bridge and not tried_show:
                print('[INFO] No show toggle observed; render test was not performed.', flush=True)
            return 0 if "FRAME_DRAWN" in seen else 8
        except KeyboardInterrupt:
            print("\n[STOP] Stopping Electron host; the game will NOT be terminated.", flush=True)
            if trace.is_file():
                for line in trace.read_text(encoding="utf-8", errors="replace").splitlines():
                    if "[NEXUS-HOOK] " in line:
                        seen.add(line.partition("[NEXUS-HOOK] ")[2].strip())
            report_summary(seen, trace)
            return 130
        finally:
            if bridge:
                bridge.stop()
            if host.poll() is None:
                host.terminate()
                try:
                    host.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    host.kill()
                    host.wait()
            if win.running(handle):
                print("[NOTE] Hook DLL is still loaded while the game lives. "
                      "To completely unload it, exit the game normally.", flush=True)
    finally:
        win.k.CloseHandle(handle)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Nexus Electron+C++ DX11/DX12/DX9/OpenGL preview for unprotected games.")
    parser.add_argument("--list", action="store_true", help="List running game processes from games.json")
    parser.add_argument("--pid", type=int, help="Optional current PID; auto-detected when --game or --exe is used")
    parser.add_argument("--game", type=str, help="Exact Nexus game name; automatically resolves its current PID")
    parser.add_argument("--find", type=str, help="Read-only executable-name search for running processes")
    parser.add_argument("--library", type=str, help="Optional absolute path to Nexus games.json")
    parser.add_argument("--exe", type=str, help="Full actual game EXE path when not matching games.json")
    parser.add_argument("--session-file", type=str, help="Optional Nexus session snapshot path; read-only")
    parser.add_argument('--renderer', choices=('auto', 'd3d11', 'd3d12', 'd3d9', 'opengl'), default='auto',
                        help='Graphics trial; auto checks D3D12Core, D3D11, D3D9, OpenGL in that order')
    parser.add_argument("--wait-d3d11", type=float, default=4.0, help="Wait up to this many seconds for a supported graphics module (default 4)")
    parser.add_argument("--attach", action="store_true", help="Request native DLL load (never automatic)")
    parser.add_argument("--no-input", action="store_true", help="Legacy always-visible draw test with no interactive controls")
    parser.add_argument("--overlay-shortcut", type=str, default="Ctrl+Shift+O", help="Validated Windows overlay hotkey")
    parser.add_argument('--managed', action='store_true', help='Started and owned by Nexus launcher')
    parser.add_argument('--managed-game-id', type=str)
    parser.add_argument('--managed-session-id', type=str)
    parser.add_argument('--managed-actions-pipe', type=str)
    parser.add_argument('--managed-actions-token', type=str)
    parser.add_argument("--confirm-unprotected", action="store_true",
                        help="Confirm you own the game and it has no online anti-cheat")
    args = parser.parse_args()
    if args.pid is not None and (args.pid < 1 or args.pid > 0xffffffff):
        parser.error("PID must be a positive Windows DWORD")
    if args.find and (args.attach or args.pid or args.game or args.exe or args.list):
        parser.error("--find is read-only and cannot be combined with attach or target selection")
    if args.list and (args.attach or args.pid or args.game or args.exe):
        parser.error("--list is read-only and cannot be combined with attach or target selection")
    if args.wait_d3d11 < 0 or args.wait_d3d11 > 60:
        parser.error("--wait-d3d11 must be between 0 and 60 seconds")
    try:
        return run(args)
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print("[ERROR]", error, file=sys.stderr, flush=True)
        return 2


if __name__ == "__main__":
    sys.exit(main())
