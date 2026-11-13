'use strict';

// Download and decode an image before treating a provider URL or cache as valid.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { validHttpUrl, isManualResource } = require('./asset-resolver');

const MAX_BYTES = 24 * 1024 * 1024;
const MAX_PIXELS = 45_000_000;
const TYPES = new Set(['poster', 'background', 'logo', 'icon']);
const extensions = ['.png', '.webp', '.jpg', '.jpeg', '.ico'];
const validated = new Map();

function inspectImage(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
    if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        return { ext: '.png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
        const form = buffer.toString('ascii', 12, 16);
        if (form === 'VP8X' && buffer.length >= 30)
            return { ext: '.webp', width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
        if (form === 'VP8 ' && buffer.length >= 30)
            return { ext: '.webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
        if (form === 'VP8L' && buffer.length >= 25) {
            const bits = buffer.readUInt32LE(21);
            return { ext: '.webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        return null;
    }
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        let i = 2;
        while (i + 9 < buffer.length) {
            if (buffer[i] !== 0xff) { i++; continue; }
            const tag = buffer[i + 1];
            if (tag === 0xd9 || tag === 0xda) break;
            const len = buffer.readUInt16BE(i + 2);
            if (len < 2 || i + len + 2 > buffer.length) break;
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb].includes(tag))
                return { ext: '.jpg', width: buffer.readUInt16BE(i + 7), height: buffer.readUInt16BE(i + 5) };
            i += len + 2;
        }
        return null;
    }
    if (buffer[0] === 0 && buffer[1] === 0 && buffer[2] === 1 && buffer[3] === 0)
        return { ext: '.ico', width: buffer[6] || 256, height: buffer[7] || 256 };
    return null;
}

function acceptable(image, kind) {
    if (!image || !image.width || !image.height) return false;
    const { width, height, ext } = image;
    if (!Number.isFinite(width * height) || width * height > MAX_PIXELS ||
        width > 20000 || height > 20000) return false;
    const ratio = width / height;
    if (kind === 'poster') return width >= 180 && height >= 280 && ratio >= 0.40 && ratio <= 0.90;
    if (kind === 'background') return width >= 600 && height >= 200 && ratio >= 1.4;
    if (kind === 'logo') return (ext === '.png' || ext === '.webp') && width >= 64 && height >= 32;
    if (kind === 'icon') return width >= 16 && height >= 16;
    return true;
}

async function decodeImage(buffer, options = {}) {
    if (options.decode) return options.decode(buffer);
    const sharp = require('sharp');
    // Resize to a small output, but force libvips to decode the complete input.
    await sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS })
        .resize({ width: 32, height: 32, fit: 'inside', withoutEnlargement: true })
        .png().toBuffer();
    return true;
}

