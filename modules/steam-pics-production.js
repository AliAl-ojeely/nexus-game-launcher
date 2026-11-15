'use strict';

// User-approved PICS logo fallback. Steam identity and image validation remain
// enforced by the existing v0.4.2 opt-in provider on every request.
const fs = require('node:fs');
const path = require('node:path');

const ID = /^[1-9]\d{0,11}$/;
const KEY = 'steamPics';

function normalize(value) {
    return Object.freeze({ enabled: value?.enabled === true });
}

function settingsModule() {
    // Loaded only inside Electron's main process; do not expose settings.json.
    return require('./app-settings');
}

function readConfig() {
    try {
        return normalize(settingsModule().readSettings()?.[KEY]);
    } catch {
        return normalize(null);
    }
}

function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid PICS setting');
    const { readSettings, writeSettings } = settingsModule();
    const settings = readSettings();
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
        throw new Error('Launcher settings unavailable');
    // Preserve all unrelated fields, including modalOverlay and other choices.
    writeSettings({ ...settings, [KEY]: { enabled } });
    return readStatus();
}

function appIdMatches(saved, fetched) {
    const a = String(saved || '');
    const b = String(fetched || '');
    if (a && !ID.test(a)) return '';
    if (b && !ID.test(b)) return '';
    if (a && b && a !== b) return '';
    return b || a;
}

function runtimeEnvForApp(enabled, originalEnv, savedId, metadataId) {
    if (enabled !== true) return originalEnv;
    const id = appIdMatches(savedId, metadataId);
    if (!id) return originalEnv;
    // The strict, existing v0.4.2 allowlist contract is still enforced.
    // Exactly one verified candidate AppID is allowed per artwork request.
    return { NEXUS_PICS_EXPERIMENT: '1', NEXUS_PICS_APPIDS: id };
}

function getRuntimeEnv(options = {}, metadata = {}) {
    // Explicit test / developer env injection retains exact old behavior.
    if (options.picsEnv) return options.picsEnv;
    return runtimeEnvForApp(readConfig().enabled, process.env,
        options.steamAppId, metadata?.steamAppId);
}

function probeAvailability() {
    const root = path.resolve(__dirname, '..');
    const tool = path.join(root, 'tools', 'nexus-asset-provider-pilot-v033');
    const binary = path.join(root, 'tools', 'nexus-asset-provider-pilot-v031',
        'steamkit-pics', 'bin', 'Release', 'net10.0', 'SteamPicsProbe.dll');
    const alternateBinary = path.join(tool, 'steamkit-pics', 'bin', 'Release',
        'net10.0', 'SteamPicsProbe.dll');
    const packagedExe = path.join(process.resourcesPath || '', 'steam-pics-runtime',
        process.arch === 'arm64' ? 'win-arm64' : 'win-x64', 'SteamPicsProbe.exe');
    return fs.existsSync(path.join(tool, 'run-pilot.cjs')) &&
        fs.existsSync(path.join(tool, 'logo-validator.cjs')) &&
        (fs.existsSync(binary) || fs.existsSync(alternateBinary) ||
            (process.platform === 'win32' && fs.existsSync(packagedExe)));
}

function readStatus() {
    return { enabled: readConfig().enabled, helperFilesPresent: probeAvailability(),
        provider: 'steamkit2-pics', logoOnly: true,
        releasePackagingVerified: false };
}

module.exports = {
    normalize, appIdMatches, runtimeEnvForApp, getRuntimeEnv,
    readConfig, setEnabled, probeAvailability, readStatus,
};
