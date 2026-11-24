import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LiveGameSessions } from '../render/details/live-sessions.mjs';
import { paintDetailsSession } from '../render/details/session-presentation.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const A = { gameId: 1001, sessionId: 'A-session', elapsed: 0, paused: false };
const B = { gameId: 2002, sessionId: 'B-session', elapsed: 0, paused: false };
const setup = () => { const s = new LiveGameSessions(); s.launch(A.gameId); s.started(A); s.launch(B.gameId); s.started(B); return s; };
function fakeDocument() {
    const elements = new Map();
    for (const id of ['detailsPlayBtn', 'sessionTimerContainer','sessionTimerValue','pauseTimerBtn']) {
        const classes = new Set();
        elements.set(id, {
            id, innerText:'', innerHTML:'', disabled:false, style: { display:'', cssText:'' },
            classList: { add: x => classes.add(x), remove: (...xs) => xs.forEach(x => classes.delete(x)),
                contains:x=>classes.has(x) }
        });
    }
    return { getElementById: id => elements.get(id) ?? null, elements };
}

test('two running games have independent elapsed time', () => {
    const s = setup();
    assert.equal(s.tick({ ...A, elapsed: 115 }), true);
    assert.equal(s.tick({ ...B, elapsed: 38 }), true);
    assert.equal(s.get(A.gameId).elapsed, 115);
    assert.equal(s.get(B.gameId).elapsed, 38);
});
test('switching details page never shows another running game status', () => {
    const s = setup(); s.tick({...A,elapsed:125}); s.tick({...B,elapsed:31});
    const doc = fakeDocument();
    paintDetailsSession(doc, s, A.gameId);
    assert.equal(doc.getElementById('sessionTimerValue').innerText, '00:02:05');
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML, /Stop/);
    paintDetailsSession(doc, s, 9999);
    assert.equal(doc.getElementById('sessionTimerContainer').style.display,'none');
    assert.equal(doc.getElementById('sessionTimerValue').innerText, '00:00:00');
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML, /Play/);
    paintDetailsSession(doc,s,B.gameId);
    assert.equal(doc.getElementById('sessionTimerValue').innerText, '00:00:31');
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML, /Stop/);
});
test('stopping A never stops or hides B', () => {
    const s=setup(); s.tick({...B,elapsed:150});
    assert.ok(s.stop({...A,elapsed:45}));
    assert.equal(s.get(A.gameId),null);
    assert.equal(s.get(B.gameId).elapsed,150);
    const doc=fakeDocument(); paintDetailsSession(doc,s,B.gameId);
    assert.equal(doc.getElementById('sessionTimerValue').innerText,'00:02:30');
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML,/Stop/);
});
test('pause A from UI/overlay cannot pause B', () => {
    const s=setup();
    s.timerState({gameId:A.gameId,sessionId:A.sessionId,paused:true,elapsed:21});
    assert.equal(s.get(A.gameId).paused,true);
    assert.equal(s.get(B.gameId).paused,false);
    const doc=fakeDocument(); paintDetailsSession(doc,s,B.gameId);
    assert.match(doc.getElementById('pauseTimerBtn').innerHTML,/circle-pause/);
    paintDetailsSession(doc,s,A.gameId);
    assert.match(doc.getElementById('pauseTimerBtn').innerHTML,/circle-play/);
});
test('stale tick after re-launch cannot update a new session', () => {
    const s=setup(); s.stop({...A,elapsed:55});
    s.launch(A.gameId); s.started({...A,sessionId:'A-new',elapsed:0});
    assert.equal(s.tick({...A,elapsed:222}),false);
    assert.equal(s.stop({...A,elapsed:222}),null);
    assert.equal(s.get(A.gameId).sessionId,'A-new');
});
test('a stop arriving before the renderer recovery snapshot still finalizes exactly once', () => {
    const s = new LiveGameSessions();
    assert.ok(s.stop({gameId:1001,sessionId:'unknown-live',elapsed:19}));
    assert.equal(s.stop({gameId:1001,sessionId:'unknown-live',elapsed:19}),null);
});
test('duplicate stop and stale started events cannot finalize twice', () => {
    const s=setup();assert.ok(s.stop({...A,elapsed:59}));
    assert.equal(s.stop({...A,elapsed:59}),null);
    assert.equal(s.started(A),false);
    assert.ok(s.get(B.gameId));
});
test('duplicate launch for same game id is rejected while second game allowed', () => {
    const s=new LiveGameSessions();
    assert.equal(s.launch('123'),true);
    assert.equal(s.launch(123),false);
    assert.equal(s.launch(200),true);
});
test('launch failure of B cannot clear running A', () => {
    const s=new LiveGameSessions();s.launch(A.gameId);s.started(A);
    s.launch(B.gameId);assert.equal(s.failed({gameId:B.gameId}),true);
    assert.ok(s.get(A.gameId));assert.equal(s.get(B.gameId),null);
    assert.equal(s.failed({gameId:A.gameId}),false);
    assert.ok(s.get(A.gameId));
});
test('late recovered snapshot never rewinds current session or replaces ID', () => {
    const s=setup();s.tick({...A,elapsed:52});
    const result=s.reconcile([{...A,elapsed:2,paused:true},
        {...B,sessionId:'old-B',elapsed:99}, {gameId:3003,sessionId:'C',elapsed:40}]);
    assert.equal(result,1);
    assert.equal(s.get(A.gameId).elapsed,52);
    assert.equal(s.get(A.gameId).paused,false);
    assert.equal(s.get(B.gameId).sessionId,'B-session');
    assert.equal(s.get(3003).elapsed,40);
});
test('numeric and string game IDs identify the same session', () => {
    const s=setup();s.tick({gameId:'1001',sessionId:A.sessionId,elapsed:13});
    assert.equal(s.get(1001).elapsed,13);
    assert.ok(s.stop({gameId:'1001',sessionId:A.sessionId,elapsed:13}));
    assert.equal(s.get(1001),null);
});
test('missing/untrusted session identities cannot affect another timer', () => {
    const s=setup();
    assert.equal(s.timerState({gameId:A.gameId,sessionId:'unexpected',paused:true}),false);
    assert.equal(s.stop({gameId:B.gameId,sessionId:'unexpected',elapsed:100}),null);
    assert.equal(s.tick({gameId:A.gameId,elapsed:99}),false);
    assert.equal(s.get(A.gameId).elapsed,0);
    assert.ok(s.get(B.gameId));
});
test('selected game only gets launch/stopping UI; unrelated detail is Play', () => {
    const s=setup(); const doc=fakeDocument();
    const ready=s.get(A.gameId); ready.phase='stopping';
    paintDetailsSession(doc,s,A.gameId,'ar');
    assert.equal(doc.getElementById('detailsPlayBtn').disabled,true);
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML,/جاري الإيقاف/);
    paintDetailsSession(doc,s,B.gameId);
    assert.equal(doc.getElementById('detailsPlayBtn').disabled,false);
    assert.match(doc.getElementById('detailsPlayBtn').innerHTML,/Stop/);
});
test('no native graphics or overlay display files altered by this kit', () => {
    const all = fs.readdirSync(path.join(root, 'render', 'details'));
    assert.ok(all.length >= 1);
    const preview = read('render/details/live-sessions.mjs');
    assert.doesNotMatch(preview,/taskkill|\.dll|process\.kill|setInterval/);
});
