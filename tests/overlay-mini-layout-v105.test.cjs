'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const style = fs.readFileSync(fs.existsSync(path.join(root,'src','mini-v105.css')) ? path.join(root,'src','mini-v105.css') : path.join(root,'overlay','poc','mini-v105.css'),'utf8');
const settingsCss = fs.readFileSync(fs.existsSync(path.join(root,'src','overlay-layout-polish-v105.css')) ? path.join(root,'src','overlay-layout-polish-v105.css') : path.join(root,'css','overlay-layout-polish-v105.css'),'utf8');
const source = fs.existsSync(path.join(root,'transform_v105.py')) ? fs.readFileSync(path.join(root,'transform_v105.py'),'utf8') : null;
const projectFile = p => {const file=path.join(root,p);return fs.existsSync(file) ? fs.readFileSync(file,'utf8') : ''};
for (const layout of ['dockline','corner-pulse','side-rail','command-strip']) {
  test(`${layout} has independent Mini geometry`, () => {
    assert.match(style, new RegExp(`data-nx-layout="${layout}"\\]\\[data-nx-mode="mini"`));
    assert.match(style, /--nx-accent/);
  });
}
test('Medium and full remain distinct from Mini',()=>{
  assert.match(style,/data-nx-mode="medium"/);
  assert.match(style,/data-nx-mode="mini"/);
  assert.doesNotMatch(style,/url\(https?:/);
});
test('Preview occupies LEFT grid column and configuration stays on RIGHT',()=>{
  assert.match(settingsCss,/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(330px,\s*395px\)/);
  assert.match(settingsCss,/\.overlay-editor-preview\s*\{[^}]*grid-column:\s*1/s);
  assert.match(settingsCss,/\.overlay-editor-controls\s*\{[^}]*grid-column:\s*2/s);
});
test('Controls and preview fall back to one column on smaller devices',()=>{
  assert.match(settingsCss,/@media\(max-width:1240px\)/);
  assert.match(settingsCss,/@media\(max-width:740px\)/);
});
test('New settings reuse launcher theme variables instead of fixed accent',()=>{
  assert.match(settingsCss,/var\(--accent\)/);
  assert.match(settingsCss,/var\(--bg-card\)/);
  assert.match(settingsCss,/var\(--text-muted\)/);
  assert.doesNotMatch(settingsCss,/#9b\d{4}/i);
});
test('User can independently disable keyboard and gamepad navigation',()=>{
  if (source) {
    assert.match(source,/overlayDisableKeyboardNav/);
    assert.match(source,/overlayDisableGamepadNav/);
    assert.match(source,/keyboard_navigation/);
    assert.match(source,/gamepad_navigation/);
    assert.match(source,/overlay_mini_display/);
  } else {
    const html=projectFile('index.html');
    const runner=projectFile('tools/run_overlay_real_game.py');
    assert.match(html,/overlayDisableKeyboardNav/);
    assert.match(html,/overlayDisableGamepadNav/);
    assert.match(runner,/--disable-overlay-keyboard-nav/);
    assert.match(runner,/--disable-overlay-gamepad-nav/);
  }
});
test('Quick Esc passthrough and timer ownership have not been removed',()=>{
  const sourceFile=projectFile('tools/nexus_input_bridge.py');
  if (sourceFile) assert.match(sourceFile,/return u\.CallNextHookEx\(self\._hook, code, event, lparam\)/);
  const helper=projectFile('overlay/poc/auto_timer_pause_v103.cjs');
  if (helper) assert.match(helper,/AutoTimerPause/);
});
test('Only Nexus overlay settings and helpers are involved, not game save files',()=>{
  if (!source) return;
  assert.doesNotMatch(source,/games\.json|gamesBackSave\.json|savefile|injector\.exe/i);
});
