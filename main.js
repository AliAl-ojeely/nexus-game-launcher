const { app, BrowserWindow, ipcMain, dialog, shell, protocol, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// --- Path Settings ---
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'games.json');

// Create the database if it doesn't exist
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

    // Context Menu
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

// --- App Lifecycle ---
app.whenReady().then(() => {
    // Register local resource protocol for images
    protocol.registerFileProtocol('local-resource', (request, callback) => {
        const url = request.url.replace(/^local-resource:\/\//, '');
        try { callback(decodeURI(url)); } catch (error) { console.error('Protocol Error:', error); }
    });
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// ==========================================
// IPC HANDLERS (System & Shell Operations)
// ==========================================

// 1. تشغيل الألعاب (.exe)
ipcMain.on('game:launch', async (event, gamePath) => {
    if (!gamePath) return;
    const error = await shell.openPath(gamePath);
    if (error) {
        dialog.showErrorBox("Launch Error", `Could not start the game. Path might be incorrect.\nError: ${error}`);
    }
});

// 2. فتح الروابط الخارجية (GitHub, Email, etc.)
ipcMain.on('shell:openExternal', (event, url) => {
    if (url) shell.openExternal(url);
});

// 3. اختيار ملف اللعبة
ipcMain.handle('dialog:selectGame', async () => {
    const result = await dialog.showOpenDialog({ 
        title: 'Select Game Executable', 
        filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'lnk'] }], 
        properties: ['openFile'] 
    });
    return result.canceled ? null : result.filePaths[0];
});

// 4. اختيار صورة مخصصة
ipcMain.handle('dialog:selectImage', async () => {
    const result = await dialog.showOpenDialog({ 
        title: 'Select Cover Image', 
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }], 
        properties: ['openFile'] 
    });
    return result.canceled ? null : result.filePaths[0];
});

// ==========================================
// DATABASE OPERATIONS (CRUD)
// ==========================================

ipcMain.handle('db:getGames', async () => {
    try {
        if (!fs.existsSync(dbPath)) return [];
        return JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
    } catch (err) { return []; }
});

ipcMain.handle('db:saveGame', async (event, newGame) => {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data.push(newGame);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
});

ipcMain.handle('db:updateGame', async (event, updatedGame) => {
    try {
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data = data.map(g => g.id === updatedGame.id ? updatedGame : g);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
});

ipcMain.handle('db:deleteGame', async (event, gameId) => {
    try {
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data = data.filter(g => g.id !== gameId);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
});

// ==========================================
// STEAM API INTEGRATION (Live Fetching)
// ==========================================

ipcMain.handle('api:fetchGameInfo', async (event, gameName) => {
    try {
        const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
        const response = await axios.get(url);
        if (response.data && response.data.total > 0) {
            const game = response.data.items[0];
            return {
                name: game.name,
                poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.id}/library_600x900.jpg`
            };
        }
    } catch (err) { console.error("Steam Basic API Error:", err.message); }
    return null;
});

//  (Description, Screenshots, Requirements)
ipcMain.handle('api:fetchGameDetails', async (event, gameName) => {
    try {
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
        const searchResponse = await axios.get(searchUrl);

        if (searchResponse.data && searchResponse.data.total > 0) {
            const appId = searchResponse.data.items[0].id;
            const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`;
            const detailsResponse = await axios.get(detailsUrl);
            
            if (detailsResponse.data[appId].success) {
                const gameData = detailsResponse.data[appId].data;
                
                let trailerUrl = "";
                if (gameData.movies && gameData.movies.length > 0) {
                    trailerUrl = gameData.movies[0].webm?.max || gameData.movies[0].mp4?.max || "";
                }
                
                let screenshotsArray = gameData.screenshots ? gameData.screenshots.map(ss => ss.path_full) : [];

                return {
                    description: gameData.short_description || "No description available.",
                    developer: gameData.developers ? gameData.developers.join(', ') : "Unknown",
                    publisher: gameData.publishers ? gameData.publishers.join(', ') : "Unknown",
                    releaseDate: gameData.release_date ? gameData.release_date.date : "Unknown",
                    background: gameData.background_raw || gameData.background || "",
                    media: { trailer: trailerUrl, screenshots: screenshotsArray },
                    systemRequirements: {
                        minimum: gameData.pc_requirements?.minimum || "Not Available",
                        recommended: gameData.pc_requirements?.recommended || "Not Available"
                    }
                };
            }
        }
    } catch (err) { console.error("Steam Details API Error:", err.message); }
    return null; 
});