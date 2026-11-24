"""Test the real patched Windows LL keyboard callback with fake Win32 calls.

No game, DLL, input hook or Windows process is started. If invoked inside the
Nexus project, source is read from the installed input bridge. Otherwise a
synthetic callback is reconstructed from the exact reviewed v1.0.3 anchor.
"""
from __future__ import annotations
import ast
import ctypes
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import textwrap
import unittest

sys.dont_write_bytecode=True
ROOT=Path(__file__).resolve().parents[1]
KIT=ROOT if (ROOT/'install.py').is_file() and (ROOT/'baseline').is_dir() else None
if KIT is None:
    # Running after installation: read kit patch only if current tests include it.
    # The installed source is used for all real callback tests, not copied text.
    PASS_THROUGH_FLAG="return u.CallNextHookEx(self._hook, code, event, lparam)"
else:
    sys.path.insert(0,str(KIT))
    from install import patch,v103_module,OLD,NEW

WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP=0x100,0x101,0x104,0x105
KEYS={0x1B:'back',0x26:'up',0x0D:'confirm'}

class KeyboardRecord(ctypes.Structure):
    _fields_=[('vkCode',ctypes.c_uint32),('scanCode',ctypes.c_uint32),
              ('flags',ctypes.c_uint32),('time',ctypes.c_uint32),
              ('dwExtraInfo',ctypes.c_size_t)]

class FakeUser32:
    def __init__(self):self.forwarded=[];self.modifiers=set()
    def GetAsyncKeyState(self, code):return 0x8000 if code in self.modifiers else 0
    def CallNextHookEx(self,*args):self.forwarded.append(args);return 0x5A5A

class FakeBridge:
    def __init__(self, visible=False, enabled=True, focused=True):
        self.user32=FakeUser32()
        self.quick_escape=enabled
        self.keyboard_navigation=True  # v1.0.5 introduced this flag.
        self.visible=SimpleNamespace(is_set=lambda:visible)
        self.game_foreground=lambda:focused
        self._hook=55
        self.events=[]
        self._emit=lambda cmd,src:self.events.append((cmd,src))

def extract_callback():
    installed=ROOT/'tools'/'nexus_input_bridge.py'
    if installed.is_file():
        source=installed.read_text('utf-8')
        tree=ast.parse(source)
        klass=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='WindowsInputBridge')
        keyboard=next(n for n in klass.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name=='_keyboard_loop')
        nested=next(n for n in ast.walk(keyboard) if isinstance(n,ast.FunctionDef) and n.name=='callback')
        # Explicit textual and syntax proof that the installed quick Esc branch forwards input.
        sub=ast.get_source_segment(source,nested)
        assert 'if key == 0x1B and self.quick_escape and foreground:' in sub
        assert 'return u.CallNextHookEx(self._hook, code, event, lparam)' in sub
        callback_body=textwrap.dedent(sub)
        fn=ast.parse(callback_body).body[0]
        fn.decorator_list=[]  # Replace only the Win32 callback wrapping decorator in tests.
    else:
        if KIT is None:raise RuntimeError('Project input helper is unavailable')
        original=v103_module().replacements('tools/nexus_input_bridge.py')[4][1]
        upgraded=patch(original)
        callback_body='def callback(code,event,lparam):\n'+textwrap.indent(textwrap.dedent(upgraded),'    ')+'\n    return u.CallNextHookEx(self._hook, code, event, lparam)\n'
        fn=ast.parse(callback_body).body[0]
    ast.fix_missing_locations(fn)
    return compile(ast.Module(body=[fn],type_ignores=[]),'<NexusEscV104Callback>','exec')

class EscRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.compiled=extract_callback()
    def setUp(self):
        self.bridge=FakeBridge()
        self.pressed=set()
        self.user32=self.bridge.user32
        namespace={
            'ctypes':ctypes,'KBDLLHOOKSTRUCT':KeyboardRecord,
            'WM_KEYDOWN':WM_KEYDOWN,'WM_KEYUP':WM_KEYUP,
            'WM_SYSKEYDOWN':WM_SYSKEYDOWN,'WM_SYSKEYUP':WM_SYSKEYUP,
            'KEYS':KEYS,'self':self.bridge,'pressed':self.pressed,'u':self.user32,
        }
        exec(self.compiled,namespace)
        self.callback=namespace['callback']
    def event(self,key=0x1B,kind=WM_KEYDOWN,flags=0):
        rec=KeyboardRecord(vkCode=key,flags=flags)
        return self.callback(0,kind,ctypes.addressof(rec))
    def test_esc_when_overlay_hidden_reaches_game_and_opens_overlay(self):
        self.assertEqual(self.event(),0x5A5A)
        self.assertEqual(self.bridge.events,[('toggle','keyboard')])
        self.assertEqual(len(self.user32.forwarded),1)
    def test_esc_when_overlay_visible_reaches_game_and_closes_overlay(self):
        self.bridge.visible.is_set=lambda:True
        self.assertEqual(self.event(),0x5A5A)
        self.assertEqual(self.bridge.events,[('toggle','keyboard')])
    def test_esc_keyup_also_reaches_game_for_real_pause_input(self):
        self.event()
        self.assertEqual(self.event(kind=WM_KEYUP),0x5A5A)
        self.assertEqual(len(self.user32.forwarded),2)
    def test_auto_repeat_only_toggles_once(self):
        self.event()
        self.event()
        self.event()
        self.event(kind=WM_KEYUP)
        self.event()
        self.assertEqual(self.bridge.events,[('toggle','keyboard'),('toggle','keyboard')])
        self.assertEqual(len(self.user32.forwarded),5)
    def test_modified_esc_passes_without_nexus_toggle(self):
        self.user32.modifiers.add(0x11)
        self.assertEqual(self.event(),0x5A5A)
        self.assertEqual(self.event(kind=WM_KEYUP),0x5A5A)
        self.assertEqual(self.bridge.events,[])
    def test_modifier_release_while_esc_held_does_not_toggle(self):
        self.user32.modifiers.add(0x11)
        self.event()
        self.user32.modifiers.clear()
        self.event()  # A repeat after Ctrl was released.
        self.assertEqual(self.bridge.events,[])
    def test_injected_esc_is_never_quick_toggle_but_passes_through(self):
        self.assertEqual(self.event(flags=0x10),0x5A5A)
        self.assertEqual(self.bridge.events,[])
    def test_unfocused_game_never_generates_toggle_or_consumes_esc(self):
        self.bridge.game_foreground=lambda:False
        self.bridge.visible.is_set=lambda:True
        self.assertEqual(self.event(),0x5A5A)
        self.assertEqual(self.bridge.events,[])
    def test_quick_mode_off_preserves_overlay_back_behavior(self):
        self.bridge.quick_escape=False
        self.bridge.visible.is_set=lambda:True
        self.assertEqual(self.event(),1)
        self.assertEqual(self.bridge.events,[('back','keyboard')])
        self.assertEqual(self.user32.forwarded,[])
    def test_quick_mode_off_game_receives_escape_when_overlay_hidden(self):
        self.bridge.quick_escape=False
        self.assertEqual(self.event(),0x5A5A)
        self.assertEqual(self.bridge.events,[])
    def test_other_navigation_still_consumed_only_while_overlay_visible(self):
        self.bridge.visible.is_set=lambda:True
        self.assertEqual(self.event(key=0x26),1)
        self.assertEqual(self.bridge.events,[('up','keyboard')])
        self.assertEqual(self.user32.forwarded,[])
    def test_other_navigation_unmodified_when_hidden(self):
        self.assertEqual(self.event(key=0x26),0x5A5A)
        self.assertEqual(self.bridge.events,[])
    def test_multiple_input_sources_not_duplicated(self):
        self.assertEqual(self.event(kind=WM_SYSKEYDOWN),0x5A5A)
        self.assertEqual(self.event(kind=WM_KEYDOWN),0x5A5A)
        self.assertEqual(self.bridge.events,[('toggle','keyboard')])

if __name__=='__main__':unittest.main(verbosity=2)
