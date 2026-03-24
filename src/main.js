const path = require('path');
const { app, BrowserWindow, ipcMain, protocol, Menu } = require('electron');

// const envPath = app.isPackaged
//     ? path.join(process.resourcesPath, '.env')
//     : path.join(__dirname, '../.env');
// require('dotenv').config({ path: envPath });

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
            { role: 'inspect', label: labels.inspect }
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

ipcMain.on('game:launch', (event, path, showFPS, args, id) =>
    launcher.launchGame(event, path, showFPS, args, id)
);

ipcMain.on('forceStopGame', (event, gameId) => {
    forceStopGame(gameId, event);
});

ipcMain.handle('db:getGames', () => db.getGames());
ipcMain.handle('db:saveGame', (event, game) => db.saveGame(game));

ipcMain.handle('db:updateGame', (event, game) => {
    console.log(`\n[MAIN IPC] 💾 Received playtime save request...`);
    console.log(`[MAIN IPC] Game: ${game.name} | New Playtime: ${game.playtime} minutes`);

    const result = db.updateGame(game);

    console.log(`[MAIN IPC] JSON Save Result: ${result ? 'SUCCESS ✅' : 'FAILED ❌'}\n`);
    return result;
});

ipcMain.handle('db:deleteGame', (event, id) => db.deleteGame(id));

ipcMain.handle('api:fetchGameInfo', async (event, name) => {
    try {
        console.log("\n[Nexus] Fetch Poster For:", name);
        const sgAssets = await steamGrid.fetchGameAssets(name);
        console.log("Poster Found:", sgAssets?.poster ? "YES" : "NO");

        return {
            name: name,
            poster: sgAssets?.poster || ""
        };
    } catch (err) {
        console.error("Poster Fetch Error:", err);
        return {
            name: name,
            poster: ""
        };
    }
});

ipcMain.handle('api:fetchGameDetails', async (event, name) => {
    try {
        console.log("\n==============================");
        console.log("Adding Game:", name);

        const steamData = await steam.fetchGameDetails(name);
        console.log("Steam AppID:", steamData?.appid || "NOT FOUND");

        const sgAssets = await steamGrid.fetchGameAssets(name, steamData?.appid);
        console.log("SteamGrid Poster:", sgAssets?.poster ? "YES" : "NO");
        console.log("SteamGrid Background:", sgAssets?.background ? "YES" : "NO");
        console.log("SteamGrid Logo:", sgAssets?.logo ? "YES" : "NO");

        const rawgData = await rawg.fetchGameDetails(name);
        console.log("RAWG Description:", rawgData?.description ? "YES" : "NO");

        let description = "No description available.";
        if (rawgData?.description && rawgData.description.length > 200) {
            description = rawgData.description;
        } else if (steamData?.description) {
            description = steamData.description;
        }

        const developer = steamData?.developer || rawgData?.developer || "N/A";
        const publisher = steamData?.publisher || rawgData?.publisher || "N/A";
        const releaseDate = steamData?.releaseDate || rawgData?.releaseDate || "N/A";

        const systemRequirements =
            (steamData && steamData.systemRequirements && steamData.systemRequirements.minimum !== "Not Available")
                ? steamData.systemRequirements
                : (rawgData?.systemRequirements || { minimum: "N/A", recommended: "N/A" });

        const screenshots =
            (sgAssets?.screenshots && sgAssets.screenshots.length > 0)
                ? sgAssets.screenshots
                : (steamData?.media?.screenshots?.length > 0
                    ? steamData.media.screenshots
                    : rawgData?.media?.screenshots || []);

        const result = {
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
                metacritic: rawgData?.metacritic || "N/A",
                genres: rawgData?.genres || "N/A",
                tags: rawgData?.tags || "N/A",
                media: {
                    screenshots: screenshots
                }
            }
        };

        console.log("==============================");
        return result;

    } catch (error) {
        console.error("Fetch Error:", error);
        return null;
    }
});

ipcMain.handle('dialog:selectGame', () => dialogs.selectGame());
ipcMain.handle('dialog:selectImage', () => dialogs.selectImage());
ipcMain.on('shell:openFolder', (event, path) => dialogs.openFolder(event, path));
ipcMain.on('shell:openExternal', (event, url) => dialogs.openExternal(url));
// === قنوات ملف الوقت المستقل ===
ipcMain.handle('db:getPlaytime', (event, gameName) => playtimeDB.getPlaytime(gameName));
ipcMain.handle('db:addPlaytime', (event, gameName, minutes) => playtimeDB.addPlaytime(gameName, minutes));