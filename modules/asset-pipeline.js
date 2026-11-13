'use strict';

// Shared orchestration for both quick artwork and full game-details IPC paths.
const rawgApi = require('./rawg-api');
const steamApi = require('./steam-api');
const steamGridApi = require('./steamGrid-api');
const steamArtworkApi = require('./steam-artwork');
const youtubeApi = require('./youtube-api');
const { mergeMetadata } = require('./metadata');
const { downloadGameAssets } = require('./assets');
const { titleScore } = require('./asset-resolver');
const { resolveTitleIdentity } = require('./asset-title-aliases');

function safeProvider(promise, label) {
    return Promise.resolve(promise).catch(error => {
        console.warn(`[AssetPipeline] ${label}: ${error.message}`);
        return null;
    });
}

async function collectMetadata(name, options = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Game name is required');
    const gameName = name.trim();
    const identity = resolveTitleIdentity(gameName);
    const lookupName = identity.searchName;
    const providers = options.providers || {
        rawg: rawgApi, steam: steamApi, grid: steamGridApi,
        library: steamArtworkApi, youtube: youtubeApi,
    };
    const rawg = await safeProvider(providers.rawg.fetchGameDetails(lookupName), 'RAWG');
    const oldId = String(options.steamAppId || '');
    let steamAppId = /^\d{1,12}$/.test(oldId) ? oldId : identity.steamAppId;
    if (!steamAppId) {
        const id = String(rawg?.steamAppId || '');
        if (/^\d{1,12}$/.test(id)) steamAppId = id;
    }
    if (!steamAppId) steamAppId = await safeProvider(providers.steam.searchAppId(lookupName), 'Steam lookup');

    let steam = null;
    let steamLibrary = null;
    let grid = null;
    if (steamAppId) {
        const fetched = await Promise.all([
            safeProvider(providers.steam.fetchGameDetails(steamAppId), 'Steam details'),
            safeProvider(providers.grid.fetchGameAssets(lookupName, steamAppId), 'SteamGridDB'),
            safeProvider(providers.library.fetchSteamArtwork(steamAppId), 'Steam library'),
        ]);
        [steam, grid, steamLibrary] = fetched;
        // An incorrect external AppID must never attach another game's artwork.
        if (steam?.name && titleScore(lookupName, steam.name) < 0.85) {
            console.warn(`[AssetPipeline] Rejecting mismatched Steam AppID for "${gameName}"`);
            const initialId = steamAppId;
            // RAWG may return a wrong AppID. Verify a fresh Steam title lookup
            // before falling back to the conservative name-only provider.
            const replacementId = await safeProvider(providers.steam.searchAppId(lookupName), 'Steam re-lookup');
            let verified = false;
            if (replacementId && String(replacementId) !== String(initialId)) {
                const replacement = await safeProvider(providers.steam.fetchGameDetails(replacementId), 'Steam recheck');
                if (replacement?.name && titleScore(lookupName, replacement.name) >= 0.85) {
                    steamAppId = String(replacementId);
                    steam = replacement;
                    [grid, steamLibrary] = await Promise.all([
                        safeProvider(providers.grid.fetchGameAssets(lookupName, steamAppId), 'SteamGridDB retry'),
                        safeProvider(providers.library.fetchSteamArtwork(steamAppId), 'Steam Library retry'),
                    ]);
                    verified = true;
                }
            }
            if (!verified) {
                steamAppId = null; steam = null; steamLibrary = null;
                grid = await safeProvider(providers.grid.fetchGameAssets(lookupName), 'SteamGridDB by name');
            }
        }
    } else {
        grid = await safeProvider(providers.grid.fetchGameAssets(lookupName), 'SteamGridDB by name');
    }

    let trailerYouTubeId = rawg?.media?.trailerYouTubeId || '';
    let trailerThumbnail = rawg?.media?.trailerThumbnail || '';
    if (!trailerYouTubeId && options.includeMedia !== false) {
        const video = await safeProvider(providers.youtube.getTrailerData(lookupName), 'YouTube');
        trailerYouTubeId = video?.videoId || '';
        trailerThumbnail = video?.thumbnail || '';
    }

    const result = mergeMetadata({
        name: gameName, rawgData: rawg, steamData: steam,
        sgAssets: grid, steamArtwork: steamLibrary,
        trailerYouTubeId, trailerThumbnail,
    });
    if (steamAppId) result.metadata.steamAppId = steamAppId;
    // Preserve RAWG metadata when no provider has any artwork.
    return result;
}

async function fetchGameDetails(gameName, options = {}) {
    const { metadata, rawAssets } = await collectMetadata(gameName, options);
    const downloader = options.downloader || downloadGameAssets;
    const local = await downloader(gameName, rawAssets, metadata, {
        existingAssets: options.existingAssets || {},
        http: options.http, decode: options.decode,
        force: options.force === true, includeMedia: options.includeMedia,
        requestedKinds: options.requestedKinds,
    });
    return {
        assets: local.assets,
        metadata: {
            ...metadata,
            media: local.media,
            artworkResolution: local.artworkResolution,
        },
    };
}

module.exports = { safeProvider, collectMetadata, fetchGameDetails };
