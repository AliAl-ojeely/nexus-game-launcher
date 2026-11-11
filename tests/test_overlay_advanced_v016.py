import importlib.util
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
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
    def test_no_win32_hook_change(self):
        text=(ROOT/'tools/nexus_input_bridge.py').read_text('utf-8')
        self.assertIn('WH_KEYBOARD_LL = 13',text)
        self.assertIn('MOD_NOREPEAT',text)
        self.assertIn('self.game_foreground()',text)
        self.assertIn('RegisterHotKey',text)

if __name__=='__main__':unittest.main()
