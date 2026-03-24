const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

let gameMonitorInterval = null;
const runningGames = new Map();

function stopMonitor(gameId, event) {
    if (gameMonitorInterval) clearInterval(gameMonitorInterval);
    runningGames.delete(gameId);

    if (event && !event.sender.isDestroyed()) {
        event.sender.send('game:stopped', { gameId });
    }
}

function getProcesses(callback) {
    exec(
        'wmic process get ProcessId,ExecutablePath',
        { windowsHide: true, maxBuffer: 1024 * 1024 * 5 },
        (err, stdout) => {
            if (err) return callback([]);

            const lines = stdout.split('\n').slice(1);
            const processes = [];

            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                const pid = parts.pop();
                const exe = parts.join(' ');

                if (exe && pid) {
                    processes.push({
                        pid: parseInt(pid),
                        path: exe.toLowerCase()
                    });
                }
            }

            callback(processes);
        }
    );
}

function startSmartMonitor(gameDir, launcherPid, exeName, gameId, event) {

    let trackedPid = launcherPid;
    let realGameDetected = false;

    console.log(`[BACKEND] Monitoring started for: ${exeName}`);

    gameMonitorInterval = setInterval(() => {

        getProcesses((processes) => {

            const launcherAlive = processes.some(p => p.pid === trackedPid);

            if (!realGameDetected) {

                const candidate = processes.find(p =>
                    p.path.startsWith(gameDir.toLowerCase()) &&
                    !p.path.endsWith(exeName.toLowerCase())
                );

                if (candidate) {
                    realGameDetected = true;
                    trackedPid = candidate.pid;

                    console.log(`[BACKEND] Real game detected -> PID ${trackedPid}`);
                }

                if (!launcherAlive && !realGameDetected) {
                    console.log(`[BACKEND] Launcher closed and no game detected.`);
                    stopMonitor(gameId, event);
                }

            } else {

                const alive = processes.some(p => p.pid === trackedPid);

                if (!alive) {
                    console.log(`[BACKEND] Game process ended.`);
                    stopMonitor(gameId, event);
                }

            }

        });

    }, 1000);
}

function launchGame(event, gamePath, showFPS, launchArgs, gameId) {

    if (!gamePath) return;

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');

    const gameDir = path.dirname(gamePath);
    const exeName = path.basename(gamePath);

    const argsArray = launchArgs
        ? launchArgs.split(' ').filter(a => a.trim() !== "")
        : [];

    try {

        console.log(`[BACKEND] Launching: ${exeName}`);

        let proc;

        if (isLinux && isExe) {

            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();

            const protonPath = path.join(
                userHome,
                'Nexus-Proton',
                protonVersion,
                'proton'
            );

            const compatDataPath = path.join(
                app.getPath('userData'),
                'nexus_proton_prefix'
            );

            if (!fs.existsSync(compatDataPath)) {
                fs.mkdirSync(compatDataPath, { recursive: true });
            }

            const env = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                DXVK_HUD: showFPS ? "compiler,fps" : "0"
            });

            proc = spawn(
                protonPath,
                ['run', gamePath, ...argsArray],
                { cwd: gameDir, env, detached: true }
            );

        } else {

            const isBatOrLnk =
                gamePath.endsWith('.bat') ||
                gamePath.endsWith('.lnk');

            proc = spawn(
                gamePath,
                argsArray,
                {
                    cwd: gameDir,
                    detached: true,
                    shell: isBatOrLnk
                }
            );

        }

        runningGames.set(gameId, {
            pid: proc.pid,
            exeName
        });

        proc.unref();

        startSmartMonitor(
            gameDir,
            proc.pid,
            exeName,
            gameId,
            event
        );

    } catch (err) {

        console.error(`[BACKEND ERROR] ${err.message}`);

        if (event && !event.sender.isDestroyed()) {
            event.sender.send('game:error', { message: err.message });
        }

    }
}

function forceStopGame(gameId, event) {
    const game = runningGames.get(gameId);
    if (!game) return;

    console.log(`[BACKEND LOG] 💀 Force stopping game: ${game.exeName}`);

    if (process.platform === 'win32') {
        exec(`taskkill /F /IM "${game.exeName}" /T`, (err) => {
            if (err) console.log(`[BACKEND LOG] Might already be dead: ${err.message}`);
            stopMonitor(gameId, event);
        });
    } else {
        try {
            if (game.proc) game.proc.kill('SIGKILL');
        } catch { }
        stopMonitor(gameId, event);
    }
}

module.exports = {
    launchGame,
    forceStopGame
};