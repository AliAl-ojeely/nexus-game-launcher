'use strict';
// Renders HTML offscreen and publishes BGRA frames to the local D3D11 hook.
// v0.4 control commands are accepted only from the local launcher with a token.
const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');
const { selectSession } = require('./session_snapshot.cjs');
const overlayConfig = require('../../modules/overlay-config');
const { maskRoundedWidget } = require('./alpha_mask.cjs');
const { decodePointer, decodeScreenPointer, projectToWidget, toCursorNormalized } = require('./pointer_protocol.cjs');

if (process.platform !== 'win32') {
    console.error('[Nexus OSR] Windows x64 only.');
    process.exit(2);
}
function arg(name) {
    const index = process.argv.indexOf(name);
    return index < 0 ? null : process.argv[index + 1];
}
const pid = Number(arg('--pid'));
if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0xffffffff) {
    console.error('Usage: electron overlay/poc/host.cjs --pid <game-pid> [--control-token <48 hex chars>]');
    process.exit(2);
}
const token = arg('--control-token');
if (token !== null && !/^[0-9a-f]{48}$/.test(token)) {
    console.error('[Nexus OSR] Invalid control token.');
    process.exit(2);
}
const rawGameId = arg('--session-game-id');
const sessionGameId = rawGameId && rawGameId.length <= 100 ? rawGameId : null;
const sessionFile = arg('--session-file');
const sessionGameLabel = (arg('--session-game-name') || 'Current game').slice(0, 160);
const interactive = token !== null;
const actionPipe = arg('--nexus-actions-pipe');
const actionToken = arg('--nexus-actions-token');
const managedSessionId = arg('--nexus-session-id');
const managed = !!(actionPipe && actionToken && managedSessionId && sessionGameId);
if ([actionPipe, actionToken, managedSessionId].some(Boolean) && !managed) {
    console.error('[Nexus OSR] Incomplete Nexus managed timer configuration.');
    process.exit(2);
}
if (managed && (!/^\\\\\.\\pipe\\nexus-app-session-/.test(actionPipe) ||
        !/^[0-9a-f]{64}$/.test(actionToken) || managedSessionId.length > 128)) {
    console.error('[Nexus OSR] Invalid Nexus timer channel.');
    process.exit(2);
}
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.setName('Nexus Overlay POC');
const pipeName = `\\\\.\\pipe\\nexus-overlay-${pid}`;
const controlPipe = `\\\\.\\pipe\\nexus-overlay-control-${pid}`;
const clients = new Set();
let window = null;
let loaded = false;
let visible = !interactive; // Preserve v0.1-v0.3 test demo behavior.
let frames = 0;
let lastSessionNotice = null;
let lastSessionReadError = null;
let sessionPolling = false;
let sessionTimer = null;
let configTimer = null;
let previousConfig = '';
const settingsFile = managed ? process.env.NEXUS_OVERLAY_SETTINGS_FILE : null;
async function pollOverlaySettings() {
    if (!settingsFile) return;
    try {
        const stat = await fs.promises.stat(settingsFile);
        if (stat.size > 131072) return;
        const stored = JSON.parse(await fs.promises.readFile(settingsFile, 'utf8'));
        const next = overlayConfig.normalize(stored.modalOverlay);
        const fingerprint = JSON.stringify(next);
        if (fingerprint !== previousConfig) {
            previousConfig = fingerprint;
            if (window && loaded) window.webContents.send('nexus:overlay-config', next);
        }
    } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[NEXUS OVERLAY] Settings read ignored:', error.code || error.message);
    }
}
let sessionUI = { connected: false, status: 'Unavailable', gameName: sessionGameLabel, canControlTimer: false };
let cursorState = null;
let cursorInsideWidget = false;
function publishCursor(pointer) {
    if (!pointer || !visible) return;
    const xy = toCursorNormalized(pointer);
    if (!xy) return;
    cursorState = xy;
    // NXC1: uint32 normalizedX, uint32 normalizedY, uint32 visible (0/1).
    // C++ draws the arrow separately from the 560x338 BGRA card.
    const packet = Buffer.alloc(16);
    packet.write('NXC1', 0, 4, 'ascii');
    packet.writeUInt32LE(xy.x, 4);
    packet.writeUInt32LE(xy.y, 8);
    packet.writeUInt32LE(1, 12);
    for (const client of clients) {
        if (!client.destroyed) client.write(packet);
    }
}

