'use strict';
// Exercise the actual patched front-end finalizer under a fake DOM/IPC. This
// catches the async race when game A ends while game B's details are visible.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');

function setup(currentGame=2002, addPlaytime=async()=>120) {
    const source=fs.readFileSync(path.join(root,'render/details/handlers.js'),'utf8');
    const start=source.indexOf('const finalizingSessions = new Set();');
    const end=source.indexOf('function extractRequiredRam(',start);
    assert.ok(start>=0 && end>start,'Expected patched finalizer not found');
    const code=source.slice(start,end).replace('export async function handleGameStop','async function handleGameStop');
    const writes=[], timeouts=[];
    const dom={};
    for(const id of ['detailsPlayBtn','sessionTimerContainer','sessionTimerValue','totalPlaytimeValue','lastPlayedContainer','lastPlayedValue']) {
        const style={display:id==='sessionTimerContainer'?'flex':'unchanged',cssText:'unchanged'};
        dom[id]={id,innerHTML:'B - Stop',innerText:'B - Running',style,disabled:false,
            classList:{add:()=>writes.push(id+':class-add'),remove:()=>writes.push(id+':class-remove')}};
    }
    const state={currentGameId:currentGame,isGameRunning:true,
        allGamesData:[{id:1001,name:'Game A',path:'A.exe'},{id:2002,name:'Game B',path:'B.exe'}],currentGameExePath:'B.exe'};
    const calls=[];
    const context={state,document:{getElementById:id=>dom[id] || null},userSettings:{lang:'en'},
        liveSessions:{get:id=>String(id)==='2002'?{gameId:2002,phase:'running',elapsed:22}:null},
        window:{api:{
            addPlaytime:async(name,mins,secs)=>{calls.push(['add',name,secs]);return addPlaytime(name,mins,secs);},
            getPlaytime:async()=>100,
            getPlaytimeInfo:async()=>({lastPlayed:Date.now()}),
            backup:{getAutoBackup:async()=>false,getInfo:async()=>({}),now:async()=>({success:false})},
        }},
        showToast:()=>null, formatPlaytime:()=> '42h',t:(name, fallback)=>fallback,
        renderGames:async()=>{},pulseBackupSuccess:()=>{},updateBackupSidebarUI:()=>{},
        paintDetailsSession:()=>{writes.push('paintDetailsSession');return false;},
        setTimeout:func=>{timeouts.push(func);return timeouts.length;},
        clearInterval:()=>{},Date,Set,String,Math,Number,console:{log(){},warn(){},error(){}}
    };
    vm.runInNewContext(code+'\nthis.handleGameStop=handleGameStop;',context,{timeout:1000});
    return {handle:context.handleGameStop,calls,state,dom,timeouts,writes};
}
test('finishing game A adds only A playtime and never touches visible game B',async()=>{
    const h=setup();
    await h.handle('Game A',83,1001,'idA');
    assert.equal(h.calls.length,1);
    assert.deepEqual(h.calls[0],['add','Game A',83]);
    assert.equal(h.state.isGameRunning,true);
    assert.equal(h.dom.detailsPlayBtn.innerHTML,'B - Stop');
    assert.equal(h.dom.sessionTimerValue.innerText,'B - Running');
    assert.equal(h.dom.sessionTimerContainer.style.display,'flex');
    await h.timeouts[0]();
    assert.deepEqual(h.writes,[]);
});
test('duplicate stop event for same session does not record playtime twice',async()=>{
    const h=setup();
    await h.handle('Game A',83,1001,'idA');
    await h.handle('Game A',83,1001,'idA');
    assert.equal(h.calls.length,1);
});
test('switching from A to B during a delayed playtime IPC cannot repaint B',async()=>{
    let complete;
    const blocker=new Promise(resolve=>{complete=resolve;});
    const h=setup(1001,async()=>{await blocker;return 120;});
    const running=h.handle('Game A',83,1001,'idA');
    h.state.currentGameId=2002;h.state.currentGameExePath='B.exe';
    complete(); await running;
    assert.equal(h.dom.detailsPlayBtn.innerHTML,'B - Stop');
    assert.equal(h.dom.sessionTimerValue.innerText,'B - Running');
    await h.timeouts[0]();
    assert.deepEqual(h.writes,[]);
});
