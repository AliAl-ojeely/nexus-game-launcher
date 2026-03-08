const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// --- إعدادات المسارات ---
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'games.json');

console.log("---------------------------------");
console.log("Database Path:", dbPath);
console.log("---------------------------------");

// إنشاء قاعدة البيانات إذا لم تكن موجودة
if (!fs.existsSync(dbPath)) {
    try {
        fs.writeFileSync(dbPath, '[]', 'utf-8');
    } catch (err) {
        console.error("Failed to create initial JSON file:", err);
    }
}

function createWindow() {

    const win = new BrowserWindow({
        width: 1100,
        height: 750,
        minWidth: 800,
        minHeight: 600,
        icon: path.join(__dirname, 'icon.ico'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true
        }
    });

    win.setMenuBarVisibility(false);
    win.loadFile('index.html');

    // Context Menu مترجم حسب اللغة
    win.webContents.on('context-menu', async () => {

        let lang = 'en';

        try {
            lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")');
        } catch {}

        const labels = {
            copy: lang === 'ar' ? 'نسخ' : 'Copy',
            paste: lang === 'ar' ? 'لصق' : 'Paste',
            cut: lang === 'ar' ? 'قص' : 'Cut',
            inspect: lang === 'ar' ? 'فحص العنصر' : 'Inspect Element'
        };

        const menu = Menu.buildFromTemplate([
            { role: 'copy', label: labels.copy },
            { role: 'paste', label: labels.paste },
            { role: 'cut', label: labels.cut },
            { type: 'separator' },
            { role: 'inspect', label: labels.inspect }
        ]);

        menu.popup({ window: win });

    });
}

// بروتوكول للملفات المحلية
app.whenReady().then(() => {

    protocol.registerFileProtocol('local-resource', (request, callback) => {

        const url = request.url.replace(/^local-resource:\/\//, '');

        try {
            callback(decodeURI(url));
        } catch (error) {
            console.error('Protocol Error:', error);
        }

    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });

});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// اختيار ملف لعبة
ipcMain.handle('dialog:selectGame', async () => {

    const result = await dialog.showOpenDialog({
        title: 'Select Game Executable',
        filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'lnk'] }],
        properties: ['openFile']
    });

    return result.canceled ? null : result.filePaths[0];

});

// اختيار صورة
ipcMain.handle('dialog:selectImage', async () => {

    const result = await dialog.showOpenDialog({
        title: 'Select Cover Image',
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }],
        properties: ['openFile']
    });

    return result.canceled ? null : result.filePaths[0];

});

// تشغيل اللعبة
ipcMain.on('game:launch', async (event, gamePath) => {

    if (!gamePath) return;

    console.log("Launching:", gamePath);

    const error = await shell.openPath(gamePath);

    if (error) {
        dialog.showErrorBox("Launch Error", error);
    }

});

// جلب الألعاب
ipcMain.handle('db:getGames', async () => {

    try {

        if (!fs.existsSync(dbPath)) return [];

        const data = fs.readFileSync(dbPath, 'utf-8');

        return JSON.parse(data || '[]');

    } catch (err) {

        console.error("Read DB Error:", err);

        return [];

    }

});

// حفظ لعبة
ipcMain.handle('db:saveGame', async (event, newGame) => {

    try {

        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');

        data.push(newGame);

        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

        return true;

    } catch (err) {

        console.error("Save Error:", err);

        return false;

    }

});

// تحديث لعبة
ipcMain.handle('db:updateGame', async (event, updatedGame) => {

    try {

        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');

        data = data.map(g => g.id === updatedGame.id ? updatedGame : g);

        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

        return true;

    } catch (err) {

        console.error("Update Error:", err);

        return false;

    }

});

// حذف لعبة
ipcMain.handle('db:deleteGame', async (event, gameId) => {

    try {

        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');

        data = data.filter(g => g.id !== gameId);

        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));

        return true;

    } catch (err) {

        console.error("Delete Error:", err);

        return false;

    }

});

// جلب معلومات لعبة من Steam
ipcMain.handle('api:fetchGameInfo', async (event, gameName) => {

    try {

        const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;

        const response = await axios.get(url);

        if (response.data && response.data.total > 0) {

            const game = response.data.items[0];
            const appId = game.id;

            return {
                name: game.name,
                poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg`
            };

        }

    } catch (err) {

        console.error("Steam API Error:", err.message);

    }

    return null;

});