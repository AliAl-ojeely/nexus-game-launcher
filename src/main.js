const path = require('path');
const { app, BrowserWindow, ipcMain, protocol, Menu, shell } = require('electron');

// استيراد الموديلات الخاصة بك
const db = require('../modules/database');
const steam = require('../modules/steam-api');
const steamGrid = require('../modules/steamGrid-api');
const rawg = require('../modules/rawg-api');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');
const playtimeDB = require('../modules/playtime');
// الموديل الجديد للبحث في يوتيوب
const youtube = require('../modules/youtube-api');

db.initDB();
playtimeDB.initPlaytimeDB();

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

    win.webContents.on('context-menu', async () => {
        let lang = 'en';
        try { lang = await win.webContents.executeJavaScript('localStorage.getItem("lang")'); } catch { }

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
            { role: 'inspectElement', label: labels.inspect }
        ]);

        menu.popup({ window: win });
    });
}

app.whenReady().then(() => {
    protocol.registerFileProtocol('local-resource', (request, callback) => {
        const url = request.url.replace(/^local-resource:\/\//, '');
        try { callback(decodeURI(url)); }
        catch (error) { console.error('Protocol Error:', error); }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────────────────────────────────────
// GAME LAUNCHER IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.on('game:launch', (event, gamePath, showFPS, args, id) => {
    launcher.launchGame(event, gamePath, showFPS, args, id);
});

ipcMain.on('game:force-stop', (_event, gameId) => {
    launcher.forceStopGame(gameId);
});

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('db:getGames', () => db.getGames());
ipcMain.handle('db:saveGame', (_e, game) => db.saveGame(game));
ipcMain.handle('db:deleteGame', (_e, id) => db.deleteGame(id));

ipcMain.handle('db:updateGame', (_e, game) => {
    console.log(`\n[MAIN IPC] Saving playtime for: ${game.name} | ${game.playtime} mins`);
    const result = db.updateGame(game);
    console.log(`[MAIN IPC] Result: ${result ? 'SUCCESS' : 'FAILED'}\n`);
    return result;
});

// ─────────────────────────────────────────────────────────────────────────────
// API IPC (تم تحديث جزء التريلر هنا)
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('api:fetchGameInfo', async (_e, name) => {
    try {
        console.log('\n[Nexus] Fetch Poster For:', name);
        const sgAssets = await steamGrid.fetchGameAssets(name);
        return { name, poster: sgAssets?.poster || '' };
    } catch (err) {
        console.error('Poster Fetch Error:', err);
        return { name, poster: '' };
    }
});

ipcMain.handle('api:fetchGameDetails', async (_e, name) => {
    console.log('\n==============================');
    console.log('Fetching details for:', name);

    const [steamData, rawgData] = await Promise.all([
        steam.fetchGameDetails(name).catch(err => { console.warn('[Steam] Failed:', err.message); return null; }),
        rawg.fetchGameDetails(name).catch(err => { console.warn('[RAWG] Failed:', err.message); return null; })
    ]);

    const sgAssets = await steamGrid.fetchGameAssets(name, steamData?.appid).catch(err => {
        console.warn('[SteamGrid] Failed:', err.message);
        return null;
    });

    // 1. تحديد الاسم الرسمي (الأدق للبحث)
    const officialName = rawgData?.name || steamData?.name || name;

    // 2. محاولة جلب التريلر من YouTube API الخاص بنا لضمان الدقة
    let trailerYouTubeId = rawgData?.media?.trailerYouTubeId || null;
    let trailerThumbnail = rawgData?.media?.trailerThumbnail || null;

    if (!trailerYouTubeId) {
        console.log(`[Nexus] RAWG failed for trailer, searching YouTube for: ${officialName}`);
        const ytData = await youtube.getTrailerData(officialName);
        if (ytData) {
            trailerYouTubeId = ytData.videoId;
            trailerThumbnail = ytData?.thumbnail || null;
        }
    }

    const trailerSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(officialName + ' official trailer')}`;

    if (!steamData && !rawgData && !sgAssets) {
        return {
            assets: { poster: '', background: '', logo: '' },
            metadata: {
                description: 'No information found for this game.',
                developer: 'N/A', publisher: 'N/A', releaseDate: 'N/A',
                systemRequirements: { minimum: 'N/A', recommended: 'N/A' },
                metacritic: 'N/A', genres: 'N/A', tags: 'N/A',
                media: { screenshots: [], trailerYouTubeId, trailerThumbnail, trailerSearchUrl }
            }
        };
    }

    let description = 'No description available.';
    if (rawgData?.description && rawgData.description.length > 200) description = rawgData.description;
    else if (steamData?.description) description = steamData.description;

    const screenshots = sgAssets?.screenshots?.length > 0 ? sgAssets.screenshots :
        steamData?.media?.screenshots?.length > 0 ? steamData.media.screenshots :
            rawgData?.media?.screenshots || [];

    console.log('==============================\n');

    return {
        assets: {
            poster: sgAssets?.poster || steamData?.poster || rawgData?.poster || '',
            background: sgAssets?.background || steamData?.background || rawgData?.background || '',
            logo: sgAssets?.logo || ''
        },
        metadata: {
            description,
            developer: steamData?.developer || rawgData?.developer || 'N/A',
            publisher: steamData?.publisher || rawgData?.publisher || 'N/A',
            releaseDate: steamData?.releaseDate || rawgData?.releaseDate || 'N/A',
            systemRequirements: steamData?.systemRequirements || rawgData?.systemRequirements || { minimum: 'N/A', recommended: 'N/A' },
            metacritic: rawgData?.metacritic || 'N/A',
            genres: rawgData?.genres || 'N/A',
            tags: rawgData?.tags || 'N/A',
            media: {
                screenshots,
                trailerYouTubeId,
                trailerThumbnail,
                trailerSearchUrl
            }
        }
    };
});

// ─────────────────────────────────────────────────────────────────────────────
// DIALOGS / SHELL IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, filePath) => dialogs.openFolder(event, filePath));
ipcMain.on('shell:openExternal', (_e, url) => {
    if (url) shell.openExternal(url);
});

// ─────────────────────────────────────────────────────────────────────────────
// PLAYTIME IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('db:getPlaytime', (_e, gameName) => playtimeDB.getPlaytime(gameName));
ipcMain.handle('db:addPlaytime', (_e, gameName, minutes) => playtimeDB.addPlaytime(gameName, minutes));