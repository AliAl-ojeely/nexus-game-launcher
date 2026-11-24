"""Test the actual installed keyboard loop, hook chain and parser with fake Win32.
No real keyboard/mouse hook, game, OS process or DLL is created.
"""
from __future__ import annotations
import ast
import ctypes
import importlib.util
from pathlib import Path
import queue
import sys
import threading
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'tools/nexus_input_bridge.py'
sys.path.insert(0, str(SOURCE.parent))
SPEC = importlib.util.spec_from_file_location('nx_bridge_under_test', SOURCE)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)

CTRL, ALT, SHIFT, WIN = 0x11, 0x12, 0x10, 0x5B
F1 = 0x70
DOWN, UP = bridge.WM_KEYDOWN, bridge.WM_KEYUP
TOGGLE = ('toggle', 'keyboard')

class HookChain:
    def __init__(self):
        self.focus = 101
        self.down = set()
        self.hooks = []
        self.delivered = []
        self.visited = []

    def dispatch(self, key, event=DOWN, flags=0, code=0):
        record = bridge.KBDLLHOOKSTRUCT(vkCode=key, flags=flags)
        self.visited = []
        return self.next(None, code, event, ctypes.addressof(record))

    def next(self, owner, code, event, lparam):
        active = [item for item in reversed(self.hooks) if item.keyboard is not None]
        offset = active.index(owner) + 1 if owner in active else 0
        if offset < len(active):
            self.visited.append(active[offset].pid)
            return active[offset].keyboard(code, event, lparam)
        self.delivered.append((self.focus, event))
        return 0

class FakeUser32:
    def __init__(self, hub, pid, fail_hook=False):
        self.hub, self.pid, self.fail_hook = hub, pid, fail_hook
        self.keyboard = None
        self.ready, self.finish = threading.Event(), threading.Event()
        self.removed = []
        self.hub.hooks.append(self)

    def GetForegroundWindow(self):
        return self.hub.focus or 0

    def GetWindowThreadProcessId(self, hwnd, pid):
        ctypes.cast(pid, ctypes.POINTER(bridge.wintypes.DWORD)).contents.value = hwnd
        return 1

    def GetAsyncKeyState(self, key):
        return -32768 if key in self.hub.down else 0

    def SetWindowsHookExW(self, kind, fn, module, tid):
        if kind == bridge.WH_KEYBOARD_LL:
            if self.fail_hook:
                return None
            self.keyboard = fn
            return self.pid * 10 + 1
        if kind == bridge.WH_MOUSE_LL:
            return self.pid * 10 + 2
        raise AssertionError('Unexpected hook type')

    def CallNextHookEx(self, hook, code, event, lparam):
        return self.hub.next(self, code, event, lparam)

    def UnhookWindowsHookEx(self, handle):
        self.removed.append(handle)
        if handle == self.pid * 10 + 1:
            self.keyboard = None
        return 1

    def GetMessageW(self, *args):
        self.ready.set()
        if not self.finish.wait(5):
            raise RuntimeError('Test did not shut down fake message loop')
        return 0

    # Intentionally no RegisterHotKey or UnregisterHotKey methods.

class Harness:
    def __init__(self, hub, pid, shortcut='Ctrl+F1', fail_hook=False):
        self.hub, self.pid = hub, pid
        self.obj = object.__new__(bridge.WindowsInputBridge)
        o = self.obj
        o.pid = pid
        o.hotkey_modifiers, o.hotkey_vk, o.hotkey_label = bridge.parse_overlay_hotkey(shortcut)
        o.user32 = self.u = FakeUser32(hub, pid, fail_hook)
        o.kernel32 = SimpleNamespace(GetCurrentThreadId=lambda:pid)
        o.HookProc = lambda fn:fn
        o.stop_event, o.visible = threading.Event(), threading.Event()
        o.events = queue.Queue()
        o.quick_escape, o.quick_start = True, True
        o.keyboard_navigation, o.gamepad_navigation = False, False
        o._hook = o._mouse_hook = o._raw_hwnd = None
        o._register_raw_mouse = lambda:True
        o._unregister_raw_mouse = lambda:None
        self.failure = None
        def run():
            try:
                o._keyboard_loop()
            except BaseException as e:
                self.failure = e
                self.u.ready.set()
        self.thread = threading.Thread(target=run, daemon=True)
        self.thread.start()
        if not self.u.ready.wait(3):
            self.close()
            raise AssertionError('Keyboard loop did not initialize')
        if self.failure:
            self.close()
            raise self.failure

    def take(self):
        items=[]
        while not self.obj.events.empty():
            items.append(self.obj.events.get_nowait())
        return items

    def close(self):
        self.obj.stop_event.set()
        self.u.finish.set()
        self.thread.join(2)
        if self.thread.is_alive():
            raise AssertionError('Keyboard loop did not terminate')
        if self.failure:
            raise self.failure

