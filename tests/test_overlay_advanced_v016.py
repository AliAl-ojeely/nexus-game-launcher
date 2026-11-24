import importlib.util
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
# Match the production runner's sibling-module import path.
sys.path.insert(0,str(ROOT/'tools'))
spec=importlib.util.spec_from_file_location('nexus_input_bridge',ROOT/'tools/nexus_input_bridge.py')
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)

class OverlayShortcutTest(unittest.TestCase):
    def test_valid_hotkeys(self):
        for raw,vk in [('Ctrl+Shift+O',ord('O')),('Alt+Q',ord('Q')),
                       ('F10',0x79),('Ctrl+Alt+1',ord('1'))]:
            mods,value,label=module.parse_overlay_hotkey(raw)
            self.assertEqual(value,vk)
            self.assertTrue(mods & module.MOD_NOREPEAT)
            self.assertEqual(label,raw)
    def test_reserved_and_invalid(self):
        for raw in ('F12','F4','Alt+F4','Ctrl+S','Win+R','Q','Shift+A','Ctrl+Alt+Delete','Ctrl+Ctrl+O',''):
            with self.subTest(raw=raw),self.assertRaises(ValueError):
                module.parse_overlay_hotkey(raw)
    def test_foreground_hook_without_global_reservation(self):
        text=(ROOT/'tools/nexus_input_bridge.py').read_text('utf-8')
        self.assertIn('WH_KEYBOARD_LL = 13',text)
        self.assertIn('MOD_NOREPEAT',text)
        self.assertIn('self.game_foreground()',text)
        self.assertIn('class ForegroundShortcut:',text)
        self.assertIn('SetWindowsHookExW(WH_KEYBOARD_LL, routed_callback',text)
        self.assertIn('self.game_foreground, u.GetAsyncKeyState',text)
        self.assertNotRegex(text,r'\b(?:RegisterHotKey|UnregisterHotKey)\s*\(')

if __name__=='__main__':unittest.main()
