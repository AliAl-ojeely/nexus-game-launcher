const fs = require('fs');
const path = require('path');

// app.getPath() is safe to call after app is imported — Electron resolves it lazily
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
        if (fs.existsSync(SETTINGS_FILE))
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch { }
    return {};
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
        writeSettings({ lang: 'en', theme: 'dark', appName: 'Nexus Launcher' });
    }
    if (!fs.existsSync(GAMES_FILE)) {
        fs.writeFileSync(GAMES_FILE, JSON.stringify([], null, 2));
    }
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
};