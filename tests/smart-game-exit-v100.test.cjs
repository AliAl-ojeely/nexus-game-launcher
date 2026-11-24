'use strict';
// Runs the actual installed launcher with the actual unchanged selector, but
// with deterministic fake Windows processes, clocks, IPC, backup and overlay.
// This never spawns, kills, injects or modifies a real process or user file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EventEmitter = require('node:events');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'modules/game-launcher.js'), 'utf8');
const selector = require(path.join(ROOT, 'modules/game-process-selector.js'));
const A = 1001, B = 2002;
const EXE_A = 'C:\\Games\\A\\game-a.exe', EXE_B = 'C:\\Games\\B\\game-b.exe';

// Existing v1.0.0 regression cases explicitly exercise conservative mode.
// New cases below exercise the real default balanced policy.
function harness({nativeProbe=true, autoBackup=false, guardIds='*'}={}) {
    let time = 0, wallOffset = 1700000000000, serial = 0, pid = 11000, index = 0;
    const scheduled = new Map(), running = new Map(), children = new Map();
    const sent = [], finalized = [], attaches = [], stops = [], feeds = [], kills = [], logs = [], probes = [], backups = [];
    const held = [], heldKills = [], backupWaiters = [];
    let nextProbe = 'normal', killMode = 'success';
    const system = { pid: 42, ppid: 4, path: 'C:\\Windows\\explorer.exe' };
    function schedule(fn, delay, repeating) {
        const id = ++serial;
        scheduled.set(id, { fn, due: time + Math.max(0, delay), interval: repeating ? delay : 0 });
        return id;
    }
    function advance(ms) {
        const end = time + ms;
        let steps = 0;
        while (true) {
            const next = [...scheduled].filter(([,item])=>item.due<=end).sort((a,b)=>a[1].due-b[1].due||a[0]-b[0])[0];
            if (!next) break;
            assert.ok(++steps < 5000, 'runaway scheduled work');
            const [id,item]=next; time=item.due;
            if (item.interval) item.due += item.interval; else scheduled.delete(id);
            item.fn();
        }
        time=end;
    }
    function disappear(target, emit=false, code=0, signal=null) {
        running.delete(target);
        if (emit) children.get(target)?.emit('exit',code,signal);
    }
    function probe(callback) {
        const rows = [system, ...running.values()].map(p=>({...p}));
        const mode = nextProbe; nextProbe='normal';
        probes.push(time);
        if (mode==='hold') { held.push(()=>callback(null,JSON.stringify(rows))); return; }
        if (mode==='fail') return callback(new Error('probe unavailable'),'');
        if (mode==='empty') return callback(null,'[]');
        callback(null,JSON.stringify(rows));
    }
    function execFile(command,args,options,callback) {
        if (command==='taskkill.exe') {
            assert.equal(args[0],'/PID');
            assert.deepEqual(Array.from(args.slice(2)),['/T','/F']);
            const target=Number(args[1]); kills.push({target,time});
            if (killMode==='fail') return callback(new Error('Access denied'));
            if (killMode==='defer') { heldKills.push(()=>{disappear(target,true);callback(null);}); return; }
            if (killMode!=='stays') disappear(target,true);
            return callback(null);
        }
        assert.ok(command.endsWith('NexusProcessProbe.exe') || command==='powershell.exe',command);
        probe(callback);
    }
    const emitter={isDestroyed:()=>false,send:(name,data)=>sent.push({name,data,time})};
    const dep={
        child_process:{spawn(command){
            const child=new EventEmitter(); child.pid=++pid;
            child.unref=()=>{};child.kill=()=>{};
            children.set(child.pid,child);
            running.set(child.pid,{pid:child.pid,ppid:999,path:command});
            return child;
        },execFile,exec:()=>{throw Error('unexpected Linux path');}},
        path,os:{homedir:()=>'/tmp'},fs:{existsSync:p=>nativeProbe||!String(p).endsWith('NexusProcessProbe.exe'),mkdirSync:()=>{}},
        electron:{app:{getPath:()=>'/fake-nexus-test'},net:{}},url:{pathToFileURL:()=>null},
        './game-process-selector':selector,
        './game-launch-diagnostics':{describeLaunchError:e=>({message:e.message})},
        './backup':{performMirroring:async (...args)=>{backups.push(args);if(autoBackup)await new Promise(resolve=>backupWaiters.push(resolve));}},
        './app-settings':{readSettings:()=>({autoBackup})},
        './playSessions':{startSession:()=>++index,getSessionId:n=>`session-${n}`,
            endSession:(n,end,elapsed,sessionId)=>{finalized.push({n,end,elapsed,sessionId,time});return true;}},
        './overlay-session-feed':{publish:rows=>feeds.push(rows.map(r=>({...r})))},
        './playtime':{getPlaytimeInfo:()=>({minutes:0,seconds:0})},
        './backup-discovery-engine-v070':{noteGameStarted:()=>{},noteGameStopped:()=>Promise.resolve(null)},
        './overlay-manager':{attach:row=>attaches.push({...row}),stop:id=>stops.push(id)},
    };
    const module={exports:{}};
    vm.runInNewContext(source+'\nmodule.exports.__test_stopMonitor = stopMonitor;',{
        module,exports:module.exports,__dirname:path.join(ROOT,'modules'),
        require:name=>{if(!(name in dep))throw Error('Unexpected require: '+name);return dep[name];},
        console:{log:(...args)=>logs.push(args.join(' ')),warn:(...args)=>logs.push(args.join(' ')),error:(...args)=>logs.push(args.join(' '))},
        Buffer,Date:class extends Date{static now(){return wallOffset+time;}},
        process:{...process,env:{...process.env,NEXUS_RESTART_GUARD_GAME_IDS:guardIds},platform:'win32',hrtime:{bigint:()=>BigInt(Math.round(time))*1000000n}},
        setInterval:(fn,ms)=>schedule(fn,ms,true),clearInterval:id=>scheduled.delete(id),
        setTimeout:(fn,ms)=>schedule(fn,ms,false),clearTimeout:id=>scheduled.delete(id),
    },{filename:'modules/game-launcher.js',timeout:1000});
    const api=module.exports;
    return {api,advance,running,children,sent,finalized,attaches,stops,feeds,kills,logs,probes,scheduled,held,heldKills,backups,backupWaiters,
        get now(){return time;},jumpWall(ms){wallOffset+=ms;},
        nextProbe(mode){nextProbe=mode;},killMode(mode){killMode=mode;},disappear,
        addProcess(process){running.set(process.pid,{...process});},
        launch(id,exe=id===A?EXE_A:EXE_B){api.launchGame({sender:emitter},exe,false,'',id,id===A?'Game A':'Game B');return pid;},
        session(id){return api.getRunningSessions().find(r=>r.gameId===id);},
        events(name){return sent.filter(r=>r.name===name);},
        hasLog(fragment){return logs.some(s=>s.includes(fragment));},
    };
}

