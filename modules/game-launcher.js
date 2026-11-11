const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');
const { net } = require('electron');
const { pathToFileURL } = require('url');
const processSelector = require('./game-process-selector');
const { describeLaunchError } = require('./game-launch-diagnostics');

const gameMonitors = new Map();  // gameId → setInterval (process polling)
const gameTimers = new Map();    // gameId → setInterval (playtime tick)
const runningGames = new Map();  // gameId → { pid, exeName, gameName, installPath, proc, startTime, pauseOffset, pauseStartTime, event, sessionIndex }
const backups = require('./backup');
const { readSettings } = require('./app-settings');
const sessions = require('./playSessions');  // 🆕 SESSION LOGGING
const overlaySessionFeed = require('./overlay-session-feed');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getElapsedSeconds(gameId) {
    const game = runningGames.get(gameId);
    if (!game) return 0;
    if (game.startHrtime !== undefined) {
        const now = process.hrtime.bigint();
        const pause = game.pauseStartedHrtime === null ? 0n : now - game.pauseStartedHrtime;
        const active = now - game.startHrtime - game.pausedNanoseconds - pause;
        return Math.max(0, Number(active > 0n ? active / 1000000000n : 0n));
    }
    return Math.max(0, Math.floor((Date.now() - game.startTime) / 1000));
}

function publishOverlaySessions() {
    // One small, local, sanitized snapshot per tick. The overlay never touches the DB.
    const active = [];
    for (const [gameId, game] of runningGames) {
        if (game.stopping) continue;
        active.push({
            gameId,
            gameName: game.gameName,
            activePid: game.activePid,
            launchPid: game.launchPid,
            sessionId: game.sessionId,
            elapsedSeconds: getElapsedSeconds(gameId),
            paused: game.pauseReasons.size > 0,
            stopping: game.stopping
        });
    }
    // This dependency is read lazily so monitoring unit tests do not need an Electron runtime.
    let readSavedTime = () => ({ minutes: 0, seconds: 0 });
    try { readSavedTime = require('./playtime').getPlaytimeInfo; }
    catch (error) {
        if (!publishOverlaySessions.loggedPlaytimeError) {
            console.warn('[NEXUS SESSION] Saved time reader unavailable:', error.message);
            publishOverlaySessions.loggedPlaytimeError = true;
        }
    }
    overlaySessionFeed.publish(active, app.getPath('userData'), readSavedTime);
}

function setPauseReason(gameId, reason, paused) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping) return false;
    if (game.pauseReasons.has(reason) === paused) return false;
    if (paused) game.pauseReasons.add(reason);
    else game.pauseReasons.delete(reason);
    const now = process.hrtime.bigint();
    if (game.pauseReasons.size && game.pauseStartedHrtime === null) {
        game.pauseStartedHrtime = now;
    } else if (!game.pauseReasons.size && game.pauseStartedHrtime !== null) {
        game.pausedNanoseconds += now - game.pauseStartedHrtime;
        game.pauseStartedHrtime = null;
    }
    publishOverlaySessions();
    if (game.event && !game.event.sender.isDestroyed()) {
        game.event.sender.send('game:timer-state', {
            gameId, paused: game.pauseReasons.size > 0, elapsed: getElapsedSeconds(gameId)
        });
    }
    return true;
}

function stopTimer(gameId) {
    const interval = gameTimers.get(gameId);
    if (interval) {
        clearInterval(interval);
        gameTimers.delete(gameId);
    }
}

