'use strict';

// Release credentials are per-user, never bundled with an installer.
// Development continues using the pre-existing, ignored src/secrets.json.
const fs = require('node:fs');
const path = require('node:path');

const KEYS = Object.freeze(['RAWG_API_KEY', 'SGDB_API_KEY', 'YOUTUBE_API_KEY']);
const MAX_SECRET_BYTES = 16 * 1024;

function loadFile(file, read = fs.readFileSync, stat = fs.statSync) {
    try {
        const size = stat(file).size;
        if (size < 2 || size > MAX_SECRET_BYTES) return {};
        const data = JSON.parse(read(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

function sourcePath({ isPackaged, userData, devRoot }) {
    // Packaged apps can only use the explicitly selected per-user credentials file.
    if (isPackaged) {
        if (!userData || !path.isAbsolute(userData)) return null;
        return path.join(userData, 'provider-secrets.json');
    }
    return path.join(devRoot || path.resolve(__dirname, '..'), 'src', 'secrets.json');
}

function getFromSources(key, options = {}) {
    if (!KEYS.includes(key)) return '';
    const env = options.env || {};
    const override = env['NEXUS_' + key];
    if (typeof override === 'string' && override.trim()) return override.trim();
    const file = sourcePath(options);
    const value = file ? loadFile(file, options.read, options.stat)[key] : undefined;
    return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function runtimeOptions() {
    let app;
    try { app = require('electron').app; } catch { /* Node-only tests or analysis */ }
    const packaged = app?.isPackaged === true;
    let userData = '';
    if (packaged) {
        try { userData = app.getPath('userData'); } catch { /* fail closed */ }
    }
    return { isPackaged: packaged, userData, devRoot: path.resolve(__dirname, '..'), env: process.env };
}

for (const key of KEYS) {
    Object.defineProperty(exports, key, {
        enumerable: true,
        get() { return getFromSources(key, runtimeOptions()); },
    });
}

// Pure helpers permit tests without reading a real user profile or credentials.
exports.__test = Object.freeze({ KEYS, MAX_SECRET_BYTES, sourcePath, loadFile, getFromSources });
