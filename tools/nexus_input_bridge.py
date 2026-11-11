"""Windows-only external input router for the local Nexus D3D11 POC.

- Ctrl+Shift+O: global registered hotkey, active only while target game focused.
- Arrow/Enter/Escape: low-level keyboard hook, consumed only while overlay visible.
- XInput: Start+Back toggle; D-pad, A and B navigate. XInput events cannot be
  consumed here, so the game may respond too. Do not use in competitive games.
"""
from __future__ import annotations
import ctypes
from ctypes import wintypes
import queue
import threading
import time


WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
WM_MOUSEMOVE = 0x0200
WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0201, 0x0202
WM_INPUT = 0x00FF
RID_INPUT = 0x10000003
RIM_TYPEMOUSE = 0
RIDEV_REMOVE = 0x00000001
RIDEV_INPUTSINK = 0x00000100
MOUSE_MOVE_ABSOLUTE = 0x0001
RI_MOUSE_LEFT_BUTTON_DOWN = 0x0001
RI_MOUSE_LEFT_BUTTON_UP = 0x0002
LLMHF_INJECTED = 0x00000001
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
WM_KEYDOWN, WM_KEYUP = 0x0100, 0x0101
WM_SYSKEYDOWN, WM_SYSKEYUP = 0x0104, 0x0105
MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_NOREPEAT = 0x0001, 0x0002, 0x0004, 0x4000
HOTKEY_ID = 509


def parse_overlay_hotkey(raw: str):
    """Parse a validated Nexus shortcut without accepting OS-reserved keys."""
    if not isinstance(raw, str) or len(raw) > 40:
        raise ValueError('Invalid overlay shortcut')
    parts = [part.strip().upper() for part in raw.split('+')]
    if not parts or len(set(parts)) != len(parts) or any(not part for part in parts):
        raise ValueError('Invalid overlay shortcut')
    control, alt, shift = 'CTRL' in parts, 'ALT' in parts, 'SHIFT' in parts
    base = [part for part in parts if part not in ('CTRL', 'ALT', 'SHIFT')]
    if len(base) != 1:
        raise ValueError('Invalid overlay shortcut')
    key = base[0]
    if len(key) == 1 and ('A' <= key <= 'Z' or '0' <= key <= '9'):
        vk = ord(key)
    elif key.startswith('F') and key[1:].isdigit() and 1 <= int(key[1:]) <= 11:
        vk = 0x70 + int(key[1:]) - 1
    else:
        raise ValueError('Unsupported overlay shortcut')
    if not (control or alt) and (shift or not (key.startswith('F') and key[1:].isdigit() and 6 <= int(key[1:]) <= 11)):
        raise ValueError('Shortcut requires Ctrl/Alt or F6-F12')
    if alt and not control and key == 'F4':
        raise ValueError('Alt+F4 is reserved')
    if control and not alt and not shift and key in ('S', 'R', 'F', 'P', 'W', 'Q'):
        raise ValueError('Shortcut conflicts with launcher commands')
    mods = MOD_NOREPEAT | (MOD_CONTROL if control else 0) | (MOD_ALT if alt else 0) | (MOD_SHIFT if shift else 0)
    canonical = '+'.join((["Ctrl"] if control else []) + (["Alt"] if alt else []) + (["Shift"] if shift else []) + [key])
    return mods, vk, canonical
KEYS = {0x26: 'up', 0x28: 'down', 0x25: 'left', 0x27: 'right',
        0x0D: 'confirm', 0x1B: 'back'}
BUTTONS = [(0x0001, 'up'), (0x0002, 'down'), (0x0004, 'left'),
           (0x0008, 'right'), (0x1000, 'confirm'), (0x2000, 'back')]

class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [('vkCode', wintypes.DWORD), ('scanCode', wintypes.DWORD),
                ('flags', wintypes.DWORD), ('time', wintypes.DWORD),
                ('dwExtraInfo', ctypes.c_size_t)]

class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [('pt', wintypes.POINT), ('mouseData', wintypes.DWORD),
                ('flags', wintypes.DWORD), ('time', wintypes.DWORD),
                ('dwExtraInfo', ctypes.c_size_t)]


