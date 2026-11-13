const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const db = require('../../modules/database');
const backups = require('../../modules/backup');
const playtimeDB = require('../../modules/playtime');

const { readSettings, ASSETS_DIR, USER_DATA } = require('../../modules/app-settings');
const { createStore, mergeArchivedGame } = require('../../modules/game-archive');
const gameArchive = createStore(USER_DATA);
const { KINDS, importManualArtworkSet, discardImportedArtwork } = require('../../modules/manual-artwork');
const { slugifyName, downloadAsset,
    renameAssetsFolder, updateAssetPaths } = require('../../modules/assets');

function registerDatabaseIPC() {

    // ── Get all games ─────────────────────────────────────────────────────────
    ipcMain.handle('db:getGames', () => db.getGames());

    // ── Save new game ─────────────────────────────────────────────────────────
    ipcMain.handle('db:saveGame', async (_e, game) => {
        if (!game || typeof game.name !== 'string' || !game.name.trim() || !game.path) return false;
        console.log(`[DB] Adding: "${game.name}"`);
        let archived;
        try {
            archived = gameArchive.find(game);
        } catch (err) {
            console.error('[DB] Archive lookup failed; refusing an unsafe re-add:', err.message);
            return false;
        }
        const { manualAssets = {}, ...payload } = game;
        const imported = await importManualArtworkSet(game.name, manualAssets);
        const candidate = archived
            ? mergeArchivedGame(archived.game, payload, imported.assets)
            : { ...payload, assets: { ...(payload.assets || {}), ...imported.assets } };
        const result = db.saveGame(candidate);
        if (!result) {
            await discardImportedArtwork(imported.createdFiles);
            return false;
        }
        if (archived) {
            try {
                gameArchive.consume(archived);
                console.log(`[DB] Restored archived artwork and metadata: "${game.name}"`);
            } catch (err) {
                console.warn('[DB] Saved game, but could not clear archive entry:', err.message);
            }
        }

        const settings = readSettings();
        const globalBackupPath = settings.globalBackupPath || '';
        const discoveredPath = backups.autoDiscoverSavePath(game.name, game.path || null, true);

        if (archived) {
            // Re-adding a game must not clear its existing save/backup configuration.
            console.log(`[DB] Preserving existing backup configuration for re-added "${game.name}"`);
        } else if (!discoveredPath) {
            backups.updateBackupConfig(game.name, { originPath: '', backupPath: globalBackupPath });
            console.log(`[DB] No save path for "${game.name}" — empty entry created`);
        } else if (globalBackupPath) {
            backups.updateBackupConfig(game.name, { backupPath: globalBackupPath });
        }

        return result;
    });

    // ── Delete game ───────────────────────────────────────────────────────────
    ipcMain.handle('db:deleteGame', async (_e, id) => {
        console.log(`[DB] Removing game ID: ${id}`);
        const game = db.getGames().find(g => String(g.id) === String(id));
        if (!game) return false;
        try {
            // Commit the recovery snapshot before removing the live library entry.
            gameArchive.archive(game);
            const removed = db.deleteGame(id);
            if (removed) console.log(`[DB] Removed from library; cached assets retained: "${game.name}"`);
            return removed;
        } catch (err) {
            console.error('[DB] Safe removal blocked:', err.message);
            return false;
        }
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
        // Per-kind merge: an empty or failed field never erases other artwork.
        const currentAssets = { ...(oldGame?.assets || {}), ...(game.assets || {}) };
        const gameDir = path.join(ASSETS_DIR, slugifyName(game.name));
        let imported = { assets: {}, createdFiles: [] };
        try {
            for (const kind of KINDS) {
                const value = currentAssets[kind];
                if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
                fs.mkdirSync(gameDir, { recursive: true });
                const local = await downloadAsset(value, gameDir, kind);
                if (local) currentAssets[kind] = local;
                else currentAssets[kind] = oldGame?.assets?.[kind] || ''; // Invalid remote artwork is never persisted.
            }
            imported = await importManualArtworkSet(game.name, game.manualAssets || {});
            game = { ...game, assets: { ...currentAssets, ...imported.assets } };
            delete game.manualAssets;
        } catch (err) {
            console.error('[ManualArtwork] Update rejected:', err);
            return false;
        }


        const result = db.updateGame(game);
        if (!result) await discardImportedArtwork(imported.createdFiles);
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

    ipcMain.handle('db:getPlaytimeInfo', (_e, gameName) => {
        return playtimeDB.getPlaytimeInfo(gameName);
    });
}

module.exports = { registerDatabaseIPC };