async function pollSession() {
    if (sessionPolling) return;
    sessionPolling = true;
    let next = { connected: false, status: 'Unavailable', gameName: sessionGameLabel };
    try {
        if (sessionFile && sessionGameId) {
            // Read-only: no database opened, no file writes, no external commands.
            const snapshot = JSON.parse(await fs.promises.readFile(sessionFile, 'utf8'));
            next = { ...next, ...selectSession(snapshot, sessionGameId, pid) };
            lastSessionReadError = null;
        }
    } catch (error) {
        // Missing snapshot is an expected state when Nexus is not running.
        if (error.code !== 'ENOENT' && lastSessionReadError !== error.message) {
            console.warn('[SESSION] Snapshot unavailable:', error.message);
            lastSessionReadError = error.message;
        }
    } finally { sessionPolling = false; }
    next.canControlTimer = !!(managed && next.connected && next.sessionId === managedSessionId);
    if (managed && next.connected && !next.canControlTimer) {
        // Stale/PID-reused snapshots must never be authoritative for a new session.
        next = { connected: false, status: 'Unavailable', gameName: sessionGameLabel, canControlTimer: false };
    }
    const key = next.connected ? 'connected-' + next.status : 'disconnected';
    if (key !== lastSessionNotice) {
        if (next.connected) console.log('[SESSION] Linked to live Nexus:', next.gameName, '(' + next.status + ')');
        else console.log('[SESSION] Waiting for a matching live Nexus session.');
        lastSessionNotice = key;
    }
    const changed = JSON.stringify(sessionUI) !== JSON.stringify(next);
    sessionUI = next;
    if (changed && window && loaded) window.webContents.send('nexus:session', sessionUI);
}


