const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

const gameMonitors = new Map();  // gameId → setInterval (process polling)
const gameTimers = new Map();    // gameId → setInterval (playtime tick)
const runningGames = new Map();  // gameId → { pid, exeName, gameName, installPath, proc, startTime, pauseOffset, pauseStartTime, event }
const backups = require('./backup');
const { readSettings } = require('./app-settings');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the total active seconds for the game (accounting for manual pauses).
 */
function getElapsedSeconds(gameId) {
    const game = runningGames.get(gameId);
    if (!game || !game.startTime) return 0;

    let elapsed = Math.floor((Date.now() - game.startTime) / 1000);
    // subtract total paused seconds
    elapsed -= (game.pauseOffset || 0);
    // if currently paused, subtract the ongoing pause duration
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

/**
 * Stops the game, triggers backup (if enabled), and sends final playtime.
 */
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

/**
 * Starts a 1-second tick that sends playtime updates.
 * The elapsed value accounts for manual pauses.
 */
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
// PROCESS LIST (Windows via PowerShell) – unchanged
// ─────────────────────────────────────────────────────────────────────────────

function getProcesses(callback) {
    const cmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select ProcessId,ExecutablePath | ConvertTo-Json"`;
    exec(cmd, { windowsHide: true, maxBuffer: 1024 * 1024 * 10 }, (err, stdout) => {
        if (err || !stdout) return callback([]);
        try {
            let data = JSON.parse(stdout);
            if (!Array.isArray(data)) data = [data];
            const processes = data
                .filter(p => p.ExecutablePath)
                .map(p => ({ pid: p.ProcessId, path: p.ExecutablePath.toLowerCase() }));
            callback(processes);
        } catch { callback([]); }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART MONITOR
// ─────────────────────────────────────────────────────────────────────────────

function startSmartMonitor(gameDir, launcherPid, exeName, gameId) {
    let trackedPid = launcherPid;
    let realGameDetected = false;
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
                    console.log(`[BACKEND] Real game detected → PID ${trackedPid}`);
                }
                if (!launcherAlive && !realGameDetected) {
                    console.log(`[BACKEND] Launcher closed, no game process detected.`);
                    stopMonitor(gameId);
                }
            } else {
                const alive = processes.some(p => p.pid === trackedPid);
                if (!alive) {
                    console.log(`[BACKEND] Game process ended naturally.`);
                    stopMonitor(gameId);
                }
            }
        });
    }, 1000);
    gameMonitors.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH
// ─────────────────────────────────────────────────────────────────────────────

function launchGame(event, gamePath, showFPS, launchArgs, gameId, gameName) {
    if (!gamePath) return;

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');
    const gameDir = path.dirname(gamePath);
    const exeName = path.basename(gamePath);
    const argsArray = launchArgs ? launchArgs.split(' ').filter(a => a.trim()) : [];

    try {
        console.log(`[BACKEND] Launching: ${exeName} (game: "${gameName}")`);

        let proc;

        if (isLinux && isExe) {
            // Simplified Proton launcher – replace with your full Linux launcher if needed
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');
            if (!fs.existsSync(compatDataPath)) fs.mkdirSync(compatDataPath, { recursive: true });
            const env = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                DXVK_HUD: showFPS ? 'compiler,fps' : '0'
            });
            proc = spawn(protonPath, ['run', gamePath, ...argsArray], { cwd: gameDir, env, detached: true });
        } else {
            const lower = gamePath.toLowerCase();
            const isBatOrLnk = lower.endsWith('.bat') || lower.endsWith('.lnk');
            proc = spawn(gamePath, argsArray, { cwd: gameDir, detached: true, shell: isBatOrLnk });
        }

        proc.on('spawn', () => console.log(`[BACKEND] PID: ${proc.pid}`));
        proc.on('exit', () => console.log('[BACKEND] Launcher/wrapper process exited (game may still be running)'));

        runningGames.set(gameId, {
            pid: proc.pid,
            exeName,
            gameName,
            installPath: gamePath,
            proc,
            startTime: Date.now(),
            pauseOffset: 0,
            pauseStartTime: null,
            event
        });

        proc.unref();
        startSmartMonitor(gameDir, proc.pid, exeName, gameId);
        startTimer(gameId);

        if (!event.sender.isDestroyed()) {
            event.sender.send('game:started', { gameId });
        }
    } catch (err) {
        console.error(`[BACKEND ERROR] ${err.message}`);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { message: err.message });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL PAUSE / RESUME (affects currently running game)
// ─────────────────────────────────────────────────────────────────────────────

function pauseTimer() {
    // Find the currently running game (only one at a time)
    const gameId = [...runningGames.keys()][0];
    const game = runningGames.get(gameId);
    if (!game) return false;
    if (game.pauseStartTime) return false; // already paused
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

module.exports = { launchGame, forceStopGame, pauseTimer, resumeTimer };