test('explicit Stop confirms A in 450 ms; B timer, overlay and session remain live',()=>{
    const h=harness();const a=h.launch(A),b=h.launch(B);h.advance(2000);
    const sidA=h.session(A).sessionId,sidB=h.session(B).sessionId;
    h.advance(1000);h.api.forceStopGame(A);h.advance(0);
    assert.equal(h.kills[0].target,a);assert.ok(h.hasLog('FAST_ARMED'));assert.ok(h.session(A));
    h.advance(449);assert.ok(h.session(A));h.advance(1);
    assert.equal(h.session(A),undefined);assert.ok(h.hasLog('FAST_CONFIRMED'));
    assert.equal(h.finalized.length,1);assert.equal(h.finalized[0].elapsed,3);
    assert.equal(h.finalized[0].sessionId,sidA);assert.equal(h.events('game:stopped')[0].data.sessionId,sidA);
    assert.deepEqual(h.stops,[A]);assert.equal(h.session(B).sessionId,sidB);
    assert.ok(h.running.has(b));h.advance(2000);assert.ok(h.session(B).elapsed>=5);
    assert.equal(h.feeds.at(-1).length,1);assert.equal(h.feeds.at(-1)[0].gameId,B);
});

test('ordinary game exit wakes immediately but preserves full restart guard',()=>{
    const h=harness();const a=h.launch(A);h.advance(2000);h.advance(1000);
    h.disappear(a,true);const before=h.probes.length;h.advance(0);
    assert.equal(h.probes.length,before+1);assert.ok(h.hasLog('RESTART_GUARD'));
    h.advance(11999);assert.ok(h.session(A));assert.equal(h.finalized.length,0);
    h.advance(2001);assert.equal(h.session(A),undefined);assert.ok(h.hasLog('GUARD_CONFIRMED'));
    assert.equal(h.finalized[0].elapsed,2);assert.equal(h.kills.length,0);
});

