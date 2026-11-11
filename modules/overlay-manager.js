'use strict';
// Nexus app-owned helper lifecycle. The helper still uses Electron OSR and the
// existing D3D11 native hook, but no terminal command is needed from the user.
// A narrow random-token named pipe routes Pause/Resume back to Nexus's timer.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { readSettings, SETTINGS_FILE } = require('./app-settings');
const overlayConfig = require('./overlay-config');

const ROOT = path.join(__dirname, '..');
const RUNNER = path.join(ROOT, 'tools', 'run_overlay_real_game.py');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const DLL = path.join(ROOT, 'native', 'nexus-overlay', 'build', 'bin', 'NexusOverlayHook.dll');
const INJECTOR = path.join(ROOT, 'native', 'nexus-overlay', 'build', 'bin', 'NexusOverlayInjector.exe');
const jobs = new Map();
const unavailable = new Set();
const retryAfter = new Map();
// One persistent no-draw / unsupported architecture failure per live game session.
// Retrying every 30 seconds cannot fix an unavailable graphics backend.
const terminalFailure = new Map();
const pipeName = `\\\\.\\pipe\\nexus-app-session-${process.pid}-${crypto.randomBytes(10).toString('hex')}`;
let server = null;
let ready = false;
let timerAction = null;
let quitting = false;

