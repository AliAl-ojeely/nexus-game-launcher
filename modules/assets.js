const fs = require('fs');
const path = require('path');
const { downloadImageCandidates, fromLocalUrl, validateFile } = require('./asset-downloader');
const { discoverSteamArtwork } = require('./asset-steam-cache');
const { KINDS, isManualResource } = require('./asset-resolver');
const { RETRY_AFTER_MS } = require('./asset-refresh-policy');

const { ASSETS_DIR } = require('./app-settings');

// ─────────────────────────────────────────────────────────────────────────────
// SLUG
// ─────────────────────────────────────────────────────────────────────────────

function slugifyName(name) {
    return name
        .toLowerCase()
        .replace(/[''`]/g, '')
        .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, ' ')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD SINGLE ASSET
// ─────────────────────────────────────────────────────────────────────────────

function downloadAsset(url, gameDir, fileName, options = {}) {
    return downloadImageCandidates(url, gameDir, fileName, options);
}

// Limit media concurrency to avoid exhausting memory on games with many screenshots.
async function mapLimited(items, count, fn) {
    const result = new Array(items.length);
    let offset = 0;
    await Promise.all(Array.from({ length: Math.min(count, items.length) }, async () => {
        while (offset < items.length) {
            const index = offset++;
            result[index] = await fn(items[index], index);
        }
    }));
    return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD ALL GAME ASSETS
// ─────────────────────────────────────────────────────────────────────────────

async function downloadGameAssets(gameName, assets, metadata, options = {}) {
    const slug = slugifyName(gameName) || 'unknown-game';
    const gameDir = path.join(ASSETS_DIR, slug);
    await fs.promises.mkdir(gameDir, { recursive: true });
    const diagnostic = {};
    const requested = KINDS.filter(kind => !options.requestedKinds || options.requestedKinds.includes(kind));
    const missing = [];
    for (const kind of requested) {
        const currentFile = fromLocalUrl(options.existingAssets?.[kind]);
        if (options.force || !currentFile || !await validateFile(currentFile, kind, options)) missing.push(kind);
    }
    // Zero Steam filesystem reads if every requested image is already cached.
    // A verified AppID is required, and only librarycache is inspected.
    const steamLocal = missing.length && metadata?.steamAppId && metadata?.artworkIdentity?.verified
        ? await discoverSteamArtwork(metadata.steamAppId, options.steamCache || {})
        : {};
    const perKind = await Promise.all(KINDS.map(async kind => {
        // Skipping a kind is not a request to erase it. Return the previous path.
        if (!requested.includes(kind)) return [kind, options.existingAssets?.[kind] || ''];
        let info = { status: 'fallback', reason: 'not_attempted' };
        const asset = await downloadAsset(assets?.[kind] || [], gameDir, kind, {
            existing: options.existingAssets?.[kind] || '',
            localCandidates: steamLocal[kind] || [],
            force: options.force && !isManualResource(options.existingAssets?.[kind]),
            enforceHosts: !options.http,
            http: options.http, decode: options.decode,
            onDiagnostic: event => { info = event; },
        });
        diagnostic[kind] = info;
        return [kind, asset];
    }));
    const resolved = Object.fromEntries(perKind);
    for (const kind of KINDS) {
        if (!diagnostic[kind]) diagnostic[kind] = { status: 'skipped', reason: 'not_requested' };
    }

    // Screenshots and trailer media remain separate from artwork selection.
    const localScreenshots = await mapLimited(options.includeMedia === false ? [] : metadata?.media?.screenshots || [], 3,
        (url, i) => downloadAsset(url, gameDir, `screenshot_${i}`, options));
    const localTrailerThumb = options.includeMedia === false ? '' : await downloadAsset(
        metadata?.media?.trailerThumbnail || '', gameDir, 'trailer_thumb', options);

    const now = Date.now();
    const artworkResolution = {
        version: 1,
        checkedAt: new Date(now).toISOString(),
        retryAfter: new Date(now + RETRY_AFTER_MS).toISOString(),
        kinds: diagnostic,
    };
    console.log(`[Assets] ${gameName}: ` + KINDS.map(kind =>
        `${kind}=${diagnostic[kind]?.status || 'unknown'}`
    ).join(' '));
    return {
        assets: resolved,
        artworkResolution,
        media: {
            ...metadata?.media,
            screenshots: localScreenshots.filter(Boolean),
            trailerThumbnail: localTrailerThumb,
        },
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// RENAME ASSETS FOLDER
// ─────────────────────────────────────────────────────────────────────────────

function renameAssetsFolder(oldName, newName) {
    if (!oldName || typeof oldName !== 'string' ||
        !newName || typeof newName !== 'string') {
        console.warn(`[Assets] renameAssetsFolder: invalid names — "${oldName}" → "${newName}" — skipping`);
        return null;
    }

    const oldSlug = slugifyName(oldName);
    const newSlug = slugifyName(newName);
    if (oldSlug === newSlug) return null;

    const oldDir = path.join(ASSETS_DIR, oldSlug);
    const newDir = path.join(ASSETS_DIR, newSlug);

    if (!fs.existsSync(oldDir)) {
        console.log(`[Assets] Folder not found: /${oldSlug}/ — skipping rename`);
        return null;
    }
    if (fs.existsSync(newDir)) {
        console.warn(`[Assets] Target already exists: /${newSlug}/ — skipping rename`);
        return null;
    }

    try {
        fs.renameSync(oldDir, newDir);
        console.log(`[Assets] Renamed: /${oldSlug}/ → /${newSlug}/`);
        return { oldSlug, newSlug };
    } catch (err) {
        console.error(`[Assets] Rename failed:`, err.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE ASSET PATHS INSIDE GAME OBJECT
// ─────────────────────────────────────────────────────────────────────────────

function updateAssetPaths(game, oldSlug, newSlug) {
    const replace = (str) => {
        if (!str || typeof str !== 'string') return str;
        return str
            .replace(`game-assets\\${oldSlug}\\`, `game-assets\\${newSlug}\\`)
            .replace(`game-assets/${oldSlug}/`, `game-assets/${newSlug}/`);
    };

    if (game.assets) {
        game.assets.poster = replace(game.assets.poster);
        game.assets.background = replace(game.assets.background);
        game.assets.logo = replace(game.assets.logo);
        game.assets.icon = replace(game.assets.icon);
    }
    if (game.metadata?.media) {
        if (game.metadata.media.screenshots)
            game.metadata.media.screenshots =
                game.metadata.media.screenshots.map(replace);
        if (game.metadata.media.trailerThumbnail)
            game.metadata.media.trailerThumbnail =
                replace(game.metadata.media.trailerThumbnail);
    }

    return game;
}

module.exports = {
    slugifyName,
    downloadAsset,
    downloadGameAssets,
    renameAssetsFolder,
    updateAssetPaths,
};