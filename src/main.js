const path = require('path');
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');

const db = require('../modules/database');
const steam = require('../modules/steam-api');
const steamGrid = require('../modules/steamGrid-api');
const rawg = require('../modules/rawg-api');
const dialogs = require('../modules/dialogs');
const launcher = require('../modules/game-launcher');
const playtimeDB = require('../modules/playtime');

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
ipcMain.handle('db:saveGame', (_event, game) => db.saveGame(game));

ipcMain.handle('db:updateGame', (_event, game) => {
    console.log(`\n[MAIN IPC] Saving playtime for: ${game.name} | ${game.playtime} mins`);
    const result = db.updateGame(game);
    console.log(`[MAIN IPC] Result: ${result ? 'SUCCESS' : 'FAILED'}\n`);
    return result;
});

ipcMain.handle('db:deleteGame', (_event, id) => db.deleteGame(id));

// ─────────────────────────────────────────────────────────────────────────────
// API IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('api:fetchGameInfo', async (_event, name) => {
    try {
        console.log('\n[Nexus] Fetch Poster For:', name);
        const sgAssets = await steamGrid.fetchGameAssets(name);
        console.log('Poster Found:', sgAssets?.poster ? 'YES' : 'NO');
        return { name, poster: sgAssets?.poster || '' };
    } catch (err) {
        console.error('Poster Fetch Error:', err);
        return { name, poster: '' };
    }
});

ipcMain.handle('api:fetchGameDetails', async (_event, name) => {
    console.log('\n==============================');
    console.log('Fetching details for:', name);

    const [steamData, rawgData] = await Promise.all([
        steam.fetchGameDetails(name).catch(err => {
            console.warn('[Steam] Failed:', err.message);
            return null;
        }),
        rawg.fetchGameDetails(name).catch(err => {
            console.warn('[RAWG] Failed:', err.message);
            return null;
        })
    ]);

    console.log('Steam found:', steamData ? `AppID ${steamData.appid}` : 'NO');
    console.log('RAWG found:', rawgData ? 'YES' : 'NO');

    const sgAssets = await steamGrid.fetchGameAssets(name, steamData?.appid).catch(err => {
        console.warn('[SteamGrid] Failed:', err.message);
        return null;
    });

    console.log('SteamGrid Poster:', sgAssets?.poster ? 'YES' : 'NO');
    console.log('SteamGrid Background:', sgAssets?.background ? 'YES' : 'NO');
    console.log('SteamGrid Logo:', sgAssets?.logo ? 'YES' : 'NO');

    if (!steamData && !rawgData && !sgAssets) {
        console.warn('[Nexus] All sources failed for:', name);
        return {
            assets: { poster: '', background: '', logo: '' },
            metadata: {
                description: 'No information found for this game.',
                developer: 'N/A',
                publisher: 'N/A',
                releaseDate: 'N/A',
                systemRequirements: { minimum: 'N/A', recommended: 'N/A' },
                metacritic: 'N/A',
                genres: 'N/A',
                tags: 'N/A',
                media: { screenshots: [] }
            }
        };
    }

    let description = 'No description available.';
    if (rawgData?.description && rawgData.description.length > 200) {
        description = rawgData.description;
    } else if (steamData?.description) {
        description = steamData.description;
    } else if (rawgData?.description) {
        description = rawgData.description;
    }

    const developer = steamData?.developer || rawgData?.developer || 'N/A';
    const publisher = steamData?.publisher || rawgData?.publisher || 'N/A';
    const releaseDate = steamData?.releaseDate || rawgData?.releaseDate || 'N/A';

    // System requirements: Steam أولوية إذا القيمة صالحة
    const steamReqValid =
        steamData?.systemRequirements?.minimum &&
        !['N/A', 'Not Available', ''].includes(steamData.systemRequirements.minimum);

    const systemRequirements = steamReqValid
        ? steamData.systemRequirements
        : (rawgData?.systemRequirements || { minimum: 'N/A', recommended: 'N/A' });

    // Screenshots: SteamGrid ← Steam ← RAWG
    const screenshots =
        sgAssets?.screenshots?.length > 0 ? sgAssets.screenshots :
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
            developer,
            publisher,
            releaseDate,
            systemRequirements,
            metacritic: rawgData?.metacritic || 'N/A',
            genres: rawgData?.genres || 'N/A',
            tags: rawgData?.tags || 'N/A',
            media: { screenshots }
        }
    };
});

// ─────────────────────────────────────────────────────────────────────────────
// DIALOGS / SHELL IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, filePath) => dialogs.openFolder(event, filePath));
ipcMain.on('shell:openExternal', (_event, url) => dialogs.openExternal(url));

// ─────────────────────────────────────────────────────────────────────────────
// PLAYTIME IPC
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('db:getPlaytime', (_event, gameName) => playtimeDB.getPlaytime(gameName));
ipcMain.handle('db:addPlaytime', (_event, gameName, minutes) => playtimeDB.addPlaytime(gameName, minutes));