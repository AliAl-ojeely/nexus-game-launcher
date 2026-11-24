'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const installed = path.join(root,'overlay/poc/auto_timer_pause_v103.cjs');
const source = fs.existsSync(installed) ? installed : path.join(root,'src/auto_timer_pause_v103.cjs');
const { AutoTimerPause } = require(source);
const session = (status = 'Running', id = 'session-A') => ({
  connected:true, canControlTimer:true, sessionId:id, status,
});
function create() {
  const calls=[];
  const controller=new AutoTimerPause(async desired => { calls.push(desired ? 'pause' : 'resume'); return {ok:true,paused:desired}; });
  return {controller,calls};
}
async function drain(controller) {
  for(let i=0;i<4;i++) await controller.idle();
}
test('default off: visible overlay never touches timer',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:false,session:session()});
  await drain(controller);
  assert.deepEqual(calls,[]);
});
test('pause on show and resume exactly once on hide',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.update({visible:false,enabled:true,session:session('Paused')});
  await drain(controller);
  await controller.update({visible:false,enabled:true,session:session('Paused')});
  assert.deepEqual(calls,['pause','resume']);
});
test('already paused by user is never owned or auto-resumed',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session('Paused')});
  await controller.update({visible:false,enabled:true,session:session('Paused')});
  assert.deepEqual(calls,[]);
});
test('manual resume transfers ownership and close does not resume again',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  const result=await controller.manual(false);
  assert.deepEqual(result,{ok:true,paused:false});
  await controller.update({visible:false,enabled:true,session:session('Running')});
  assert.deepEqual(calls,['pause','resume']);
});
test('manual pause is not auto-resumed after overlay is closed',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.manual(true);
  await controller.update({visible:false,enabled:true,session:session('Paused')});
  assert.deepEqual(calls,['pause','pause']);
});
test('multiple state polls are idempotent',async()=>{
  const {controller,calls}=create();
  for(let i=0;i<5;i++)await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  assert.deepEqual(calls,['pause']);
});
test('disabling while open resumes timer owned by overlay',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.update({visible:true,enabled:false,session:session('Paused')});
  assert.deepEqual(calls,['pause','resume']);
});
test('failed automatic pause never causes automatic resume',async()=>{
  const calls=[];
  const controller=new AutoTimerPause(async paused=>{
    calls.push(paused?'pause':'resume');
    return {ok:false,error:'session already ended'};
  });
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.update({visible:false,enabled:true,session:session()});
  assert.deepEqual(calls,['pause']);
});
test('stale and disconnected sessions cannot receive commands',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:{...session(),connected:false}});
  await controller.update({visible:true,enabled:true,session:{...session(),canControlTimer:false}});
  await controller.update({visible:true,enabled:true,session:{...session(),sessionId:null}});
  assert.deepEqual(calls,[]);
});
test('changing session identity prevents auto-resume for old game',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.update({visible:false,enabled:true,session:session('Running','session-B')});
  assert.deepEqual(calls,['pause']);
});
test('open->close during in-flight pause still resumes on confirmation',async()=>{
  let finish;
  const commands=[];
  const controller = new AutoTimerPause(async paused=>{
    commands.push(paused?'pause':'resume');
    if(paused)return new Promise(resolve=>{finish=resolve;});
    return {ok:true,paused:false};
  });
  const first=controller.update({visible:true,enabled:true,session:session()});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(typeof finish,'function');
  const second=controller.update({visible:false,enabled:true,session:session('Paused')});
  finish({ok:true,paused:true});
  await Promise.all([first,second]);
  await drain(controller);
  assert.deepEqual(commands,['pause','resume']);
});
test('second open makes exactly one new pause request',async()=>{
  const {controller,calls}=create();
  await controller.update({visible:true,enabled:true,session:session()});
  await drain(controller);
  await controller.update({visible:false,enabled:true,session:session('Paused')});
  await controller.update({visible:true,enabled:true,session:session('Running')});
  await drain(controller);
  assert.deepEqual(calls,['pause','resume','pause']);
});
test('real project wiring is present after installing the patch',()=>{
  const host=path.join(root,'overlay/poc/host.cjs');
  if(!fs.existsSync(host))return;
  const content=fs.readFileSync(host,'utf8');
  assert.match(content,/AutoTimerPause/);
  assert.match(content,/autoTimer\.manual\(paused\)/);
  assert.match(content,/allowHiddenAutoResume && action === 'resume'/);
  const config=require(path.join(root,'modules/overlay-config.js'));
  assert.equal(config.normalize(null).autoPauseTimer,false);
  assert.deepEqual(config.normalize(null).quickOpen,{escape:false,start:false});
  assert.deepEqual(config.normalize({quickOpen:{escape:true,start:true},autoPauseTimer:true}).quickOpen,{escape:true,start:true});
  assert.equal(config.normalize({autoPauseTimer:true}).autoPauseTimer,true);
  const manager=fs.readFileSync(path.join(root,'modules/overlay-manager.js'),'utf8');
  assert.match(manager,/--quick-escape/);
  assert.match(manager,/--quick-start/);
});
