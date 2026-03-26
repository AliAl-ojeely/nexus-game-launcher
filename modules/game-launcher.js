const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

const gameMonitors = new Map();  // gameId → setInterval (process polling)
const gameTimers = new Map();  // gameId → setInterval (playtime tick)
const runningGames = new Map();  // gameId → { pid, exeName, proc, startTime, event }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getElapsedSeconds(gameId) {
    const game = runningGames.get(gameId);
    if (!game?.startTime) return 0;
    return Math.floor((Date.now() - game.startTime) / 1000);
}

function stopTimer(gameId) {
    const interval = gameTimers.get(gameId);
    if (interval) {
        clearInterval(interval);
        gameTimers.delete(gameId);
    }
}

/**
 * ✅ Full teardown — clears monitor + timer + notifies renderer.
 *    Uses the event stored in runningGames (no param needed).
 */
function stopMonitor(gameId) {
    // 1. Stop process-polling interval
    const monitor = gameMonitors.get(gameId);
    if (monitor) {
        clearInterval(monitor);
        gameMonitors.delete(gameId);
    }

    // 2. Stop playtime ticker
    stopTimer(gameId);

    // 3. Grab event from the stored game record BEFORE deleting it
    const game = runningGames.get(gameId);
    const elapsed = getElapsedSeconds(gameId);
    runningGames.delete(gameId);

    // 4. Notify renderer
    if (game?.event && !game.event.sender.isDestroyed()) {
        game.event.sender.send('game:stopped', { gameId, elapsed });
        console.log(`[BACKEND] ✅ game:stopped sent → gameId: ${gameId}, elapsed: ${elapsed}s`);
    } else {
        console.warn(`[BACKEND] ⚠️ Could not send game:stopped — event missing or window destroyed`);
    }
}

/**
 * Starts a 1-second tick that sends playtime updates to the renderer.
 */
function startTimer(gameId) {
    if (gameTimers.has(gameId)) return;

    const interval = setInterval(() => {
        const game = runningGames.get(gameId);
        if (!game) { stopTimer(gameId); return; }

        if (!game.event.sender.isDestroyed()) {
            game.event.sender.send('game:tick', {
                gameId,
                elapsed: getElapsedSeconds(gameId)
            });
        }
    }, 1000);

    gameTimers.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS LIST (Windows via PowerShell)
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
                .map(p => ({
                    pid: p.ProcessId,
                    path: p.ExecutablePath.toLowerCase()
                }));

            callback(processes);
        } catch {
            callback([]);
        }
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
                    return (
                        procPath.startsWith(gameDir.toLowerCase()) &&
                        !procPath.endsWith(exeName.toLowerCase())
                    );
                });

                if (candidate) {
                    realGameDetected = true;
                    trackedPid = candidate.pid;
                    console.log(`[BACKEND] Real game detected → PID ${trackedPid}`);
                }

                if (!launcherAlive && !realGameDetected) {
                    console.log(`[BACKEND] Launcher closed, no game detected.`);
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

function launchGame(event, gamePath, showFPS, launchArgs, gameId) {
    if (!gamePath) return;

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');

    const gameDir = path.dirname(gamePath);
    const exeName = path.basename(gamePath);

    const argsArray = launchArgs
        ? launchArgs.split(' ').filter(a => a.trim() !== '')
        : [];

    try {
        console.log(`[BACKEND] Launching: ${exeName}`);

        let proc;

        if (isLinux && isExe) {
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');

            if (!fs.existsSync(compatDataPath)) {
                fs.mkdirSync(compatDataPath, { recursive: true });
            }

            const env = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                DXVK_HUD: showFPS ? 'compiler,fps' : '0'
            });

            proc = spawn(protonPath, ['run', gamePath, ...argsArray], {
                cwd: gameDir, env, detached: true
            });
        } else {
            const lower = gamePath.toLowerCase();
            const isBatOrLnk = lower.endsWith('.bat') || lower.endsWith('.lnk');

            proc = spawn(gamePath, argsArray, {
                cwd: gameDir,
                detached: true,
                shell: isBatOrLnk,
            });
        }

        proc.on('spawn', () => {
            console.log(`[BACKEND] PID: ${proc.pid}`);
        });

        proc.on('exit', () => {
            if (runningGames.has(gameId)) {
                console.log('[BACKEND] Game exited via proc.on(exit)');
                stopMonitor(gameId);
            }
        });

        // ✅ Store event here so every function can reach it without passing it around
        runningGames.set(gameId, {
            pid: proc.pid,
            exeName,
            proc,
            startTime: Date.now(),
            event               // ← single source of truth for IPC back to renderer
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
// FORCE STOP
// ✅ No event param needed — reads it from runningGames internally
// ─────────────────────────────────────────────────────────────────────────────

function forceStopGame(gameId) {
    const game = runningGames.get(gameId);
    if (!game) {
        console.warn(`[BACKEND] forceStopGame: no running game found for id ${gameId}`);
        return;
    }

    console.log(`[BACKEND] 💀 Force stopping: ${game.exeName}`);

    if (process.platform === 'win32') {
        exec(
            `taskkill /IM "${game.exeName}" /T /F`,
            { windowsHide: true },
            (err) => {
                if (err) console.warn(`[BACKEND] taskkill warning: ${err.message}`);
                stopMonitor(gameId);  // ✅ sends game:stopped with correct event
            }
        );
    } else {
        try { game.proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
        stopMonitor(gameId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = { launchGame, forceStopGame };