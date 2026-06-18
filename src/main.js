const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');

const db = require('../modules/database');
const playtimeDB = require('../modules/playtime');
const backups = require('../modules/backup');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');
const si = require('systeminformation');
const sessions = require('../modules/playSessions');
const appTray = require('../modules/app-tray');

const { initAppData, readSettings, writeSettings } = require('../modules/app-settings');
const { registerDatabaseIPC } = require('./ipc/ipc-database');
const { registerApiIPC } = require('./ipc/ipc-api');
const { registerBackupIPC } = require('./ipc/ipc-backup');

// ─── Globals ────────────────────────────────────────────────────────────────
let mainWindow = null;
let trayInstance = null;

// ─── Initialisation ─────────────────────────────────────────────────────────
initAppData();
db.initDB();
playtimeDB.initPlaytimeDB();
backups.initBackupDB();
sessions.initSessionsDB();

// ─── Window ─────────────────────────────────────────────────────────────────
const { getWindowSize, setWindowSize } = require('../modules/app-settings');

function createWindow() {
    const savedSize = getWindowSize();
    const win = new BrowserWindow({
        width: savedSize.width,
        height: savedSize.height,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, '../assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
        },
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '../index.html'));

    win.on('resize', () => {
        const [width, height] = win.getSize();
        setWindowSize(width, height);
    });

    win.webContents.on('context-menu', async () => {
        let lang = 'en';
        try {
            lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")');
        } catch { /* ignore */ }
        const L = (ar, en) => (lang === 'ar' ? ar : en);
        Menu.buildFromTemplate([
            { role: 'copy', label: L('نسخ', 'Copy') },
            { role: 'paste', label: L('لصق', 'Paste') },
            { role: 'cut', label: L('قص', 'Cut') },
        ]).popup({ window: win });
    });

    win.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            win.hide();
        }
    });

    mainWindow = win;
    return win;
}

// ─── Protocol ──────────────────────────────────────────────────────────────
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'local-resource',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            bypassCSP: true,
            stream: true,
        },
    },
]);

// ─── App Ready ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    protocol.handle('local-resource', async (request) => {
        const raw = request.url.replace(/^local-resource:\/\//, '');
        const decoded = decodeURI(raw);
        let filePath = decoded.replace(/\//g, path.sep);
        filePath = path.normalize(filePath);
        if (process.platform === 'win32') {
            const m = filePath.match(/^([a-zA-Z])\\(.*)$/);
            if (m) filePath = m[1].toUpperCase() + ':\\' + m[2];
        }
        try {
            const stat = await fs.promises.stat(filePath);
            if (!stat.isFile()) throw new Error('Not a file');
            const data = await fs.promises.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mime = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
                '.ico': 'image/x-icon',
            };
            return new Response(data, {
                status: 200,
                headers: { 'Content-Type': mime[ext] || 'application/octet-stream' },
            });
        } catch (err) {
            console.error('[Protocol Error]:', err.message, '| Path:', filePath);
            return new Response('File not found', { status: 404 });
        }
    });

    // Create window
    const win = createWindow();
    mainWindow = win;

    // Setup tray if enabled
    const settings = readSettings();
    if (settings.enableSystemTray) {
        trayInstance = appTray.createTray(win);
    }

    // IPC: tray status changes (triggered by renderer toggle)
    ipcMain.handle('tray:setStatus', (_, enabled) => {
        const settings = readSettings();
        settings.enableSystemTray = enabled;
        writeSettings(settings);

        if (enabled && !trayInstance) {
            trayInstance = appTray.createTray(mainWindow);
        } else if (!enabled && trayInstance) {
            appTray.destroyTray(trayInstance);
            trayInstance = null;
        }

        const windows = BrowserWindow.getAllWindows();
        for (const w of windows) {
            if (!w.isDestroyed()) {
                w.webContents.send('tray:status-changed', enabled);
            }
        }
        return true;
    });

    // IPC: tray exit
    ipcMain.on('tray:exit-app', () => {
        app.isQuitting = true;
        app.quit();
    });

    // IPC: update tray language
    ipcMain.on('tray:update-language', (_, lang) => {
        appTray.updateTrayLanguage(lang);
    });
});

// ─── IPC Handlers ──────────────────────────────────────────────────────────

// App data
ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

ipcMain.handle('app:setWindowSize', (event, width, height) => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        win.setSize(width, height);
        setWindowSize(width, height);
    }
    return true;
});

ipcMain.handle('app:getWindowSize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) {
        const [width, height] = win.getSize();
        return { width, height };
    }
    return { width: 1100, height: 750 };
});

// Fullscreen
ipcMain.handle('toggle-fullscreen', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.setFullScreen(!win.isFullScreen());
});

// System specs
ipcMain.handle('app:getSystemSpecs', async () => {
    try {
        const cpu = await si.cpu();
        const mem = await si.mem();
        const graphics = await si.graphics();
        const os = await si.osInfo();
        return {
            cpu: `${cpu.manufacturer} ${cpu.brand}`,
            ramGB: Math.round(mem.total / (1024 ** 3)),
            gpu: graphics.controllers.map(c => c.model).join(' / '),
            os: os.distro
        };
    } catch (error) {
        console.error('[Specs] Error:', error);
        return null;
    }
});

// ─── Game Launcher IPC ─────────────────────────────────────────────────────
ipcMain.on('game:launch', (event, gamePath, showFPS, args, id, name) =>
    launcher.launchGame(event, gamePath, showFPS, args, id, name)
);
ipcMain.on('game:force-stop', (_e, gameId) => launcher.forceStopGame(gameId));

// ─── Dialog IPC ────────────────────────────────────────────────────────────
ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.handle('dialog:selectFolder', () => dialogs.selectFolder());

ipcMain.on('shell:openFolder', (_e, p) => dialogs.openFolder(null, p));
ipcMain.on('shell:openExternal', (_e, url) => dialogs.openExternal(url));

// ─── Timer IPC ─────────────────────────────────────────────────────────────
ipcMain.handle('timer:pause', () => launcher.pauseTimer());
ipcMain.handle('timer:resume', () => launcher.resumeTimer());

// ─── Feature modules ───────────────────────────────────────────────────────
registerDatabaseIPC();
registerApiIPC();
registerBackupIPC();

// ─── App lifecycle ──────────────────────────────────────────────────────────
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        const settings = readSettings();
        if (!settings.enableSystemTray) {
            app.quit();
        }
    }
});

app.on('before-quit', () => {
    app.isQuitting = true;
});

app.on('will-quit', () => {
    if (trayInstance) {
        appTray.destroyTray(trayInstance);
        trayInstance = null;
    }
});