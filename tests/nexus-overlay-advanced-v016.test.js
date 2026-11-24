'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT=path.resolve(__dirname,'..');
const schema=require('../modules/overlay-config');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');

test('full, medium, minimal sizes preserve the settings schema and default',()=>{
  const empty=schema.normalize(null);
  assert.equal(empty.sizeMode,'full');
  assert.equal(empty.shortcut,'Ctrl+Shift+O');
  assert.equal(empty.enabled,false);
  for(const size of ['full','medium','minimal']) assert.equal(schema.normalize({sizeMode:size}).sizeMode,size);
  assert.equal(schema.normalize({sizeMode:'giant'}).sizeMode,'full');
});
test('valid Windows shortcuts and unsafe combinations are distinguished',()=>{
  for(const [input,expected] of Object.entries({'F10':'F10','alt+q':'Alt+Q',
    'Ctrl+Shift+O':'Ctrl+Shift+O','ctrl+alt+1':'Ctrl+Alt+1','Ctrl+F10':'Ctrl+F10'}))
    assert.equal(schema.normalizeShortcut(input),expected);
  for(const input of ['F12','Ctrl+Alt+Delete','Win+R','Alt+F4','Ctrl+S','Shift+X',
    'Q','Ctrl+Ctrl+O','Ctrl+','', 'Ctrl+Shift+F12'])
    assert.equal(schema.normalizeShortcut(input),null,input);
  assert.equal(schema.normalize({shortcut:'Win+R'}).shortcut,'Ctrl+Shift+O');
});
test('real DOM ids are maintained; advanced layout is inside overlay-only editor',()=>{
  const html=read('index.html');
  for(const id of ['overlayEnabled','overlayEditor','overlayShortcutCapture','overlayShortcutReset',
    'overlayShortcutStatus','overlayPreviewFrame','overlayPreviewStage','overlayReset','saveGeneralSettings'])
    assert.ok(html.includes(`id="${id}"`),id);
  for(const value of ['full','medium','minimal']) assert.ok(html.includes(`name="overlaySizeMode" value="${value}"`));
  const overlay=read('overlay/poc/index.html');
  for(const name of ['overlay-hotkey','session-time','total-time','timer-action-label','last-input','nexus-mouse-cursor'])
    assert.ok(overlay.includes(`id="${name}"`),name);
});
test('runtime bridge uses foreground shortcut and validated Small/Large BGRA geometry',()=>{
  const manager=read('modules/overlay-manager.js');
  const win=read('tools/nexus_input_bridge.py');
  const runner=read('tools/run_overlay_real_game.py');
  const overlay=read('overlay/poc/ui.js');
  const css=read('overlay/poc/overlay-layout-v106.css');
  const host=read('overlay/poc/host.cjs');
  const markup=read('overlay/poc/index.html');
  assert.ok(manager.includes("'--overlay-shortcut', activeShortcut"));
  assert.ok(win.includes('self.hotkey_modifiers, self.hotkey_vk, self.hotkey_label'));
  assert.match(runner,/WindowsInputBridge\(pid,\s*shortcut=args\.overlay_shortcut,\s*quick_escape=args\.quick_escape,\s*quick_start=args\.quick_start,\s*keyboard_navigation=not args\.disable_overlay_keyboard_nav,\s*gamepad_navigation=not args\.disable_overlay_gamepad_nav\)/);
  assert.match(win,/class ForegroundShortcut:/);
  assert.doesNotMatch(win,/\b(?:RegisterHotKey|UnregisterHotKey)\s*\(/);
  assert.match(win,/self\.game_foreground, u\.GetAsyncKeyState/);
  assert.match(win,/from nexus_overlay_quick_input_v103 import start_release_edge/);
  assert.match(read('tools/nexus_overlay_quick_input_v103.py'),/def start_release_edge\(/);
  assert.ok(overlay.includes("button.hidden = !config.buttons[name] || (isMinimal && name === 'test')"));
  assert.ok(overlay.includes("widget.dataset.nxMode = isMinimal ? 'mini' : config.sizeMode === 'medium' ? 'medium' : 'full'"));
  assert.ok(overlay.includes('layer.dataset.nxWindowScale = config.windowScale'));
  assert.ok(markup.includes('./overlay-layout-v106.css'));
  assert.match(css,/\.layer\[data-nx-window-scale="large"\]\s*\{[^}]*transform:scale\(1\.3\)/);
  assert.match(host,/small:\s*\[560, 338\]/);
  assert.match(host,/large:\s*\[728, 439\]/);
  assert.match(host,/window\.setSize\(width, height, false\)/);
  assert.match(host,/projectToWidget\(pointer, activeCorner, frameWidth, frameHeight\)/);
});
