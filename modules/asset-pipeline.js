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
const { KINDS } = require('./asset-resolver');
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
    let source = steamAppId ? (/^\d{1,12}$/.test(oldId) ? 'saved-identity' : 'reviewed-alias') : null;
    if (!steamAppId) {
        const id = String(rawg?.steamAppId || '');
        if (/^\d{1,12}$/.test(id)) { steamAppId = id; source = 'rawg-suggestion'; }
    }
    if (!steamAppId) {
        steamAppId = await safeProvider(providers.steam.searchAppId(lookupName), 'Steam lookup');
        if (steamAppId) source = 'steam-exact-search';
    }

    let steam = null;
    let steamLibrary = null;
    let grid = null;
    let verified = false;
    const requestedKinds = Array.isArray(options.requestedKinds)
        ? KINDS.filter(kind => options.requestedKinds.includes(kind)) : KINDS;

    if (steamAppId) {
        steam = await safeProvider(providers.steam.fetchGameDetails(steamAppId), 'Steam details');
        if (steam?.name && titleScore(lookupName, steam.name) >= 0.85) {
            verified = true;
        } else if (steam?.name) {
            console.warn(`[AssetPipeline] Rejecting mismatched Steam AppID for "${gameName}"`);
            const old = String(steamAppId);
            const found = await safeProvider(providers.steam.searchAppId(lookupName), 'Steam re-lookup');
            if (found && String(found) !== old) {
                const replacement = await safeProvider(providers.steam.fetchGameDetails(found), 'Steam recheck');
                if (replacement?.name && titleScore(lookupName, replacement.name) >= 0.85) {
                    steamAppId = String(found);
                    steam = replacement;
                    source = 'steam-exact-search';
                    verified = true;
                }
            }
            if (!verified) { steamAppId = null; steam = null; }
        } else if (source === 'reviewed-alias' || source === 'steam-exact-search' ||
            (source === 'saved-identity' && options.trustedSteamAppId === true)) {
            // Steam's conservative title search and a reviewed explicit alias
            // are acceptable identities if optional Store Details is offline.
            verified = true;
        } else {
            // An unchecked AppID from external metadata must not attach art.
            const found = await safeProvider(providers.steam.searchAppId(lookupName), 'Steam identity verification');
            if (found && String(found) === String(steamAppId)) {
                source = 'steam-exact-search';
                verified = true;
            } else {
                console.warn(`[AssetPipeline] Withholding unverified Steam AppID for "${gameName}"`);
                steamAppId = null;
            }
        }
    }

    if (verified && steamAppId) {
        [grid, steamLibrary] = await Promise.all([
            safeProvider(providers.grid.fetchGameAssets(lookupName, steamAppId, { kinds: requestedKinds }), 'SteamGridDB'),
            safeProvider(providers.library.fetchSteamArtwork(steamAppId), 'Steam library'),
        ]);
    } else {
        grid = await safeProvider(providers.grid.fetchGameAssets(lookupName, undefined,
            { kinds: requestedKinds }), 'SteamGridDB by name');
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
    // Never persist RAWG's unchecked AppID after it failed Steam verification.
    result.metadata.steamAppId = verified && steamAppId ? String(steamAppId) : null;
    result.metadata.artworkIdentity = {
        verified: Boolean(verified && steamAppId),
        source: verified ? source : null,
        reason: verified ? 'verified_store_identity' : 'no_verified_steam_identity',
    };
    return result;
}

async function fetchGameDetails(gameName, options = {}) {
    // The library's quick-poster lookup must not fetch RAWG, SteamGridDB, Steam,
    // and YouTube again when the existing poster is valid on disk.
    if (options.includeMedia === false && Array.isArray(options.requestedKinds) &&
        options.requestedKinds.length && options.force !== true) {
        const { fromLocalUrl, validateFile } = require('./asset-downloader');
        const ready = await Promise.all(options.requestedKinds.map(async kind => {
            if (!KINDS.includes(kind)) return false;
            const file = fromLocalUrl(options.existingAssets?.[kind]);
            return !!file && validateFile(file, kind, options);
        }));
        if (ready.every(Boolean)) {
            return { assets: { ...options.existingAssets }, metadata: { artworkResolution: {
                version: 2, checkedAt: new Date().toISOString(), kinds: {},
                reason: 'already_cached_no_network',
            } } };
        }
    }

    const { metadata, rawAssets } = await collectMetadata(gameName, options);
    const downloader = options.downloader || downloadGameAssets;
    const local = await downloader(gameName, rawAssets, metadata, {
        existingAssets: options.existingAssets || {},
        http: options.http, decode: options.decode,
        force: options.force === true, includeMedia: options.includeMedia,
        requestedKinds: options.requestedKinds,
        steamCache: options.steamCache,
    });
    // NEXUS_STEAM_PICS_V040: opt-in, logo-only, after all existing providers fail.
    // NEXUS_STEAM_PICS_V060: per-game allowlist from an explicit Settings toggle.
    const picsRuntimeEnv = (() => {
        if (options.picsEnv) return options.picsEnv;
        if (local.assets?.logo || (options.requestedKinds && !options.requestedKinds.includes('logo')))
            return process.env;
        try {
            return require('./steam-pics-production').getRuntimeEnv(options, metadata);
        } catch {
            return process.env;
        }
    })();
    if (picsRuntimeEnv.NEXUS_PICS_EXPERIMENT === '1' &&
        (!options.requestedKinds || options.requestedKinds.includes('logo')) &&
        !local.assets?.logo) {
        try {
            const { getPicsFallbackLogo, picsStrictHttp } = require('./steam-pics-opt-in');
            const { isManualResource } = require('./asset-resolver');
            // NEXUS_STEAM_PICS_V042: recover a locally saved AppID after a Steam API timeout.
            // The PICS provider STILL requires independent same-AppID game identity proof.
            const savedAppId = String(options.steamAppId || '');
            const metadataAppId = String(metadata?.steamAppId || '');
            const conflictingAppId = !!(savedAppId && metadataAppId && savedAppId !== metadataAppId);
            const probeMetadata = {
                ...metadata,
                steamAppId: conflictingAppId ? '' : (metadataAppId || savedAppId),
            };
            const pilot = await getPicsFallbackLogo(gameName, probeMetadata, {
                env: picsRuntimeEnv,
                manualLogo: isManualResource(options.existingAssets?.logo),
                firstPassLogo: local.assets?.logo,
                probe: options.picsProbe,
                verify: options.picsVerify,
            });
            if (!pilot.candidates.length) {
                const reason = conflictingAppId ? 'appid_conflict' : pilot.status;
                console.log('[AssetPipeline] Opt-in Steam PICS logo skipped: ' + reason);
            }
            if (pilot.candidates.length) {
                const extra = await downloader(gameName, { logo: pilot.candidates }, metadata, {
                    existingAssets: options.existingAssets || {},
                    http: options.picsHttp || picsStrictHttp(), decode: options.decode,
                    force: false, includeMedia: false, requestedKinds: ['logo'],
                });
                if (extra?.assets?.logo) {
                    local.assets.logo = extra.assets.logo;
                    if (local.artworkResolution?.kinds && extra.artworkResolution?.kinds?.logo)
                        local.artworkResolution.kinds.logo = extra.artworkResolution.kinds.logo;
                    console.log('[AssetPipeline] Opt-in Steam PICS logo applied for verified AppID');
                } else {
                    console.warn('[AssetPipeline] Opt-in Steam PICS logo candidate verified but not downloaded');
                }
            }
        } catch {
            console.warn('[AssetPipeline] Opt-in Steam PICS logo unavailable; previous sources preserved');
        }
    }
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