async function stopMonitor(gameId, verifiedExit = null) {
    const game = runningGames.get(gameId);
    if (!game) {
        console.error('[BACKEND] stopMonitor: game not found');
        return;
    }

    if (game.stopping) return;
    game.stopping = true;
    const monitor = gameMonitors.get(gameId);
    if (monitor) {
        clearInterval(monitor);
        gameMonitors.delete(gameId);
    }
    stopTimer(gameId);
    if (process.platform === 'win32') {
        try { require('./overlay-manager').stop(gameId); }
        catch (error) { console.warn('[NEXUS OVERLAY] Stop error:', error.message); }
    }
    publishOverlaySessions(); // Immediately remove an ended game, even while backup runs.

    // Do not add the 14-second exit-confirmation delay to recorded playtime.
    const elapsed = verifiedExit && Number.isFinite(verifiedExit.elapsed)
        ? verifiedExit.elapsed : getElapsedSeconds(gameId);
    const endTime = verifiedExit && Number.isFinite(verifiedExit.endTime)
        ? verifiedExit.endTime : Date.now();

    if (game.sessionIndex !== undefined) {
        try {
            const recorded = sessions.endSession(game.sessionIndex, endTime, elapsed, game.sessionId);
            if (recorded) console.log(`[BACKEND] Session recorded for "${game.gameName}": ${elapsed}s`);
            else console.warn(`[BACKEND] Session not finalized for "${game.gameName}" (record missing/already closed).`);
        } catch (error) {
            // A disk/JSON error must not leave the game stuck as running.
            console.error(`[BACKEND] Could not save session for "${game.gameName}":`, error);
        }
    }

    const settings = readSettings();
    const autoBackup = settings.autoBackup !== undefined ? settings.autoBackup : true;

    if (autoBackup && game.gameName) {
        console.log(`[BACKEND] 📂 Starting backup for: "${game.gameName}"`);
        try {
            await backups.performMirroring(game.gameName, game.installPath || null);
        } catch (err) {
            console.error('[BACKEND] Backup error:', err);
        }
    } else if (!autoBackup && game.gameName) {
        console.log(`[BACKEND] ⏭️ Auto backup disabled for: "${game.gameName}"`);
    }

    if (runningGames.get(gameId) === game) runningGames.delete(gameId);

    if (game.event && !game.event.sender.isDestroyed()) {
        game.event.sender.send('game:stopped', { gameId, elapsed });
        console.log(`[BACKEND] ✅ game:stopped sent → gameId: ${gameId}, elapsed: ${elapsed}s`);
    }
}

function startTimer(gameId) {
    if (gameTimers.has(gameId)) return;

    const interval = setInterval(() => {
        const game = runningGames.get(gameId);
        if (!game) {
            stopTimer(gameId);
            return;
        }
        const elapsed = getElapsedSeconds(gameId);
        publishOverlaySessions();
        if (!game.event.sender.isDestroyed()) {
            game.event.sender.send('game:tick', { gameId, elapsed });
        }
    }, 1000);

    gameTimers.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS‑PLATFORM PROCESS LISTING (Optimized - No PowerShell)
// ─────────────────────────────────────────────────────────────────────────────
function getProcesses(callback) {
    if (process.platform === 'win32') {
        const probe = path.join(__dirname, '..', 'native', 'nexus-overlay', 'build', 'bin', 'NexusProcessProbe.exe');
        const deliver = (err, output) => {
            try {
                if (err) throw err;
                const json = JSON.parse(output);
                if (!Array.isArray(json) || json.length === 0) throw new Error('Empty process snapshot');
                const valid = json.filter(p => Number.isInteger(Number(p.pid)) && typeof p.path === 'string' && p.path);
                // Treat an unusable/empty snapshot as a probe error, never as
                // evidence that all running games disappeared.
                if (!valid.length) throw new Error('Process snapshot contained no usable executable paths');
                callback(valid.map(p => ({ pid: Number(p.pid), ppid: Number(p.ppid) || 0, path: p.path })));
            } catch (error) { callback(null, error); }
        };
        if (fs.existsSync(probe)) {
            execFile(probe, [], { windowsHide: true, timeout: 12000, maxBuffer: 12 * 1024 * 1024 }, deliver);
        } else {
            // Slow compatibility path when the native probe hasn't been built.
            const script = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ' +
                'Select-Object @{N="pid";E={$_.ProcessId}},@{N="ppid";E={$_.ParentProcessId}},' +
                '@{N="path";E={$_.ExecutablePath}} | ConvertTo-Json -Compress';
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
                { windowsHide: true, timeout: 25000, maxBuffer: 12 * 1024 * 1024 }, (err, output) => {
                    if (!err) {
                        try {
                            const parsed = JSON.parse(output);
                            deliver(null, JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]));
                            return;
                        } catch (error) { err = error; }
                    }
                    deliver(err || new Error('Process probe unavailable'), output);
                });
        }
        return;
    }
    exec('ps -eo pid=,ppid=,args=', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) return callback(null, err || new Error('ps failed'));
        const found = [];
        for (const line of stdout.split('\n')) {
            const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
            if (match) found.push({ pid: Number(match[1]), ppid: Number(match[2]), path: match[3].split(' ')[0] });
        }
        callback(found.length ? found : null);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART MONITOR (Optimized with Grace Period)
