'use strict';

// Read-only Steam library artwork discovery. Never scan Steam user credentials,
// mutate Steam files, or infer artwork for an unverified AppID.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const KINDS = Object.freeze(['poster', 'background', 'logo', 'icon']);
const MAX_DIRS = 32;
const MAX_CANDIDATES = 8;
const HEX_FOLDER = /^[a-f0-9]{40}$/i;

const ASSET_NAMES = Object.freeze({
    poster: ['library_600x900_2x.jpg', 'library_600x900.jpg', 'library_capsule.jpg', 'library_600x900.png'],
    background: ['library_hero_2x.jpg', 'library_hero.jpg', 'library_hero.png'],
    logo: ['logo.png', 'library_logo.png', 'logo_english.png', 'logo.webp'],
    icon: ['icon.jpg', 'icon.png', 'icon.webp'],
});

let steamRegistryRoot;
function windowsSteamRegistryRoot() {
    if (steamRegistryRoot !== undefined) return steamRegistryRoot;
    steamRegistryRoot = '';
    if (process.platform !== 'win32') return steamRegistryRoot;
    try {
        const result = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
            { encoding: 'utf8', windowsHide: true, timeout: 1500,
                stdio: ['ignore', 'pipe', 'ignore'] });
        const found = result.match(/^\s*SteamPath\s+REG_\w+\s+(.+)\s*$/im);
        if (found) steamRegistryRoot = found[1].trim();
    } catch { /* Steam is optional; do not use credentials or fail the launcher */ }
    return steamRegistryRoot;
}

function steamRoots({ roots, platform = process.platform, env = process.env, home = os.homedir() } = {}) {
    const rootList = Array.isArray(roots) ? roots : [
        env.STEAM_INSTALL_PATH, env.STEAM_PATH,
        ...(platform === 'win32' ? [windowsSteamRegistryRoot()] : []),
        ...(platform === 'win32' ? [
            env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Steam'),
            env.ProgramFiles && path.join(env.ProgramFiles, 'Steam'),
            'C:\\Program Files (x86)\\Steam',
        ] : platform === 'darwin' ? [
            path.join(home, 'Library', 'Application Support', 'Steam'),
        ] : [
            path.join(home, '.steam', 'steam'),
            path.join(home, '.local', 'share', 'Steam'),
        ]),
    ];
    return [...new Set(rootList.filter(root => typeof root === 'string' && root.trim())
        .map(root => path.resolve(root)))].slice(0, 12);
}

async function statOrNull(file) {
    try { return await fs.promises.stat(file); } catch { return null; }
}

// Reject symlinks escaping Steam's actual cache, even in user-provided roots.
async function isRegularFileUnder(file, cacheRoot) {
    try {
        const [real, base, st] = await Promise.all([
            fs.promises.realpath(file), fs.promises.realpath(cacheRoot), fs.promises.stat(file),
        ]);
        return st.isFile() && st.size >= 24 && st.size <= 24 * 1024 * 1024 &&
            path.relative(base, real) !== '' &&
            !path.relative(base, real).startsWith('..' + path.sep) &&
            path.relative(base, real) !== '..' && !path.isAbsolute(path.relative(base, real));
    } catch { return false; }
}

async function listGameDirs(cacheRoot, id) {
    const direct = path.join(cacheRoot, id);
    const st = await statOrNull(direct);
    if (!st?.isDirectory()) return [];
    let children = [];
    try { children = await fs.promises.readdir(direct, { withFileTypes: true }); } catch { /* no access */ }
    // Limit work: hashed Steam folders are not game identities; appid is the parent.
    const hashed = children.filter(item => item.isDirectory() && HEX_FOLDER.test(item.name))
        .slice(0, MAX_DIRS).map(item => path.join(direct, item.name));
    return [direct, ...hashed];
}

async function discoverSteamArtwork(appid, options = {}) {
    const empty = Object.fromEntries(KINDS.map(kind => [kind, []]));
    const id = String(appid ?? '');
    if (!/^[1-9]\d{0,11}$/.test(id)) return empty;
    for (const root of steamRoots(options)) {
        const cacheRoot = path.join(root, 'appcache', 'librarycache');
        const rootStat = await statOrNull(cacheRoot);
        if (!rootStat?.isDirectory()) continue;
        const dirs = await listGameDirs(cacheRoot, id);
        // The legacy Steam cache stores "<appid>_logo.png" in its root.
        dirs.push(cacheRoot);
        for (const kind of KINDS) {
            for (const dir of dirs) {
                for (const filename of ASSET_NAMES[kind]) {
                    const relativeName = dir === cacheRoot ? `${id}_${filename}` : filename;
                    const candidate = path.join(dir, relativeName);
                    if (!await isRegularFileUnder(candidate, cacheRoot)) continue;
                    if (!empty[kind].includes(candidate)) empty[kind].push(candidate);
                    if (empty[kind].length >= MAX_CANDIDATES) break;
                }
                if (kind === 'icon' && dir !== cacheRoot && empty[kind].length < MAX_CANDIDATES) {
                    // Steam's newer community icon can use a 40-character hash as filename.
                    try {
                        const contents = await fs.promises.readdir(dir);
                        for (const name of contents.slice(0, 150)) {
                            if (!/^[a-f0-9]{40}\.jpg$/i.test(name)) continue;
                            const filename = path.join(dir, name);
                            if (await isRegularFileUnder(filename, cacheRoot)) empty.icon.push(filename);
                            if (empty.icon.length >= MAX_CANDIDATES) break;
                        }
                    } catch { /* the directory is optional */ }
                }
                if (empty[kind].length >= MAX_CANDIDATES) break;
            }
        }
    }
    return empty;
}

module.exports = { KINDS, steamRoots, discoverSteamArtwork, isRegularFileUnder };
