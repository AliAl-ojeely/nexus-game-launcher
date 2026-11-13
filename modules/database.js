const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const playtimeDB = require('./playtime');
const { nonEmptyAssetMerge } = require('./asset-resolver');
const { mergeMetadataSafe } = require('./asset-refresh-policy');

const dbPath = path.join(app.getPath('userData'), 'games.json');

// ── مجلد حفظ الصور المحلية ──────────────────────────────────────────────────
const ASSETS_DIR = path.join(app.getPath('userData'), 'game-assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// The legacy database writer now uses the same validated downloader as IPC.
// Previously this path could save an HTTP 404 body as an image file.
async function downloadAsset(url, gameId, type) {
    const { downloadAsset: safeDownload } = require('./assets');
    return safeDownload(url, path.join(ASSETS_DIR, 'legacy', String(gameId)), type);
}

async function downloadAllAssets(gameId, assets = {}) {
    const result = await Promise.all(['poster', 'background', 'logo', 'icon']
        .map(kind => downloadAsset(assets[kind] || '', gameId, kind)));
    return Object.fromEntries(['poster', 'background', 'logo', 'icon']
        .map((kind, index) => [kind, result[index]]));
}

async function downloadScreenshots(gameId, screenshots = []) {
    const result = [];
    for (const [index, url] of screenshots.slice(0, 20).entries()) {
        const local = await downloadAsset(url, gameId, `screenshot_${index}`);
        if (local) result.push(local);
    }
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DB CORE
// ─────────────────────────────────────────────────────────────────────────────

function initDB() {
    if (!fs.existsSync(dbPath)) {
        try { fs.writeFileSync(dbPath, '[]', 'utf-8'); }
        catch (err) { console.error("[Database] Init Error:", err); }
    }
}

function getGames() {
    try {
        if (!fs.existsSync(dbPath)) return [];
        const content = fs.readFileSync(dbPath, 'utf-8');
        let games = JSON.parse(content || '[]');

        return games.map(game => {
            // ✅ إضافة icon في القيم الافتراضية لضمان عدم وجود undefined
            if (!game.assets) game.assets = { poster: '', background: '', logo: '', icon: '' };
            if (!game.assets.icon) game.assets.icon = '';

            if (!game.metadata) game.metadata = {
                description: '', developer: 'N/A', publisher: 'N/A',
                releaseDate: 'N/A', systemRequirements: {}, media: { screenshots: [] }
            };
            game.playtime = playtimeDB.getPlaytime(game.name);
            return game;
        });
    } catch (err) { return []; }
}

function saveGame(newGame) {
    try {
        const games = getGames();
        // Preserve restored notes and future per-game fields without saving runtime playtime.
        const formattedGame = {
            ...newGame,
            id: newGame.id || Date.now(),
            name: newGame.name,
            path: newGame.path,
            isInstalled: newGame.isInstalled !== false,
            arguments: newGame.arguments || '',
            isFavorite: newGame.isFavorite === true,
            assets: newGame.assets || { poster: '', background: '', logo: '', icon: '' },
            metadata: newGame.metadata || {
                description: '', developer: 'N/A', publisher: 'N/A',
                releaseDate: 'N/A', systemRequirements: {}, media: { screenshots: [] }
            }
        };
        delete formattedGame.playtime;
        delete formattedGame.manualAssets;
        games.push(formattedGame);
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function updateGame(updatedGame) {
    try {
        let games = getGames();
        games = games.map(g => {
            if (String(g.id) === String(updatedGame.id)) {
                const tempGame = { ...g, ...updatedGame };
                delete tempGame.playtime;
                return tempGame;
            }
            return g;
        });
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function deleteGame(gameId) {
    // IPC archives the game before removal. Do not delete artwork: it may be
    // shared by another library entry and must be available on re-add.
    try {
        const games = getGames();
        if (!games.some(g => String(g.id) === String(gameId))) return false;
        const remaining = games.filter(g => String(g.id) !== String(gameId));
        for (const game of remaining) delete game.playtime;
        fs.writeFileSync(dbPath, JSON.stringify(remaining, null, 2));
        return true;
    } catch (err) {
        console.error('[Database] Remove game failed:', err);
        return false;
    }
}

async function saveGameDetails(gameId, fetchedData) {
    try {
        let games = getGames();
        const index = games.findIndex(g => String(g.id) === String(gameId));
        if (index === -1 || !fetchedData) return { success: false, error: 'Game not found' };

        // ── تحميل الأصول محلياً (يشمل الأيقونة الآن) ──
        const localAssets = await downloadAllAssets(gameId, fetchedData.assets || {});

        const rawScreenshots = fetchedData.metadata?.media?.screenshots || [];
        const localScreenshots = await downloadScreenshots(gameId, rawScreenshots);

        // ✅ حفظ مسار الأيقونة النهائي في JSON
        games[index].assets = nonEmptyAssetMerge(games[index].assets || {}, localAssets);
        games[index].metadata = mergeMetadataSafe(games[index].metadata || {}, {
            ...(fetchedData.metadata || {}),
            media: {
                ...(fetchedData.metadata?.media || {}),
                screenshots: localScreenshots,
            },
        });

        delete games[index].playtime;
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return { success: true };
    } catch (err) {
        console.error('[Database] saveGameDetails error:', err);
        return { success: false, error: err.message };
    }
}

module.exports = {
    initDB, getGames, saveGame, updateGame,
    deleteGame, saveGameDetails,
    downloadAllAssets, downloadAsset
};