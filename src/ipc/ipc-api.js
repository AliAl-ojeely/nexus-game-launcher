const { ipcMain, app } = require('electron');
const fs = require('fs');
const path = require('path');

const rawg = require('../../modules/rawg-api');
const steam = require('../../modules/steam-api');
const steamGrid = require('../../modules/steamGrid-api');
const youtube = require('../../modules/youtube-api');
const db = require('../../modules/database');

const { mergeMetadata } = require('../../modules/metadata');
const { ASSETS_DIR } = require('../../modules/app-settings');
const { slugifyName, downloadAsset, downloadGameAssets } = require('../../modules/assets');

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

        // ── Step 1: RAWG بالاسم ───────────────────────────────────────────────
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

        // ── Step 4: RAWG fallback عبر Steam AppID ─────────────────────────────
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

        // ── Step 6: كل المصادر فشلت ──────────────────────────────────────────
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
    const orderPath = path.join(require('electron').app.getPath('userData'), 'order.json');
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
}

module.exports = { registerApiIPC };