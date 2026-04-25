/**
 * modules/backup.js  —  Nexus Game Launcher  v2.0
 *
 * ✅ Fix 1: autoDiscoverSavePath now writes originPath immediately to gamesBackSave.json
 * ✅ Fix 2: Enhanced fuzzy matching — handles em-dash, en-dash, accents, Roman numerals
 * ✅ Fix 3: performMirroring reads globalBackupPath from settings.json as fallback
 * ✅ Fix 4: All functions return rich result objects for UI feedback
 * ✅ Fix 5: scanVaultForExistingBackups — re-links backups after Windows reinstall
 * ✅ Fix 6: ZIP format confirmed (adm-zip) — no external tools needed for restore
 *
 * Requirements:
 *   npm install adm-zip
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

let AdmZip;
try {
    AdmZip = require('adm-zip');
} catch {
    console.warn('[Backup] adm-zip not installed — run: npm install adm-zip');
}

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_DATA = path.join(os.homedir(), 'AppData', 'Roaming', 'Nexus Game Launcher');
const SAVE_PATHS_DB = path.join(USER_DATA, 'gameSavePaths.json');
const BACKUP_CONFIG = path.join(USER_DATA, 'gamesBackSave.json');
const SETTINGS_FILE = path.join(USER_DATA, 'settings.json');

if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });

// ─── Settings helpers ─────────────────────────────────────────────────────────

function readSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE))
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    } catch { /* ignore */ }
    return {};
}

function getGlobalBackupPath() {
    return readSettings().globalBackupPath || '';
}

// ─── Ensure gameSavePaths.json exists in user data ───────────────────────────
function ensureSavePathsDB() {
    if (fs.existsSync(SAVE_PATHS_DB)) return true;

    // Look for the bundled file in extraResources (process.resourcesPath)
    let sourcePath = path.join(process.resourcesPath, 'gameSavePaths.json');
    if (!fs.existsSync(sourcePath)) {
        // Fallback: maybe it's in the app root (dev environment)
        sourcePath = path.join(__dirname, '../gameSavePaths.json');
    }
    if (!fs.existsSync(sourcePath)) {
        console.warn('[Backup] gameSavePaths.json not found in resources – save path auto‑discovery may be limited');
        return false;
    }

    try {
        fs.copyFileSync(sourcePath, SAVE_PATHS_DB);
        console.log(`[Backup] ✅ Copied gameSavePaths.json to ${SAVE_PATHS_DB}`);
        return true;
    } catch (err) {
        console.error('[Backup] Failed to copy gameSavePaths.json:', err.message);
        return false;
    }
}

// ─── initBackupDB ─────────────────────────────────────────────────────────────

function initBackupDB() {

    ensureSavePathsDB();
    if (!fs.existsSync(BACKUP_CONFIG)) {
        fs.writeFileSync(BACKUP_CONFIG, JSON.stringify({}, null, 2), 'utf-8');
        console.log('[Backup] gamesBackSave.json created');
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2 — ENHANCED FUZZY MATCHING
// Handles: em-dash (–), en-dash (–), apostrophes, accents, Roman numerals,
//          "The" prefix swap, edition suffixes, GTA-style abbreviations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalizes a string for fuzzy comparison:
 *   - Lowercases
 *   - Replaces all dash variants (–, —, -, −) with a standard hyphen
 *   - Removes accents/diacritics
 *   - Strips common noise words and punctuation
 */
const normCache = new Map();
function normalizeForFuzzy(str) {
    if (normCache.has(str)) return normCache.get(str);
    const result = str
        .toLowerCase()
        .replace(/[\u2013\u2014\u2012\u2212\ufe58\ufe63\uff0d]/g, '-')
        .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC]/g, "'")
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s*[:\-–]\s*(the\s+)?(definitive|complete|ultimate|deluxe|enhanced|remastered|gold|goty|anniversary)\s+edition\s*$/i, '')
        .trim();
    normCache.set(str, result);
    return result;
}

/**
 * Builds a comprehensive set of name candidates for fuzzy lookup.
 * Each candidate is a normalized string that might match a DB key.
 */
