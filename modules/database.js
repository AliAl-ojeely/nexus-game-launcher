const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const playtimeDB = require('./playtime');

const dbPath = path.join(app.getPath('userData'), 'games.json');

// ── مجلد حفظ الصور المحلية ──────────────────────────────────────────────────
const ASSETS_DIR = path.join(app.getPath('userData'), 'game-assets');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
// ASSET DOWNLOADER — يحمّل صورة من URL ويحفظها محلياً
// ─────────────────────────────────────────────────────────────────────────────

async function downloadAsset(url, gameId, type) {
    if (!url || url.startsWith('file:///') || url.startsWith('local-resource://')) return url;

    try {
        const https = require('https');
        const http = require('http');
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const fileName = `${gameId}_${type}${ext}`;
        const filePath = path.join(ASSETS_DIR, fileName);

        // إذا موجود مسبقاً، لا تحمّل مجدداً
        if (fs.existsSync(filePath)) return `local-resource://${filePath}`;

        return new Promise((resolve) => {
            const protocol = url.startsWith('https') ? https : http;
            const file = fs.createWriteStream(filePath);

            const request = protocol.get(url, (response) => {
                // تعامل مع الـ redirect
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlink(filePath, () => { });
                    downloadAsset(response.headers.location, gameId, type).then(resolve);
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(`local-resource://${filePath}`);
                });
            });

            request.on('error', () => {
                file.close();
                fs.unlink(filePath, () => { });
                resolve(url); // fallback للـ URL الأصلي
            });

            request.setTimeout(15000, () => {
                request.destroy();
                file.close();
                fs.unlink(filePath, () => { });
                resolve(url);
            });
        });
    } catch (err) {
        console.warn(`[Assets] Failed to download ${type} for ${gameId}:`, err.message);
        return url;
    }
}

// تحميل كل الأصول (poster, background, logo) لعبة واحدة
async function downloadAllAssets(gameId, assets) {
    const [poster, background, logo, icon] = await Promise.all([
        downloadAsset(assets.poster || '', gameId, 'poster'),
        downloadAsset(assets.background || '', gameId, 'background'),
        downloadAsset(assets.logo || '', gameId, 'logo'),
        downloadAsset(assets.icon || '', gameId, 'icon'),
    ]);
    return { poster, background, logo, icon };
}

// تحميل الـ screenshots
async function downloadScreenshots(gameId, screenshots = []) {
    if (!screenshots.length) return [];
    const results = await Promise.all(
        screenshots.map((url, i) => downloadAsset(url, gameId, `screenshot_${i}`))
    );
    return results;
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
        const formattedGame = {
            id: newGame.id || Date.now(),
            name: newGame.name,
            path: newGame.path,
            arguments: newGame.arguments || '',
            isFavorite: newGame.isFavorite || false,
            // ✅ إضافة icon هنا عند الحفظ لأول مرة
            assets: newGame.assets || { poster: '', background: '', logo: '', icon: '' },
            metadata: newGame.metadata || {
                description: '', developer: 'N/A', publisher: 'N/A',
                releaseDate: 'N/A', systemRequirements: {}, media: { screenshots: [] }
            }
        };
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
    try {
        // حذف ملفات الأصول المحلية
        if (fs.existsSync(ASSETS_DIR)) {
            fs.readdirSync(ASSETS_DIR).forEach(file => {
                if (file.startsWith(`${gameId}_`)) {
                    fs.unlinkSync(path.join(ASSETS_DIR, file));
                }
            });
        }
        let games = getGames();
        games = games.filter(g => String(g.id) !== String(gameId));
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
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
        games[index].assets = {
            poster: localAssets.poster || games[index].assets.poster,
            background: localAssets.background || games[index].assets.background,
            logo: localAssets.logo || games[index].assets.logo,
            icon: localAssets.icon || games[index].assets.icon, // الحفظ هنا!
        };

        games[index].metadata = {
            ...fetchedData.metadata,
            media: {
                ...fetchedData.metadata?.media,
                screenshots: localScreenshots,
            }
        };

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