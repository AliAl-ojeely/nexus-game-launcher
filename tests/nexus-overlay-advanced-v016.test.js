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
test('runtime bridge uses selected shortcut and keeps fixed BGRA geometry',()=>{
  const manager=read('modules/overlay-manager.js');
  const win=read('tools/nexus_input_bridge.py');
  const runner=read('tools/run_overlay_real_game.py');
  const overlay=read('overlay/poc/ui.js');
  const css=read('overlay/poc/ui.css');
  assert.ok(manager.includes("'--overlay-shortcut', activeShortcut"));
  assert.ok(win.includes('self.hotkey_modifiers, self.hotkey_vk, self.hotkey_label'));
  assert.ok(runner.includes('WindowsInputBridge(pid, shortcut=args.overlay_shortcut)'));
  assert.ok(overlay.includes("button.hidden = isMinimal ? name === 'test' : !config.buttons[name]"));
  assert.ok(overlay.includes('widget.dataset.overlaySize = config.sizeMode'));
  assert.match(css,/\.widget\[data-overlay-size="minimal"\]/);
  assert.match(css,/\.widget\[data-overlay-size="medium"\]/);
  assert.ok(css.includes('padding: 8px;'));
  assert.ok(css.includes('border-radius: 18px;'));
});
