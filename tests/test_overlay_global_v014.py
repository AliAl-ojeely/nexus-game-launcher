"""Checks the preserved settings shell and the in-game UI contracts."""
import unittest
from pathlib import Path
R = Path(__file__).resolve().parents[1]

class OverlayGlobalTests(unittest.TestCase):
    def test_original_settings_controls_still_present(self):
        html = (R / 'index.html').read_text('utf8')
        for item in ('appNameSetting','openAppDataBtn','exportLibraryCsvBtn',
                     'systemTrayToggle','fpsToggle','themeSetting','langSetting',
                     'autoBackupToggle','globalBackupPath','scanVaultBtn','saveGeneralSettings'):
            self.assertEqual(html.count('id="'+item+'"'),1,item)
        for key in ('open_appdata_desc','auto_update_desc','export_library_csv_desc',
                    'backup_user_data_desc','system_tray_note','recent_limit_desc',
                    'auto_backup_desc','scan_vault_desc'):
            self.assertIn('data-i18n="'+key+'"',html)

    def test_overlay_origin_and_native_contract(self):
        css = (R/'overlay/poc/ui.css').read_text('utf8')
        host = (R/'overlay/poc/host.cjs').read_text('utf8')
        mask = (R/'overlay/poc/alpha_mask.cjs').read_text('utf8')
        self.assertIn('padding: 8px;',css)
        self.assertIn('border-radius: 18px;',css)
        self.assertIn('const WIDGET_PADDING = 8;',mask)
        self.assertIn('const WIDGET_RADIUS = 18;',mask)
        self.assertIn("header.write('NXF1'",host)
        self.assertIn('DX12_CRASH_QUARANTINE_IMAGES',(R/'tools/run_overlay_real_game.py').read_text('utf8'))

    def test_translations_and_global_control(self):
        tr=(R/'src/translations.js').read_text('utf8')
        html=(R/'index.html').read_text('utf8')
        for key in ('overlay_enable','overlay_enable_note','overlay_preview_error'):
            self.assertEqual(tr.count(key+':'),2,key)
        self.assertEqual(html.count('id="overlayEnabled"'),1)
        self.assertNotIn('id="detailsOverlayToggle"',html)

if __name__ == '__main__':
    unittest.main()