function safeId(value) { return String(value); }
function dependencies() {
    return [RUNNER, ELECTRON, DLL, INJECTOR].filter(item => !fs.existsSync(item));
}
function actionValid(request, job) {
    return !!(request && job && request.token === job.token &&
        safeId(request.gameId) === safeId(job.gameId) &&
        request.sessionId === job.sessionId && request.pid === job.pid &&
        (request.action === 'pause' || request.action === 'resume'));
}
function responseForRequest(request) {
    const job = request && jobs.get(safeId(request.gameId));
    if (!actionValid(request, job) || !timerAction) return { ok: false, error: 'Unrecognized or expired session' };
    try {
        const state = timerAction(job.gameId, job.sessionId, job.pid, request.action === 'pause');
        return state && state.ok ? { ok: true, paused: !!state.paused } :
            { ok: false, error: 'Game session is no longer active' };
    } catch (error) {
        console.error('[NEXUS OVERLAY] Timer action rejected:', error.message);
        return { ok: false, error: 'Timer action was not applied' };
    }
}
function start(applyTimerAction) {
    if (process.platform !== 'win32') return;
    if (server) return;
    timerAction = applyTimerAction;
    server = net.createServer(socket => {
        let bytes = '';
        socket.setTimeout(2500, () => socket.destroy());
        socket.on('data', chunk => {
            bytes += chunk.toString('utf8');
            if (bytes.length > 2048) { socket.destroy(); return; }
            const index = bytes.indexOf('\n');
            if (index < 0) return;
            let reply;
            try { reply = responseForRequest(JSON.parse(bytes.slice(0, index))); }
            catch { reply = { ok: false, error: 'Malformed timer request' }; }
            socket.end(JSON.stringify(reply) + '\n');
        });
        socket.on('error', () => {});
    });
    server.on('error', error => {
        ready = false;
        console.error('[NEXUS OVERLAY] Timer control unavailable:', error.message);
    });
    server.listen(pipeName, () => {
        ready = true;
        console.log('[NEXUS OVERLAY] Integrated session control ready.');
    });
    server.unref();
}
function attach(game) {
    if (quitting || !ready || process.platform !== 'win32' || !game || game.stopping) return false;
    const settings = readSettings();
    if (!overlayConfig.normalize(settings.modalOverlay).enabled) return false;
    // Global opt-in replaces the old per-game approval UI.
    const pid = Number(game.activePid);
    if (!Number.isSafeInteger(pid) || pid < 1 || !game.sessionId ||
        !game.activePath || !game.installPath ||
        path.win32.normalize(game.activePath).toLowerCase() !== path.win32.normalize(game.installPath).toLowerCase()) {
        // No auto-attach to an unverified wrapper child / different executable.
        return false;
    }
    const key = safeId(game.gameId);
    const old = jobs.get(key);
    if (old && old.pid === pid && old.sessionId === game.sessionId) return true;
    if (old) stop(key); // A new verified PID/session replaces the prior helper.
    const previousFailure = terminalFailure.get(key);
    if (previousFailure && previousFailure.pid === pid &&
        previousFailure.sessionId === game.sessionId) return false;
    if (previousFailure) terminalFailure.delete(key);
    const cooldown = retryAfter.get(key);
    if (cooldown && cooldown.sessionId === game.sessionId && cooldown.pid === pid &&
        Date.now() < cooldown.until) return false;
    const missing = dependencies();
    if (missing.length) {
        const id = missing.join('|');
        if (!unavailable.has(id)) {
            unavailable.add(id);
            console.warn('[NEXUS OVERLAY] Auto overlay skipped; missing installed component:', missing.join(', '));
        }
        return false;
    }
    const token = crypto.randomBytes(32).toString('hex');
    const activeShortcut = overlayConfig.normalize(settings.modalOverlay).shortcut;
    const args = ['-3', RUNNER, '--pid', String(pid), '--exe', game.activePath, '--overlay-shortcut', activeShortcut,
        '--attach', '--confirm-unprotected', '--managed',
        '--managed-game-id', key, '--managed-session-id', game.sessionId,
        '--managed-actions-pipe', pipeName, '--managed-actions-token', token];
    let child;
    try {
        child = spawn('py', args, { cwd: ROOT, windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', NEXUS_OVERLAY_SETTINGS_FILE: SETTINGS_FILE } });
    } catch (error) {
        console.warn('[NEXUS OVERLAY] Unable to start integrated overlay:', error.message);
        return false;
    }
    // The helper may exit before the launcher sends its shutdown request.
    // Never turn that expected broken pipe into an Electron crash.
    child.stdin?.on?.('error', () => {});
    const job = { gameId: game.gameId, pid, sessionId: game.sessionId, token, child };
    jobs.set(key, job);
    const log = (stream, kind) => {
        let tail = '';
        stream.setEncoding('utf8');
        stream.on('data', part => {
            tail = (tail + part).slice(-8192);
            let pos;
            while ((pos = tail.indexOf('\n')) >= 0) {
                const line = tail.slice(0, pos).trim();
                tail = tail.slice(pos + 1);
                if (line && (/^\[(?:ERROR|WARN|NEXUS OVERLAY|CONTROL|SESSION|ATTACH|NATIVE|INPUT|RESULT|TARGET|API)/.test(line) || kind === 'stderr'))
                    console.log(`[OVERLAY ${game.gameName}] ${line.slice(0, 500)}`);
            }
        });
    };
    log(child.stdout, 'stdout');
    log(child.stderr, 'stderr');
    child.on('error', error => {
        retryAfter.set(key, { sessionId: game.sessionId, pid, until: Date.now() + 30000 });
        console.warn('[NEXUS OVERLAY] Python helper could not start:', error.message);
        if (jobs.get(key) === job) jobs.delete(key);
    });
    child.on('exit', (code, signal) => {
        retryAfter.set(key, { sessionId: game.sessionId, pid, until: Date.now() + 30000 });
        if (jobs.get(key) === job) jobs.delete(key);
        if (code === 2 || code === 3 || code === 8) {
            terminalFailure.set(key, { sessionId: game.sessionId, pid, code });
            console.warn(`[NEXUS OVERLAY] Overlay unavailable for this game session (exit ${code}); ` +
                         'not retrying until a new launch. See preceding diagnostics.');
        }
        console.log(`[NEXUS OVERLAY] Helper exited for ${game.gameName} (${code ?? signal}).`);
    });
    console.log(`[NEXUS OVERLAY] Auto-start for ${game.gameName} (PID ${pid}); ${activeShortcut} to open.`);
    return true;
}
function stop(gameId) {
    const key = safeId(gameId);
    const job = jobs.get(key);
    if (!job) return;
    jobs.delete(key); // revoke timer access before shutting down helper
    retryAfter.set(key, { sessionId: job.sessionId, pid: job.pid, until: Date.now() + 30000 });
    if (job.child.stdin && !job.child.stdin.destroyed) {
        try { job.child.stdin.end('stop\n'); } catch { /* child already exited */ }
    }
}
function stopAll() {
    for (const key of [...jobs.keys()]) stop(key);
}
function shutdown() {
    quitting = true;
    terminalFailure.clear();
    stopAll();
    if (server) {
        try { server.close(); } catch { /* may not be listening */ }
    }
    ready = false;
}
module.exports = { start, attach, stop, stopAll, shutdown, actionValid };
