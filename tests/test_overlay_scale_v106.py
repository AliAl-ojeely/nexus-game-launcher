#!/usr/bin/env python3
"""Standalone installed-project regression checks for Nexus Overlay v1.0.6.1.

Run: py -3 -B tests\\test_overlay_scale_v106.py
No transform_v106.py, installation kit, global Python path, or network needed.
The ZIP's original pre-install reconstruction tests remain in the v1.0.6.1
installer --self-test. This file tests the actual installed runtime sources.
"""
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


def source(rel):
    return (ROOT / rel).read_text(encoding='utf-8')


def node_check(code, *paths):
    result = subprocess.run(['node', '-e', code, *[str(ROOT / p) for p in paths]],
                            capture_output=True, text=True, encoding='utf-8',
                            errors='replace', timeout=20, cwd=ROOT, check=False)
    if result.returncode:
        raise AssertionError(f'Node runtime assertion failed ({result.returncode}): {result.stderr[-2500:]}')
    return result.stdout


class InstalledOverlayScaleTests(unittest.TestCase):
    def test_actual_project_has_expected_files(self):
        self.assertEqual((ROOT / 'package.json').is_file(), True)
        for rel in (
            'modules/overlay-config.js', 'overlay/poc/pointer_protocol.cjs',
            'overlay/poc/host.cjs', 'overlay/poc/ui.js',
            'overlay/poc/overlay-layout-v106.css', 'render/overlay-editor.js',
            'css/overlay-editor-layout-v106.css', 'index.html',
            'src/translations.js',
        ):
            with self.subTest(file=rel):
                self.assertTrue((ROOT / rel).is_file(), f'Missing installed overlay asset: {rel}')

    def test_pointer_projection_all_corners_both_real_sizes(self):
        code = r'''const assert=require('node:assert/strict');
const {widgetOrigin,projectToWidget}=require(process.argv[1]);
for (const [w,h] of [[560,338],[728,439]]) {
  for (const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    const o=widgetOrigin(1920,1080,corner,w,h);
    assert.deepEqual(projectToWidget({type:'move',x:o.x+100,y:o.y+40,width:1920,height:1080},corner,w,h),
      {type:'move',x:100,y:40,native:true});
    assert.equal(projectToWidget({type:'move',x:o.x+w,y:o.y,width:1920,height:1080},corner,w,h),null);
    assert.equal(projectToWidget({type:'move',x:o.x,y:o.y+h,width:1920,height:1080},corner,w,h),null);
    assert.equal(projectToWidget({type:'move',x:o.x-1,y:o.y,width:1920,height:1080},corner,w,h),null);
  }
}
const old=widgetOrigin(1920,1080);
assert.equal(old.x,1920-560-24);
assert.equal(old.y,24);
console.log('REAL_RUNTIME_GEOMETRY_PASS');'''
        self.assertIn('REAL_RUNTIME_GEOMETRY_PASS', node_check(code, 'overlay/poc/pointer_protocol.cjs'))

    def test_window_scale_normalization_and_feature_preservation(self):
        code = r'''const assert=require('node:assert/strict');
const cfg=require(process.argv[1]);
assert.equal(cfg.normalize(null).windowScale,'small');
assert.equal(cfg.normalize({windowScale:'large'}).windowScale,'large');
for(const bad of ['Large',728,'130%',null,{},'giant'])
  assert.equal(cfg.normalize({windowScale:bad}).windowScale,'small');
const c=cfg.normalize({windowScale:'large',layout:'side-rail',corner:'bottom-left',sizeMode:'minimal',
 quickOpen:{escape:true,start:true},autoPauseTimer:true,navigation:{keyboard:false,gamepad:false}});
assert.equal(c.layout,'side-rail');assert.equal(c.corner,'bottom-left');
assert.equal(c.sizeMode,'minimal');assert.equal(c.autoPauseTimer,true);
assert.deepEqual(c.quickOpen,{escape:true,start:true});
assert.deepEqual(c.navigation,{keyboard:false,gamepad:false});
console.log('REAL_RUNTIME_CONFIG_PASS');'''
        self.assertIn('REAL_RUNTIME_CONFIG_PASS', node_check(code, 'modules/overlay-config.js'))

    def test_physical_electron_window_changes_size(self):
        js = source('overlay/poc/host.cjs')
        for pattern in (r'large:\s*\[728,\s*439\]',
                        r'window\.setSize\(width, height, false\)',
                        r'applyOverlayFrameScale\(next\.windowScale\)',
                        r'projectToWidget\(pointer, activeCorner, frameWidth, frameHeight\)'):
            self.assertRegex(js, pattern)

    def test_osr_frame_size_and_mouse_hitbox_agree(self):
        js = source('overlay/poc/ui.js')
        css = source('overlay/poc/overlay-layout-v106.css')
        self.assertIn('layer.dataset.nxWindowScale = config.windowScale', js)
        self.assertIn('728 : 560', js)
        self.assertIn('439 : 338', js)
        self.assertIn('transform:scale(1.3)', css)
        self.assertIn('data-nx-window-scale="small"', css)

    def test_command_strip_distinct_from_dockline_in_mini(self):
        css = source('overlay/poc/overlay-layout-v106.css')
        self.assertRegex(css, r'\[data-nx-layout="command-strip"\] \.actions \{[\s\S]*?grid-row:2;')
        self.assertRegex(css, r'\[data-nx-layout="dockline"\] \{[\s\S]*?border-radius:30px;')
        self.assertIn('[data-nx-layout="command-strip"][data-nx-mode="mini"]',css)
        self.assertIn('grid-template-rows:43px minmax(0,69px) 18px;',css)

    def test_left_live_preview_contains_the_three_groups(self):
        html=source('index.html')
        editor=source('render/overlay-editor.js')
        self.assertIn('id="overlayPreviewExtras"',html)
        self.assertIn("const previewExtras = field('overlayPreviewExtras')",editor)
        self.assertIn('previewExtras.appendChild(section)',editor)
        self.assertIn("field('overlayBgStyle')?.closest('fieldset')",editor)
        self.assertIn("editor.querySelector('.nx-quick-controls')",editor)
        self.assertIn("editor.querySelector('.nx-navigation-options')",editor)
        # Important: never add duplicate DOM IDs when relocating fields.
        for element_id in ('overlayPreviewExtras','overlayBgStyle','overlayWindowSmall',
                           'overlayWindowLarge','overlayEnabled','overlayShortcutCapture'):
            with self.subTest(dom_id=element_id):
                self.assertEqual(len(re.findall(r'\bid="'+re.escape(element_id)+'"',html)),1)

    def test_preview_scale_is_independent_of_mini(self):
        html=source('index.html')
        editor=source('render/overlay-editor.js')
        for marker in ('id="overlayWindowSmall"','id="overlayWindowLarge"'):
            self.assertIn(marker,html)
        self.assertIn("windowScale: scaleRadios.find(radio => radio.checked)?.value || 'small'",editor)
        self.assertIn('frameWidth = large ? 728 : 560',editor)
        self.assertIn('frame.style.width',editor)
        self.assertIn('frame.style.height',editor)

    def test_bilingual_labels_and_theme_colors(self):
        translations=source('src/translations.js')
        self.assertEqual(translations.count('    overlay_window_scale:'),2)
        self.assertEqual(translations.count('    overlay_window_scale_hint:'),2)
        css=source('css/overlay-editor-layout-v106.css')
        osr=source('overlay/poc/overlay-layout-v106.css')
        self.assertIn('var(--accent)',css)
        self.assertIn('var(--nx-accent)',osr)
        self.assertNotIn('#932afa',osr)

    def test_runtime_javascript_syntax(self):
        for rel in ('modules/overlay-config.js','render/overlay-editor.js',
                    'overlay/poc/ui.js','modules/overlay-preview.js',
                    'overlay/poc/host.cjs','overlay/poc/pointer_protocol.cjs'):
            with self.subTest(source=rel):
                result=subprocess.run(['node','--check',str(ROOT/rel)],capture_output=True,
                                      text=True,encoding='utf-8',errors='replace',timeout=20,check=False)
                self.assertEqual(result.returncode,0,result.stderr[-1500:])


if __name__ == '__main__':
    unittest.main(verbosity=2)