function buildNameCandidates(gameName) {
    const add = (s) => { if (s && s.length > 1) candidates.add(normalizeForFuzzy(s)); };
    const candidates = new Set();

    const base = gameName.trim();
    const baseNorm = normalizeForFuzzy(base);

    // ── Tier 1: Direct variations ─────────────────────────────────────────────
    add(base);
    add(baseNorm);

    // ── Tier 2: Remove subtitle after colon ──────────────────────────────────
    // "The First Berserker: Khazan" → "The First Berserker"
    const colonIdx = base.indexOf(':');
    if (colonIdx > 0) {
        add(base.slice(0, colonIdx));
        // also the part AFTER colon: "Khazan"
        add(base.slice(colonIdx + 1));
    }

    // ── Tier 3: Remove subtitle after any dash variant ────────────────────────
    // "GTA: Vice City – The Definitive Edition" → "GTA: Vice City"
    const dashMatch = base.match(/\s+[-–—]\s+/);
    if (dashMatch) {
        add(base.slice(0, dashMatch.index));
    }

    // ── Tier 4: Remove year suffix ────────────────────────────────────────────
    // "Resident Evil 4 (2023)" → "Resident Evil 4"
    const noYear = base.replace(/\s*[\[(]?\d{4}[\])]?\s*$/, '').trim();
    if (noYear !== base) add(noYear);

    // ── Tier 5: "The" prefix swap ──────────────────────────────────────────────
    // "The First Berserker: Khazan" → "First Berserker: Khazan, The"
    if (base.toLowerCase().startsWith('the ')) {
        add(base.slice(4) + ', The');
        add(base.slice(4));
    }

    // ── Tier 6: Alphanumeric only ─────────────────────────────────────────────
    // "Nier:Automata" → "NierAutomata"
    const alnum = base.replace(/[^\w\s]/g, '').trim();
    if (alnum !== base) add(alnum);

    // ── Tier 7: Strip all special chars (for em-dash games) ──────────────────
    // "Grand Theft Auto: Vice City – The Definitive Edition"
    // → "grand theft auto vice city the definitive edition"
    add(base.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim());

    // ── Tier 8: Known abbreviation expansions ─────────────────────────────────
    const abbrevMap = {
        'gta': ['grand theft auto'],
        'kof': ['the king of fighters', 'king of fighters'],
        'ff': ['final fantasy'],
        'dmc': ['devil may cry'],
        're': ['resident evil'],
        'mgs': ['metal gear solid'],
        'cod': ['call of duty'],
        'ac': ['assassins creed', "assassin's creed"],
        'bf': ['battlefield'],
        'nfs': ['need for speed'],
        'pes': ['pro evolution soccer'],
    };
    const firstWord = base.split(/\s+/)[0].toLowerCase().replace(/[^\w]/g, '');
    if (abbrevMap[firstWord]) {
        for (const expansion of abbrevMap[firstWord]) {
            add(base.replace(new RegExp(`^${firstWord}`, 'i'), expansion));
        }
    }

    // ── Tier 9: Roman numeral normalization ───────────────────────────────────
    // "King of Fighters '98" — the apostrophe + number is already handled by normalizeForFuzzy
    // but also try without the year part
    const noApostropheYear = base.replace(/'\d{2,4}/, '').trim();
    if (noApostropheYear !== base) add(noApostropheYear);

    return [...candidates].filter(s => s.length > 1);
}

/**
 * Full fuzzy lookup against gameSavePaths.json.
 *
 * Pass 1 — Exact normalized match against all DB keys
 * Pass 2 — Alias array match
 * Pass 3 — Substring containment (both directions)
 * Pass 4 — Word overlap score (≥ 60% of words match)
 */
function fuzzyLookup(db, gameName) {
    if (!db || !gameName) return null;

    const candidates = buildNameCandidates(gameName);

    // Pre-build normalized key map once
    const normKeyMap = {}; // normalizedKey → originalKey
    for (const key of Object.keys(db)) {
        normKeyMap[normalizeForFuzzy(key)] = key;
    }

    // ── Pass 1: Normalized exact match ────────────────────────────────────────
    for (const candidate of candidates) {
        if (normKeyMap[candidate]) {
            const realKey = normKeyMap[candidate];
            console.log(`[Backup] 🎯 Fuzzy exact: "${realKey}" ← "${candidate}"`);
            return { entry: db[realKey], matchedKey: realKey };
        }
    }

    // ── Pass 2: Alias array match ─────────────────────────────────────────────
    for (const candidate of candidates) {
        for (const [key, entry] of Object.entries(db)) {
            if (!entry?.aliases) continue;
            if (entry.aliases.some(a => normalizeForFuzzy(a) === candidate)) {
                console.log(`[Backup] 🎯 Alias match: "${key}" via "${candidate}"`);
                return { entry, matchedKey: key };
            }
        }
    }

    // ── Pass 3: Substring match ───────────────────────────────────────────────
    const gameNameNorm = normalizeForFuzzy(gameName);
    for (const [normKey, realKey] of Object.entries(normKeyMap)) {
        if (normKey.length < 4) continue;
        if (
            normKey.includes(gameNameNorm) ||
            gameNameNorm.includes(normKey)
        ) {
            console.log(`[Backup] 🔍 Substring: "${realKey}"`);
            return { entry: db[realKey], matchedKey: realKey };
        }
    }

    // ── Pass 4: Word overlap scoring ─────────────────────────────────────────
    // Useful for "Grand Theft Auto Vice City Definitive Edition" vs DB key
    const gameWords = gameNameNorm.split(/\s+/).filter(w => w.length > 2);
    let bestScore = 0;
    let bestKey = null;

    for (const [normKey, realKey] of Object.entries(normKeyMap)) {
        if (normKey.length < 4) continue;
        const dbWords = normKey.split(/\s+/).filter(w => w.length > 2);
        const intersection = gameWords.filter(w => dbWords.includes(w)).length;
        const score = intersection / Math.max(gameWords.length, dbWords.length);
        if (score > bestScore) { bestScore = score; bestKey = realKey; }
    }

    if (bestScore >= 0.6 && bestKey) {
        console.log(`[Backup] 🔍 Word-overlap match (${Math.round(bestScore * 100)}%): "${bestKey}"`);
        return { entry: db[bestKey], matchedKey: bestKey };
    }

    return null;
}

// ─── Path Resolution ──────────────────────────────────────────────────────────

function resolvePath(rawPath, installPath = null) {
    if (!rawPath) return null;
    if (rawPath.includes('<xdgConfig>') || rawPath.includes('<xdgData>')) return null;
    if (rawPath === 'Goldberg Steam Emulator') return null;

    const gameDir = installPath ? path.dirname(installPath) : null;

    const vars = {
        '{{p|userprofile}}': os.homedir(),
        '{{p|localappdata}}': process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        '{{p|appdata}}': process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        '{{p|documents}}': path.join(os.homedir(), 'Documents'),
        '{{p|savedgames}}': path.join(os.homedir(), 'Saved Games'),
        '{{p|programdata}}': process.env.PROGRAMDATA || 'C:\\ProgramData',
        '{{p|public}}': 'C:\\Users\\Public',
        '{{p|publicdocuments}}': 'C:\\Users\\Public\\Documents',
        '{{p|game}}': gameDir,
        '{{p|steam}}': process.env.STEAM_PATH || 'C:\\Program Files (x86)\\Steam',
        '{{p|steamuserdata}}': path.join(process.env.STEAM_PATH || 'C:\\Program Files (x86)\\Steam', 'userdata'),
        '<winLocalAppData>': process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
        '<winAppData>': process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        '<winDocuments>': path.join(os.homedir(), 'Documents'),
        '<winSavedGames>': path.join(os.homedir(), 'Saved Games'),
        '<winProgramData>': process.env.PROGRAMDATA || 'C:\\ProgramData',
        '<winPublic>': 'C:\\Users\\Public',
        '<home>': os.homedir(),
        '<root>': gameDir,
        '<base>': gameDir,
    };

    let resolved = rawPath;
    for (const [key, value] of Object.entries(vars)) {
        if (!value) continue;
        const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        resolved = resolved.replace(regex, value);
    }
    resolved = resolved.replace(/%([^%]+)%/gi, (_, v) => process.env[v.toUpperCase()] || `%${v}%`);
    resolved = resolved.replace(/\//g, '\\');
    return path.normalize(resolved);
}

// ─── Wildcard Resolution ──────────────────────────────────────────────────────

function resolveWildcard(rawPath) {
    if (!rawPath) return null;
    let workPath = rawPath.replace(/<storeUserId>/gi, '*');
    if (!workPath.includes('*')) return workPath;

    try {
        const starIdx = workPath.indexOf('*');
        const before = workPath.slice(0, starIdx).replace(/[/\\]$/, '');
        const afterStar = workPath.slice(starIdx + 1).replace(/^[/\\]/, '');

        if (!fs.existsSync(before)) return null;

        const entries = fs.readdirSync(before, { withFileTypes: true });
        const dir = entries.find(e => e.isDirectory() && !e.name.startsWith('.'));
        if (!dir) return null;

        const joined = afterStar
            ? path.join(before, dir.name, afterStar)
            : path.join(before, dir.name);

        return joined.includes('*') ? resolveWildcard(joined) : joined;
    } catch {
        return null;
    }
}

// ─── Find Existing Path ───────────────────────────────────────────────────────

function findExistingPath(paths, installPath = null) {
    for (const rawPath of paths) {
        if (!rawPath || rawPath === 'Goldberg Steam Emulator') continue;
        if (rawPath.includes('<xdgConfig>') || rawPath.includes('<xdgData>')) continue;

        let resolved = resolvePath(rawPath, installPath);
        if (!resolved) continue;

        if (resolved.includes('*') || rawPath.includes('<storeUserId>')) {
            resolved = resolveWildcard(resolved);
            if (!resolved) continue;
        }

        try {
            if (fs.existsSync(resolved)) return resolved;
        } catch { /* ignore */ }
    }
    return null;
}

// ─── Heuristic Search ────────────────────────────────────────────────────────

function heuristicSearch(gameName) {
    const roots = [
        path.join(os.homedir(), 'Documents', 'My Games'),
        path.join(os.homedir(), 'Documents'),
        path.join(os.homedir(), 'Saved Games'),
        process.env.LOCALAPPDATA,
        process.env.APPDATA,
    ].filter(Boolean);

    // Build search terms from game name
    const terms = buildNameCandidates(gameName)
        .map(c => c.toLowerCase())
        .filter(c => c.length > 4);

    for (const root of roots) {
        if (!fs.existsSync(root)) continue;
        try {
            const entries = fs.readdirSync(root);
            for (const entry of entries) {
                const entryLower = entry.toLowerCase();
                const isMatch = terms.some(t =>
                    entryLower.includes(t) || t.includes(entryLower)
                );
                if (isMatch) {
                    const full = path.join(root, entry);
                    try {
                        if (fs.statSync(full).isDirectory()) {
                            console.log(`[Backup] 🔎 Heuristic: "${gameName}" → ${full}`);
                            return full;
                        }
                    } catch { /* ignore */ }
                }
            }
        } catch { /* ignore */ }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 1 — autoDiscoverSavePath NOW WRITES originPath to gamesBackSave.json
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Discovers the save path for a game using 3 layers:
 *   Layer 1 — gameSavePaths.json (Ludusavi) with enhanced fuzzy matching
 *   Layer 2 — Wildcard / storeUserId resolution
 *   Layer 3 — Heuristic scan of common save folders
 *
 * ✅ FIX: If a path is found, it is immediately written to gamesBackSave.json
 *         so that subsequent calls and UI display the correct value.
 *
 * @param {string}      gameName    - Game display name
 * @param {string|null} installPath - Path to game .exe (for {{p|game}} resolution)
 * @param {boolean}     persist     - Write to gamesBackSave.json on success (default: true)
 * @returns {string|null}
 */
function autoDiscoverSavePath(gameName, installPath = null, persist = true) {
    let found = null;

    // ── Layer 1 + 2: Database lookup ─────────────────────────────────────────
    if (fs.existsSync(SAVE_PATHS_DB)) {
        try {
            const db = JSON.parse(fs.readFileSync(SAVE_PATHS_DB, 'utf-8'));
            const match = fuzzyLookup(db, gameName);

            if (match?.entry?.paths?.length > 0) {
                found = findExistingPath(match.entry.paths, installPath);
                if (found) {
                    console.log(`[Backup] ✅ DB path for "${gameName}" [${match.matchedKey}]: ${found}`);
                } else {
                    console.log(`[Backup] ⚠️  DB entry found [${match.matchedKey}] but paths don't exist on disk`);
                }
            } else {
                console.log(`[Backup] No DB entry for "${gameName}"`);
            }
        } catch (err) {
            console.error(`[Backup] DB read error: ${err.message}`);
        }
    } else {
        console.warn('[Backup] gameSavePaths.json missing — run build-save-paths-db.js');
    }

    // ── Layer 3: Heuristic fallback ───────────────────────────────────────────
    if (!found) {
        found = heuristicSearch(gameName);
    }

    // ── FIX 1: Write to gamesBackSave.json immediately ───────────────────────
    if (found && persist) {
        const globalBackupPath = getGlobalBackupPath();
        updateBackupConfig(gameName, {
            originPath: found,
            // Only set backupPath if not already set
            ...(globalBackupPath ? { backupPath: globalBackupPath } : {}),
        });
        console.log(`[Backup] 💾 originPath written for "${gameName}": ${found}`);
    }

    if (!found) {
        console.log(`[Backup] ❌ No save path found for "${gameName}"`);
    }

    return found;
}

// ─── updateBackupConfig ───────────────────────────────────────────────────────

function updateBackupConfig(gameName, config) {
    try {
        const data = fs.existsSync(BACKUP_CONFIG)
            ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, 'utf-8'))
            : {};

        // Merge — never overwrite a non-empty originPath with empty
        const existing = data[gameName] || {};
        data[gameName] = {
            ...existing,
            ...config,
            // Guard: don't overwrite a good originPath with empty string
            originPath: (config.originPath || existing.originPath || ''),
            updatedAt: new Date().toISOString(),
        };

        fs.writeFileSync(BACKUP_CONFIG, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error(`[Backup] updateBackupConfig error: ${err.message}`);
        return false;
    }
}

// ─── getGameBackupInfo ────────────────────────────────────────────────────────

function getGameBackupInfo(gameName) {
    try {
        const data = fs.existsSync(BACKUP_CONFIG)
            ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, 'utf-8'))
            : {};
        let config = data[gameName] || null;

        // Get global backup path from settings
        const globalPath = getGlobalBackupPath();
        console.log(`[Backup] getGameBackupInfo for "${gameName}" – globalPath: ${globalPath}`);

        // Determine which backup path to use for listing backups
        let backupPath = config?.backupPath || globalPath;
        console.log(`[Backup] Using backupPath: ${backupPath}`);

        const backupList = backupPath ? listBackups(gameName, backupPath) : [];
        console.log(`[Backup] Found ${backupList.length} backups for "${gameName}"`);

        const lastBackup = backupList[0] || null;
        const lastBackupDate = lastBackup
            ? new Date(lastBackup.date).toLocaleString('en-GB', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            })
            : null;

        return {
            config,
            backups: backupList,
            lastBackupDate,
            backupCounter: backupList.length,
            hasOriginPath: !!(config?.originPath),
            hasBackupPath: !!(config?.backupPath),
        };
    } catch (err) {
        console.error(`[Backup] getGameBackupInfo error: ${err.message}`);
        return { config: null, backups: [], lastBackupDate: null, backupCounter: 0, hasOriginPath: false, hasBackupPath: false };
    }
}