test('late self-restart retains the same session, paused state, new PID and overlay',()=>{
    const h=harness();const a=h.launch(A),b=h.launch(B);h.advance(2000);
    const sid=h.session(A).sessionId;h.api.pauseTimer(A);
    h.advance(1000);h.disappear(a,true);h.advance(0);h.advance(11500);
    h.addProcess({pid:41000,ppid:0,path:EXE_A});h.advance(2000);
    assert.equal(h.session(A).sessionId,sid);assert.equal(h.session(A).paused,true);
    assert.equal(h.session(A).elapsed,2);assert.equal(h.session(B).paused,false);assert.ok(h.running.has(b));
    assert.ok(h.attaches.some(r=>r.gameId===A&&r.activePid===41000&&r.sessionId===sid));
    assert.equal(h.finalized.length,0);assert.equal(h.stops.length,0);assert.equal(h.events('game:started').length,2);
    assert.ok(h.hasLog('RESTART_RECOVERED'));assert.equal(h.api.applyOverlayTimerAction(A,sid,a,false).ok,false);
    assert.equal(h.api.applyOverlayTimerAction(A,sid,41000,false).ok,true);assert.equal(h.session(B).paused,false);
});

test('quick restart is detected by bounded early recheck instead of waiting next 2s tick',()=>{
    const h=harness();const a=h.launch(A);h.advance(2300);const sid=h.session(A).sessionId;
    h.disappear(a,true);h.advance(0);h.advance(200);h.addProcess({pid:42000,ppid:0,path:EXE_A});h.advance(250);
    assert.ok(h.attaches.some(r=>r.activePid===42000&&r.sessionId===sid));assert.equal(h.finalized.length,0);
});

test('replacement detected between fast confirmations cancels acceleration',()=>{
    const h=harness();h.launch(A);h.advance(2000);const sid=h.session(A).sessionId;
    h.api.forceStopGame(A);h.advance(0);h.advance(200);h.addProcess({pid:43000,ppid:0,path:EXE_A});h.advance(1000);
    assert.ok(h.hasLog('FAST_FALLBACK replacement'));assert.equal(h.session(A).sessionId,sid);
    assert.ok(!h.hasLog('FAST_CONFIRMED'));assert.equal(h.finalized.length,0);
});

test('failed taskkill cannot enter fast path; ordinary exit guard stays active',()=>{
    const h=harness();const a=h.launch(A);h.advance(2000);h.killMode('fail');h.api.forceStopGame(A);h.advance(0);
    assert.ok(!h.hasLog('FAST_ARMED'));assert.ok(h.session(A));h.disappear(a,true);h.advance(0);
    h.advance(11999);assert.ok(h.session(A));h.advance(2001);assert.equal(h.session(A),undefined);
});

test('failed post-kill probe drops fast path; no premature finalization',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.api.forceStopGame(A);h.nextProbe('fail');h.advance(0);
    assert.ok(h.hasLog('FAST_FALLBACK probe-failed'));h.advance(6000);assert.ok(h.session(A));assert.equal(h.finalized.length,0);
    h.advance(10000);assert.equal(h.session(A),undefined);assert.ok(h.hasLog('GUARD_CONFIRMED'));
});

