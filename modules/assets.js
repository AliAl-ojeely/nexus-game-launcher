const fs = require('fs');
const path = require('path');
const { downloadImageCandidates } = require('./asset-downloader');

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

async function downloadGameAssets(gameName, assets, metadata) {
    const slug = slugifyName(gameName);
    const gameDir = path.join(ASSETS_DIR, slug);
    if (!fs.existsSync(gameDir)) fs.mkdirSync(gameDir, { recursive: true });

    console.log(`[Assets] Downloading for: "${gameName}" → /${slug}/`);

    const [poster, background, logo, icon] = await Promise.all([
        downloadAsset(assets.poster || '', gameDir, 'poster'),
        downloadAsset(assets.background || '', gameDir, 'background'),
        downloadAsset(assets.logo || '', gameDir, 'logo'),
        downloadAsset(assets.icon || '', gameDir, 'icon'),
    ]);

    const localScreenshots = await mapLimited(metadata?.media?.screenshots || [], 3, (url, i) =>
            downloadAsset(url, gameDir, `screenshot_${i}`)
        );

    const localTrailerThumb = await downloadAsset(
        metadata?.media?.trailerThumbnail || '', gameDir, 'trailer_thumb'
    );

    console.log(`[Assets] Done → poster:${!!poster} bg:${!!background} logo:${!!logo} icon:${!!icon} screenshots:${localScreenshots.length}`);

    return {
        assets: { poster, background, logo, icon },
        media: {
            ...metadata?.media,
            screenshots: localScreenshots.filter(Boolean),
            trailerThumbnail: localTrailerThumb,
        }
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