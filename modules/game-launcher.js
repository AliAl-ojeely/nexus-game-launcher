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
    
    const argsArray = launchArgs ? launchArgs.split(' ').filter(arg => arg.trim() !== "") : [];

    try {
        let proc;

        if (isLinux && isExe) {
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');

            if (!fs.existsSync(compatDataPath)) fs.mkdirSync(compatDataPath, { recursive: true });

            const processEnv = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                STEAM_COMPAT_CLIENT_INSTALL_PATH: path.join(userHome, 'Nexus-Proton'),
                DXVK_HUD: showFPS ? "compiler,fps" : "0",
            });

            proc = spawn(protonPath, ['run', gamePath, ...argsArray], { env: processEnv, cwd: gameDir, detached: true });
        } else {
            proc = spawn(gamePath, argsArray, { cwd: gameDir, detached: false, windowsHide: false });
        }

        proc.on('error', (err) => {
            console.error("Game process error:", err);
            if (!event.sender.isDestroyed()) event.sender.send('game:error', { message: err.message });
        });

        // بمجرد إغلاق المشغل، نرسل أمر للواجهة لفك قفل زر Play
        proc.on('close', () => {
            if (!event.sender.isDestroyed()) event.sender.send('game:stopped', { gameId: gameId });
        });

    } catch (error) {
        if (!event.sender.isDestroyed()) event.reply('game:error', { message: error.message });
    }
}

module.exports = { launchGame };