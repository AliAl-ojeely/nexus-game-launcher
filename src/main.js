const path = require('path');
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');


const envPath = app.isPackaged 
    ? path.join(process.resourcesPath, '.env') 
    : path.join(__dirname, '../.env');

require('dotenv').config({ path: envPath });

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
        // 1. جلب البيانات من Steam أولاً للحصول على الـ AppID الدقيق (Exact Match)
        const steamData = await steam.fetchGameDetails(name);

        // 2. جلب الصور من SteamGrid مع تمرير الـ AppID (إذا كان متوفراً) لضمان دقة 100%
        const sgAssets = await steamGrid.fetchGameAssets(name, steamData?.appid);

        // 3. جلب البيانات من RAWG كدعم احتياطي
        const rawgData = await rawg.fetchGameDetails(name);

        // اختيار أفضل وصف
        let description = "No description available.";
        if (rawgData?.description && rawgData.description.length > 200) {
            description = rawgData.description;
        } else if (steamData?.description) {
            description = steamData.description;
        }

        // اختيار المطور والناشر وتاريخ الإصدار
        const developer = steamData?.developer || rawgData?.developer || "N/A";
        const publisher = steamData?.publisher || rawgData?.publisher || "N/A";
        const releaseDate = steamData?.releaseDate || rawgData?.releaseDate || "N/A";

        // متطلبات التشغيل
        const systemRequirements = 
            (steamData && steamData.systemRequirements && steamData.systemRequirements.minimum !== "Not Available")
                ? steamData.systemRequirements
                : (rawgData?.systemRequirements || { minimum: "N/A", recommended: "N/A" });

        // screenshots
        const screenshots = 
            (sgAssets?.screenshots && sgAssets.screenshots.length > 0)
                ? sgAssets.screenshots
                : (steamData?.media?.screenshots?.length > 0 ? steamData.media.screenshots : rawgData?.media?.screenshots || []);

        return {
            assets: {
                poster: sgAssets?.poster || steamData?.poster || rawgData?.poster || "",
                background: sgAssets?.background || steamData?.background || rawgData?.background || "",
                logo: sgAssets?.logo || ""
            },
            metadata: {
                description: description,
                developer: developer,
                publisher: publisher,
                releaseDate: releaseDate,
                systemRequirements: systemRequirements,
                media: {
                    trailer: steamData?.media?.trailer || rawgData?.media?.trailer || "",
                    screenshots: screenshots
                }
            }
        };

    } catch (error) {
        console.error("Fetch Error:", error);
        return null;
    }
});

// console.log("RAWG KEY:", process.env.RAWG_API_KEY);

// --- حوارات النظام والمجلدات ---
ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, path) => dialogs.openFolder(event, path));
ipcMain.on('shell:openExternal', (event, url) => dialogs.openExternal(url));