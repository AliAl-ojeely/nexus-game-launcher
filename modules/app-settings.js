const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const USER_DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');
const GAMES_FILE = path.join(USER_DATA, 'games.json');
const ASSETS_DIR = path.join(USER_DATA, 'game-assets');
const BACKUP_CONFIG = path.join(USER_DATA, 'gamesBackSave.json');

const BUNDLED_DB_PATH = path.join(process.resourcesPath, 'gameSavePaths.json');
const USER_DB_PATH = path.join(USER_DATA, 'gameSavePaths.json');

// ─────────────────────────────────────────────────────────────────────────────

function readSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
            // Ensure defaults for new keys
            return {
                lang: 'en',
                theme: 'dark',
                appName: 'Nexus Launcher',
                enableSystemTray: false,   // default to disabled
                ...data
            };
        }
    } catch { /* ignore */ }
    // If file doesn't exist, return defaults
    return {
        lang: 'en',
        theme: 'dark',
        appName: 'Nexus Launcher',
        enableSystemTray: false,
    };
}

function writeSettings(data) {
    if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function initAppData() {
    if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
    if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

    if (!fs.existsSync(USER_DB_PATH)) {
        const devPath = path.join(__dirname, '../gameSavePaths.json');
        const sourcePath = fs.existsSync(BUNDLED_DB_PATH) ? BUNDLED_DB_PATH : devPath;
        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, USER_DB_PATH);
            console.log('✅ Game Database initialized in AppData.');
        }
    }

    if (!fs.existsSync(SETTINGS_FILE)) {
        // Write default settings (with tray disabled)
        writeSettings({
            lang: 'en',
            theme: 'dark',
            appName: 'Nexus Launcher',
            enableSystemTray: false,
        });
    }
    if (!fs.existsSync(GAMES_FILE)) {
        fs.writeFileSync(GAMES_FILE, JSON.stringify([], null, 2));
    }
}

function getWindowSize() {
    const settings = readSettings();
    return {
        width: settings.windowWidth || 1100,
        height: settings.windowHeight || 750
    };
}

function setWindowSize(width, height) {
    const settings = readSettings();
    settings.windowWidth = width;
    settings.windowHeight = height;
    writeSettings(settings);
}

module.exports = {
    USER_DATA,
    SETTINGS_FILE,
    GAMES_FILE,
    ASSETS_DIR,
    BACKUP_CONFIG,
    USER_DB_PATH,
    readSettings,
    writeSettings,
    initAppData,
    getWindowSize,
    setWindowSize
};