class XINPUT_GAMEPAD(ctypes.Structure):
    _fields_ = [('wButtons', wintypes.WORD), ('bLeftTrigger', wintypes.BYTE),
                ('bRightTrigger', wintypes.BYTE), ('sThumbLX', wintypes.SHORT),
                ('sThumbLY', wintypes.SHORT), ('sThumbRX', wintypes.SHORT),
                ('sThumbRY', wintypes.SHORT)]

class XINPUT_STATE(ctypes.Structure):
    _fields_ = [('dwPacketNumber', wintypes.DWORD), ('Gamepad', XINPUT_GAMEPAD)]


def input_events(previous: int, current: int, visible: bool) -> list[str]:
    if not visible or (current & 0x30) == 0x30:
        return []
    return [name for bit, name in BUTTONS if (current & bit) and not (previous & bit)]


WIDGET_WIDTH = 560
WIDGET_HEIGHT = 338


class VirtualCursor:
    """Overlay-local cursor that does not depend on the game's OS pointer lock.

    Kept deliberately pure for testing without Windows or a running game.
    Position is inside the 560 x 338 Electron OSR frame, not the desktop.
    """
    def __init__(self, width=WIDGET_WIDTH, height=WIDGET_HEIGHT, gain=1.25):
        self.width = width
        self.height = height
        self.gain = gain
        self.reset()

    def reset(self):
        # Near the action buttons, so the user never needs to reach the far
        # right of a captured game cursor just to reach Nexus.
        self.x = (self.width - 1) / 2
        self.y = min(self.height - 1, 265.0)
        return self.position()

    def position(self):
        return (round(self.x), round(self.y))

    def move(self, dx, dy, *, limit=180):
        if not isinstance(dx, int) or not isinstance(dy, int):
            return None
        if abs(dx) > 32767 or abs(dy) > 32767:
            return None
        # Keep a single malformed event from jumping the virtual pointer.
        dx = max(-limit, min(limit, dx))
        dy = max(-limit, min(limit, dy))
        self.x = max(0.0, min(self.width - 1.0, self.x + dx * self.gain))
        self.y = max(0.0, min(self.height - 1.0, self.y + dy * self.gain))
        return self.position()


