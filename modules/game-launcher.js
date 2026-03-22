const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');

function launchGame(event, gamePath, showFPS, launchArgs, gameId) {
    if (!gamePath) return;

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');
    const gameDir = path.dirname(gamePath);

    // Parse launch arguments safely
    const argsArray = launchArgs ? launchArgs.split(' ').filter(arg => arg.trim() !== "") : [];

    try {
        let proc;

        if (isLinux && isExe) {
            // Linux/Proton logic for running Windows executables
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');

            // Create compatibility data path if it doesn't exist
            if (!fs.existsSync(compatDataPath)) {
                fs.mkdirSync(compatDataPath, { recursive: true });
            }

            const processEnv = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(userHome, 'Nexus-Proton'),
                DXVK_HUD: showFPS ? "compiler,fps" : "0",
            });

            proc = spawn(protonPath, ['run', gamePath, ...argsArray], {
                env: processEnv,
                cwd: gameDir,
                detached: true
            });

        } else {
            // Native execution for Windows or native Linux games
            // Check if the file is a batch script or a shortcut (important for Windows execution)
            const isBatOrLnk = gamePath.toLowerCase().endsWith('.bat') || gamePath.toLowerCase().endsWith('.lnk');

            proc = spawn(gamePath, argsArray, {
                cwd: gameDir,
                detached: false,
                windowsHide: false,
                shell: isBatOrLnk // Required to execute .bat or .lnk files properly without ENOENT error
            });
        }

        proc.on('error', (err) => {
            console.error("Game process error:", err);
            if (event && !event.sender.isDestroyed()) {
                event.sender.send('game:error', { message: err.message });
            }
        });

        // Once the process is closed, send an event to the frontend to unlock the Play button
        proc.on('close', () => {
            if (event && !event.sender.isDestroyed()) {
                event.sender.send('game:stopped', { gameId: gameId });
            }
        });

    } catch (error) {
        // Consistent error handling catch block
        if (event && !event.sender.isDestroyed()) {
            event.sender.send('game:error', { message: error.message });
        }
    }
}

module.exports = { launchGame };