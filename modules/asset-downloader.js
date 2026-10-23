// Atomic, non-destructive image downloader used by assets.js.
// Each candidate is tried until a real image of the requested kind is obtained.
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 24 * 1024 * 1024;
const KINDS = new Set(['poster', 'background', 'logo', 'icon']);

function inspectImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
        return { ext: '.png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const form = buffer.toString('ascii', 12, 16);
        if (form === 'VP8X' && buffer.length >= 30) {
            return { ext: '.webp', width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
        }
        if (form === 'VP8 ' && buffer.length >= 30) {
            return { ext: '.webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
        }
        if (form === 'VP8L' && buffer.length >= 25) {
            const bits = buffer.readUInt32LE(21);
            return { ext: '.webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        return { ext: '.webp', width: 0, height: 0 };
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        let i = 2;
        while (i + 9 < buffer.length) {
            if (buffer[i] !== 0xff) { i++; continue; }
            const tag = buffer[i + 1];
            if (tag === 0xd9 || tag === 0xda) break;
            const len = buffer.readUInt16BE(i + 2);
            if (len < 2 || i + len + 2 > buffer.length) break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb].includes(tag)) {
                return { ext: '.jpg', width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
            }
            i += len + 2;
        }
        return null;
    }
    if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0) {
        return { ext: '.ico', width: buffer[6] || 256, height: buffer[7] || 256 };
    }
    return null;
}

function acceptable(image, kind) {
    if (!image || !image.width || !image.height) return false;
    const { width, height, ext } = image;
    if (width > 20000 || height > 20000) return false;
    const ratio = width / height;
    if (kind === 'poster') return width >= 180 && height >= 280 && ratio >= 0.40 && ratio <= 0.90;
    if (kind === 'background') return width >= 600 && height >= 200 && ratio >= 1.4;
    if (kind === 'logo') return (ext === '.png' || ext === '.webp') && width >= 64 && height >= 32;
    if (kind === 'icon') return width >= 16 && height >= 16;
    return true;
}

function toLocalUrl(filePath) {
    return `local-resource:///${filePath.replace(/\\/g, '/')}`;
}

function cachedFile(gameDir, name) {
    const explicit = path.extname(name);
    const stems = explicit ? [name] : ['.png', '.webp', '.jpg', '.jpeg', '.ico'].map(ext => `${name}${ext}`);
    for (const filename of stems) {
        const file = path.join(gameDir, filename);
        try {
            const st = fs.statSync(file);
            if (st.size < 24 || st.size > MAX_BYTES) continue;
            const buf = fs.readFileSync(file);
            if (acceptable(inspectImage(buf), name.split('_')[0])) return toLocalUrl(file);
        } catch (_) { /* missing file */ }
    }
    return '';
}

async function downloadImageCandidates(candidates, gameDir, name, options = {}) {
    const kind = KINDS.has(name) ? name : '';
    const items = [...new Set([].concat(candidates || []).filter(Boolean))];
    // Important: a locally selected image always takes precedence over API refreshes.
    const cache = !options.force ? cachedFile(gameDir, name) : '';
    if (cache) return cache;
    fs.mkdirSync(gameDir, { recursive: true });
    for (const url of items) {
        if (typeof url !== 'string') continue;
        if (url.startsWith('local-resource://') || url.startsWith('file:///')) return url;
        if (!/^https:\/\//i.test(url)) continue;
        try {
            const { data } = await (options.http || axios).get(url, {
                responseType: 'arraybuffer',
                timeout: 15000,
                maxRedirects: 3,
                maxContentLength: MAX_BYTES,
                headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/x-icon,image/*;q=0.8' },
            });
            const buffer = Buffer.from(data);
            if (buffer.length > MAX_BYTES) throw new Error('image exceeds limit');
            const info = inspectImage(buffer);
            if (!acceptable(info, kind)) {
                console.warn(`[Assets] Rejected ${name}: invalid image/type/dimensions from ${new URL(url).hostname}`);
                continue;
            }
            // Save only after validation. Existing files remain untouched.
            const target = path.join(gameDir, `${path.parse(name).name}${info.ext}`);
            if (!options.force) {
                const found = cachedFile(gameDir, name);
                if (found) return found;
            }
            const tmp = `${target}.${process.pid}.${Date.now()}.part`;
            try {
                fs.writeFileSync(tmp, buffer, { flag: 'wx' });
                fs.renameSync(tmp, target);
            } finally {
                if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
            }
            console.log(`[Assets] ${name} ← ${new URL(url).hostname} (${info.width}x${info.height})`);
            return toLocalUrl(target);
        } catch (err) {
            console.warn(`[Assets] ${name} candidate failed: ${err.message}`);
        }
    }
    return '';
}

module.exports = { inspectImage, acceptable, cachedFile, downloadImageCandidates };
