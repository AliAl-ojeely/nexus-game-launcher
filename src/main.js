const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const path = require('path');

// استدعاء الوحدات المستقلة
const db = require('../modules/database');
const steam = require('../modules/steam-api');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');

// تهيئة قاعدة البيانات
db.initDB();

function createWindow() {
    const win = new BrowserWindow({
        width: 1100, height: 750, minWidth: 800, minHeight: 600,
        icon: path.join(__dirname, '../assets/icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '../index.html'));

    win.webContents.on('context-menu', async () => {
        let lang = 'en';
        try { lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")'); } catch {}
        const labels = { copy: lang === 'ar' ? 'نسخ' : 'Copy', paste: lang === 'ar' ? 'لصق' : 'Paste', cut: lang === 'ar' ? 'قص' : 'Cut', inspect: lang === 'ar' ? 'فحص العنصر' : 'Inspect Element' };
        const menu = Menu.buildFromTemplate([
            { role: 'copy', label: labels.copy }, { role: 'paste', label: labels.paste }, { role: 'cut', label: labels.cut },
            { type: 'separator' }, { role: 'inspect', label: labels.inspect }
        ]);
        menu.popup({ window: win });
    });
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('local-resource', (request, callback) => {
        const url = request.url.replace(/^local-resource:\/\//, '');
        try { callback(decodeURI(url)); } catch (error) { console.error('Protocol Error:', error); }
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// ==========================================
// IPC HANDLERS (ربط الواجهة بالوحدات)
// ==========================================

ipcMain.on('game:launch', (event, path, showFPS, args, id) => launcher.launchGame(event, path, showFPS, args, id));

ipcMain.handle('db:getGames', () => db.getGames());
ipcMain.handle('db:saveGame', (event, game) => db.saveGame(game));
ipcMain.handle('db:updateGame', (event, game) => db.updateGame(game));
ipcMain.handle('db:deleteGame', (event, id) => db.deleteGame(id));
ipcMain.handle('save-game-details', (event, id, details) => db.saveGameDetails(id, details));

ipcMain.handle('api:fetchGameInfo', (event, name) => steam.fetchGameInfo(name));
ipcMain.handle('api:fetchGameDetails', (event, name) => steam.fetchGameDetails(name));

ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, path) => dialogs.openFolder(event, path));
ipcMain.on('shell:openExternal', (event, url) => dialogs.openExternal(url));