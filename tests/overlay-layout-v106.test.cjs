'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const overlay = require('../modules/overlay-config.js');
const { widgetOrigin, projectToWidget } = require('../overlay/poc/pointer_protocol.cjs');

test('Small is default, Large is validated, invalid window sizes are rejected', () => {
  assert.equal(overlay.normalize(null).windowScale, 'small');
  assert.equal(overlay.normalize({windowScale:'large'}).windowScale, 'large');
  assert.equal(overlay.normalize({windowScale:'small'}).windowScale, 'small');
  for (const invalid of ['120%', 'giant', {}, 728, null, 'Large'])
    assert.equal(overlay.normalize({windowScale:invalid}).windowScale, 'small');
});
test('original concept / corner / Mini / quick keys / navigation / timer survive size changes', () => {
  const c = overlay.normalize({windowScale:'large',layout:'side-rail',corner:'bottom-left',sizeMode:'minimal',
    quickOpen:{escape:true,start:true},autoPauseTimer:true,navigation:{keyboard:false,gamepad:false},
    metrics:{session:true,total:false}});
  assert.equal(c.windowScale,'large');
  assert.equal(c.layout,'side-rail');
  assert.equal(c.corner,'bottom-left');
  assert.equal(c.sizeMode,'minimal');
  assert.deepEqual(c.quickOpen,{escape:true,start:true});
  assert.equal(c.autoPauseTimer,true);
  assert.deepEqual(c.navigation,{keyboard:false,gamepad:false});
  assert.equal(c.metrics.total,false);
});
for (const [w,h] of [[560,338],[728,439]]) {
  for (const corner of ['top-left','top-right','bottom-left','bottom-right']) {
    test(`pointer projection ${corner} ${w}x${h}`, () => {
      const origin=widgetOrigin(1920,1080,corner,w,h);
      assert.deepEqual(projectToWidget({type:'move',x:origin.x+80,y:origin.y+60,width:1920,height:1080},corner,w,h),
        {type:'move',x:80,y:60,native:true});
      assert.equal(projectToWidget({type:'up',x:origin.x+w,y:origin.y,width:1920,height:1080},corner,w,h),null);
      assert.equal(projectToWidget({type:'up',x:origin.x,y:origin.y+h,width:1920,height:1080},corner,w,h),null);
    });
  }
}
test('host changes the physical offscreen BrowserWindow frame not just the preview', () => {
  const s=read('overlay/poc/host.cjs');
  assert.match(s,/large:\s*\[728, 439\]/);
  assert.match(s,/window\.setSize\(width, height, false\)/);
  assert.match(s,/applyOverlayFrameScale\(next\.windowScale\)/);
  assert.match(s,/projectToWidget\(pointer, activeCorner, frameWidth, frameHeight\)/);
});
test('OSR client scales full card and hitbox after normalization', () => {
  const js=read('overlay/poc/ui.js');
  const css=read('overlay/poc/overlay-layout-v106.css');
  assert.match(js,/layer\.dataset\.nxWindowScale = config\.windowScale/);
  assert.match(js,/728 : 560/);
  assert.match(js,/439 : 338/);
  assert.match(css,/transform:scale\(1\.3\)/);
});
test('Command Strip has two distinct rows and Dockline is still a pill', () => {
  const css=read('overlay/poc/overlay-layout-v106.css');
  assert.match(css,/\[data-nx-layout="command-strip"\] \.actions \{[\s\S]*?grid-row:2;/);
  assert.match(css,/\[data-nx-layout="dockline"\] \{[\s\S]*?border-radius:30px;/);
  assert.match(css,/\[data-nx-layout="command-strip"\]\[data-nx-mode="mini"\]/);
});
test('Appearance, Quick Controls, Input Navigation are moved under preview without cloning inputs', () => {
  const editor=read('render/overlay-editor.js');
  const html=read('index.html');
  assert.match(editor,/previewExtras\.appendChild\(section\)/);
  assert.match(editor,/field\('overlayBgStyle'\)\?\.closest\('fieldset'\)/);
  assert.match(editor,/\.nx-quick-controls/);
  assert.match(editor,/\.nx-navigation-options/);
  assert.match(html,/id="overlayPreviewExtras"/);
});
test('new window size choices remain independent of Mini/Medium/Full', () => {
  const html=read('index.html');
  const editor=read('render/overlay-editor.js');
  assert.match(html,/id="overlayWindowSmall"/);
  assert.match(html,/id="overlayWindowLarge"/);
  assert.match(editor,/scaleRadios\.find\(radio => radio\.checked\)\?\.value \|\| 'small'/);
  assert.match(editor,/frameWidth = large \? 728 : 560/);
  assert.match(editor,/frame\.style\.width/);
});
test('Arabic and English settings labels added', () => {
  const s=read('src/translations.js');
  assert.equal((s.match(/    overlay_window_scale:/g)||[]).length,2);
  assert.equal((s.match(/    overlay_window_scale_hint:/g)||[]).length,2);
});
test('new UI colors use launcher theme tokens, never a fixed accent for the action buttons', () => {
  const css=read('css/overlay-editor-layout-v106.css');
  const osr=read('overlay/poc/overlay-layout-v106.css');
  assert.match(css,/var\(--accent\)/);
  assert.match(osr,/var\(--nx-accent\)/);
});