class ForegroundTests(unittest.TestCase):
    def setUp(self):
        self.hub = HookChain()
        self.hub.down.add(CTRL)
        self.a = self.new(101)
        self.b = self.new(202)

    def new(self, pid, shortcut='Ctrl+F1', fail_hook=False):
        h=Harness(self.hub,pid,shortcut,fail_hook)
        self.addCleanup(h.close)
        return h

    def chord(self,key=F1):
        r1=self.hub.dispatch(key)
        r2=self.hub.dispatch(key,UP)
        return r1,r2

    def test_same_hotkey_for_two_helpers_only_foreground_toggles(self):
        self.assertEqual(self.chord(),(1,1))
        self.assertEqual(self.a.take(),[TOGGLE]); self.assertEqual(self.b.take(),[])
        self.hub.focus=202
        self.assertEqual(self.chord(),(1,1))
        self.assertEqual(self.b.take(),[TOGGLE]); self.assertEqual(self.a.take(),[])
        self.assertEqual(self.hub.visited,[202,101])

    def test_reverse_hook_order_still_routes_correctly(self):
        self.hub.hooks.reverse()
        self.hub.focus=202
        self.assertEqual(self.chord(),(1,1))
        self.assertEqual(self.a.take(),[]); self.assertEqual(self.b.take(),[TOGGLE])

    def test_toggle_once_per_physical_press_and_chain_observes_repeats(self):
        for _ in range(5):
            self.assertEqual(self.hub.dispatch(F1),1)
            self.assertEqual(self.hub.visited,[202,101])
        self.assertEqual(self.a.take(),[TOGGLE])
        self.hub.dispatch(F1,UP)
        self.chord()
        self.assertEqual(self.a.take(),[TOGGLE]); self.assertEqual(self.b.take(),[])

    def test_focus_switch_while_key_held_never_toggles_second_game(self):
        self.hub.dispatch(F1)
        self.hub.focus=202
        self.hub.dispatch(F1)
        self.hub.dispatch(F1,UP)
        self.assertEqual(self.a.take(),[TOGGLE]); self.assertEqual(self.b.take(),[])
        self.chord()
        self.assertEqual(self.b.take(),[TOGGLE])

    def test_outside_game_forwards_entire_chord_without_toggle(self):
        self.hub.focus=999
        self.assertEqual(self.chord(),(0,0))
        self.assertEqual(self.a.take()+self.b.take(),[])

    def test_background_press_then_focus_repeat_does_not_toggle(self):
        self.hub.focus=999
        self.hub.dispatch(F1)
        self.hub.focus=101
        self.hub.dispatch(F1)
        self.hub.dispatch(F1,UP)
        self.assertEqual(self.a.take()+self.b.take(),[])

    def test_wrong_or_extra_modifier_passes_to_game(self):
        for mods in (set(),{CTRL,ALT},{CTRL,SHIFT},{CTRL,WIN}):
            self.hub.down=mods
            self.assertEqual(self.chord(),(0,0))
        self.assertEqual(self.a.take()+self.b.take(),[])

    def test_releasing_extra_modifier_while_held_does_not_toggle(self):
        self.hub.down={CTRL,SHIFT}
        self.hub.dispatch(F1)
        self.hub.down={CTRL}
        self.hub.dispatch(F1)
        self.hub.dispatch(F1,UP)
        self.assertEqual(self.a.take()+self.b.take(),[])

    def test_injected_key_events_do_not_toggle_or_consume(self):
        for flags in (0x10,0x12,0x02):
            self.assertEqual(self.hub.dispatch(F1,flags=flags),0)
            self.assertEqual(self.hub.dispatch(F1,UP,flags),0)
        self.assertEqual(self.a.take()+self.b.take(),[])
        self.chord()
        self.assertEqual(self.a.take(),[TOGGLE])

    def test_injected_release_does_not_reset_physical_debounce(self):
        self.hub.dispatch(F1)
        self.hub.dispatch(F1,UP,0x10)
        self.hub.dispatch(F1)
        self.assertEqual(self.a.take(),[TOGGLE]); self.assertEqual(self.b.take(),[])

    def test_negative_hook_code_is_forwarded(self):
        self.assertEqual(self.hub.dispatch(F1,code=-1),0)
        self.assertEqual(self.a.take()+self.b.take(),[])

    def test_custom_ctrl_alt_shift_and_alt_syskey_shortcuts(self):
        c=self.new(303,'Ctrl+Alt+Shift+K')
        self.hub.focus=303; self.hub.down={CTRL,ALT,SHIFT}
        self.assertEqual(self.chord(ord('K')),(1,1))
        self.assertEqual(c.take(),[TOGGLE])
        d=self.new(404,'Alt+F7')
        self.hub.focus=404; self.hub.down={ALT}
        self.assertEqual(self.hub.dispatch(0x76,bridge.WM_SYSKEYDOWN),1)
        self.assertEqual(self.hub.dispatch(0x76,bridge.WM_SYSKEYUP),1)
        self.assertEqual(d.take(),[TOGGLE]); self.assertEqual(self.a.take()+self.b.take(),[])

    def test_plain_supported_function_key(self):
        c=self.new(303,'F8'); self.hub.focus=303; self.hub.down=set()
        self.assertEqual(self.chord(0x77),(1,1)); self.assertEqual(c.take(),[TOGGLE])

    def test_new_helper_started_while_os_reports_key_held_ignores_repeat(self):
        self.hub.down={CTRL,F1}; c=self.new(303); self.hub.focus=303
        self.hub.dispatch(F1); self.hub.dispatch(F1,UP)
        self.assertEqual(c.take(),[])
        self.hub.down={CTRL}; self.chord(); self.assertEqual(c.take(),[TOGGLE])

    def test_shortcut_independent_of_visible_state_and_navigation_flag(self):
        for visible in (False,True):
            for nav in (False,True):
                (self.a.obj.visible.set if visible else self.a.obj.visible.clear)()
                self.a.obj.keyboard_navigation=nav
                self.assertEqual(self.chord(),(1,1)); self.assertEqual(self.a.take(),[TOGGLE])

    def test_esc_passthrough_and_quick_toggle_still_work(self):
        self.hub.down=set(); self.a.obj.visible.set()
        self.assertEqual(self.chord(0x1B),(0,0)); self.assertEqual(self.a.take(),[TOGGLE])
        self.hub.focus=202
        self.assertEqual(self.chord(0x1B),(0,0)); self.assertEqual(self.b.take(),[TOGGLE])

    def test_keyboard_navigation_disabled_and_enabled_unchanged(self):
        self.a.obj.visible.set()
        self.assertEqual(self.chord(0x26),(0,0)); self.assertEqual(self.a.take(),[])
        self.a.obj.keyboard_navigation=True
        self.assertEqual(self.chord(0x26),(1,1)); self.assertEqual(self.a.take(),[('up','keyboard')])
        self.a.obj.visible.clear()
        self.assertEqual(self.chord(0x0D),(0,0)); self.assertEqual(self.a.take(),[])

    def test_close_first_helper_never_disables_second(self):
        self.a.close(); self.hub.focus=202
        self.assertEqual(self.chord(),(1,1)); self.assertEqual(self.b.take(),[TOGGLE])
        self.assertEqual(self.a.u.removed,[1011,1012])

    def test_restarted_helper_same_shortcut_no_global_registration(self):
        self.a.close(); c=self.new(303); self.hub.focus=303
        self.chord(); self.assertEqual(c.take(),[TOGGLE])
        self.hub.focus=202; self.chord(); self.assertEqual(self.b.take(),[TOGGLE])

    def test_hook_failure_does_not_reserve_or_break_other_helper(self):
        c=self.new(303,fail_hook=True)
        self.hub.focus=303; self.assertEqual(self.chord(),(0,0)); self.assertEqual(c.take(),[])
        self.hub.focus=202; self.chord(); self.assertEqual(self.b.take(),[TOGGLE])

    def test_reserved_shortcuts_still_rejected(self):
        for label in ('Alt+F4','Ctrl+S','Ctrl+Ctrl+F1','Escape','F12','Shift+F1'):
            with self.assertRaises(ValueError): bridge.parse_overlay_hotkey(label)

    def test_no_desktop_global_registration_remains(self):
        tree=ast.parse(SOURCE.read_text('utf-8'))
        attrs={n.attr for n in ast.walk(tree) if isinstance(n,ast.Attribute)}
        self.assertTrue({'RegisterHotKey','UnregisterHotKey'}.isdisjoint(attrs))
        self.assertIn('NEXUS_FOREGROUND_SHORTCUT_V107',SOURCE.read_text('utf-8'))

if __name__=='__main__':unittest.main(verbosity=2)
