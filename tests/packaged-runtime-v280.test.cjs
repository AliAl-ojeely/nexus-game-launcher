'use strict';
// Execute the real overlay-manager in an isolated VM. No Windows API, process,
// native injection, game files or user data are used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT,'modules/overlay-manager.js'),'utf8');
const win = path.win32;
const resources = 'C:\\Program Files\\Nexus Game Launcher\\resources';
const exe = 'C:\\Program Files\\Nexus Game Launcher\\Nexus Game Launcher.exe';
const dev = 'D:\\dev\\nexus-game-launcher';
const data = 'C:\\Users\\Tester\\AppData\\Roaming\\Custom Nexus Profile';
const gamePath = 'D:\\Offline Games\\Game A\\game.exe';
const makeGame = (overrides={}) => ({ gameId:1,gameName:'Game A',sessionId:'session-a',activePid:101,activePath:gamePath,installPath:gamePath,stopping:false,...overrides });
function harness({packaged=true,enabled=true,missing=false,arch='x64'}={}) {
    const runtime=packaged?win.join(resources,'overlay-runtime'):dev;
    const runner=win.join(runtime,'tools',packaged?'run_overlay_real_game.exe':'run_overlay_real_game.py');
    const calls=[], logs=[];
    const server=new EventEmitter();server.listen=(_pipe,cb)=>cb();server.unref=()=>{};server.close=()=>{};
    const config={enabled,shortcut:'Ctrl+F1',quickOpen:{escape:true,start:true},navigation:{keyboard:false,gamepad:false}};
    const dep={
        'node:child_process':{spawn(command,args,options){
            const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>{};
            child.stdout=new EventEmitter();child.stderr=new EventEmitter();
            child.stdout.setEncoding=child.stderr.setEncoding=()=>{};
            calls.push({command,args:Array.from(args),options,child});return child;
        }},
        'node:fs':{existsSync:p=>!missing||p!==runner},
        'node:net':{createServer:()=>server},'node:path':win,'node:crypto':crypto,
        electron:{app:{isPackaged:packaged}},
        './app-settings':{readSettings:()=>({modalOverlay:config}),SETTINGS_FILE:win.join(data,'settings.json')},
        './overlay-config':{normalize:value=>value},
    };
    const module={exports:{}};
    vm.runInNewContext(source,{module,exports:module.exports,__dirname:win.join(packaged?win.join(resources,'app.asar'):dev,'modules'),
        require:name=>{if(!(name in dep))throw Error('Unexpected dependency '+name);return dep[name];},
        process:{platform:'win32',arch,pid:1234,resourcesPath:resources,execPath:exe,env:{}},
        console:{log:(...a)=>logs.push(a.join(' ')),warn:(...a)=>logs.push(a.join(' ')),error:(...a)=>logs.push(a.join(' '))},Date},
        {filename:'modules/overlay-manager.js',timeout:1000});
    const api=module.exports;api.start(()=>({ok:true,paused:false}));return {api,calls,logs,runner,runtime};
}
const option=(args,key)=>args[args.indexOf(key)+1];
function assertCommon(call) {
    const a=call.args;
    assert.equal(option(a,'--pid'),'101');
    assert.equal(option(a,'--exe'),gamePath);
    assert.equal(option(a,'--overlay-shortcut'),'Ctrl+F1');
    assert.equal(option(a,'--library'),win.join(data,'games.json'));
    assert.equal(option(a,'--session-file'),win.join(data,'nexus-overlay-session-v1.json'));
    assert.equal(option(a,'--managed-game-id'),'1');
    assert.equal(option(a,'--managed-session-id'),'session-a');
    assert.match(option(a,'--managed-actions-token'),/^[0-9a-f]{64}$/);
    for(const flag of ['--attach','--confirm-unprotected','--managed','--quick-escape','--quick-start','--disable-overlay-keyboard-nav','--disable-overlay-gamepad-nav']) assert.ok(a.includes(flag),flag);
    assert.equal(call.options.env.NEXUS_OVERLAY_SETTINGS_FILE,win.join(data,'settings.json'));
    assert.equal(call.options.windowsHide,true);
}
test('packaged helper is executable, never an extra positional argument',()=>{
    const h=harness();assert.equal(h.api.attach(makeGame()),true);assert.equal(h.calls.length,1);
    const c=h.calls[0];assert.equal(c.command,h.runner);assert.equal(c.args[0],'--pid');
    assert.ok(!c.args.includes(h.runner));assert.ok(!c.args.includes('-3'));
    assert.equal(c.options.cwd,h.runtime);assert.equal(c.options.env.NEXUS_OVERLAY_PACKAGED_APP_EXE,exe);
    assertCommon(c);assert.ok(h.logs.some(s=>s.includes('runtime=packaged')));
});
test('development Python command still receives -3 and script path exactly once',()=>{
    const h=harness({packaged:false});assert.equal(h.api.attach(makeGame()),true);const c=h.calls[0];
    assert.equal(c.command,'py');assert.deepEqual(c.args.slice(0,3),['-3',h.runner,'--pid']);
    assert.equal(c.args.filter(x=>x===h.runner).length,1);assert.equal(c.options.cwd,dev);
    assert.equal(c.options.env.NEXUS_OVERLAY_PACKAGED_APP_EXE,undefined);assertCommon(c);
});
test('two installed game helpers have separate PIDs and token/session identities',()=>{
    const h=harness();h.api.attach(makeGame());h.api.attach(makeGame({gameId:2,activePid:202,sessionId:'session-b'}));
    assert.equal(h.calls.length,2);const [a,b]=h.calls.map(c=>c.args);
    assert.equal(option(a,'--pid'),'101');assert.equal(option(b,'--pid'),'202');
    assert.notEqual(option(a,'--managed-actions-token'),option(b,'--managed-actions-token'));
    assert.equal(option(b,'--managed-session-id'),'session-b');
    h.api.stop(1);assert.equal(h.api.attach(makeGame({gameId:2,activePid:202,sessionId:'session-b'})),true);assert.equal(h.calls.length,2);
});
test('disabled overlay, missing component, unsupported host or mismatched EXE cannot attach',()=>{
    for(const options of [{enabled:false},{missing:true},{arch:'arm64'}]){
        const h=harness(options);assert.equal(h.api.attach(makeGame()),false);assert.equal(h.calls.length,0);
    }
    const h=harness();assert.equal(h.api.attach(makeGame({activePath:'C:\\Windows\\explorer.exe'})),false);assert.equal(h.calls.length,0);
});
test('CI builds only existing x64 probe target and stages it outside ASAR',()=>{
    const build=fs.readFileSync(path.join(ROOT,'.github/scripts/build_overlay_runtime.ps1'),'utf8');
    assert.match(build,/\$archTargets = if \(\$arch -eq 'x64'\) \{ \$targets \+ @\('NexusProcessProbe'\) \} else \{ \$targets \}/);
    assert.ok(build.includes('--target $archTargets'));
    assert.ok(build.includes("$probeSource = Join-Path $root 'native/nexus-overlay/build/bin/NexusProcessProbe.exe'"));
    assert.ok(build.includes("(Join-Path $stage 'native/nexus-overlay/build/bin/NexusProcessProbe.exe')"));
    assert.ok(build.includes('--hidden-import nexus_overlay_quick_input_v103'));
    assert.doesNotMatch(build,/NexusD3D12Hook/);
});
test('CI executes native snapshot and rejects invalid managed CLI before process access',()=>{
    const verify=fs.readFileSync(path.join(ROOT,'.github/scripts/verify_overlay_resources.ps1'),'utf8');
    assert.ok(verify.includes("'native/nexus-overlay/build/bin/NexusProcessProbe.exe'"));
    assert.ok(verify.includes('Invoke-CapturedSmoke -File $probeExe'));
    assert.ok(verify.includes('ConvertFrom-Json'));
    assert.ok(verify.includes('$_.pid -eq $PID -and $_.path'));
    assert.ok(verify.includes("@('--pid','0'"));
    assert.ok(verify.includes('PID must be a positive Windows DWORD'));
    assert.ok(verify.includes("-match 'unrecognized arguments'"));
    assert.ok(verify.includes("@('--nexus-overlay-helper', '--pid', 'invalid')"));
});