function toLocalUrl(file) { return `local-resource:///${file.replace(/\\/g, '/')}`; }
function fromLocalUrl(value) {
    if (typeof value !== 'string') return null;
    if (/^file:\/\//i.test(value)) {
        try { return fileURLToPath(value); } catch { return null; }
    }
    if (!/^local-resource:\/\//i.test(value)) return null;
    try {
        // Works for local-resource:///C:/... and local-resource:////home/... .
        const raw = decodeURIComponent(value.replace(/^local-resource:\/\/\//i, ''));
        return raw.startsWith('/') ? raw : raw;
    } catch { return null; }
}

function cacheFiles(gameDir, name) {
    const stem = path.parse(name).name;
    return extensions.map(ext => path.join(gameDir, stem + ext));
}

// Kept for legacy callers. The actual downloader uses the async decoder-aware check.
function cachedFile(gameDir, name) {
    for (const filename of cacheFiles(gameDir, name)) {
        try {
            const stat = fs.statSync(filename);
            if (!stat.isFile() || stat.size < 24 || stat.size > MAX_BYTES) continue;
            if (acceptable(inspectImage(fs.readFileSync(filename)), name.split('_')[0])) return toLocalUrl(filename);
        } catch { /* ignore nonexistent or invalid files */ }
    }
    return '';
}

async function validateFile(filename, kind, options) {
    try {
        const st = await fs.promises.stat(filename);
        if (!st.isFile() || st.size < 24 || st.size > MAX_BYTES) return false;
        const key = `${filename}:${st.mtimeMs}:${st.size}:${kind}`;
        if (!options.decode && validated.has(key)) return true;
        const bytes = await fs.promises.readFile(filename);
        if (!acceptable(inspectImage(bytes), kind)) return false;
        await decodeImage(bytes, options);
        if (!options.decode) {
            if (validated.size > 384) validated.clear();
            validated.set(key, true);
        }
        return true;
    } catch { return false; }
}

function tell(options, info) {
    if (typeof options.onDiagnostic === 'function') options.onDiagnostic({ ...info });
}

async function downloadImageCandidates(input, gameDir, name, options = {}) {
    const kind = TYPES.has(name) ? name : '';
    const sources = Array.isArray(input) ? input.flat(2) : [input];
    const candidates = [];
    const seen = new Set();
    for (const candidate of sources) {
        const url = typeof candidate === 'string' ? candidate : candidate?.url;
        if (!validHttpUrl(url) || seen.has(url)) continue;
        candidates.push({ url, source: candidate?.source || 'unspecified' });
        seen.add(url);
        if (candidates.length >= 12) break;
    }
    const failures = [];

    const previous = options.existing;
    const previousFile = fromLocalUrl(previous);
    if (previousFile && await validateFile(previousFile, kind, options)) {
        const manual = isManualResource(previous);
        if (manual || !options.force) {
            tell(options, { status: manual ? 'manual' : 'cached', source: manual ? 'manual' : 'existing', attempted: 0 });
            return previous;
        }
    }

    if (!options.force) {
        for (const filename of cacheFiles(gameDir, name)) {
            if (await validateFile(filename, kind, options)) {
                tell(options, { status: 'cached', source: 'local-cache', attempted: 0 });
                return toLocalUrl(filename);
            }
        }
    }

    await fs.promises.mkdir(gameDir, { recursive: true });
    for (const candidate of candidates) {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await (options.http || axios).get(candidate.url, {
                    responseType: 'arraybuffer', timeout: 12000, maxRedirects: 3,
                    maxContentLength: MAX_BYTES,
                    headers: { Accept: 'image/webp,image/png,image/jpeg,image/x-icon,image/*;q=0.7' },
                });
                const type = String(response.headers?.['content-type'] || '');
                if (/^(?:text\/|application\/(?:json|xml|html))/i.test(type)) throw new Error('non_image_response');
                const buffer = Buffer.from(response.data);
                const info = inspectImage(buffer);
                if (buffer.length > MAX_BYTES || !acceptable(info, kind)) throw new Error('invalid_dimensions_or_format');
                await decodeImage(buffer, options);
                const target = path.join(gameDir, `${path.parse(name).name}${info.ext}`);
                const tmp = `${target}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.part`;
                try {
                    await fs.promises.writeFile(tmp, buffer, { flag: 'wx' });
                    await fs.promises.rename(tmp, target);
                } finally { await fs.promises.rm(tmp, { force: true }).catch(() => {}); }
                tell(options, { status: 'downloaded', source: candidate.source, attempted: failures.length + 1 });
                return toLocalUrl(target);
            } catch (err) {
                const status = Number(err.response?.status) || 0;
                const retriable = [429, 502, 503, 504].includes(status) || ['ETIMEDOUT', 'ECONNRESET'].includes(err.code);
                failures.push({ source: candidate.source, reason: status ? `http_${status}` : (err.message || 'download_failed').slice(0, 65) });
                if (!retriable || attempt === 1) break;
                await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
            }
        }
    }
    tell(options, {
        status: 'fallback', source: null, attempted: failures.length,
        reason: candidates.length ? 'no_valid_download' : 'no_candidates',
        failures: failures.slice(0, 12),
    });
    return '';
}

module.exports = {
    MAX_BYTES, inspectImage, acceptable, cachedFile, decodeImage,
    fromLocalUrl, validateFile, downloadImageCandidates,
};