// ─────────────────────────────────────────────────────────────────────────────
function startSmartMonitor(gameDir, launcherPid, exeName, gameId) {
    let busy = false;
    let probeFailures = 0;
    const MAX_MISSING = 7;
    const health = processSelector.createMonitorHealth(MAX_MISSING);
    console.log(`[BACKEND] Monitoring verified game process: ${exeName}`);
    const interval = setInterval(() => {
        if (busy || !runningGames.has(gameId)) return;
        busy = true;
        getProcesses((processes, error) => {
            busy = false;
            const game = runningGames.get(gameId);
            if (!game || game.stopping) return;
            if (!processes) {
                const { previousMissing } = health.unavailable();
                probeFailures++;
                if (probeFailures === 1 || probeFailures % 10 === 0 || previousMissing) {
                    console.warn(`[BACKEND] Process probe failed (${probeFailures}); exit confirmation reset:`,
                        error?.message || 'empty snapshot');
                }
                return;
            }
            if (probeFailures) {
                console.log(`[BACKEND] Process probe recovered after ${probeFailures} failed snapshots.`);
                probeFailures = 0;
            }
            const selected = processSelector.selectGameProcess(
                processes, game.launchPid, game.installPath, game.activePid, game.activePath
            );
            if (selected) {
                const { recoveredAfter } = health.found(selected, getElapsedSeconds(gameId), Date.now());
                if (recoveredAfter) {
                    console.log(`[BACKEND] Game process recovered after ${recoveredAfter} missing snapshots (PID ${selected.pid}).`);
                }
                if (game.activePid !== selected.pid ||
                    processSelector.normalized(game.activePath) !== processSelector.normalized(selected.path)) {
                    game.activePid = selected.pid;
                    game.activePath = selected.path;
                    game.pid = selected.pid; // forceStopGame uses the verified active PID.
                    console.log(`[BACKEND] Verified game PID ${selected.pid} (${selected.reason})`);
                    publishOverlaySessions();
                }
                // The app automatically owns the overlay after selecting a VERIFIED process.
                // Only per-game approved exact executables can be attached.
                if (process.platform === 'win32') {
                    try { require('./overlay-manager').attach({
                        gameId, gameName: game.gameName, sessionId: game.sessionId,
                        activePid: game.activePid, activePath: game.activePath,
                        installPath: game.installPath, stopping: game.stopping
                    }); }
                    catch (error) { console.warn('[NEXUS OVERLAY] Start error:', error.message); }
                }
                return;
            }
            const missing = health.missing();
            if (missing.missingCount === 1 || missing.missingCount === MAX_MISSING) {
                console.log(`[BACKEND] Game PID ${game.activePid} not in process snapshot ` +
                    `(${missing.missingCount}/${MAX_MISSING}); checking for late child / process exit.`);
            }
            if (missing.shouldStop) {
                const verified = missing.lastSeen;
                if (verified) {
                    console.log(`[BACKEND] Confirmed exit. Last seen PID ${verified.pid}, ` +
                        `played ${verified.elapsed}s; confirmation delay excluded.`);
                } else {
                    console.warn('[BACKEND] No game process was verified after launch; recording zero-duration session.');
                }
                void stopMonitor(gameId, verified || { elapsed: 0, endTime: Date.now() });
            }
        });
    }, 2000);
    gameMonitors.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH GAME (with session creation)
// ─────────────────────────────────────────────────────────────────────────────
function launchGame(event, gamePath, showFPS, launchArgs, gameId, gameName) {
    if (!gamePath) {
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { gameId, message: 'No game executable path provided.' });
        }
        return;
    }

    if (!fs.existsSync(gamePath)) {
        const errorMsg = `Game executable not found.\nPath: ${gamePath}\nPlease update the game path in the edit modal.`;
        console.error('[BACKEND] Launch error:', errorMsg);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { gameId, message: errorMsg });
        }
        return;
    }

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');
    const gameDir = path.dirname(gamePath);
    const exeName = path.basename(gamePath);
    const argsArray = launchArgs ? launchArgs.split(' ').filter(a => a.trim()) : [];

    try {
        console.log(`[BACKEND] Launching: ${exeName} (game: "${gameName}")`);

        let proc;

        if (isLinux && isExe) {
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');
            if (!fs.existsSync(compatDataPath)) fs.mkdirSync(compatDataPath, { recursive: true });
            const env = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                DXVK_HUD: showFPS ? 'compiler,fps' : '0'
            });
            proc = spawn(protonPath, ['run', gamePath, ...argsArray], { cwd: gameDir, env, detached: true, stdio: 'ignore' });
        } else {
            const lower = gamePath.toLowerCase();
            const isBatOrLnk = lower.endsWith('.bat') || lower.endsWith('.lnk');
            proc = spawn(gamePath, argsArray, { cwd: gameDir, detached: true, shell: isBatOrLnk, stdio: 'ignore' });
        }

        // A failed CreateProcess can return a ChildProcess with no PID. Node
        // emits 'error' asynchronously. Do not create a session or generate a
        // second, misleading "invalid PID" toast while waiting for it.
        let launchErrorReported = false;
        function reportLaunchFailure(error) {
            if (launchErrorReported) return;
            launchErrorReported = true;
            console.error('[BACKEND] Spawn error:', error);
            const diagnostic = describeLaunchError(error, gamePath, gameName);
            if (!event.sender.isDestroyed()) {
                event.sender.send('game:error', { ...diagnostic, gameId });
            }
        }
        proc.on('spawn', () => console.log(`[BACKEND] PID: ${proc.pid}`));
        proc.on('exit', (code, signal) => {
            console.log(`[BACKEND] Spawned process PID ${proc.pid} exited (code=${code}, signal=${signal}); monitor will verify the game process.`);
        });
        proc.once('error', (error) => {
            // On a successfully spawned game, a later error should be logged
            // without rolling back an already running game/session.
            if (runningGames.get(gameId)?.proc === proc) {
                console.warn('[BACKEND] Process runtime error:', error);
                return;
            }
            reportLaunchFailure(error);
        });
        if (!Number.isInteger(proc.pid) || proc.pid <= 0) {
            console.warn('[BACKEND] Process not created; waiting for OS launch error. No game session started.');
            return;
        }
        // Begin the game session ONLY after Windows returned a valid process.
        const sessionIndex = sessions.startSession(gameName, gameId);
        const sessionId = sessions.getSessionId(sessionIndex);

        runningGames.set(gameId, {
            pid: proc.pid,
            launchPid: proc.pid,
            activePid: proc.pid,
            activePath: gamePath,
            exeName,
            gameName,
            installPath: gamePath,
            proc,
            startTime: Date.now(),
            startHrtime: process.hrtime.bigint(),
            pausedNanoseconds: 0n,
            pauseStartedHrtime: null,
            pauseReasons: new Set(),
            stopping: false,
            event,
            sessionIndex,
            sessionId
        });

        proc.unref();
        publishOverlaySessions();
        startSmartMonitor(gameDir, proc.pid, exeName, gameId);
        startTimer(gameId);

        if (!event.sender.isDestroyed()) {
            event.sender.send('game:started', { gameId });
        }
    } catch (err) {
        console.error(`[BACKEND ERROR] ${err.message}`);
        const diagnostic = describeLaunchError(err, gamePath, gameName);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { ...diagnostic, gameId });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL PAUSE / RESUME
