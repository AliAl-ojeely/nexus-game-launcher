const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');
const path = require('path');

// ==========================================
// استدعاء الوحدات المستقلة
// ==========================================
const db = require('../modules/database');
const steam = require('../modules/steam-api');
const steamGrid = require('../modules/steamGrid-api');
const rawg = require('../modules/rawg-api');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');

// تهيئة قاعدة البيانات عند بدء التشغيل
db.initDB();

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
            webSecurity: true
        }
    });

    win.setMenuBarVisibility(false);
    win.loadFile(path.join(__dirname, '../index.html'));

    // تخصيص قائمة الزر الأيمن (Context Menu)
    win.webContents.on('context-menu', async () => {
        let lang = 'en';
        try { lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")'); } catch {}
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

// ==========================================
// تهيئة التطبيق والبروتوكولات
// ==========================================
app.whenReady().then(() => {
    // تسجيل بروتوكول محلي لتحميل الصور من القرص الصلب (Local Resources)
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

// ==========================================
// IPC HANDLERS (منطق الربط والـ API الذكي)
// ==========================================

// --- تشغيل الألعاب ---
ipcMain.on('game:launch', (event, path, showFPS, args, id) => launcher.launchGame(event, path, showFPS, args, id));

// --- عمليات قاعدة البيانات ---
ipcMain.handle('db:getGames', () => db.getGames());
ipcMain.handle('db:saveGame', (event, game) => db.saveGame(game));
ipcMain.handle('db:updateGame', (event, game) => db.updateGame(game));
ipcMain.handle('db:deleteGame', (event, id) => db.deleteGame(id));
ipcMain.handle('save-game-details', (event, id, details) => db.saveGameDetails(id, details));

// جلب معلومات البحث الأولية (البوستر الرئيسي)
ipcMain.handle('api:fetchGameInfo', async (event, name) => {
    try {
        console.log(`[Nexus] Getting initial poster for: ${name}`);
        // نطلب البوستر من SteamGridDB مباشرة لضمان الجودة
        const sgAssets = await steamGrid.fetchGameAssets(name);
        
        return {
            name: name,
            poster: sgAssets?.poster || "" // الاعتماد على SteamGridDB
        };
    } catch (err) {
        return { name: name, poster: "" };
    }
});

ipcMain.handle('api:fetchGameDetails', async (event, name) => {
    try {

        // 1. جلب الصور من SteamGridDB (الأولوية دائماً للصور)
        const sgAssets = await steamGrid.fetchGameAssets(name);

        // 2. محاولة جلب المعلومات من Steam
        let steamData = await steam.fetchGameDetails(name);

        // 3. إذا Steam لم يرجع بيانات كافية → استخدم RAWG
        if (!steamData || !steamData.description) {

            console.log("[Nexus] Steam data missing, switching to RAWG fallback");

            const rawgData = await rawg.fetchGameDetails(name);

            if (rawgData) {
                steamData = rawgData;
            }
        }

        return {

            assets: {
                poster: sgAssets?.poster || steamData?.poster || "",
                background: sgAssets?.background || steamData?.background || "",
                logo: sgAssets?.logo || ""
            },

            metadata: {
                description: steamData?.description || "No description available.",
                developer: steamData?.developer || "N/A",
                publisher: steamData?.publisher || "N/A",
                releaseDate: steamData?.releaseDate || "N/A",
                systemRequirements: steamData?.systemRequirements || { minimum: "N/A", recommended: "N/A" },
                media: steamData?.media || { trailer: "", screenshots: [] }
            }

        };

    } catch (error) {

        console.error("Fetch Error:", error);

        return null;
    }
});

// --- حوارات النظام والمجلدات ---
ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, path) => dialogs.openFolder(event, path));
ipcMain.on('shell:openExternal', (event, url) => dialogs.openExternal(url));