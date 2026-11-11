'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const config = require('../modules/overlay-config');
const source = fs.readFileSync(path.join(root,'overlay/poc/ui.js'), 'utf8');

function fakeDom() {
  const styles = new Map();
  const active = new Set();
  const createElement = () => ({ textContent:'', className:'', disabled:false, hidden:false,
    dataset:{}, style:{setProperty:(key,value)=>styles.set(key,value)},
    classList:{add:name=>active.add(name),remove:name=>active.delete(name),toggle(){}},
    addEventListener(){} });
  const metrics = ['session','total','clock','fps'].map(name => Object.assign(createElement(),{dataset:{metric:name}}));
  const buttons = ['resume','timer','test'].map(name => Object.assign(createElement(),{dataset:{action:name}}));
  const ids = new Map(['game-name','session-time','total-time','session-state','status-badge','sync-state',
    'timer-action-icon','timer-action-label','last-input','input-count','local-clock','game-fps','nexus-mouse-cursor']
    .map(name=>[name,createElement()]));
  const widget = createElement(); widget.dataset = {};
  const syncMode = createElement();
  const document = {
    getElementById: name => ids.get(name),
    querySelectorAll: selector => selector==='[data-metric]' ? metrics : buttons,
    querySelector: selector=>selector==='.widget'?widget:selector==='.sync-mode'?syncMode:null,
  };
  let messageListener;
  const parent = {postMessage() {}};
  const window = {NEXUS_PREVIEW:true, NexusOverlayConfig:config, parent,
    addEventListener(type, callback){if(type==='message')messageListener=callback;}};
  vm.runInNewContext(source,{window,document,Date,Number,String,Promise,console});
  return {metrics,buttons,widget,ids,receive(config){messageListener({source:parent,data:{type:'nexus-overlay-preview-config',config}})}};
}

test('schema defaults retain the legacy overlay layout and style', () => {
  assert.deepEqual(config.normalize(null), {
    enabled:false,
    shortcut:'Ctrl+Shift+O',
    sizeMode:'full',
    metrics:{session:true,total:true,clock:false,fps:false},
    buttons:{resume:true,timer:true,test:true},
    appearance:{style:'glassy',background:'#000000',accent:'#78abf8',opacity:45},
  });
});
test('schema rejects unexpected data without storing unknown keys', () => {
  const value=config.normalize({ metrics:{session:false,total:'false',x:true},
    buttons:{timer:false,resume:null}, appearance:{style:'javascript:',background:'url(//evil)',accent:'#AA44CC',opacity:999},__proto__:{evil:true}});
  assert.equal(value.metrics.session,false);
  assert.equal(value.metrics.total,true);
  assert.equal('x' in value.metrics,false);
  assert.equal(value.buttons.timer,false);
  assert.equal(value.buttons.resume,true);
  assert.equal(value.appearance.style,'glassy');
  assert.equal(value.appearance.background,'#000000');
  assert.equal(value.appearance.accent,'#aa44cc');
  assert.equal(value.appearance.opacity,100);
  assert.equal('evil' in value,false);
});
test('real overlay renderer previews the same visibility and accent configuration', () => {
  const dom=fakeDom();
  assert.deepEqual(dom.metrics.map(e=>e.hidden),[false,false,true,true]);
  dom.receive({metrics:{session:true,total:false,clock:true,fps:true},
    buttons:{resume:false,timer:false,test:true},
    appearance:{style:'solid',background:'#24212b',accent:'#cc11aa',opacity:64}});
  assert.deepEqual(dom.metrics.map(e=>e.hidden),[false,true,false,false]);
  assert.deepEqual(dom.buttons.map(e=>e.hidden),[true,true,false]);
  assert.equal(dom.widget.dataset.overlayDense,'true');
  assert.equal(dom.widget.dataset.overlayStyle,'solid');
  assert.equal(dom.widget.style.getPropertyValue,undefined);
  assert.equal(dom.ids.get('game-fps').textContent,'N/A');
  dom.receive({metrics:{session:false,total:false,clock:false,fps:false},buttons:{resume:false,timer:false,test:false}});
  assert.deepEqual(dom.buttons.map(e=>e.hidden),[true,true,true]);
  assert.equal(dom.widget.dataset.overlayDense,'false');
});
test('actual host and launcher share validated settings with no native changes', () => {
  const main=fs.readFileSync(path.join(root,'src/main.js'),'utf8');
  const preload=fs.readFileSync(path.join(root,'src/preload.js'),'utf8');
  const host=fs.readFileSync(path.join(root,'overlay/poc/host.cjs'),'utf8');
  const manager=fs.readFileSync(path.join(root,'modules/overlay-manager.js'),'utf8');
  assert.match(main,/ipcMain\.handle\('overlay:save-config'/);
  assert.match(main,/settings\.modalOverlay = next/);
  assert.match(preload,/overlaySaveConfig/);
  assert.match(manager,/NEXUS_OVERLAY_SETTINGS_FILE: SETTINGS_FILE/);
  assert.match(host,/window\.webContents\.send\('nexus:overlay-config', next\)/);
  assert.doesNotMatch(host,/execSync\(|eval\(/);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(html,/id="overlayEnabled"/);
  assert.match(html,/id="overlayPreviewFrame" sandbox="allow-scripts"/);
  assert.match(html,/id="fpsToggle"/);
  assert.match(html,/id="systemTrayToggle"/);
});