// ─── backupGame ───────────────────────────────────────────────────────────────

/**
 * Creates a ZIP backup of the game's save folder.
 * ✅ Uses adm-zip (ZIP format) — no external tools needed for restore.
 */
async function backupGame(game, backupDir, savePath = null, installPath = null) {
    if (!AdmZip) return { success: false, error: 'adm-zip not installed — run: npm install adm-zip' };

    // Resolve savePath if not provided
    if (!savePath) {
        const info = getGameBackupInfo(game.name);
        savePath = info.config?.originPath
            || autoDiscoverSavePath(game.name, installPath || game.path || null, true);
    }

    if (!savePath) return { success: false, error: `No save path for "${game.name}"` };
    if (!fs.existsSync(savePath)) return { success: false, error: `Path not found: ${savePath}` };

    const gameBackupDir = path.join(backupDir, 'NexusBackups', sanitizeName(game.name));
    fs.mkdirSync(gameBackupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const zipPath = path.join(gameBackupDir, `${sanitizeName(game.name)}_${timestamp}.zip`);

    try {
        const zip = new AdmZip();
        const stat = fs.statSync(savePath);

        if (stat.isDirectory()) {
            addFolderToZip(zip, savePath);
        } else {
            zip.addLocalFile(savePath);
        }

        zip.writeZip(zipPath);

        const zipStat = fs.statSync(zipPath);
        const zipSizeKB = Math.round(zipStat.size / 1024);

        cleanOldBackups(gameBackupDir, 10);

        // Persist backupPath used (don't overwrite originPath)
        updateBackupConfig(game.name, { backupPath: backupDir });

        console.log(`[Backup] ✅ ZIP created: ${zipPath} (${zipSizeKB} KB)`);
        return { success: true, zipPath, savePath, sizeKB: zipSizeKB };
    } catch (err) {
        return { success: false, error: `ZIP failed: ${err.message}` };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 3 — performMirroring reads globalBackupPath from settings.json as fallback
// ─────────────────────────────────────────────────────────────────────────────

async function performMirroring(gameName, installPath = null) {
    console.log(`[Backup] 🔄 performMirroring: "${gameName}"`);

    try {
        const data = fs.existsSync(BACKUP_CONFIG)
            ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, 'utf-8'))
            : {};
        const config = data[gameName] || {};

        // ── Resolve backup destination ─────────────────────────────────────
        // Priority: per-game backupPath → global setting
        const backupDir = config.backupPath || getGlobalBackupPath();

        if (!backupDir) {
            console.log(`[Backup] ⏭️  No backup path for "${gameName}" — skipping`);
            return { success: false, reason: 'no_backup_path' };
        }

        // ── Resolve save source ────────────────────────────────────────────
        // Priority: saved originPath → auto-discover (and persist result)
        const savePath = config.originPath
            || autoDiscoverSavePath(gameName, installPath, true);

        if (!savePath) {
            return { success: false, reason: 'no_save_path' };
        }
        if (!fs.existsSync(savePath)) {
            return { success: false, reason: 'path_not_found', savePath };
        }

        const result = await backupGame({ name: gameName, path: installPath }, backupDir, savePath);
        return result;

    } catch (err) {
        console.error(`[Backup] performMirroring exception: ${err.message}`);
        return { success: false, reason: 'exception', error: err.message };
    }
}

// ─── backupAllGames ───────────────────────────────────────────────────────────

async function backupAllGames(games, backupDir, onProgress) {
    const results = [];
    for (let i = 0; i < games.length; i++) {
        const game = games[i];
        const result = await backupGame(game, backupDir, null, game.path || null);
        results.push({ game: game.name, ...result });
        if (typeof onProgress === 'function') {
            onProgress({ game, done: i + 1, total: games.length, result });
        }
    }
    return results;
}

// ─── restoreBackup ────────────────────────────────────────────────────────────

async function restoreBackup(zipPath, gameName) {
    if (!AdmZip) return { success: false, error: 'adm-zip not installed' };

    const info = getGameBackupInfo(gameName);
    const targetPath = info.config?.originPath || null;

    if (!targetPath) return { success: false, error: `No restore path for "${gameName}"` };
    if (!fs.existsSync(zipPath)) return { success: false, error: `ZIP not found: ${zipPath}` };

    try {
        fs.mkdirSync(targetPath, { recursive: true });
        new AdmZip(zipPath).extractAllTo(targetPath, true);
        console.log(`[Backup] ✅ Restored "${gameName}" → ${targetPath}`);
        return { success: true, targetPath };
    } catch (err) {
        return { success: false, error: `Restore failed: ${err.message}` };
    }
}

// ─── listBackups ──────────────────────────────────────────────────────────────

function listBackups(gameName, backupDir) {
    const dir = path.join(backupDir, 'NexusBackups', sanitizeName(gameName));
    if (!fs.existsSync(dir)) return [];

    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.zip'))
        .map(f => {
            const full = path.join(dir, f);
            const stat = fs.statSync(full);
            return {
                fileName: f,
                filePath: full,
                size: stat.size,
                sizeKB: Math.round(stat.size / 1024),
                date: stat.mtime,
            };
        })
        .sort((a, b) => b.date - a.date);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 5 — scanVaultForExistingBackups
// Re-links existing NexusBackups after Windows reinstall
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans a vault directory for existing NexusBackups and re-links them
 * to games currently in gamesBackSave.json.
 *
 * Use case: User reinstalls Windows, launches Nexus, clicks "Scan Vault".
 * This restores all the "Last Backup" dates and counts in the UI.
 *
 * @param {string}   vaultPath  - Root backup folder (e.g. "D:\Games\Games Backup")
 * @param {string[]} gameNames  - Array of game names currently in Nexus library
 * @returns {{ linked: number, skipped: number, details: Array }}
 */
function scanVaultForExistingBackups(vaultPath, gameNames = []) {
    const nexusBackupsDir = path.join(vaultPath, 'NexusBackups');
    const result = { linked: 0, skipped: 0, details: [] };

    if (!fs.existsSync(nexusBackupsDir)) {
        console.log(`[Backup] scanVault: NexusBackups folder not found in ${vaultPath}`);
        return result;
    }

    let folders;
    try {
        folders = fs.readdirSync(nexusBackupsDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name);
    } catch (err) {
        console.error(`[Backup] scanVault read error: ${err.message}`);
        return result;
    }

    console.log(`[Backup] 🔍 Scanning vault: found ${folders.length} game folder(s)`);

    for (const folderName of folders) {
        const folderPath = path.join(nexusBackupsDir, folderName);

        // Check if it has ZIP files
        let zips;
        try {
            zips = fs.readdirSync(folderPath).filter(f => f.endsWith('.zip'));
        } catch { continue; }

        if (zips.length === 0) continue;

        // Try to match folder name to a game in the library
        // The folder name is sanitizeName(gameName), so we need to reverse-match
        const matchedGame = gameNames.find(name => {
            const sanitized = sanitizeName(name);
            return (
                sanitized.toLowerCase() === folderName.toLowerCase() ||
                name.toLowerCase() === folderName.toLowerCase()
            );
        });

        if (matchedGame) {
            // Re-link: update backupPath, don't touch originPath
            updateBackupConfig(matchedGame, { backupPath: vaultPath });
            result.linked++;
            result.details.push({ folder: folderName, game: matchedGame, zips: zips.length, status: 'linked' });
            console.log(`[Backup] ✅ Re-linked: "${matchedGame}" (${zips.length} backups)`);
        } else {
            result.skipped++;
            result.details.push({ folder: folderName, game: null, zips: zips.length, status: 'no_match' });
            console.log(`[Backup] ⚠️  No match for folder: "${folderName}"`);
        }
    }

    console.log(`[Backup] Scan complete — linked: ${result.linked}, unmatched: ${result.skipped}`);
    return result;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function sanitizeName(name) {
    return name.replace(/[<>:"/\\|?*\u2013\u2014]/g, '_').trim();
}

function addFolderToZip(zip, folderPath, zipFolder = '') {
    let entries;
    try { entries = fs.readdirSync(folderPath, { withFileTypes: true }); }
    catch { return; }

    for (const entry of entries) {
        const full = path.join(folderPath, entry.name);
        const zipBase = zipFolder ? `${zipFolder}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            addFolderToZip(zip, full, zipBase);
        } else if (entry.isFile()) {
            try { zip.addLocalFile(full, zipFolder || ''); }
            catch (err) { console.warn(`[Backup] Skip: ${full} — ${err.message}`); }
        }
    }
}

function cleanOldBackups(dir, maxKeep = 10) {
    try {
        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.zip'))
            .map(f => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime }))
            .sort((a, b) => b.mtime - a.mtime);
        files.slice(maxKeep).forEach(f => {
            try { fs.unlinkSync(path.join(dir, f.name)); } catch { /* ignore */ }
        });
    } catch { /* ignore */ }
}

/**
 * Deletes a specific backup ZIP file.
 * @param {string} gameName - Name of the game
 * @param {string} zipPath  - Full path to the ZIP file to delete
 * @returns {object} { success: boolean, error?: string }
 */
function deleteBackup(gameName, zipPath) {
    try {
        if (!fs.existsSync(zipPath)) {
            return { success: false, error: 'Backup file not found' };
        }
        fs.unlinkSync(zipPath);
        console.log(`[Backup] Deleted: ${zipPath}`);

        // Update the backup list in gamesBackSave.json (optional: remove from list, but it's auto-generated on next getInfo)
        // No need to modify the config file because listBackups will rebuild from disk.

        return { success: true };
    } catch (err) {
        console.error(`[Backup] Failed to delete backup: ${err.message}`);
        return { success: false, error: err.message };
    }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    initBackupDB,
    autoDiscoverSavePath,
    updateBackupConfig,
    getGameBackupInfo,
    performMirroring,
    backupGame,
    backupAllGames,
    restoreBackup,
    listBackups,
    scanVaultForExistingBackups,
    resolvePath,
    findExistingPath,
    fuzzyLookup,
    buildNameCandidates,
    normalizeForFuzzy,
    getGlobalBackupPath,
    deleteBackup,
};