class GameCursor:
    """Fast, screen-wide virtual pointer. The C++ renderer draws its sprite.

    A relative mouse device moves this pointer in *game client* pixels. Unlike
    VirtualCursor (the v0.6.2 compatibility helper), the active pointer is
    never clamped to the 560x338 Electron widget.
    """
    def __init__(self, width=1920, height=1080, gain=2.65):
        self.width = max(320, int(width))
        self.height = max(200, int(height))
        self.gain = max(0.8, min(6.0, float(gain)))
        self.reset()

    def reset(self):
        # Start near the actions in the top-right widget, then roam freely.
        self.x = float(max(0, self.width - 560 // 2 - 24))
        self.y = float(min(self.height - 1, 24 + 338 - 78))
        return self.position()

    def resize(self, width, height):
        if not isinstance(width, int) or not isinstance(height, int):
            return
        if width < 320 or height < 200 or width > 16384 or height > 16384:
            return
        if width == self.width and height == self.height:
            return
        u = self.x / max(1, self.width - 1)
        v = self.y / max(1, self.height - 1)
        self.width, self.height = width, height
        self.x = min(width - 1.0, u * (width - 1))
        self.y = min(height - 1.0, v * (height - 1))

    def position(self):
        return round(self.x), round(self.y)

    def move(self, dx, dy, *, limit=180):
        if type(dx) is not int or type(dy) is not int:
            return None
        if abs(dx) > 32767 or abs(dy) > 32767:
            return None
        dx = max(-limit, min(limit, dx))
        dy = max(-limit, min(limit, dy))
        # Sub-pixel accuracy on slow motion, modest acceleration on fast flicks.
        magnitude = max(abs(dx), abs(dy))
        acceleration = 1.0 + min(0.85, max(0, magnitude - 3) * 0.027)
        speed = self.gain * acceleration
        self.x = max(0.0, min(self.width - 1.0, self.x + dx * speed))
        self.y = max(0.0, min(self.height - 1.0, self.y + dy * speed))
        return self.position()

    def packet(self, kind):
        x, y = self.position()
        return f'mouse-screen:{kind}:{x}:{y}:{self.width}:{self.height}'


# Raw input structures use Windows fixed-width types even when unit tests run
# on Linux, where ctypes.wintypes.DWORD/LONG have different C ABI sizes.
class RAWINPUTDEVICE(ctypes.Structure):
    _fields_ = [('usUsagePage', ctypes.c_uint16), ('usUsage', ctypes.c_uint16),
                ('dwFlags', ctypes.c_uint32), ('hwndTarget', ctypes.c_void_p)]


class RAWINPUTHEADER(ctypes.Structure):
    _fields_ = [('dwType', ctypes.c_uint32), ('dwSize', ctypes.c_uint32),
                ('hDevice', ctypes.c_void_p), ('wParam', ctypes.c_size_t)]


class RAWMOUSE_BUTTON_BITS(ctypes.Structure):
    _fields_ = [('usButtonFlags', ctypes.c_uint16), ('usButtonData', ctypes.c_uint16)]


class RAWMOUSE_BUTTON_UNION(ctypes.Union):
    _fields_ = [('ulButtons', ctypes.c_uint32), ('bits', RAWMOUSE_BUTTON_BITS)]


class RAWMOUSE(ctypes.Structure):
    _fields_ = [('usFlags', ctypes.c_uint16), ('buttons', RAWMOUSE_BUTTON_UNION),
                ('ulRawButtons', ctypes.c_uint32), ('lLastX', ctypes.c_int32),
                ('lLastY', ctypes.c_int32), ('ulExtraInformation', ctypes.c_uint32)]


class RAWINPUT_MOUSE(ctypes.Structure):
    _fields_ = [('header', RAWINPUTHEADER), ('mouse', RAWMOUSE)]


def local_overlay_point(screen_x, screen_y, client_screen_x, client_screen_y,
                        client_width, client_height, width=WIDGET_WIDTH,
                        height=WIDGET_HEIGHT):
    if not all(isinstance(v, int) for v in (screen_x, screen_y, client_screen_x,
           client_screen_y, client_width, client_height, width, height)):
        return None
    if min(client_width, client_height, width, height) <= 0:
        return None
    if not (client_screen_x <= screen_x < client_screen_x + client_width and
            client_screen_y <= screen_y < client_screen_y + client_height):
        return None
    x0 = max(8, client_width - width - 24)
    y0 = 24
    x = screen_x - client_screen_x - x0
    y = screen_y - client_screen_y - y0
    if not (0 <= x < width and 0 <= y < height):
        return None
    return x, y


def is_raw_input_for_target(message: wintypes.MSG, target_hwnd) -> bool:
    """Match Windows MSG.hWnd (capital W), not the nonexistent MSG.hwnd.

    Keeping this separate from the Win32 message pump lets tests exercise
    Python's real ctypes.wintypes.MSG layout across supported interpreters.
    """
    return bool(target_hwnd) and message.message == WM_INPUT and message.hWnd == target_hwnd


class WindowsInputBridge:
    def __init__(self, pid: int, shortcut: str = 'Ctrl+Shift+O') -> None:
        self.pid = pid
        self.hotkey_modifiers, self.hotkey_vk, self.hotkey_label = parse_overlay_hotkey(shortcut)
        self.events: queue.Queue[tuple[str, str]] = queue.Queue(maxsize=128)
        self.visible = threading.Event()
        self.stop_event = threading.Event()
        self.user32 = ctypes.WinDLL('user32', use_last_error=True)
        self._keyboard_thread = None
        self._pad_thread = None
        self._keyboard_tid = None
        self._hook_callback = None
        self._hook = None
        self._mouse_hook = None
        self._mouse_callback = None
        self._mouse_last_move = (None, None)
        self._mouse_last_emit = 0.0
        self._mouse_captured = False
        self._pointer_lock = threading.Lock()
        import os
        try:
            speed = float(os.environ.get('NEXUS_MOUSE_SPEED', '2.65'))
        except ValueError:
            speed = 2.65
        self._cursor = GameCursor(gain=speed)
        self._screen_cursor = True
        self._last_bounds_check = 0.0
        self._fallback_last_screen = None
        self._raw_hwnd = None
        self._raw_registered = False
        self._last_raw_at = 0.0
        self._reported_raw_motion = False
        self._reported_click = False
        self._configure_api()

    def _configure_api(self) -> None:
        u = self.user32
        u.GetForegroundWindow.restype = wintypes.HWND
        u.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
        u.GetWindowThreadProcessId.restype = wintypes.DWORD
        u.RegisterHotKey.argtypes = (wintypes.HWND, ctypes.c_int, wintypes.UINT, wintypes.UINT)
        u.RegisterHotKey.restype = wintypes.BOOL
        u.UnregisterHotKey.argtypes = (wintypes.HWND, ctypes.c_int)
        u.UnregisterHotKey.restype = wintypes.BOOL
        u.GetClientRect.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.RECT))
        u.GetClientRect.restype = wintypes.BOOL
        u.ClientToScreen.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.POINT))
        u.ClientToScreen.restype = wintypes.BOOL
        self.HookProc = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)
        u.SetWindowsHookExW.argtypes = (ctypes.c_int, self.HookProc, wintypes.HINSTANCE, wintypes.DWORD)
        u.SetWindowsHookExW.restype = wintypes.HHOOK
        u.UnhookWindowsHookEx.argtypes = (wintypes.HHOOK,)
        u.UnhookWindowsHookEx.restype = wintypes.BOOL
        u.CallNextHookEx.argtypes = (wintypes.HHOOK, ctypes.c_int, ctypes.c_size_t, ctypes.c_ssize_t)
        u.CallNextHookEx.restype = ctypes.c_ssize_t
        u.GetMessageW.argtypes = (ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT)
        u.GetMessageW.restype = wintypes.BOOL
        u.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t)
        u.PostThreadMessageW.restype = wintypes.BOOL
        self.kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        self.kernel32.GetCurrentThreadId.restype = wintypes.DWORD
        self.kernel32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)
        self.kernel32.GetModuleHandleW.restype = wintypes.HINSTANCE
        u.CreateWindowExW.argtypes = (wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR,
            wintypes.DWORD, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
            wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p)
        u.CreateWindowExW.restype = wintypes.HWND
        u.DestroyWindow.argtypes = (wintypes.HWND,)
        u.DestroyWindow.restype = wintypes.BOOL
        u.RegisterRawInputDevices.argtypes = (ctypes.POINTER(RAWINPUTDEVICE), wintypes.UINT, wintypes.UINT)
        u.RegisterRawInputDevices.restype = wintypes.BOOL
        u.GetRawInputData.argtypes = (wintypes.HANDLE, wintypes.UINT, ctypes.c_void_p,
                                       ctypes.POINTER(wintypes.UINT), wintypes.UINT)
        u.GetRawInputData.restype = wintypes.UINT
        u.TranslateMessage.argtypes = (ctypes.POINTER(wintypes.MSG),)
        u.TranslateMessage.restype = wintypes.BOOL
        u.DispatchMessageW.argtypes = (ctypes.POINTER(wintypes.MSG),)
        u.DispatchMessageW.restype = ctypes.c_ssize_t

    def game_foreground(self) -> bool:
        hwnd = self.user32.GetForegroundWindow()
        if not hwnd:
            return False
        pid = wintypes.DWORD(0)
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value == self.pid

    def _emit(self, name: str, source: str) -> None:
        try:
            self.events.put_nowait((name, source))
        except queue.Full:
            pass

    def _mouse_position(self, screen_x: int, screen_y: int):
        # The mouse hook runs only on the active game and a visible overlay.
        # Convert per-monitor-aware screen coordinates into game client pixels.
        hwnd = self.user32.GetForegroundWindow()
        if not hwnd:
            return None
        pid = wintypes.DWORD(0)
        self.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value != self.pid:
            return None
        rect = wintypes.RECT()
        origin = wintypes.POINT(0, 0)
        if not self.user32.GetClientRect(hwnd, ctypes.byref(rect)):
            return None
        if not self.user32.ClientToScreen(hwnd, ctypes.byref(origin)):
            return None
        return local_overlay_point(screen_x, screen_y, origin.x, origin.y,
                                   rect.right - rect.left, rect.bottom - rect.top)

    def _update_game_client_size(self, *, force=False):
        if not getattr(self, '_screen_cursor', False):
            return
        now = time.monotonic()
        if not force and now - self._last_bounds_check < 0.22:
            return
        self._last_bounds_check = now
        try:
            hwnd = self.user32.GetForegroundWindow()
            if not hwnd:
                return
            rect = wintypes.RECT()
            if not self.user32.GetClientRect(hwnd, ctypes.byref(rect)):
                return
            width, height = int(rect.right - rect.left), int(rect.bottom - rect.top)
            with self._pointer_lock:
                self._cursor.resize(width, height)
        except (OSError, AttributeError, ValueError):
            pass

    def _pointer_event(self, kind):
        if getattr(self, '_screen_cursor', False):
            return self._cursor.packet(kind), 'mouse-screen'
        x, y = self._cursor.position()
        return f'mouse:{kind}:{x}:{y}', 'mouse'

    def set_visible(self, active: bool) -> None:
        """Called after a verified reply from the authenticated OSR host."""
        was_visible = self.visible.is_set()
        if active and not was_visible:
            self._update_game_client_size(force=True)
        if active and not was_visible:
            with self._pointer_lock:
                x, y = self._cursor.reset()
                self._fallback_last_screen = None
                self._last_raw_at = 0.0
                self._mouse_last_emit = 0.0
                self._mouse_last_move = (None, None)
            self.visible.set()
            event, source = self._pointer_event('move')
            self._emit(event, source)
        elif not active and was_visible:
            self.visible.clear()
            with self._pointer_lock:
                self._mouse_captured = False
                self._fallback_last_screen = None

    def _virtual_move(self, dx: int, dy: int, *, fallback=False) -> None:
        if not self.visible.is_set() or not self.game_foreground():
            return
        self._update_game_client_size()
        with self._pointer_lock:
            point = self._cursor.move(dx, dy, limit=48 if fallback else 180)
            if point is None:
                return
            now = time.monotonic()
            # Native DXGI sprite is updated independently of Electron's 16 fps BGRA.
            minimum = 0.012 if getattr(self, '_screen_cursor', False) else 0.025
            if point == self._mouse_last_move or now - self._mouse_last_emit < minimum:
                return
            self._mouse_last_emit = now
            self._mouse_last_move = point
            event, source = self._pointer_event('move')
        self._emit(event, source)

    def _virtual_click(self, down: bool) -> None:
        with self._pointer_lock:
            event, source = self._pointer_event('down' if down else 'up')
        self._emit(event, source)
        if not self._reported_click:
            self._reported_click = True
            print('[INPUT] Virtual Nexus pointer received mouse button input.', flush=True)

    def _register_raw_mouse(self) -> bool:
        """Hidden INPUTSINK receives relative device deltas even under cursor lock."""
        u = self.user32
        h_instance = self.kernel32.GetModuleHandleW(None)
        # The built-in STATIC class has a WndProc, so we need not inject a
        # window proc into the game or display any desktop overlay window.
        hwnd = u.CreateWindowExW(0, 'STATIC', 'Nexus Mouse Sink', 0, 0, 0, 0, 0,
                                 None, None, h_instance, None)
        if not hwnd:
            return False
        self._raw_hwnd = hwnd
        device = RAWINPUTDEVICE(1, 2, RIDEV_INPUTSINK, hwnd)
        if not u.RegisterRawInputDevices(ctypes.byref(device), 1, ctypes.sizeof(device)):
            u.DestroyWindow(hwnd)
            self._raw_hwnd = None
            return False
        self._raw_registered = True
        return True

    def _raw_message(self, handle) -> None:
        if not self.visible.is_set() or not self.game_foreground():
            return
        size = wintypes.UINT(0)
        header_size = ctypes.sizeof(RAWINPUTHEADER)
        error_code = 0xFFFFFFFF
        result = self.user32.GetRawInputData(handle, RID_INPUT, None,
                                             ctypes.byref(size), header_size)
        if result == error_code or size.value < ctypes.sizeof(RAWINPUT_MOUSE) or size.value > 4096:
            return
        buffer = (ctypes.c_byte * size.value)()
        result = self.user32.GetRawInputData(handle, RID_INPUT, buffer,
                                             ctypes.byref(size), header_size)
        if result == error_code or result < ctypes.sizeof(RAWINPUT_MOUSE):
            return
        raw = ctypes.cast(buffer, ctypes.POINTER(RAWINPUT_MOUSE)).contents
        if raw.header.dwType != RIM_TYPEMOUSE:
            return
        buttons = raw.mouse.buttons.bits.usButtonFlags
        if not (raw.mouse.usFlags & MOUSE_MOVE_ABSOLUTE):
            dx, dy = int(raw.mouse.lLastX), int(raw.mouse.lLastY)
            if dx or dy:
                self._last_raw_at = time.monotonic()
                if not self._reported_raw_motion:
                    self._reported_raw_motion = True
                    print('[INPUT] Relative RAW mouse movement detected; Nexus virtual cursor active.', flush=True)
                self._virtual_move(dx, dy)
        # Mouse low-level hooks see ordinary button events. Raw button flags
        # are a fallback if a game or policy prevents installing that hook.
        if not self._mouse_hook:
            if buttons & RI_MOUSE_LEFT_BUTTON_DOWN:
                self._virtual_click(True)
            if buttons & RI_MOUSE_LEFT_BUTTON_UP:
                self._virtual_click(False)

    def _unregister_raw_mouse(self) -> None:
        if self._raw_registered:
            device = RAWINPUTDEVICE(1, 2, RIDEV_REMOVE, None)
            self.user32.RegisterRawInputDevices(ctypes.byref(device), 1, ctypes.sizeof(device))
            self._raw_registered = False
        if self._raw_hwnd:
            self.user32.DestroyWindow(self._raw_hwnd)
            self._raw_hwnd = None

    def _keyboard_loop(self) -> None:
        # Per-monitor awareness avoids wrong hit-testing at 125%/150% DPI.
        try:
            setter = self.user32.SetThreadDpiAwarenessContext
            setter.argtypes = (ctypes.c_void_p,)
            setter.restype = ctypes.c_void_p
            setter(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
        except (AttributeError, OSError):
            pass
        self._keyboard_tid = int(self.kernel32.GetCurrentThreadId())
        pressed = set()
        u = self.user32
        @self.HookProc
        def callback(code, event, lparam):
            if code >= 0 and event in (WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP):
                key = int(ctypes.cast(lparam, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents.vkCode)
                if key in KEYS:
                    down = event in (WM_KEYDOWN, WM_SYSKEYDOWN)
                    if not down: pressed.discard(key)
                    if self.visible.is_set() and self.game_foreground():
                        if down and key not in pressed:
                            pressed.add(key)
                            self._emit(KEYS[key], 'keyboard')
                        return 1  # Swallow navigation only during active overlay/game focus.
            return u.CallNextHookEx(self._hook, code, event, lparam)
        self._hook_callback = callback  # Keep callback alive during the hook lifetime.
        self._hook = u.SetWindowsHookExW(WH_KEYBOARD_LL, callback, None, 0)
        if not self._hook:
            print('[INPUT] Keyboard hook unavailable; keyboard navigation disabled.', flush=True)
        @self.HookProc
        def mouse_callback(code, event, lparam):
            if code >= 0 and event in (WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP):
                try:
                    sample = ctypes.cast(lparam, ctypes.POINTER(MSLLHOOKSTRUCT)).contents
                    if not (sample.flags & LLMHF_INJECTED):
                        active = self.visible.is_set() and self.game_foreground()
                        if active:
                            if event == WM_MOUSEMOVE:
                                now = time.monotonic()
                                pos = (int(sample.pt.x), int(sample.pt.y))
                                with self._pointer_lock:
                                    previous = self._fallback_last_screen
                                    self._fallback_last_screen = pos
                                # Only fall back to desktop position deltas if
                                # this game/driver is not supplying RAW deltas.
                                if previous and now - self._last_raw_at > 0.6:
                                    dx, dy = pos[0] - previous[0], pos[1] - previous[1]
                                    if abs(dx) < 400 and abs(dy) < 400:
                                        self._virtual_move(dx, dy, fallback=True)
                                return 1  # Prevent regular WM_MOUSEMOVE in game.
                            if event == WM_LBUTTONDOWN:
                                if not self._mouse_captured:
                                    self._mouse_captured = True
                                    self._virtual_click(True)
                                return 1
                            if event == WM_LBUTTONUP:
                                if self._mouse_captured:
                                    self._mouse_captured = False
                                    self._virtual_click(False)
                                return 1
                        if event == WM_LBUTTONUP and self._mouse_captured:
                            self._mouse_captured = False
                            if getattr(self, '_screen_cursor', False):
                                self._emit('mouse-screen:cancel:0:0:1920:1080', 'mouse-screen')
                            else:
                                self._emit('mouse:cancel:0:0', 'mouse')
                            return 1
                except Exception:
                    pass  # Never crash the Windows hook callback over a game.
            return u.CallNextHookEx(self._mouse_hook, code, event, lparam)
        self._mouse_callback = mouse_callback
        self._mouse_hook = u.SetWindowsHookExW(WH_MOUSE_LL, mouse_callback, None, 0)
        if not self._mouse_hook:
            print('[INPUT] Low-level mouse hook unavailable; RAW mouse buttons will be best-effort.', flush=True)
        if self._register_raw_mouse():
            print('[INPUT] RAW relative mouse registered; virtual cursor does not require moving the Windows pointer over the widget.', flush=True)
        else:
            print('[INPUT] RAW mouse registration unavailable; using desktop cursor deltas as a fallback.', flush=True)
        registered = bool(u.RegisterHotKey(None, HOTKEY_ID, self.hotkey_modifiers, self.hotkey_vk))
        if not registered:
            print(f'[INPUT] {self.hotkey_label} unavailable (shortcut may be in use); use Start+Back or choose a different shortcut.', flush=True)
        message = wintypes.MSG()
        raw_error_logged = False
        try:
            while not self.stop_event.is_set():
                result = u.GetMessageW(ctypes.byref(message), None, 0, 0)
                if result <= 0:
                    break
                if message.message == WM_HOTKEY and message.wParam == HOTKEY_ID and self.game_foreground():
                    self._emit('toggle', 'keyboard')
                elif is_raw_input_for_target(message, self._raw_hwnd):
                    try:
                        self._raw_message(message.lParam)
                    except Exception as exc:
                        if not raw_error_logged:
                            raw_error_logged = True
                            print(f'[INPUT] RAW mouse packet ignored ({type(exc).__name__}: {exc}); keyboard shortcuts remain active.', flush=True)
                # Always dispatch to the STATIC window class for raw-input
                # cleanup (DefWindowProc) and standard message handling.
                u.TranslateMessage(ctypes.byref(message))
                u.DispatchMessageW(ctypes.byref(message))
        finally:
            if registered: u.UnregisterHotKey(None, HOTKEY_ID)
            if self._hook: u.UnhookWindowsHookEx(self._hook)
            if self._mouse_hook: u.UnhookWindowsHookEx(self._mouse_hook)
            self._unregister_raw_mouse()
            self._mouse_hook = None
            self._hook = None

    def _xinput_loop(self) -> None:
        dll = None
        for name in ('xinput1_4.dll', 'xinput1_3.dll', 'xinput9_1_0.dll'):
            try:
                dll = ctypes.WinDLL(name)
                break
            except OSError:
                continue
        if not dll:
            print('[INPUT] XInput not found; controller input unavailable.', flush=True)
            return
        get_state = dll.XInputGetState
        get_state.argtypes = (wintypes.DWORD, ctypes.POINTER(XINPUT_STATE))
        get_state.restype = wintypes.DWORD
        previous = [0] * 4
        last_toggle = 0.0
        while not self.stop_event.wait(0.045):
            if not self.game_foreground():
                previous = [0] * 4
                continue
            for index in range(4):
                state = XINPUT_STATE()
                current = state.Gamepad.wButtons if get_state(index, ctypes.byref(state)) == 0 else 0
                old = previous[index]
                previous[index] = current
                combo = (current & 0x30) == 0x30
                old_combo = (old & 0x30) == 0x30
                if combo and not old_combo and time.monotonic() - last_toggle > 0.6:
                    last_toggle = time.monotonic()
                    self._emit('toggle', 'gamepad')
                for name in input_events(old, current, self.visible.is_set()):
                    self._emit(name, 'gamepad')

    def start(self) -> None:
        self._keyboard_thread = threading.Thread(target=self._keyboard_loop, name='nexus-keyboard', daemon=True)
        self._pad_thread = threading.Thread(target=self._xinput_loop, name='nexus-xinput', daemon=True)
        self._keyboard_thread.start()
        self._pad_thread.start()
        print(f'[INPUT] {self.hotkey_label} toggle; virtual RAW mouse, arrows/Enter/Esc, Start+Back/D-pad/A/B.', flush=True)

    def stop(self) -> None:
        self.stop_event.set()
        if self._keyboard_tid:
            self.user32.PostThreadMessageW(self._keyboard_tid, WM_QUIT, 0, 0)
        if self._keyboard_thread: self._keyboard_thread.join(timeout=2.0)
        if self._pad_thread: self._pad_thread.join(timeout=2.0)


def send_control(pid: int, token: str, action: str, key: str = '', source: str = 'keyboard') -> dict:
    """Use byte-mode Win32 Named Pipes (Node net.createServer uses byte mode)."""
    import json
    pipe_name = f'\\\\.\\pipe\\nexus-overlay-control-{pid}'
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateFileW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE)
    k.CreateFileW.restype = wintypes.HANDLE
    k.WaitNamedPipeW.argtypes = (wintypes.LPCWSTR, wintypes.DWORD)
    k.WaitNamedPipeW.restype = wintypes.BOOL
    k.WriteFile.argtypes = (wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                             ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p)
    k.WriteFile.restype = wintypes.BOOL
    k.ReadFile.argtypes = (wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                            ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p)
    k.ReadFile.restype = wintypes.BOOL
    k.CloseHandle.argtypes = (wintypes.HANDLE,)
    k.CloseHandle.restype = wintypes.BOOL
    handle = k.CreateFileW(pipe_name, 0xC0000000, 0, None, 3, 0, None)
    if handle in (None, ctypes.c_void_p(-1).value):
        k.WaitNamedPipeW(pipe_name, 250)
        handle = k.CreateFileW(pipe_name, 0xC0000000, 0, None, 3, 0, None)
    if handle in (None, ctypes.c_void_p(-1).value):
        raise OSError(ctypes.get_last_error(), f'Cannot open Nexus control pipe {pid}')
    try:
        body = (json.dumps({'token': token, 'action': action, 'key': key,
                            'source': source}, separators=(',', ':')) + '\n').encode('utf-8')
        packet = ctypes.create_string_buffer(body)
        transferred = wintypes.DWORD(0)
        if not k.WriteFile(handle, packet, len(body), ctypes.byref(transferred), None):
            raise OSError(ctypes.get_last_error(), 'Nexus command write failed')
        chunks = bytearray()
        while len(chunks) < 2048:
            read_buffer = ctypes.create_string_buffer(512)
            count = wintypes.DWORD(0)
            if not k.ReadFile(handle, read_buffer, len(read_buffer), ctypes.byref(count), None) or count.value == 0:
                raise OSError(ctypes.get_last_error(), 'Nexus command reply lost')
            chunks.extend(read_buffer.raw[:count.value])
            if b'\n' in chunks:
                return json.loads(bytes(chunks).split(b'\n', 1)[0].decode('utf-8'))
        raise ValueError('Nexus command response exceeded size limit')
    finally:
        k.CloseHandle(handle)

# user custom modification
