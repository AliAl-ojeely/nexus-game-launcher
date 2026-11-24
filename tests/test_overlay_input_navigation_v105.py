"""Pure input routing tests; no Windows hooks or game processes started."""
from __future__ import annotations
import ast
import ctypes
from pathlib import Path
import sys
import textwrap
import unittest
from types import SimpleNamespace

KIT=Path(__file__).resolve().parents[1]
WM_KEYDOWN,WM_KEYUP,WM_SYSKEYDOWN,WM_SYSKEYUP=0x100,0x101,0x104,0x105
KEYS={0x1B:'back',0x26:'up',0x28:'down',0x0D:'confirm'}
class KeyboardRecord(ctypes.Structure):
    _fields_=[('vkCode',ctypes.c_uint32),('scanCode',ctypes.c_uint32),('flags',ctypes.c_uint32),('time',ctypes.c_uint32),('dwExtraInfo',ctypes.c_size_t)]
class User32:
    def __init__(self):self.forwarded=[]
    def GetAsyncKeyState(self,k):return 0
    def CallNextHookEx(self,*args):self.forwarded.append(args);return 0x1357
class Bridge:
    def __init__(self,enabled,visible,quick_escape=True,focused=True):
        self.keyboard_navigation=enabled
        self.quick_escape=quick_escape
        self.visible=SimpleNamespace(is_set=lambda:visible)
        self.game_foreground=lambda:focused
        self.user32=User32()
        self._hook=42
        self.commands=[]
        self._emit=lambda name,src:self.commands.append((name,src))

def built_source():
    local=KIT/'tools/nexus_input_bridge.py'
    if local.is_file():
        src=local.read_text('utf-8')
        doc=ast.parse(src)
        cls=next(n for n in doc.body if isinstance(n,ast.ClassDef) and n.name=='WindowsInputBridge')
        loop=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='_keyboard_loop')
        fn=next(n for n in ast.walk(loop) if isinstance(n,ast.FunctionDef) and n.name=='callback')
        fn.decorator_list=[]
        return compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'<installed-nexus-input>','exec')
    # In the standalone kit, compile the exact v1.0.3 callback after its v1.0.4
    # Esc pass-through, then apply the v1.0.5 navigation guard.
    import importlib.util
    def load(rel):
        spec=importlib.util.spec_from_file_location('nx_'+rel.stem,KIT/'baseline'/rel)
        mod=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    v103=load(Path('quick_controls_v103_installer.py'))
    v104=load(Path('esc_passthrough_v104_installer.py'))
    snippet=v104.patch(v103.replacements('tools/nexus_input_bridge.py')[4][1])
    snippet=snippet.replace('if self.visible.is_set() and foreground:', 'if self.keyboard_navigation and self.visible.is_set() and foreground:',1)
    program='def callback(code,event,lparam):\n'+textwrap.indent(textwrap.dedent(snippet),'    ')+'\n    return u.CallNextHookEx(self._hook, code, event, lparam)\n'
    fn=ast.parse(program).body[0]
    return compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'<v105-input>','exec')

class Navigation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.compiled=built_source()
    def run_event(self,enabled,visible,key,quick=True,focused=True):
        obj=Bridge(enabled,visible,quick,focused)
        namespace={'ctypes':ctypes,'KBDLLHOOKSTRUCT':KeyboardRecord,
            'WM_KEYDOWN':WM_KEYDOWN,'WM_KEYUP':WM_KEYUP,'WM_SYSKEYDOWN':WM_SYSKEYDOWN,'WM_SYSKEYUP':WM_SYSKEYUP,
            'KEYS':KEYS,'self':obj,'pressed':set(),'u':obj.user32}
        exec(self.compiled,namespace)
        record=KeyboardRecord(vkCode=key)
        result=namespace['callback'](0,WM_KEYDOWN,ctypes.addressof(record))
        return result,obj
    def test_disabled_arrows_reach_game(self):
        ret,obj=self.run_event(False,True,0x26)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[])
    def test_disabled_enter_reaches_game(self):
        ret,obj=self.run_event(False,True,0x0D)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[])
    def test_enabled_navigation_still_works(self):
        ret,obj=self.run_event(True,True,0x28)
        self.assertEqual(ret,1)
        self.assertEqual(obj.commands,[('down','keyboard')])
    def test_quick_escape_passthrough_even_when_navigation_off(self):
        ret,obj=self.run_event(False,True,0x1B)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[('toggle','keyboard')])
    def test_non_quick_esc_passes_game_when_navigation_off(self):
        ret,obj=self.run_event(False,True,0x1B,quick=False)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[])
    def test_non_quick_esc_back_when_navigation_on(self):
        ret,obj=self.run_event(True,True,0x1B,quick=False)
        self.assertEqual(ret,1)
        self.assertEqual(obj.commands,[('back','keyboard')])
    def test_game_unfocused_never_intercepted(self):
        ret,obj=self.run_event(True,True,0x28,focused=False)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[])
    def test_overlay_hidden_no_intercept(self):
        ret,obj=self.run_event(True,False,0x28)
        self.assertEqual(ret,0x1357)
        self.assertEqual(obj.commands,[])
    def test_gamepad_off_routes_no_navigation(self):
        # The bridge passes `False` into the existing tested `input_events`
        # helper, whose contract is an empty event list for hidden mode.
        src=KIT/'tools/nexus_input_bridge.py'
        if src.exists():text=src.read_text('utf-8')
        else:text=(KIT/'transform_v105.py').read_text('utf-8')
        self.assertIn('self.gamepad_navigation',text)
        self.assertIn('input_events(old, current, self.visible.is_set() and self.gamepad_navigation)',text)
    def test_start_toggle_does_not_depend_on_navigation_flags(self):
        src=KIT/'tools/nexus_input_bridge.py'
        if src.exists():text=src.read_text('utf-8')
        else:text=(KIT/'baseline/quick_controls_v103_installer.py').read_text('utf-8')
        self.assertIn('start_release_edge',text)
        self.assertIn("self._emit('toggle', 'gamepad')",text)

if __name__=='__main__':
    unittest.main(verbosity=2)
