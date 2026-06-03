const { ipcMain, app, shell } = require('electron');
const fs = require('fs');                 // sync methods
const fsPromises = require('fs').promises; // async methods
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const rawg = require('../../modules/rawg-api');
const steam = require('../../modules/steam-api');
const steamGrid = require('../../modules/steamGrid-api');
const youtube = require('../../modules/youtube-api');
const playtime = require('../../modules/playtime');
const db = require('../../modules/database');
const sessions = require('../../modules/playSessions');

const { mergeMetadata } = require('../../modules/metadata');
const { ASSETS_DIR } = require('../../modules/app-settings');
const { slugifyName, downloadAsset, downloadGameAssets } = require('../../modules/assets');
const updater = require('../../modules/updater');

function registerApiIPC() {

    // ── Quick poster fetch ────────────────────────────────────────────────────
    ipcMain.handle('api:fetchGameInfo', async (_e, name) => {
        try {
            console.log('\n[API] Fetch poster for:', name);
            const sgAssets = await steamGrid.fetchGameAssets(name);
            return { name, poster: sgAssets?.poster || '' };
        } catch (err) {
            console.error('[API] Poster fetch error:', err.message);
            return { name, poster: '' };
        }
    });

    // ── Full game details ─────────────────────────────────────────────────────
    ipcMain.handle('api:fetchGameDetails', async (_e, name) => {
        if (!name || typeof name !== 'string' || name.trim() === '') {
            console.error('[API] fetchGameDetails: invalid name — aborting');
            return null;
        }

        console.log('\n==============================');
        console.log(`Fetching: "${name}" → /${slugifyName(name)}/`);

        // ── Step 1: RAWG ───────────────────────────────────────────────
        const rawgData = await rawg.fetchGameDetails(name).catch(err => {
            console.warn('[RAWG] Failed:', err.message);
            return null;
        });

        console.log('RAWG  found:', rawgData
            ? `"${rawgData.name}"  metacritic:${rawgData.metacritic}`
            : 'NO'
        );

        // ── Step 2: Steam AppID ───────────────────────────────────────────────
        let resolvedAppId = null;

        if (rawgData?.steamAppId) {
            resolvedAppId = rawgData.steamAppId;
            console.log(`[API] AppID from RAWG: ${resolvedAppId}`);
        } else {
            console.log(`[API] RAWG has no AppID — searching Steam directly for: "${name}"`);
            resolvedAppId = await steam.searchAppId(name).catch(() => null);
        }

        // ── Step 3: Steam + SteamGrid ─────────────────────────────────────────
        let steamData = null;
        let sgAssets = null;

        if (resolvedAppId) {
            [steamData, sgAssets] = await Promise.all([
                steam.fetchGameDetails(resolvedAppId).catch(() => null),
                steamGrid.fetchGameAssets(name, resolvedAppId).catch(() => null),
            ]);
        } else {
            console.log(`[API] No AppID found — fetching SteamGrid by name only`);
            sgAssets = await steamGrid.fetchGameAssets(name).catch(() => null);
        }

        console.log('Steam found:', steamData
            ? `"${steamData.name}" AppID:${steamData.appid}`
            : 'NO'
        );

        // ── Step 4: RAWG fallback Steam AppID ─────────────────────────────
        let rawgExtraData = null;
        if (!rawgData && resolvedAppId) {
            console.log(`[API] Trying RAWG lookup via Steam AppID: ${resolvedAppId}`);
            rawgExtraData = await rawg.fetchGameDetailsBySteamId(resolvedAppId).catch(() => null);
            if (rawgExtraData) {
                console.log(`[API] RAWG extra → metacritic:${rawgExtraData.metacritic} | genres:${rawgExtraData.genres}`);
            } else {
                console.log(`[API] RAWG AppID lookup also returned nothing`);
            }
        }

        // ── Step 5: Trailer ───────────────────────────────────────────────────
        let trailerYouTubeId = rawgData?.media?.trailerYouTubeId || null;
        let trailerThumbnail = rawgData?.media?.trailerThumbnail || null;

        if (!trailerYouTubeId) {
            console.log(`[YouTube] Searching: "${name}"`);
            const ytData = await youtube.getTrailerData(name).catch(() => null);
            if (ytData) {
                trailerYouTubeId = ytData.videoId;
                trailerThumbnail = ytData.thumbnail;
            }
        }

        // ── Step 6: all source failed──────────────────────────────────────────
        if (!rawgData && !rawgExtraData && !steamData && !sgAssets) {
            console.warn('[API] All sources failed for:', name);
            return {
                assets: { poster: '', background: '', logo: '', icon: null },
                metadata: {
                    name,
                    description: '', developer: '', publisher: '', releaseDate: '',
                    systemRequirements: { minimum: '', recommended: '' },
                    metacritic: '', genres: '', tags: '',
                    media: {
                        screenshots: [],
                        trailerYouTubeId,
                        trailerThumbnail,
                        trailerSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' official trailer')}`,
                    },
                },
            };
        }

        // ── Step 7: Merge ─────────────────────────────────────────────────────
        const resolvedName = rawgData?.name || steamData?.name || name;

        const effectiveRawgData = rawgData || (rawgExtraData ? {
            name: resolvedName,
            steamAppId: resolvedAppId,
            description: rawgExtraData.description || '',
            developer: '',
            publisher: '',
            releaseDate: '',
            metacritic: rawgExtraData.metacritic || '',
            genres: rawgExtraData.genres || '',
            tags: rawgExtraData.tags || '',
            systemRequirements: rawgExtraData.systemRequirements || { minimum: '', recommended: '' },
            poster: '',
            background: '',
            media: {
                screenshots: [],
                trailerYouTubeId: null,
                trailerThumbnail: null,
                trailerSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' official trailer')}`,
            },
        } : null);

        const { metadata: rawMetadata, rawAssets } = mergeMetadata({
            name: resolvedName,
            rawgData: effectiveRawgData,
            steamData,
            sgAssets,
            trailerYouTubeId,
            trailerThumbnail,
        });

        rawMetadata.name = name;

        console.log(`[API] metacritic:${rawMetadata.metacritic} | genres:${rawMetadata.genres} | tags:${rawMetadata.tags?.slice(0, 40)}`);

        // ── Step 8: Download assets locally ──────────────────────────────────
        const { assets: localAssets, media: localMedia } = await downloadGameAssets(
            name, rawAssets, rawMetadata
        );

        console.log('==============================\n');

        return {
            assets: localAssets,
            metadata: { ...rawMetadata, media: localMedia },
        };
    });

    // ── Save game details ─────────────────────────────────────────────────────
    ipcMain.handle('save-game-details', async (_e, id, details) => {
        console.log(`[API] save-game-details for id: ${id}`);

        const existingGame = db.getGames().find(g => String(g.id) === String(id));
        const gameName = details?.name || existingGame?.name || '';

        if (!gameName) {
            console.error('[API] save-game-details: cannot resolve game name for id:', id);
            return false;
        }

        if (details?.assets) {
            const hasRemote =
                details.assets.poster?.startsWith('http') ||
                details.assets.background?.startsWith('http') ||
                details.assets.logo?.startsWith('http') ||
                details.assets.icon?.startsWith('http');

            if (hasRemote) {
                const gameDir = path.join(ASSETS_DIR, slugifyName(gameName));
                if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

                const [poster, background, logo, icon] = await Promise.all([
                    downloadAsset(details.assets.poster || '', gameDir, 'poster'),
                    downloadAsset(details.assets.background || '', gameDir, 'background'),
                    downloadAsset(details.assets.logo || '', gameDir, 'logo'),
                    downloadAsset(details.assets.icon || '', gameDir, 'icon'),
                ]);
                details.assets = {
                    poster: poster || '',
                    background: background || '',
                    logo: logo || '',
                    icon: icon || '',
                };
            }
        }

        if (!details?.assets?.icon && existingGame?.assets?.icon) {
            if (!details.assets) details.assets = {};
            details.assets.icon = existingGame.assets.icon;
        }

        return db.updateGame({ id, name: gameName, ...details });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 🆕 ORDER HANDLERS (drag & drop reordering)
    // ─────────────────────────────────────────────────────────────────────────
    const orderPath = path.join(app.getPath('userData'), 'order.json');
    const favOrderPath = path.join(app.getPath('userData'), 'order-favorites.json');

    ipcMain.handle('db:getGameOrder', () => {
        try {
            if (fs.existsSync(orderPath)) {
                return JSON.parse(fs.readFileSync(orderPath, 'utf-8'));
            }
        } catch (err) {
            console.error('[Order] Failed to read order.json:', err);
        }
        return [];
    });

    ipcMain.handle('db:saveGameOrder', (_, order) => {
        try {
            fs.writeFileSync(orderPath, JSON.stringify(order, null, 2));
            return true;
        } catch (err) {
            console.error('[Order] Failed to save order.json:', err);
            return false;
        }
    });

    ipcMain.handle('db:getFavoritesOrder', () => {
        try {
            if (fs.existsSync(favOrderPath)) {
                return JSON.parse(fs.readFileSync(favOrderPath, 'utf-8'));
            }
        } catch (err) {
            console.error('[Order] Failed to read favorites order:', err);
        }
        return [];
    });

    ipcMain.handle('db:saveFavoritesOrder', (_, order) => {
        try {
            fs.writeFileSync(favOrderPath, JSON.stringify(order, null, 2));
            return true;
        } catch (err) {
            console.error('[Order] Failed to save favorites order:', err);
            return false;
        }
    });

    // ── Check For Updates ─────────────────────────────────────────────────────
    ipcMain.handle('app:checkForUpdates', async () => {
        console.log('[API] Checking for updates from GitHub...');
        return await updater.checkGitHubReleases();
    });

    // Download the update to temp folder
    ipcMain.handle('app:downloadUpdate', async (event, url, filename) => {
        const destPath = path.join(os.tmpdir(), filename);
        try {
            await updater.defaultUpdater.downloadAsset(url, destPath, (progress) => {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('update:progress', progress);
                }
            });
            return { success: true, path: destPath };
        } catch (err) {
            console.error('[UPDATER] Download failed:', err);
            return { success: false, error: err.message };
        }
    });

    // Execute the NSIS installer and quit
    ipcMain.on('app:installUpdate', async (event, filePath) => {
        console.log('[UPDATER] Launching installer:', filePath);
        const error = await shell.openPath(filePath);
        if (error) {
            console.error('[UPDATER] Failed to open installer:', error);
        } else {
            app.quit();
        }
    });

    // Cancel the ongoing download
    ipcMain.on('app:cancelDownload', () => {
        console.log('[UPDATER] Download cancelled by user.');
        updater.defaultUpdater.cancelDownload();
    });

    ipcMain.handle('get-all-playtime', () => {
        return playtime.getAllPlaytimeData();
    });

    ipcMain.handle('clear-last-played', (_, gameName) => {
        return playtime.clearLastPlayed(gameName);
    });

    ipcMain.handle('get-game-stats', (_, gameName, periodDays) => {
        return sessions.getGameStats(gameName, periodDays);
    });

    ipcMain.handle('get-overall-stats', (_, periodDays) => {
        return sessions.getOverallStats(periodDays);
    });

    ipcMain.handle('get-daily-stats', (_, gameName, periodDays) => {
        return sessions.getDailyStats(gameName, periodDays);
    });

    ipcMain.handle('get-game-names-with-sessions', () => {
        return sessions.getGameNamesWithSessions();
    });

    ipcMain.handle('get-game-list', () => {
        const allGames = db.getGames();
        const gameNames = sessions.getGameNamesWithSessions();
        return allGames.filter(g => gameNames.includes(g.name));
    });

    ipcMain.handle('get-all-sessions', () => {
        return sessions.getAllSessions();
    });

    ipcMain.handle('get-longest-session', (_, gameName) => {
        return sessions.getLongestSession(gameName);
    });

    ipcMain.handle('get-shortest-session', (_, gameName) => {
        return sessions.getShortestSession(gameName);
    });

    ipcMain.handle('get-playtime-by-weekday', () => {
        return sessions.getPlaytimeByWeekday();
    });

    ipcMain.handle('get-playtime-by-hour', () => {
        return sessions.getPlaytimeByHour();
    });

    ipcMain.handle('get-longest-streak', () => {
        return sessions.getLongestStreak();
    });

    ipcMain.handle('get-top-games', (_, limit, periodDays) => {
        return sessions.getTopGames(limit, periodDays);
    });

    ipcMain.handle('get-unique-games-count', () => {
        return sessions.getUniqueGamesCount();
    });

    ipcMain.handle('get-first-played-date', () => {
        return sessions.getFirstPlayedDate();
    });

    ipcMain.handle('get-monthly-playtime', (_, months) => {
        return sessions.getMonthlyPlaytime(months);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Folder info handler (size, file count, etc.)
    // ─────────────────────────────────────────────────────────────────────────
    async function getFolderInfo(folderPath) {
        if (!folderPath || !fs.existsSync(folderPath)) return null;
        try {
            let totalSize = 0;
            let fileCount = 0;
            let folderCount = 0;

            async function walk(dir) {
                const entries = await fsPromises.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        folderCount++;
                        await walk(fullPath);
                    } else {
                        fileCount++;
                        const stat = await fsPromises.stat(fullPath);
                        totalSize += stat.size;
                    }
                }
            }
            await walk(folderPath);

            const stats = await fsPromises.stat(folderPath);
            const created = stats.birthtime || stats.ctime;

            return {
                folderName: path.basename(folderPath),
                type: 'File folder',
                location: folderPath,
                sizeBytes: totalSize,
                sizeOnDiskBytes: totalSize,
                contains: `${fileCount} files, ${folderCount} folders`,
                created: created.toLocaleString()
            };
        } catch (err) {
            console.error('[FolderInfo] Error:', err);
            return null;
        }
    }

    ipcMain.handle('get-folder-info', async (_, folderPath) => {
        return await getFolderInfo(folderPath);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Backup all user data (ZIP)
    // ─────────────────────────────────────────────────────────────────────────
    ipcMain.handle('backup-user-data', async (event, savePath) => {
        const userDataPath = app.getPath('userData');
        const tempDir = path.join(os.tmpdir(), `nexus_backup_${Date.now()}`);

        function copyRecursive(src, dest) {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                if (entry.isDirectory()) {
                    copyRecursive(srcPath, destPath);
                } else {
                    try {
                        fs.copyFileSync(srcPath, destPath);
                    } catch (err) {
                        console.warn(`[Backup] Skipping locked file: ${srcPath}`, err.message);
                    }
                }
            }
        }

        try {
            copyRecursive(userDataPath, tempDir);
            const zip = new AdmZip();
            zip.addLocalFolder(tempDir);
            zip.writeZip(savePath);
            fs.rmSync(tempDir, { recursive: true, force: true });
            return { success: true, path: savePath };
        } catch (err) {
            if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
            throw err;
        }
    });

    ipcMain.handle('scan-for-games', async (_, folderPath) => {
        const fs = require('fs').promises;
        const path = require('path');
        const existingGames = db.getGames();
        const existingPaths = new Set(existingGames.map(g => path.normalize(g.path).toLowerCase()));

        const games = [];

        async function scanImmediateSubfolders(dir) {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subDir = path.join(dir, entry.name);
                        const gameFolderName = entry.name;

                        // Look for an executable inside the folder (first .exe or .bat)
                        let foundExecutable = null;
                        try {
                            const subEntries = await fs.readdir(subDir);
                            for (const file of subEntries) {
                                const ext = path.extname(file).toLowerCase();
                                if (ext === '.exe' || ext === '.bat') {
                                    foundExecutable = path.join(subDir, file);
                                    break;
                                }
                            }
                        } catch (err) {
                            console.warn(`[Scan] Error reading ${subDir}:`, err.message);
                        }

                        const normalizedPath = foundExecutable ? path.normalize(foundExecutable).toLowerCase() : null;
                        const alreadyExists = normalizedPath && existingPaths.has(normalizedPath);

                        if (!alreadyExists) {
                            games.push({
                                folderPath: subDir,
                                suggestedName: gameFolderName,
                                executablePath: foundExecutable || null // may be null if no exe/bat found
                            });
                        }
                    }
                }
            } catch (err) {
                console.error('[Scan] Error reading folder:', err);
            }
        }

        await scanImmediateSubfolders(folderPath);
        return games;
    });

    // Inside registerApiIPC() – add these handlers

    let activeWatcher = null;
    let processedFolders = new Set();

    ipcMain.handle('start-folder-watcher', async (_, folderPath) => {
        if (activeWatcher) {
            activeWatcher.close();
            activeWatcher = null;
        }
        if (!folderPath || !require('fs').existsSync(folderPath)) return false;

        // Initialize processed folders with existing ones
        processedFolders.clear();
        const fs = require('fs').promises;
        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                processedFolders.add(entry.name);
            }
        }

        activeWatcher = require('fs').watch(folderPath, { persistent: true }, async (eventType, filename) => {
            if (eventType === 'rename' && filename) {
                // Check if it's a new directory (not a file and not already processed)
                const fullPath = require('path').join(folderPath, filename);
                try {
                    const stat = await fs.stat(fullPath);
                    if (stat.isDirectory() && !processedFolders.has(filename)) {
                        processedFolders.add(filename);
                        // Send to all windows
                        const windows = require('electron').BrowserWindow.getAllWindows();
                        windows.forEach(win => {
                            win.webContents.send('folder-created', { folderPath: fullPath, folderName: filename });
                        });
                    }
                } catch (err) {
                    console.error('[Watcher] Error checking new folder:', err);
                }
            }
        });
        return true;
    });

    ipcMain.handle('stop-folder-watcher', () => {
        if (activeWatcher) {
            activeWatcher.close();
            activeWatcher = null;
        }
        processedFolders.clear();
        return true;
    });

    ipcMain.handle('get-immediate-subfolders', async (_, folderPath) => {
        const fs = require('fs').promises;
        const path = require('path');
        try {
            const entries = await fs.readdir(folderPath, { withFileTypes: true });
            const subfolders = [];
            for (const entry of entries) {
                if (entry.isDirectory()) {
                    subfolders.push(path.join(folderPath, entry.name));
                }
            }
            return subfolders;
        } catch (err) {
            console.error('[Subfolders] Error:', err);
            return [];
        }
    });

    ipcMain.handle('game-exists-in-folder', async (_, folderPath) => {
        const existingGames = db.getGames();
        for (const game of existingGames) {
            const gameFolder = path.dirname(game.path);
            if (path.normalize(gameFolder).toLowerCase() === path.normalize(folderPath).toLowerCase()) {
                return true;
            }
        }
        return false;
    });
}

module.exports = { registerApiIPC };