function requestNexusTimer(action) {
    if (!managed || !sessionUI.connected || !sessionUI.canControlTimer || !visible) {
        return Promise.resolve({ ok: false, error: 'No active Nexus-managed timer session' });
    }
    return new Promise(resolve => {
        let finished = false;
        let reply = '';
        const socket = net.createConnection({ path: actionPipe });
        const done = result => {
            if (finished) return;
            finished = true;
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(2200, () => done({ ok: false, error: 'Nexus timer request timed out' }));
        socket.on('connect', () => {
            socket.write(JSON.stringify({ token: actionToken, action,
                gameId: sessionGameId, sessionId: managedSessionId, pid }) + '\n');
        });
        socket.on('data', data => {
            reply += data.toString('utf8');
            if (reply.length > 2048) return done({ ok: false, error: 'Invalid timer response' });
            if (reply.includes('\n')) {
                try { done(JSON.parse(reply.split('\n', 1)[0])); }
                catch { done({ ok: false, error: 'Unreadable Nexus timer reply' }); }
            }
        });
        socket.on('error', () => done({ ok: false, error: 'Nexus timer channel disconnected' }));
        socket.on('end', () => done({ ok: false, error: 'No timer confirmation received' }));
    });
}


function visibilityHeader() {
    const header = Buffer.alloc(16);
    header.write('NXV1', 0, 4, 'ascii');
    header.writeUInt32LE(visible ? 1 : 0, 4);
    return header;
}
function publishVisibility() {
    const header = visibilityHeader();
    for (const client of clients) {
        if (!client.destroyed) client.write(header);
    }
}
function setVisible(next) {
    const changed = visible !== Boolean(next);
    visible = Boolean(next);
    publishVisibility();
    if (visible && cursorState) {
        // Reconnect/toggle uses the last trusted normalized point until the
        // input bridge sends a fresh position for the current game window.
        const packet = Buffer.alloc(16);
        packet.write('NXC1', 0, 4, 'ascii');
        packet.writeUInt32LE(cursorState.x, 4);
        packet.writeUInt32LE(cursorState.y, 8);
        packet.writeUInt32LE(1, 12);
        for (const client of clients) if (!client.destroyed) client.write(packet);
    }
    if (!visible) cursorInsideWidget = false;
    if (window && loaded) {
        window.webContents.send('nexus:state', { visible });
        if (visible) window.webContents.invalidate();
    }
    if (changed) console.log('[Nexus OSR] Overlay:', visible ? 'SHOWN' : 'HIDDEN');
    return visible;
}
const server = net.createServer(client => {
    clients.add(client);
    console.log('[Nexus OSR] C++ connected:', pipeName);
    client.on('close', () => clients.delete(client));
    client.on('error', err => {
        if (['EOF', 'EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes(err.code)) {
            console.log('[Nexus OSR] Test renderer disconnected:', err.code);
        } else console.warn('[Nexus OSR] Client error:', err.message);
    });
    client.write(visibilityHeader());
    if (visible && window && loaded) window.webContents.invalidate();
});
server.on('error', err => { console.error('[Nexus OSR] Frame pipe:', err.message); app.quit(); });

const allowedNavigation = new Set(['up','down','left','right','confirm','back']);
function handleControl(request) {
    if (!request || request.token !== token || !interactive) return { ok: false, error: 'unauthorized' };
    switch (request.action) {
        case 'ping': return { ok: true, visible };
        case 'toggle': return { ok: true, visible: setVisible(!visible) };
        case 'show': return { ok: true, visible: setVisible(true) };
        case 'hide': return { ok: true, visible: setVisible(false) };
        case 'navigate':
            if (!visible || !loaded || !allowedNavigation.has(request.key)) return { ok: false, visible };
            window.webContents.send('nexus:navigation', { key: request.key, source: request.source === 'gamepad' ? 'gamepad' : 'keyboard' });
            return { ok: true, visible };
        case 'pointer': {
            if (!visible || !loaded || !window) return { ok: false, visible };
            if (request.source === 'mouse-screen') {
                const pointer = decodeScreenPointer(request.key, request.source);
                if (!pointer) return { ok: false, error: 'invalid-screen-pointer', visible };
                if (pointer.type !== 'cancel') {
                    publishCursor(pointer);
                    const projected = projectToWidget(pointer);
                    if (projected) {
                        cursorInsideWidget = true;
                        window.webContents.send('nexus:pointer', projected);
                    } else if (cursorInsideWidget) {
                        cursorInsideWidget = false;
                        window.webContents.send('nexus:pointer', { type: 'cancel', native: true });
                    }
                } else if (cursorInsideWidget) {
                    cursorInsideWidget = false;
                    window.webContents.send('nexus:pointer', { type: 'cancel', native: true });
                }
                return { ok: true, visible };
            }
            const pointer = decodePointer(request.key, request.source);
            if (!pointer) return { ok: false, error: 'invalid-pointer', visible };
            // Preserve the v0.6.1 local-only pointer for offline test tooling.
            window.webContents.send('nexus:pointer', pointer);
            return { ok: true, visible };
        }
        default: return { ok: false, error: 'invalid-command' };
    }
}
let controlServer = null;
if (interactive) {
    controlServer = net.createServer(client => {
        let incoming = '';
        client.setTimeout(2000);
        client.on('timeout', () => client.destroy());
        client.on('data', data => {
            incoming += data.toString('utf8');
            if (incoming.length > 1024) { client.destroy(); return; }
            if (!incoming.includes('\n')) return;
            const [line] = incoming.split('\n', 1);
            let response;
            try { response = handleControl(JSON.parse(line)); }
            catch { response = { ok: false, error: 'invalid-json' }; }
            client.end(JSON.stringify(response) + '\n');
        });
        client.on('error', () => {});
    });
    controlServer.on('error', error => {
        console.error('[Nexus OSR] Control pipe:', error.message);
        app.quit();
    });
}

app.whenReady().then(async () => {
    server.listen(pipeName, () => console.log('[Nexus OSR] Pipe ready:', pipeName));
    if (controlServer) controlServer.listen(controlPipe, () => console.log('[Nexus OSR] Control ready for PID', pid));
    window = new BrowserWindow({
        width: 560, height: 338, frame: false, show: false, transparent: true,
        backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
        webPreferences: {
            offscreen: true,
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true, nodeIntegration: false, sandbox: true,
            backgroundThrottling: false,
        },
    });
    window.webContents.setFrameRate(16);
    window.webContents.on('paint', (_event, _dirty, image) => {
        if (!visible || clients.size === 0) return;
        try {
            const { width, height } = image.getSize();
            const bitmap = image.toBitmap({ scaleFactor: 1 });
            if (!width || !height || width > 800 || height > 600 || bitmap.length !== width * height * 4) {
                if (!frames) console.warn('[Nexus OSR] Invalid BGRA frame:', width, height);
                return;
            }
            // Guarantee a fully transparent outer margin, even if OSR repaints
            // it with opaque pixels after a fullscreen/resize transition.
            maskRoundedWidget(bitmap, width, height);
            const header = Buffer.allocUnsafe(16);
            header.write('NXF1', 0, 4, 'ascii');
            header.writeUInt32LE(width, 4);
            header.writeUInt32LE(height, 8);
            header.writeUInt32LE(bitmap.length, 12);
            for (const client of clients) {
                if (!client.destroyed && client.writableLength < 1024 * 1024) {
                    client.write(header);
                    client.write(bitmap);
                }
            }
            if (++frames === 1) console.log('[Nexus OSR] First BGRA frame:', width, 'x', height);
        } catch (error) { console.error('[Nexus OSR] Paint error:', error.message); }
    });
    ipcMain.handle('nexus:timer-action', async (event, paused) => {
        if (event.sender !== window.webContents || typeof paused !== 'boolean')
            return { ok: false, error: 'Invalid timer command' };
        const result = await requestNexusTimer(paused ? 'pause' : 'resume');
        if (result.ok) console.log('[SESSION] Nexus timer:', result.paused ? 'PAUSED' : 'RUNNING');
        else console.warn('[SESSION] Timer action not applied:', result.error);
        return result;
    });
    ipcMain.on('nexus:ui-command', (event, action) => {
        if (event.sender !== window.webContents) return;
        if (action === 'hide') setVisible(false);
    });
    await window.loadFile(path.join(__dirname, 'index.html'));
    loaded = true;
    window.webContents.send('nexus:state', { visible });
    window.webContents.send('nexus:session', sessionUI);
    window.webContents.send('nexus:overlay-config', overlayConfig.normalize(null));
    if (visible) window.webContents.invalidate();
    // This timer only polls a sanitized local snapshot; Nexus owns the actual timer.
    await pollSession();
    sessionTimer = setInterval(pollSession, 900);
    await pollOverlaySettings();
    configTimer = setInterval(pollOverlaySettings, 1400);
    if (visible) window.webContents.invalidate();
    console.log('[Nexus OSR] Offscreen HTML loaded; input and UI stay outside game process.');
});
app.on('before-quit', () => {
    if (sessionTimer) clearInterval(sessionTimer);
    if (configTimer) clearInterval(configTimer);
    server.close();
    if (controlServer) controlServer.close();
});
app.on('window-all-closed', () => {});
