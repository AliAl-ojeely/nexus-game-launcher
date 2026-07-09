const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');
const { net } = require('electron');
const { pathToFileURL } = require('url');

const gameMonitors = new Map();  // gameId → setInterval (process polling)
const gameTimers = new Map();    // gameId → setInterval (playtime tick)
const runningGames = new Map();  // gameId → { pid, exeName, gameName, installPath, proc, startTime, pauseOffset, pauseStartTime, event, sessionIndex }
const backups = require('./backup');
const { readSettings } = require('./app-settings');
const sessions = require('./playSessions');  // 🆕 SESSION LOGGING

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getElapsedSeconds(gameId) {
    const game = runningGames.get(gameId);
    if (!game || !game.startTime) return 0;

    let elapsed = Math.floor((Date.now() - game.startTime) / 1000);
    elapsed -= (game.pauseOffset || 0);
    if (game.pauseStartTime) {
        elapsed -= Math.floor((Date.now() - game.pauseStartTime) / 1000);
    }
    return Math.max(0, elapsed);
}

function stopTimer(gameId) {
    const interval = gameTimers.get(gameId);
    if (interval) {
        clearInterval(interval);
        gameTimers.delete(gameId);
    }
}

async function stopMonitor(gameId) {
    const game = runningGames.get(gameId);
    if (!game) {
        console.error('[BACKEND] stopMonitor: game not found');
        return;
    }

    const monitor = gameMonitors.get(gameId);
    if (monitor) {
        clearInterval(monitor);
        gameMonitors.delete(gameId);
    }
    stopTimer(gameId);

    const elapsed = getElapsedSeconds(gameId);

    // 🆕 SESSION LOGGING – finalise session
    if (game.sessionIndex !== undefined && elapsed > 0) {
        sessions.endSession(game.sessionIndex, Date.now(), elapsed);
        console.log(`[BACKEND] Session recorded for "${game.gameName}": ${elapsed}s`);
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

    runningGames.delete(gameId);

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
        const cmd = `wmic process get ProcessId,ExecutablePath`;
        exec(cmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
            if (err || !stdout) return callback([]);
            try {
                const processes = [];
                const lines = stdout.split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line) continue;

                    const match = line.match(/^(.*?)\s+(\d+)$/);
                    if (match) {
                        const exePath = match[1].trim().toLowerCase();
                        const pid = parseInt(match[2], 10);
                        if (exePath && pid) {
                            processes.push({ pid, path: exePath });
                        }
                    }
                }
                callback(processes);
            } catch { callback([]); }
        });
    } else {
        exec('ps -eo pid,args', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err || !stdout) return callback([]);
            const lines = stdout.split('\n').slice(1);
            const processes = [];
            for (const line of lines) {
                const match = line.match(/^\s*(\d+)\s+(.+)$/);
                if (match) {
                    const pid = parseInt(match[1], 10);
                    let exePath = match[2].trim().split(' ')[0];
                    processes.push({ pid, path: exePath.toLowerCase() });
                }
            }
            callback(processes);
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART MONITOR (Optimized with Grace Period)
// ─────────────────────────────────────────────────────────────────────────────
function startSmartMonitor(gameDir, launcherPid, exeName, gameId) {
    let trackedPid = launcherPid;
    let realGameDetected = false;

    let missingCount = 0;
    const MAX_MISSING = 7;

    console.log(`[BACKEND] Monitoring started for: ${exeName}`);

    const interval = setInterval(() => {
        getProcesses((processes) => {
            const launcherAlive = processes.some(p => p.pid === trackedPid);

            if (!realGameDetected) {
                const candidate = processes.find(p => {
                    const procPath = p.path.toLowerCase();
                    return procPath.startsWith(gameDir.toLowerCase()) && !procPath.endsWith(exeName.toLowerCase());
                });

                if (candidate) {
                    realGameDetected = true;
                    trackedPid = candidate.pid;
                    missingCount = 0;
                    console.log(`[BACKEND] Real game detected → PID ${trackedPid}`);
                }

                if (!launcherAlive && !realGameDetected) {
                    missingCount++;
                    console.log(`[BACKEND] Launcher missing. Waiting for real game... (${missingCount}/${MAX_MISSING})`);

                    if (missingCount >= MAX_MISSING) {
                        console.log(`[BACKEND] Launcher closed, no game process detected after grace period.`);
                        stopMonitor(gameId);
                    }
                } else if (launcherAlive) {
                    missingCount = 0;
                }
            } else {
                const alive = processes.some(p => p.pid === trackedPid);
                if (!alive) {
                    missingCount++;
                    if (missingCount >= 2) {
                        console.log(`[BACKEND] Game process ended naturally.`);
                        stopMonitor(gameId);
                    }
                } else {
                    missingCount = 0;
                }
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
            event.sender.send('game:error', { message: 'No game executable path provided.' });
        }
        return;
    }

    if (!fs.existsSync(gamePath)) {
        const errorMsg = `Game executable not found.\nPath: ${gamePath}\nPlease update the game path in the edit modal.`;
        console.error('[BACKEND] Launch error:', errorMsg);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { message: errorMsg });
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

        proc.on('spawn', () => console.log(`[BACKEND] PID: ${proc.pid}`));
        proc.on('exit', () => console.log('[BACKEND] Launcher/wrapper process exited (game may still be running)'));
        proc.on('error', (err) => {
            console.error('[BACKEND] Spawn error:', err);
            let errorMessage = '';
            if (err.code === 'ENOENT') {
                errorMessage = `Game executable not found.\nPath: ${gamePath}\nThe file may have been moved or deleted.`;
            } else if (err.code === 'EACCES') {
                errorMessage = `Permission denied to run the game.\nPath: ${gamePath}`;
            } else {
                errorMessage = err.message;
            }
            if (!event.sender.isDestroyed()) {
                event.sender.send('game:error', { message: errorMessage });
            }
        });

        // 🆕 Create a session record for this play
        const sessionIndex = sessions.startSession(gameName);

        runningGames.set(gameId, {
            pid: proc.pid,
            exeName,
            gameName,
            installPath: gamePath,
            proc,
            startTime: Date.now(),
            pauseOffset: 0,
            pauseStartTime: null,
            event,
            sessionIndex   // 🆕 store session index
        });

        proc.unref();
        startSmartMonitor(gameDir, proc.pid, exeName, gameId);
        startTimer(gameId);

        if (!event.sender.isDestroyed()) {
            event.sender.send('game:started', { gameId });
        }
    } catch (err) {
        console.error(`[BACKEND ERROR] ${err.message}`);
        let errorMessage = err.message;
        if (err.code === 'ENOENT') {
            errorMessage = `Game executable not found.\nPath: ${gamePath}\nPlease update the game path.`;
        }
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { message: errorMessage });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL PAUSE / RESUME
// ─────────────────────────────────────────────────────────────────────────────
function pauseTimer() {
    const gameId = [...runningGames.keys()][0];
    const game = runningGames.get(gameId);
    if (!game) return false;
    if (game.pauseStartTime) return false;
    game.pauseStartTime = Date.now();
    console.log(`[BACKEND] Timer paused for game: ${game.gameName}`);
    return true;
}

function resumeTimer() {
    const gameId = [...runningGames.keys()][0];
    const game = runningGames.get(gameId);
    if (!game) return false;
    if (!game.pauseStartTime) return false;
    const pausedDuration = Math.floor((Date.now() - game.pauseStartTime) / 1000);
    game.pauseOffset += pausedDuration;
    game.pauseStartTime = null;
    console.log(`[BACKEND] Timer resumed for game: ${game.gameName}, added paused ${pausedDuration}s, total offset ${game.pauseOffset}s`);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FORCE STOP
// ─────────────────────────────────────────────────────────────────────────────
function forceStopGame(gameId) {
    const game = runningGames.get(gameId);
    if (!game) {
        console.warn(`[BACKEND] forceStopGame: no running game for id ${gameId}`);
        return;
    }
    console.log(`[BACKEND] 💀 Force stopping: ${game.exeName}`);
    if (process.platform === 'win32') {
        exec(`taskkill /PID ${game.pid} /T /F`, { windowsHide: true }, (err) => {
            if (err) console.warn(`[BACKEND] taskkill warning: ${err.message}`);
            stopMonitor(gameId);
        });
    } else {
        try { game.proc.kill('SIGKILL'); } catch (_) { }
        stopMonitor(gameId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
    launchGame,
    forceStopGame,
    pauseTimer,
    resumeTimer,
};