// ─────────────────────────────────────────────────────────────────────────────
function resolveGameId(gameId) {
    if (gameId !== undefined && gameId !== null) {
        return runningGames.has(gameId) ? gameId : null;
    }
    // Do not randomly pause the first game if several are running.
    return runningGames.size === 1 ? runningGames.keys().next().value : null;
}
function pauseTimer(gameId) {
    const target = resolveGameId(gameId);
    if (target === null) return false;
    return setPauseReason(target, 'manual', true);
}
function resumeTimer(gameId) {
    const target = resolveGameId(gameId);
    if (target === null) return false;
    return setPauseReason(target, 'manual', false);
}

// Only a live, matching session may be controlled by the in-game UI.
// Pause/resume changes the Nexus timer state; the overlay does not own a timer.
function applyOverlayTimerAction(gameId, sessionId, gamePid, paused) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping || !sessionId || game.sessionId !== sessionId ||
        game.activePid !== gamePid || typeof paused !== 'boolean') return { ok: false };
    setPauseReason(gameId, 'manual', paused);
    return { ok: true, paused: game.pauseReasons.size > 0 };
}

function forceStopGame(gameId) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping) return;
    if (process.platform !== 'win32') {
        try { game.proc.kill('SIGKILL'); } catch (error) { console.warn('[BACKEND] Stop failed:', error); }
        return; // Monitor finalizes only when disappearance is verified.
    }
    getProcesses((processes, error) => {
        const current = runningGames.get(gameId);
        if (!current || current.stopping) return;
        if (!processes) {
            console.warn('[BACKEND] Force-stop cancelled: cannot validate target:', error?.message);
            return;
        }
        const found = processes.find(p => p.pid === current.activePid);
        if (!found || processSelector.normalized(found.path) !== processSelector.normalized(current.activePath)) {
            console.warn('[BACKEND] Force-stop cancelled: PID/path no longer match');
            return;
        }
        console.log(`[BACKEND] Force stopping verified PID ${found.pid}: ${found.path}`);
        execFile('taskkill.exe', ['/PID', String(found.pid), '/T', '/F'], { windowsHide: true }, (err) => {
            if (err) console.warn('[BACKEND] taskkill warning:', err.message);
            // Do not prematurely finalize or add playtime: the monitor verifies exit.
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    launchGame,
    forceStopGame,
    pauseTimer,
    resumeTimer,
    applyOverlayTimerAction,
};