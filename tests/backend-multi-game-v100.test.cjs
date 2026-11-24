'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const ROOT = path.join(__dirname, '..');

function harness() {
    const files = fs.readFileSync(path.join(ROOT, 'modules/game-launcher.js'), 'utf8');
    const sent = [], overlaysStopped = [], snapshots = [];
    const intervals = new Map(), timers = [];
    let pid = 11001, index = 0, timerId = 0;
    const emitter = {
        isDestroyed: () => false,
        send(name, payload) { sent.push({ name, payload }); },
    };
    const dependencies = {
        'child_process': {
            spawn(_command, _args, _opts) {
                const child = new EventEmitter();
                child.pid = ++pid;
                child.unref = () => {};
                child.kill = () => {};
                return child;
            }, exec:()=>{}, execFile:()=>{}
        },
        'path': path, 'os': {homedir:()=>'/tmp'},
        'fs': { existsSync: () => true, mkdirSync:()=>{} },
        'electron': { app: {getPath:()=>'/tmp/nexus-test'}, net: {} },
        'url': { pathToFileURL:()=>null },
        './game-process-selector': {normalized:s=>s, createMonitorHealth:()=>({unavailable:()=>({previousMissing:0}),found:()=>({recoveredAfter:0}),missing:()=>({missingCount:0,shouldStop:false})}), selectGameProcess:()=>null},
        './game-launch-diagnostics': {describeLaunchError:() => ({message:'fail'})},
        './backup': {performMirroring:async()=>{}},
        './app-settings': {readSettings:()=>({autoBackup:false})},
        './playSessions': {
            startSession:()=>++index, getSessionId:n=>`session-${n}`,
            endSession:()=>true
        },
        './overlay-session-feed': {publish:games=>snapshots.push(games.map(g=>({...g})))},
        './playtime': {getPlaytimeInfo:()=>({minutes:0,seconds:0})},
        './backup-discovery-engine-v070': {noteGameStarted:()=>{}, noteGameStopped:()=>Promise.resolve(null)},
        './overlay-manager': {stop: id=>overlaysStopped.push(id)},
    };
    const module = { exports: {} };
    const context = {module, exports:module.exports,
        // Node CommonJS provides __dirname. vm.runInNewContext does not;
        // mirror the real location of the module under test. This is a
        // harness-only global: it does not change the production backend.
        __dirname: path.join(ROOT, 'modules'),
        require(name) { if (!(name in dependencies)) throw new Error('Unexpected require '+name); return dependencies[name]; },
        console: {log(){},warn(){},error(){}}, Buffer, Date, process: {...process, platform:'win32'},
        setInterval(cb,_ms) {const id=++timerId;intervals.set(id,cb);timers.push(id);return id;},
        clearInterval(id){intervals.delete(id);},
        setTimeout, clearTimeout,
    };
    // Never run in the real app or touch its data; executing a copy of the
    // actual backend under a stubbed process/database/Electron environment.
    vm.runInNewContext(files + '\nmodule.exports.__test_stopMonitor = stopMonitor;',context,{filename:'modules/game-launcher.js',timeout:1000});
    return {api:module.exports, sent, snapshots, overlaysStopped, intervals, emitter};
}
test('two independent game processes, timers, session identities, and native overlay feeds',async()=>{
    const h=harness();
    h.api.launchGame({sender:h.emitter},'C:/Games/A/game-a.exe',false,'',1001,'Game A');
    h.api.launchGame({sender:h.emitter},'C:/Games/B/game-b.exe',false,'',2002,'Game B');
    const rows=h.api.getRunningSessions();
    assert.equal(rows.length,2);assert.notEqual(rows[0].sessionId,rows[1].sessionId);
    assert.equal(h.intervals.size,4); // Separate monitor & timer per game
    assert.equal(h.sent.filter(e=>e.name==='game:started').length,2);
    const a=h.sent.find(e=>e.name==='game:started'&&e.payload.gameId===1001).payload;
    const b=h.sent.find(e=>e.name==='game:started'&&e.payload.gameId===2002).payload;
    assert.notEqual(a.sessionId,b.sessionId);
    h.api.pauseTimer(1001);
    assert.equal(h.api.getRunningSessions().find(r=>r.gameId===1001).paused,true);
    assert.equal(h.api.getRunningSessions().find(r=>r.gameId===2002).paused,false);
});
test('ending A leaves B live and never closes the other overlay or timer',async()=>{
    const h=harness();
    h.api.launchGame({sender:h.emitter},'C:/Games/A/game-a.exe',false,'',1001,'Game A');
    h.api.launchGame({sender:h.emitter},'C:/Games/B/game-b.exe',false,'',2002,'Game B');
    const backend=h.api.getRunningSessions();
    assert.equal(backend.length,2);
    assert.equal(h.api.pauseTimer(1001),true);
    assert.equal(h.api.resumeTimer(1001),true);
    assert.equal(h.api.getRunningSessions().find(r=>r.gameId===2002).paused,false);
    await h.api.__test_stopMonitor(1001, {elapsed:12,endTime:Date.now()});
    assert.deepEqual(Array.from(h.api.getRunningSessions(),r=>r.gameId),[2002]);
    assert.equal(h.intervals.size,2); // B's monitor + timer remain
    assert.deepEqual(h.overlaysStopped,[1001]); // Never stop B's native helper
    assert.equal(h.sent.filter(e=>e.name==='game:stopped').length,1);
    assert.equal(h.sent.filter(e=>e.name==='game:stopped')[0].payload.gameId,1001);
    assert.equal(h.sent.filter(e=>e.name==='game:stopped')[0].payload.sessionId,backend[0].sessionId);
    for (const tick of h.intervals.values()) tick();
    assert.equal(h.sent.filter(e=>e.name==='game:tick').every(e=>e.payload.gameId===2002),true);
});
test('starting the same game twice does not overwrite the live PID or session',()=>{
    const h=harness();
    h.api.launchGame({sender:h.emitter},'C:/Games/A/game-a.exe',false,'',1001,'Game A');
    const original=h.api.getRunningSessions()[0];
    h.api.launchGame({sender:h.emitter},'C:/Games/A/game-a.exe',false,'',1001,'Game A');
    assert.equal(h.api.getRunningSessions().length,1);
    assert.equal(h.api.getRunningSessions()[0].sessionId,original.sessionId);
    assert.equal(h.intervals.size,2);
});