test('empty snapshot is not process-exit evidence and resets the grace streak',()=>{
    const h=harness();const a=h.launch(A);h.advance(2000);h.disappear(a,true);h.advance(0);h.advance(5000);
    h.nextProbe('empty');h.advance(1000);h.advance(7000);assert.ok(h.session(A));
    h.advance(9000);assert.equal(h.session(A),undefined);assert.ok(!h.hasLog('FAST_CONFIRMED'));
});

test('probe begun before taskkill acknowledgment cannot count as fast evidence',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.nextProbe('hold');h.advance(2000);assert.equal(h.held.length,1);
    h.api.forceStopGame(A);assert.ok(h.hasLog('FAST_ARMED'));h.advance(100);h.held.shift()();h.advance(0);
    assert.ok(h.session(A));h.advance(449);assert.ok(h.session(A));h.advance(1);assert.equal(h.session(A),undefined);
});

test('successful taskkill acknowledgment with process still alive expires safely',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.killMode('stays');h.api.forceStopGame(A);h.advance(10000);
    assert.ok(h.session(A));assert.ok(h.hasLog('FAST_FALLBACK'));assert.equal(h.finalized.length,0);
    assert.ok(h.probes.length<35,'bounded fast checking');
});

test('duplicate Stop while validation or taskkill is pending cannot kill twice',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.killMode('defer');
    h.api.forceStopGame(A);h.api.forceStopGame(A);assert.equal(h.kills.length,1);assert.equal(h.heldKills.length,1);
    h.heldKills.shift()();h.advance(450);assert.equal(h.finalized.length,1);
});

test('force-stop refuses a tree containing a second tracked game',()=>{
    const h=harness();const a=h.launch(A),b=h.launch(B);h.advance(2000);
    h.running.get(b).ppid=a;h.api.forceStopGame(A);h.advance(0);
    assert.equal(h.kills.length,0);assert.ok(h.hasLog('process tree contains another tracked game'));assert.ok(h.session(A));assert.ok(h.session(B));
});

test('changed PID/path or session before asynchronous validation cannot kill new target',()=>{
    const h=harness();const a=h.launch(A);h.advance(2000);h.nextProbe('hold');h.api.forceStopGame(A);
    h.disappear(a,false);h.addProcess({pid:44000,ppid:0,path:EXE_A});h.advance(2000);h.held.shift()();h.advance(0);
    assert.equal(h.kills.length,0);assert.ok(h.hasLog('target changed while validating'));assert.ok(h.session(A));
});

test('ambiguous replacement candidates cannot be mistaken for fast-confirmed absence',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.api.forceStopGame(A);h.advance(0);
    h.addProcess({pid:45000,ppid:0,path:EXE_A});h.addProcess({pid:45001,ppid:0,path:EXE_A});h.advance(450);
    assert.ok(h.hasLog('FAST_FALLBACK ambiguous-candidate'));assert.ok(h.session(A));assert.equal(h.finalized.length,0);
});

test('wall clock changes do not shorten restart guard (monotonic deadline)',()=>{
    const h=harness();const a=h.launch(A);h.advance(2000);h.disappear(a,true);h.advance(0);
    h.jumpWall(1000000000);h.advance(11999);assert.ok(h.session(A));h.advance(2001);assert.equal(h.session(A),undefined);
});

test('PowerShell fallback still supports Stop verification without extra natural burst',()=>{
    const h=harness({nativeProbe:false});h.launch(A);h.advance(2000);h.api.forceStopGame(A);h.advance(450);
    assert.equal(h.session(A),undefined);assert.ok(h.hasLog('FAST_CONFIRMED'));
});

