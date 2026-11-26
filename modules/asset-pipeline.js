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
const { lookupTitle, providerStatus } = require('./asset-search-identity-v063.cjs');
const { editionEvidence } = require('./asset-edition-v064.cjs');
const { validHttpUrl } = require('./asset-resolver');

function storeYear(value) {
    const match = /\b((?:19|20)\d{2})\b/.exec(String(value || ''));
    return match ? Number(match[1]) : null;
}

function rawgBackground(url) {
    return validHttpUrl(url) && new URL(url).hostname.toLowerCase() === 'media.rawg.io';
}

function safeProvider(promise, label) {
    return Promise.resolve(promise).catch(error => {
        console.warn(`[AssetPipeline] ${label}: ${providerStatus(error)}`);
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
    const search = lookupTitle(lookupName);
    const diagnostics = [];
    const onDiagnostic = entry => { if (diagnostics.length < 24) diagnostics.push(entry); };
    let rawg = await safeProvider(providers.rawg.fetchGameDetails(lookupName, { onDiagnostic }), 'RAWG');
    const specialEdition = Boolean(search.port || search.edition || search.conflict);
    // A real Steam title can itself end in Remake/Remastered. Do not remove
    // it for store search; require affirmative edition proof before binding.
    const steamName = search.edition ? `${search.base} ${search.edition === 'remaster' ? 'Remastered' : search.edition}` : search.base;
    const storeBlocked = search.port || search.conflict;
    const matchesSteam = value => {
        if (!value?.name || storeBlocked) return false;
        if (search.edition) {
            const year = storeYear(value.releaseDate);
            const catalogYear = rawg?.catalogIdentity?.releaseYear;
            return lookupTitle(value.name).key === search.key &&
                editionEvidence({ name: value.name, description_raw: value.description }, search.base) === search.edition &&
                !!year && (!search.year || year === search.year) && (!catalogYear || year === catalogYear);
        }
        return search.year ? (lookupTitle(value.name).key === search.key && !lookupTitle(value.name).edition && !lookupTitle(value.name).port && storeYear(value.releaseDate) === search.year)
            : titleScore(steamName, value.name) >= 0.85;
    };
    const oldId = String(options.steamAppId || '');
    let steamAppId = storeBlocked ? null : (/^\d{1,12}$/.test(oldId) ? oldId : identity.steamAppId);
    let source = steamAppId ? (/^\d{1,12}$/.test(oldId) ? 'saved-identity' : 'reviewed-alias') : null;
    if (!steamAppId && !storeBlocked) {
        const id = String(rawg?.steamAppId || '');
        if (/^\d{1,12}$/.test(id)) { steamAppId = id; source = 'rawg-suggestion'; }
    }
    if (!steamAppId && !storeBlocked) {
        steamAppId = await safeProvider(providers.steam.searchAppId(steamName), 'Steam lookup');
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
        if (matchesSteam(steam)) {
            verified = true;
        } else if (steam?.name) {
            console.warn(`[AssetPipeline] Rejecting mismatched Steam AppID for "${gameName}"`);
            const old = String(steamAppId);
            const found = await safeProvider(providers.steam.searchAppId(steamName), 'Steam re-lookup');
            if (found && String(found) !== old) {
                const replacement = await safeProvider(providers.steam.fetchGameDetails(found), 'Steam recheck');
                if (matchesSteam(replacement)) {
                    steamAppId = String(found);
                    steam = replacement;
                    source = 'steam-exact-search';
                    verified = true;
                }
            }
            if (!verified) { steamAppId = null; steam = null; }
        } else if (search.year || search.edition) {
            // Without store date evidence, a same-name Steam release cannot
            // establish the identity of a year-qualified local title.
            steamAppId = null;
            steam = null;
        } else if (source === 'reviewed-alias' || source === 'steam-exact-search' ||
            (source === 'saved-identity' && options.trustedSteamAppId === true)) {
            // Steam's conservative title search and a reviewed explicit alias
            // are acceptable identities if optional Store Details is offline.
            verified = true;
        } else {
            // An unchecked AppID from external metadata must not attach art.
            const found = await safeProvider(providers.steam.searchAppId(steamName), 'Steam identity verification');
            if (found && String(found) === String(steamAppId)) {
                source = 'steam-exact-search';
                verified = true;
            } else {
                console.warn(`[AssetPipeline] Withholding unverified Steam AppID for "${gameName}"`);
                steamAppId = null;
            }
        }
    }

    // If the exact year was verified on Steam, never mix in older original
    // release metadata that RAWG had returned as a base-game fallback.
    if (verified && rawg?.catalogIdentity?.relation === 'base_game') rawg = null;
    const gridOptions = {
        kinds: requestedKinds,
        canonicalName: rawg?.name || steam?.name || lookupName,
        releaseYear: Number(String(rawg?.releaseDate || '').slice(0, 4)) || search.year || undefined,
        catalogIdentity: rawg?.catalogIdentity || (verified && search.edition ? {
            provider: 'steam', relation: 'verified_edition', edition: search.edition,
            name: steam.name, releaseYear: storeYear(steam.releaseDate),
        } : undefined),
        verifiedSteamEdition: Boolean(verified && search.edition),
        onDiagnostic,
    };

    if (verified && steamAppId) {
        [grid, steamLibrary] = await Promise.all([
            safeProvider(providers.grid.fetchGameAssets(lookupName, steamAppId, gridOptions), 'SteamGridDB'),
            safeProvider(providers.library.fetchSteamArtwork(steamAppId), 'Steam library'),
        ]);
    } else {
        grid = await safeProvider(providers.grid.fetchGameAssets(lookupName, undefined,
            gridOptions), 'SteamGridDB by name');
    }

    // A different, exact requested-year artwork entry is evidence of a
    // distinct release; do not silently pair it with older base metadata.
    if (!search.port && rawg?.catalogIdentity?.relation === 'base_game' &&
        grid?.catalogIdentity?.releaseYear && grid.catalogIdentity.releaseYear !== rawg.catalogIdentity.releaseYear) {
        rawg = null;
    }
    let trailerYouTubeId = rawg?.media?.trailerYouTubeId || '';
    let trailerThumbnail = rawg?.media?.trailerThumbnail || '';
    // Generic title-only trailers are unsafe for explicitly labeled or unresolved editions.
    // Full video identity matching is a later phase.
    const unresolved = diagnostics.some(d => ['ambiguous_identity','edition_confirmation_required','no_unambiguous_catalog_match','conflicting_edition_intent'].includes(d.reason));
    if (!trailerYouTubeId && !specialEdition && !unresolved && options.includeMedia !== false) {
        const video = await safeProvider(providers.youtube.getTrailerData(rawg?.name || lookupName), 'YouTube');
        trailerYouTubeId = video?.videoId || '';
        trailerThumbnail = video?.thumbnail || '';
    }

    const result = mergeMetadata({
        name: gameName, rawgData: rawg, steamData: steam,
        sgAssets: grid, steamArtwork: steamLibrary,
        trailerYouTubeId, trailerThumbnail,
    });
    // RAWG supplies genuine landscape imagery, never a fabricated poster/logo.
    // It remains a last candidate, subject to the same decoder/host checks.
    if (rawg?.catalogIdentity && rawgBackground(rawg.background) && requestedKinds.includes('background')) {
        const list = result.rawAssets.background || [];
        if (!list.some(item => item.url === rawg.background)) {
            result.rawAssets.background = [...list.slice(0, 11), { url: rawg.background, source: 'rawg-background' }];
        }
    }
    result.metadata.assetSearch = {
        version: 4, editionIntent: search.port ? 'pc_port' : search.edition, requestedTitle: gameName, requestedYear: search.year,
        metadataIdentity: rawg?.catalogIdentity || null,
        artworkIdentity: grid?.catalogIdentity || null,
        diagnostics,
    };
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
    if (!lookupTitle(gameName).port && !lookupTitle(gameName).conflict &&
        (!lookupTitle(gameName).edition || metadata.artworkIdentity?.verified === true) &&
        picsRuntimeEnv.NEXUS_PICS_EXPERIMENT === '1' &&
        metadata.assetSearch?.metadataIdentity?.relation !== 'base_game' &&
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
