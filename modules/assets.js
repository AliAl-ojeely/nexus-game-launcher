const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

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

function downloadAsset(url, gameDir, fileName) {
    return new Promise((resolve) => {
        if (!url || url.trim() === '') return resolve('');
        if (url.startsWith('local-resource://') || url.startsWith('file:///'))
            return resolve(url);

        try {
            let ext = '.jpg';
            try {
                const parsed = new URL(url);
                const extFromPath = path.extname(parsed.pathname).split('?')[0].toLowerCase();
                if (extFromPath) ext = extFromPath;
            } catch { }

            const fullFileName = fileName.includes('.') ? fileName : `${fileName}${ext}`;
            const filePath = path.join(gameDir, fullFileName);

            // ── إذا الملف موجود مسبقاً نرجعه مباشرة ─────────────────────────
            if (fs.existsSync(filePath))
                return resolve(`local-resource:///${filePath.replace(/\\/g, '/')}`)

            const proto = url.startsWith('https') ? https : http;
            const file = fs.createWriteStream(filePath);

            const request = proto.get(url, { timeout: 20000 }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    file.close();
                    fs.unlink(filePath, () => { });
                    downloadAsset(response.headers.location, gameDir, fileName).then(resolve);
                    return;
                }
                if (response.statusCode !== 200) {
                    file.close();
                    fs.unlink(filePath, () => { });
                    return resolve('');
                }

                response.pipe(file);

                file.on('finish', () => {
                    file.close();

                    // ── فحص ذكي لنوع الملف الفعلي وتصحيح الامتداد إذا لزم الأمر ──
                    try {
                        const fd = fs.openSync(filePath, 'r');
                        const buf = Buffer.alloc(4);
                        fs.readSync(fd, buf, 0, 4, 0);
                        fs.closeSync(fd);

                        const isIco = buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00;
                        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;

                        let trueExt = ext;
                        if (isIco) trueExt = '.ico';
                        else if (isPng) trueExt = '.png';

                        if (trueExt !== ext && !fileName.includes('.')) {
                            const newFilePath = path.join(gameDir, `${fileName}${trueExt}`);
                            fs.renameSync(filePath, newFilePath);
                            console.log(`[Assets] Saved ${fileName} correctly as ${trueExt}`);
                            return resolve(`local-resource://${newFilePath}`);
                        }
                    } catch (err) {
                        console.warn(`[Assets] Magic byte check failed:`, err.message);
                    }

                    resolve(`local-resource:///${filePath.replace(/\\/g, '/')}`)
                });

                file.on('error', () => {
                    file.close();
                    fs.unlink(filePath, () => { });
                    resolve('');
                });
            });

            request.on('error', () => {
                file.close();
                fs.unlink(filePath, () => { });
                resolve('');
            });
            request.on('timeout', () => {
                request.destroy();
                file.close();
                fs.unlink(filePath, () => { });
                resolve('');
            });
        } catch (err) {
            console.warn(`[Assets] downloadAsset error (${fileName}):`, err.message);
            resolve('');
        }
    });
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

    const localScreenshots = await Promise.all(
        (metadata?.media?.screenshots || []).map((url, i) =>
            downloadAsset(url, gameDir, `screenshot_${i}`)
        )
    );

    const localTrailerThumb = await downloadAsset(
        metadata?.media?.trailerThumbnail || '', gameDir, 'trailer_thumb'
    );

    console.log(`[Assets] Done → poster:${!!poster} bg:${!!background} logo:${!!logo} icon:${!!icon} screenshots:${localScreenshots.length}`);

    return {
        assets: { poster, background, logo, icon },
        media: {
            ...metadata?.media,
            screenshots: localScreenshots,
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