test('confirmed stop does not bypass the existing auto-backup completion path',async()=>{
    const h=harness({autoBackup:true});h.launch(A);h.launch(B);h.advance(2000);h.api.forceStopGame(A);h.advance(450);
    assert.equal(h.finalized.length,1);assert.equal(h.backups.length,1);assert.equal(h.session(A).stopping,true);
    assert.equal(h.events('game:stopped').length,0);assert.ok(h.session(B));assert.deepEqual(h.stops,[A]);
    h.backupWaiters.shift()();await Promise.resolve();await Promise.resolve();await Promise.resolve();
    assert.equal(h.session(A),undefined);assert.equal(h.events('game:stopped').length,1);assert.ok(h.session(B));
});


test('duplicate Stop after acknowledgment does not launch a second kill or reset fast verification',()=>{
    const h=harness();h.launch(A);h.advance(2000);h.api.forceStopGame(A);h.advance(0);
    h.api.forceStopGame(A);assert.equal(h.kills.length,1);h.advance(450);
    assert.equal(h.session(A),undefined);assert.equal(h.finalized.length,1);
});


// v1.0.1: the short deadline is a configurable policy, never a proof of no
// future restart. The original tests above still cover the long policy.
test('balanced natural exit: 4-second confirmation; B keeps its own timer and overlay',()=>{
    const h=harness({guardIds:''});const a=h.launch(A),b=h.launch(B);h.advance(3000);
    const sid=h.session(B).sessionId;h.disappear(a,true);h.advance(0);
    assert.ok(h.hasLog('mode=balanced graceMs=4000'));h.advance(3999);
    assert.ok(h.session(A));assert.equal(h.finalized.length,0);h.advance(1);
    assert.equal(h.session(A),undefined);assert.equal(h.finalized.length,1);
    assert.ok(h.hasLog('verifyMs=4000 mode=balanced'));assert.equal(h.finalized[0].elapsed,2);
    assert.deepEqual(h.stops,[A]);assert.equal(h.session(B).sessionId,sid);
    assert.ok(h.running.has(b));assert.equal(h.kills.length,0);
    assert.ok(h.session(B).elapsed>=7);
});
test('balanced policy detects restart just before deadline and keeps session and pause',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(2000);const sid=h.session(A).sessionId;
    h.api.pauseTimer(A);h.disappear(a,true);h.advance(0);h.advance(3999);
    h.addProcess({pid:51000,ppid:0,path:EXE_A});h.advance(1);
    assert.equal(h.session(A).sessionId,sid);assert.equal(h.session(A).paused,true);
    assert.equal(h.finalized.length,0);assert.ok(h.hasLog('RESTART_RECOVERED'));
    assert.ok(h.attaches.some(r=>r.activePid===51000&&r.sessionId===sid));
    assert.equal(h.api.applyOverlayTimerAction(A,sid,a,false).ok,false);
});
test('restarted process disappearance keeps the extended guard',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(2000);const sid=h.session(A).sessionId;
    h.disappear(a,true);h.advance(0);h.addProcess({pid:51001,ppid:0,path:EXE_A});h.advance(450);
    h.disappear(51001,false);h.advance(1550);h.advance(4000);
    assert.equal(h.session(A).sessionId,sid);assert.ok(h.hasLog('mode=extended graceMs=12000'));
    h.advance(10000);assert.equal(h.session(A),undefined);assert.equal(h.finalized.length,1);
});
test('learned restart profile persists across sessions in this launcher run only for A',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(2000);
    h.disappear(a,true);h.advance(0);h.addProcess({pid:51002,ppid:0,path:EXE_A});h.advance(450);
    h.api.forceStopGame(A);h.advance(450);assert.equal(h.session(A),undefined);
    const a2=h.launch(A),b=h.launch(B);h.advance(3000);
    h.disappear(a2,true);h.disappear(b,true);h.advance(0);h.advance(4000);
    assert.ok(h.session(A));assert.equal(h.session(B),undefined);
    h.advance(10000);assert.equal(h.session(A),undefined);
    assert.ok(h.hasLog('RESTART_PROFILE_EXTENDED gameId=1001'));
});
test('per-game conservative override protects delayed restart and leaves other games balanced',()=>{
    const h=harness({guardIds:' 1001 , 9999 '});const a=h.launch(A),b=h.launch(B);h.advance(3000);
    const sid=h.session(A).sessionId;h.disappear(a,true);h.disappear(b,true);h.advance(0);h.advance(4000);
    assert.ok(h.session(A));assert.equal(h.session(B),undefined);
    h.advance(6500);h.addProcess({pid:52000,ppid:0,path:EXE_A});h.advance(2000);
    assert.equal(h.session(A).sessionId,sid);assert.equal(h.finalized.length,1);
});
test('crash or nonzero exit code retains the full guard',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(3000);
    h.disappear(a,true,1);h.advance(0);h.advance(4000);assert.ok(h.session(A));
    assert.ok(h.hasLog('mode=extended graceMs=12000'));h.advance(10000);assert.equal(h.session(A),undefined);
});
test('unverified early exit does not qualify for shortened guard',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(100);
    h.disappear(a,true);h.advance(0);h.advance(4000);assert.ok(h.session(A));
    h.advance(10000);assert.equal(h.session(A),undefined);
});
test('no child exit event means extended guard even for a direct executable',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(2000);
    h.disappear(a,false);h.advance(6000);assert.ok(h.session(A));
    h.advance(10000);assert.equal(h.session(A),undefined);
});
test('failed probe during balanced guard restarts full protection',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(3000);
    h.disappear(a,true);h.advance(0);h.nextProbe('fail');h.advance(450);h.advance(4000);
    assert.ok(h.hasLog('BALANCED_FALLBACK gameId=1001 reason=probe-failed'));assert.ok(h.session(A));
    h.advance(12000);assert.equal(h.session(A),undefined);
});
test('ambiguous replacement candidates revoke the short deadline',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(3000);
    h.disappear(a,true);h.advance(0);h.addProcess({pid:53000,ppid:0,path:EXE_A});h.addProcess({pid:53001,ppid:0,path:EXE_A});h.advance(450);
    assert.ok(h.hasLog('BALANCED_FALLBACK gameId=1001 reason=ambiguous-candidate'));
    h.disappear(53000);h.disappear(53001);h.advance(4000);assert.ok(h.session(A));
    h.advance(10000);assert.equal(h.session(A),undefined);
});
test('non-native slow process probe keeps conservative natural exit',()=>{
    const h=harness({guardIds:'',nativeProbe:false});const a=h.launch(A);h.advance(3000);
    h.disappear(a,true);h.advance(0);h.advance(4000);assert.ok(h.session(A));h.advance(10000);
    assert.equal(h.session(A),undefined);assert.ok(h.hasLog('mode=extended graceMs=12000'));
});
test('in-flight snapshot before clean exit cannot count toward balanced deadline',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(2000);h.nextProbe('hold');h.advance(2000);
    h.disappear(a,true);h.advance(1000);h.held.shift()();h.advance(0);h.advance(3999);
    assert.ok(h.session(A));h.advance(1);assert.equal(h.session(A),undefined);
    assert.ok(h.hasLog('verifyMs=4000 mode=balanced'));
});
test('balanced policy is monotonic under large wall-clock adjustment',()=>{
    const h=harness({guardIds:''});const a=h.launch(A);h.advance(3000);h.disappear(a,true);h.advance(0);
    h.jumpWall(900000000);h.advance(3999);assert.ok(h.session(A));h.advance(1);
    assert.equal(h.session(A),undefined);
});
test('balanced mode does not change explicit Stop confirmation',()=>{
    const h=harness({guardIds:''});h.launch(A);h.advance(3000);h.api.forceStopGame(A);h.advance(449);
    assert.ok(h.session(A));h.advance(1);assert.equal(h.session(A),undefined);assert.ok(h.hasLog('FAST_CONFIRMED'));
});
test('wrapper launches never qualify as verified direct executable',()=>{
    const h=harness({guardIds:''});const a=h.launch(A,'C:\\Games\\A\\launcher.exe');h.advance(3000);
    h.disappear(a,true);h.advance(0);h.advance(4000);assert.ok(h.session(A));h.advance(10000);assert.equal(h.session(A),undefined);
});
