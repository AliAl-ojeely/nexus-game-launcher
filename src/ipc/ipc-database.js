const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const db = require('../../modules/database');
const backups = require('../../modules/backup');
const playtimeDB = require('../../modules/playtime');

const { readSettings, ASSETS_DIR } = require('../../modules/app-settings');
const { slugifyName, downloadAsset,
    renameAssetsFolder, updateAssetPaths } = require('../../modules/assets');

function registerDatabaseIPC() {

    // ── Get all games ─────────────────────────────────────────────────────────
    ipcMain.handle('db:getGames', () => db.getGames());

    // ── Save new game ─────────────────────────────────────────────────────────
    ipcMain.handle('db:saveGame', async (_e, game) => {
        console.log(`[DB] Adding: "${game.name}"`);
        const result = db.saveGame(game);

        const settings = readSettings();
        const globalBackupPath = settings.globalBackupPath || '';
        const discoveredPath = backups.autoDiscoverSavePath(game.name, game.path || null, true);

        if (!discoveredPath) {
            backups.updateBackupConfig(game.name, { originPath: '', backupPath: globalBackupPath });
            console.log(`[DB] No save path for "${game.name}" — empty entry created`);
        } else if (globalBackupPath) {
            backups.updateBackupConfig(game.name, { backupPath: globalBackupPath });
        }

        return result;
    });

    // ── Delete game ───────────────────────────────────────────────────────────
    ipcMain.handle('db:deleteGame', async (_e, id) => {
        console.log(`[DB] Deleting game ID: ${id}`);
        try {
            const game = db.getGames().find(g => String(g.id) === String(id));
            if (game) {
                const gameDir = path.join(ASSETS_DIR, slugifyName(game.name));
                if (fs.existsSync(gameDir)) {
                    fs.rmSync(gameDir, { recursive: true, force: true });
                    console.log(`[DB] Deleted assets: /${slugifyName(game.name)}/`);
                }
            }
        } catch (err) {
            console.error('[DB] Asset deletion error:', err.message);
        }
        return db.deleteGame(id);
    });

    // ── Update game ───────────────────────────────────────────────────────────
    ipcMain.handle('db:updateGame', async (_e, game) => {
        console.log(`\n[DB] Updating: "${game?.name}"`);

        if (!game || !game.name || typeof game.name !== 'string') {
            console.error('[DB] ❌ db:updateGame: missing game.name — aborting');
            return false;
        }

        const oldGame = db.getGames().find(g => String(g.id) === String(game.id));

        // ... (كود الـ rename كما هو) ...

        // التحقق من وجود روابط remote (تحميل جديد)
        const hasRemote = game.assets && (
            (game.assets.poster && game.assets.poster.startsWith('http')) ||
            (game.assets.background && game.assets.background.startsWith('http')) ||
            (game.assets.logo && game.assets.logo.startsWith('http')) ||
            (game.assets.icon && game.assets.icon.startsWith('http'))
        );

        if (hasRemote) {
            const gameDir = path.join(ASSETS_DIR, slugifyName(game.name));
            if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

            const [poster, background, logo, icon] = await Promise.all([
                downloadAsset(game.assets.poster || '', gameDir, 'poster'),
                downloadAsset(game.assets.background || '', gameDir, 'background'),
                downloadAsset(game.assets.logo || '', gameDir, 'logo'),
                downloadAsset(game.assets.icon || '', gameDir, 'icon'), // تأكد من وجود الأيقونة هنا
            ]);
            game.assets = { poster, background, logo, icon };
        } else {
            // ✅ إذا لم يكن هناك تحميل جديد، تأكد أننا لا نمسح الأيقونة القديمة الموجودة في oldGame
            if (oldGame && oldGame.assets && !game.assets.icon) {
                game.assets.icon = oldGame.assets.icon;
            }
        }

        const result = db.updateGame(game);
        console.log(`[DB] ${result ? 'SUCCESS' : 'FAILED'}\n`);
        return result;
    });

    // ── Playtime ──────────────────────────────────────────────────────────────
    ipcMain.handle('db:getPlaytime', (_e, gameName) =>
        playtimeDB.getPlaytime(gameName)
    );
    ipcMain.handle('db:addPlaytime', (_e, gameName, minutes, totalSeconds) =>
        playtimeDB.addPlaytime(gameName, minutes, totalSeconds || 0)
    );
}

module.exports = { registerDatabaseIPC };