'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(process.cwd());
const config = require(path.join(ROOT, 'modules/overlay-config.js'));
const pointer = require(path.join(ROOT, 'overlay/poc/pointer_protocol.cjs'));
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');
const modes = ['dockline','corner-pulse','side-rail','command-strip'];
const corners = ['top-left','top-right','bottom-left','bottom-right'];
test('all four visual concepts normalize with default corner', () => {
  assert.equal(config.normalize(null).corner, 'top-right');
  for (const layout of modes) assert.equal(config.normalize({layout}).layout,layout);
});
test('all four positions accept only declared values', () => {
  for (const corner of corners) assert.equal(config.normalize({corner}).corner,corner);
  for (const corner of ['middle', '__proto__', 1, '../../bad'])
    assert.equal(config.normalize({corner}).corner,'top-right');
});
test('color is validated; arbitrary CSS values never pass to preview/native UI', () => {
  assert.equal(config.normalize({themeAccent:'#29AB4C'}).themeAccent,'#29ab4c');
  assert.equal(config.normalize({themeAccent:'var(--bad)'}).themeAccent,'#ff4655');
  assert.equal(config.normalize({launcherTheme:'light'}).launcherTheme,'light');
  assert.equal(config.normalize({launcherTheme:'not-a-theme'}).launcherTheme,'dark');
});
test('previous metrics, timer and shortcut settings survive layout changes', () => {
  const before = config.normalize({shortcut:'Ctrl+Shift+O', metrics:{session:true,total:false,clock:true,fps:false},buttons:{resume:true,timer:true,test:false}});
  const after = config.normalize({...before,layout:'side-rail',corner:'bottom-left'});
  assert.deepEqual(after.metrics,before.metrics);
  assert.deepEqual(after.buttons,before.buttons);
  assert.equal(after.shortcut,before.shortcut);
});
test('mouse projection matches top-left anchor', () => {
  assert.deepEqual(pointer.widgetOrigin(1920,1080,'top-left'),{x:24,y:24});
  assert.deepEqual(pointer.projectToWidget({type:'up',x:30,y:35,width:1920,height:1080},'top-left'),{type:'up',x:6,y:11,native:true});
});
test('mouse projection matches top-right anchor', () => {
  assert.deepEqual(pointer.widgetOrigin(1920,1080,'top-right'),{x:1336,y:24});
  assert.deepEqual(pointer.projectToWidget({type:'move',x:1340,y:44,width:1920,height:1080},'top-right'),{type:'move',x:4,y:20,native:true});
});
test('mouse projection matches bottom-left anchor', () => {
  assert.deepEqual(pointer.widgetOrigin(1920,1080,'bottom-left'),{x:24,y:718});
  assert.deepEqual(pointer.projectToWidget({type:'up',x:100,y:800,width:1920,height:1080},'bottom-left'),{type:'up',x:76,y:82,native:true});
});
test('mouse projection matches bottom-right anchor', () => {
  assert.deepEqual(pointer.widgetOrigin(1920,1080,'bottom-right'),{x:1336,y:718});
  assert.deepEqual(pointer.projectToWidget({type:'down',x:1340,y:720,width:1920,height:1080},'bottom-right'),{type:'down',x:4,y:2,native:true});
});
test('coordinates outside widget are rejected for all corners', () => {
  for(const corner of corners) {
    const loc=pointer.widgetOrigin(1920,1080,corner);
    assert.equal(pointer.projectToWidget({type:'down',x:loc.x-1,y:loc.y,width:1920,height:1080},corner),null);
    assert.equal(pointer.projectToWidget({type:'down',x:loc.x+560,y:loc.y,width:1920,height:1080},corner),null);
  }
});
test('native placement message has bounded enum and default top-right', () => {
  const host=read('overlay/poc/host.cjs');
  const pipe=read('native/nexus-overlay/src/frame_pipe.cpp');
  assert.match(host,/NXP1/);
  assert.match(host,/nativePlacementSupported/);
  assert.match(host,/if \(nativePlacementSupported\) client\.write\(placementHeader\(\)\)/);
  assert.match(host,/projectToWidget\(pointer, activeCorner, frameWidth, frameHeight\)/);
  assert.match(pipe,/u32\(4\) > 3 \|\| u32\(8\) != 0 \|\| u32\(12\) != 0/);
  assert.match(pipe,/g_corner\{1\}/);
});
test('all three supported native renderers share one corner computation', () => {
  for(const source of ['renderer.cpp','d3d9_renderer.cpp','opengl_renderer.cpp'])
    assert.match(read('native/nexus-overlay/src/'+source),/NexusComputeWidgetOrigin/);
  assert.doesNotMatch(read('native/nexus-overlay/src/d3d12_bridge_renderer.cpp'),/NexusComputeWidgetOrigin/);
});
test('all four styles are defined and use the dynamic accent token', () => {
  const css=read('overlay/poc/concepts-v100.css');
  for(const mode of modes) assert.ok(css.includes(`data-nx-layout="${mode}"`),mode);
  assert.match(css,/var\(--nx-accent\)/);
  assert.match(css,/prefers-reduced-motion/);
});
test('editor and OSR renderer use same real source files and optional theme bridge', () => {
  const preview=read('modules/overlay-preview.js');
  const html=read('overlay/poc/index.html');
  const ui=read('overlay/poc/ui.js');
  const editor=read('render/overlay-editor.js');
  assert.match(preview,/source\('overlay\/poc\/concepts-v100.css'\)/);
  assert.match(html,/concepts-v100.css/);
  assert.match(ui,/widget\.dataset\.nxLayout = config\.layout/);
  assert.match(ui,/config\.themeAccent/);
  assert.match(editor,/userSettings\.accentColor/);
  assert.match(read('src/main.js'),/overlay:sync-theme/);
});
test("no changes to game's timer commands, session or backup handlers", () => {
  const ui=read('overlay/poc/ui.js');
  assert.match(ui,/window\.nexusBridge\.setTimerPaused/);
  assert.match(ui,/window\.nexusBridge\?\.hide\(\)/);
  assert.match(read('modules/overlay-manager.js'),/actionValid/);
});
