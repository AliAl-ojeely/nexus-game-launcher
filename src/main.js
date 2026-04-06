const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');

const db = require('../modules/database');
const playtimeDB = require('../modules/playtime');
const backups = require('../modules/backup');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');

const { initAppData } = require('../modules/app-settings');
const { registerDatabaseIPC } = require('./ipc/ipc-database');
const { registerApiIPC } = require('./ipc/ipc-api');
const { registerBackupIPC } = require('./ipc/ipc-backup');

initAppData();
db.initDB();
playtimeDB.initPlaytimeDB();
backups.initBackupDB();

// ─── Window ─────────────────────────────────

function createWindow() {
    const win = new BrowserWindow({
        width: 1100,
        height: 750,
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

    win.webContents.on('context-menu', async () => {
        let lang = 'en';
        try {
            lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")');
        } catch { }

        const L = (ar, en) => (lang === 'ar' ? ar : en);

        Menu.buildFromTemplate([
            { role: 'copy', label: L('نسخ', 'Copy') },
            { role: 'paste', label: L('لصق', 'Paste') },
            { role: 'cut', label: L('قص', 'Cut') },
            { type: 'separator' },
            { role: 'inspectElement', label: L('فحص العنصر', 'Inspect Element') },
        ]).popup({ window: win });
    });
}

// ─── Custom protocol ─────────────────────────

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

app.whenReady().then(() => {

    protocol.handle('local-resource', async (request) => {
        const raw = request.url.replace(/^local-resource:\/\//, '');
        const decoded = decodeURI(raw);

        // ── تحويل forward slashes لـ backslashes على Windows ─────────────────
        let filePath = decoded.replace(/\//g, path.sep);
        filePath = path.normalize(filePath);

        // Fix drive-letter path on Windows (C\Users → C:\Users)
        if (process.platform === 'win32') {
            const m = filePath.match(/^([a-zA-Z])\\(.*)$/);
            if (m) filePath = m[1].toUpperCase() + ':\\' + m[2];
        }

        console.log('[Protocol] Loading:', filePath);

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
                '.ico': 'image/x-icon',  // ← أضفنا ico
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

    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─── IPC ─────────────────────────────────────

// Game launcher
ipcMain.on('game:launch', (event, gamePath, showFPS, args, id, name) =>
    launcher.launchGame(event, gamePath, showFPS, args, id, name)
);

ipcMain.on('game:force-stop', (_e, gameId) =>
    launcher.forceStopGame(gameId)
);

// Dialogs
ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.handle('dialog:selectFolder', () => dialogs.selectFolder());

ipcMain.on('shell:openFolder', (_e, p) =>
    dialogs.openFolder(null, p)
);

ipcMain.on('shell:openExternal', (_e, url) =>
    dialogs.openExternal(url)
);

// Feature modules
registerDatabaseIPC();
registerApiIPC();
registerBackupIPC();