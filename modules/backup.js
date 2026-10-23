/**
 * modules/backup.js — Nexus Game Launcher v2.1 (Strict Game Isolation)
 */
const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");

let AdmZip;
try {
  AdmZip = require("adm-zip");
} catch {
  console.warn("[Backup] adm-zip not installed — run: npm install adm-zip");
}

// ─── Constants ────────────────────────────────────────────────────────────────

const USER_DATA = path.join(
  os.homedir(),
  "AppData",
  "Roaming",
  "Nexus Game Launcher",
);
const SAVE_PATHS_DB = path.join(USER_DATA, "gameSavePaths.json");
const BACKUP_CONFIG = path.join(USER_DATA, "gamesBackSave.json");
const SETTINGS_FILE = path.join(USER_DATA, "settings.json");

if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });

// ─── Settings helpers ─────────────────────────────────────────────────────────

function readSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE))
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    /* ignore */
  }
  return {};
}

function getGlobalBackupPath() {
  return readSettings().globalBackupPath || "";
}

// ─── Ensure gameSavePaths.json exists in user data ───────────────────────────
function ensureSavePathsDB() {
  if (fs.existsSync(SAVE_PATHS_DB)) return true;

  let sourcePath = process.resourcesPath
    ? path.join(process.resourcesPath, "gameSavePaths.json")
    : "";
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    sourcePath = path.join(__dirname, "../gameSavePaths.json");
  }
  if (!fs.existsSync(sourcePath)) {
    console.warn(
      "[Backup] gameSavePaths.json not found in resources – save path auto‑discovery may be limited",
    );
    return false;
  }

  try {
    fs.copyFileSync(sourcePath, SAVE_PATHS_DB);
    console.log(`[Backup] ✅ Copied gameSavePaths.json to ${SAVE_PATHS_DB}`);
    return true;
  } catch (err) {
    console.error("[Backup] Failed to copy gameSavePaths.json:", err.message);
    return false;
  }
}

// ─── initBackupDB ─────────────────────────────────────────────────────────────

function initBackupDB() {
  ensureSavePathsDB();
  if (!fs.existsSync(BACKUP_CONFIG)) {
    fs.writeFileSync(BACKUP_CONFIG, JSON.stringify({}, null, 2), "utf-8");
    console.log("[Backup] gamesBackSave.json created");
  }
}

// ─── Strict Normalization & Candidate Building ───────────────────────────────

const normCache = new Map();
function normalizeForFuzzy(str) {
  if (!str || typeof str !== "string") return "";
  if (normCache.has(str)) return normCache.get(str);
  const result = str
    .toLowerCase()
    .replace(/[\u2013\u2014\u2012\u2212\ufe58\ufe63\uff0d]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u02BC]/g, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /\s*[:\-–]\s*(the\s+)?(definitive|complete|ultimate|deluxe|enhanced|remastered|gold|goty|anniversary)\s+edition\s*$/i,
      "",
    )
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  normCache.set(str, result);
  return result;
}

/**
 * Builds strict whole-title variations for a game name.
 * Never splits colons/subtitles into partial words to prevent cross-game collisions.
 */
function buildNameCandidates(gameName) {
  const candidates = new Set();
  const add = (s) => {
    const norm = normalizeForFuzzy(s);
    if (norm && norm.length >= 2) candidates.add(norm);
  };

  if (!gameName || typeof gameName !== "string") return [];
  const base = gameName.trim();
  add(base);

  // Remove year suffix: "Resident Evil 4 (2023)" → "Resident Evil 4"
  const noYear = base.replace(/\s*[\[(]?\d{4}[\])]?\s*$/, "").trim();
  if (noYear !== base) add(noYear);

  // "The" prefix swap
  if (base.toLowerCase().startsWith("the ")) {
    add(base.slice(4) + ", The");
    add(base.slice(4));
  }

  return [...candidates];
}

/**
 * Strict lookup against gameSavePaths.json.
 * Only allows exact normalized full-title match or exact alias match.
 * Partial substring and word-overlap guessing are disabled to prevent cross-game contamination.
 */
function fuzzyLookup(db, gameName) {
  if (!db || !gameName) return null;

  const candidates = buildNameCandidates(gameName);
  if (!candidates.length) return null;

  const normKeyMap = new Map();
  for (const key of Object.keys(db)) {
    const norm = normalizeForFuzzy(key);
    if (norm) normKeyMap.set(norm, key);
  }

  // Pass 1: Normalized exact full-title match
  for (const candidate of candidates) {
    if (normKeyMap.has(candidate)) {
      const realKey = normKeyMap.get(candidate);
      console.log(
        `[Backup] 🎯 Exact title match: "${realKey}" ← "${candidate}"`,
      );
      return { entry: db[realKey], matchedKey: realKey };
    }
  }

  // Pass 2: Normalized exact alias match
  for (const candidate of candidates) {
    for (const [key, entry] of Object.entries(db)) {
      if (!Array.isArray(entry?.aliases)) continue;
      if (entry.aliases.some((a) => normalizeForFuzzy(a) === candidate)) {
        console.log(
          `[Backup] 🎯 Exact alias match: "${key}" via "${candidate}"`,
        );
        return { entry, matchedKey: key };
      }
    }
  }

  return null;
}

// ─── Path Resolution ──────────────────────────────────────────────────────────

function resolvePath(rawPath, installPath = null) {
  if (!rawPath) return null;
  if (rawPath.includes("<xdgConfig>") || rawPath.includes("<xdgData>"))
    return null;
  if (rawPath === "Goldberg Steam Emulator") return null;

  const gameDir = installPath ? path.dirname(installPath) : null;

  const vars = {
    "{{p|userprofile}}": os.homedir(),
    "{{p|localappdata}}":
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "{{p|appdata}}":
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "{{p|documents}}": path.join(os.homedir(), "Documents"),
    "{{p|savedgames}}": path.join(os.homedir(), "Saved Games"),
    "{{p|programdata}}": process.env.PROGRAMDATA || "C:\\ProgramData",
    "{{p|public}}": "C:\\Users\\Public",
    "{{p|publicdocuments}}": "C:\\Users\\Public\\Documents",
    "{{p|game}}": gameDir,
    "{{p|steam}}": process.env.STEAM_PATH || "C:\\Program Files (x86)\\Steam",
    "{{p|steamuserdata}}": path.join(
      process.env.STEAM_PATH || "C:\\Program Files (x86)\\Steam",
      "userdata",
    ),
    "<winLocalAppData>":
      process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "<winAppData>":
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
    "<winDocuments>": path.join(os.homedir(), "Documents"),
    "<winSavedGames>": path.join(os.homedir(), "Saved Games"),
    "<winProgramData>": process.env.PROGRAMDATA || "C:\\ProgramData",
    "<winPublic>": "C:\\Users\\Public",
    "<home>": os.homedir(),
    "<root>": gameDir,
    "<base>": gameDir,
  };

  let resolved = rawPath;
  for (const [key, value] of Object.entries(vars)) {
    if (!value) continue;
    const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    resolved = resolved.replace(regex, value);
  }
  resolved = resolved.replace(
    /%([^%]+)%/gi,
    (_, v) => process.env[v.toUpperCase()] || `%${v}%`,
  );
  resolved = resolved.replace(/\//g, "\\");
  return path.normalize(resolved);
}

// ─── Wildcard Resolution ──────────────────────────────────────────────────────

function resolveWildcard(rawPath) {
  if (!rawPath) return null;
  let workPath = rawPath.replace(/<storeUserId>/gi, "*");
  if (!workPath.includes("*")) return workPath;

  try {
    const starIdx = workPath.indexOf("*");
    const before = workPath.slice(0, starIdx).replace(/[/\\]$/, "");
    const afterStar = workPath.slice(starIdx + 1).replace(/^[/\\]/, "");

    if (!fs.existsSync(before)) return null;

    const entries = fs.readdirSync(before, { withFileTypes: true });
    const dir = entries.find((e) => e.isDirectory() && !e.name.startsWith("."));
    if (!dir) return null;

    const joined = afterStar
      ? path.join(before, dir.name, afterStar)
      : path.join(before, dir.name);

    return joined.includes("*") ? resolveWildcard(joined) : joined;
  } catch {
    return null;
  }
}

// ─── Find Existing Path ───────────────────────────────────────────────────────

function findExistingPath(paths, installPath = null) {
  for (const rawPath of paths) {
    if (!rawPath || rawPath === "Goldberg Steam Emulator") continue;
    if (rawPath.includes("<xdgConfig>") || rawPath.includes("<xdgData>"))
      continue;

    let resolved = resolvePath(rawPath, installPath);
    if (!resolved) continue;

    if (resolved.includes("*") || rawPath.includes("<storeUserId>")) {
      resolved = resolveWildcard(resolved);
      if (!resolved) continue;
    }

    try {
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ─── Strict Heuristic Search (Exact Folder Name Match Only) ──────────────────

function heuristicSearch(gameName) {
  const roots = [
    path.join(os.homedir(), "Documents", "My Games"),
    path.join(os.homedir(), "Saved Games"),
  ].filter(Boolean);

  const terms = new Set(
    buildNameCandidates(gameName).filter((c) => c.length >= 4),
  );
  if (!terms.size) return null;

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root);
      for (const entry of entries) {
        const entryNorm = normalizeForFuzzy(entry);
        if (!entryNorm || entryNorm.length < 4) continue;
        if (terms.has(entryNorm)) {
          const full = path.join(root, entry);
          try {
            if (fs.statSync(full).isDirectory()) {
              console.log(
                `[Backup] 🔎 Exact folder match: "${gameName}" → ${full}`,
              );
              return full;
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Discovers candidate save path for a game without persisting by default.
 * @param {string}      gameName    - Game display name
 * @param {string|null} installPath - Path to game .exe
 * @param {boolean}     persist     - Write to gamesBackSave.json on success (default: false)
 * @returns {string|null}
 */
function autoDiscoverSavePath(gameName, installPath = null, persist = false) {
  let found = null;

  if (fs.existsSync(SAVE_PATHS_DB)) {
    try {
      const db = JSON.parse(fs.readFileSync(SAVE_PATHS_DB, "utf-8"));
      const match = fuzzyLookup(db, gameName);

      if (match?.entry?.paths?.length > 0) {
        found = findExistingPath(match.entry.paths, installPath);
        if (found) {
          console.log(
            `[Backup] ✅ DB path for "${gameName}" [${match.matchedKey}]: ${found}`,
          );
        } else {
          console.log(
            `[Backup] ⚠️ DB entry found [${match.matchedKey}] but paths don't exist on disk`,
          );
        }
      } else {
        console.log(`[Backup] No exact DB entry for "${gameName}"`);
      }
    } catch (err) {
      console.error(`[Backup] DB read error: ${err.message}`);
    }
  }

  if (!found) {
    found = heuristicSearch(gameName);
  }

  if (found && persist === true) {
    const globalBackupPath = getGlobalBackupPath();
    updateBackupConfig(gameName, {
      originPath: found,
      ...(globalBackupPath ? { backupPath: globalBackupPath } : {}),
    });
    console.log(`[Backup] 💾 originPath written for "${gameName}": ${found}`);
  }

  if (!found) {
    console.log(`[Backup] ❌ No verified save path found for "${gameName}"`);
  }

  return found;
}

// ─── updateBackupConfig ───────────────────────────────────────────────────────

function updateBackupConfig(gameName, config) {
  if (!gameName || typeof gameName !== "string") return false;
  try {
    const data = fs.existsSync(BACKUP_CONFIG)
      ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, "utf-8"))
      : {};

    const existing = data[gameName] || {};
    data[gameName] = {
      ...existing,
      ...config,
      originPath:
        config.originPath !== undefined
          ? config.originPath
          : existing.originPath || "",
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(BACKUP_CONFIG, JSON.stringify(data, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error(`[Backup] updateBackupConfig error: ${err.message}`);
    return false;
  }
}

// ─── getGameBackupInfo ────────────────────────────────────────────────────────

function getGameBackupInfo(gameName) {
  if (!gameName || typeof gameName !== "string") {
    return {
      config: null,
      backups: [],
      lastBackupDate: null,
      backupCounter: 0,
      hasOriginPath: false,
      hasBackupPath: false,
    };
  }
  try {
    const data = fs.existsSync(BACKUP_CONFIG)
      ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, "utf-8"))
      : {};
    const config = Object.prototype.hasOwnProperty.call(data, gameName)
      ? data[gameName]
      : null;

    const globalPath = getGlobalBackupPath();
    const backupPath = config?.backupPath || globalPath;

    const backupList = backupPath ? listBackups(gameName, backupPath) : [];
    const lastBackup = backupList[0] || null;
    const lastBackupDate = lastBackup
      ? new Date(lastBackup.date).toLocaleString("en-GB", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    return {
      config,
      backups: backupList,
      lastBackupDate,
      backupCounter: backupList.length,
      hasOriginPath: !!config?.originPath,
      hasBackupPath: !!config?.backupPath,
    };
  } catch (err) {
    console.error(`[Backup] getGameBackupInfo error: ${err.message}`);
    return {
      config: null,
      backups: [],
      lastBackupDate: null,
      backupCounter: 0,
      hasOriginPath: false,
      hasBackupPath: false,
    };
  }
}

// ─── backupGame ───────────────────────────────────────────────────────────────

/**
 * Creates a ZIP backup of the game's verified save folder.
 * Never guesses or auto-saves an unverified path silently.
 */
async function backupGame(
  game,
  backupDir,
  savePath = null,
  installPath = null,
) {
  if (!AdmZip)
    return {
      success: false,
      code: "ADMZIP_MISSING",
      error: "adm-zip not installed — run: npm install adm-zip",
    };
  if (!game || !game.name)
    return {
      success: false,
      code: "INVALID_GAME",
      error: "Game name is missing",
    };

  if (!savePath) {
    const info = getGameBackupInfo(game.name);
    savePath = info.config?.originPath || null;
  }

  if (!savePath) {
    return {
      success: false,
      code: "NO_SAVE_PATH_CONFIGURED",
      error: `No confirmed save path configured for "${game.name}". Please run Discover Save Location or set it in Edit Game first.`,
    };
  }
  if (!fs.existsSync(savePath)) {
    return {
      success: false,
      code: "SAVE_PATH_MISSING_ON_DISK",
      error: `Configured save path does not exist on disk: ${savePath}`,
    };
  }

  const safeGameFolder = sanitizeName(game.name);
  const gameBackupDir = path.join(backupDir, "NexusBackups", safeGameFolder);
  fs.mkdirSync(gameBackupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const zipPath = path.join(
    gameBackupDir,
    `${safeGameFolder}_${timestamp}.zip`,
  );

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

    updateBackupConfig(game.name, { backupPath: backupDir });

    console.log(`[Backup] ✅ ZIP created: ${zipPath} (${zipSizeKB} KB)`);
    return { success: true, zipPath, savePath, sizeKB: zipSizeKB };
  } catch (err) {
    return {
      success: false,
      code: "ZIP_WRITE_FAILED",
      error: `ZIP failed: ${err.message}`,
    };
  }
}

// ─── performMirroring ─────────────────────────────────────────────────────────

async function performMirroring(gameName, installPath = null) {
  console.log(`[Backup] 🔄 performMirroring: "${gameName}"`);

  try {
    const data = fs.existsSync(BACKUP_CONFIG)
      ? JSON.parse(fs.readFileSync(BACKUP_CONFIG, "utf-8"))
      : {};
    const config = Object.prototype.hasOwnProperty.call(data, gameName)
      ? data[gameName]
      : {};

    const backupDir = config.backupPath || getGlobalBackupPath();
    if (!backupDir) {
      console.log(`[Backup] ⏭️ No backup path for "${gameName}" — skipping`);
      return { success: false, reason: "no_backup_path" };
    }

    const savePath = config.originPath || null;
    if (!savePath) {
      console.log(
        `[Backup] ⏭️ No confirmed originPath for "${gameName}" — skipping silent auto-discovery`,
      );
      return { success: false, reason: "no_save_path" };
    }
    if (!fs.existsSync(savePath)) {
      return { success: false, reason: "path_not_found", savePath };
    }

    return await backupGame(
      { name: gameName, path: installPath },
      backupDir,
      savePath,
    );
  } catch (err) {
    console.error(`[Backup] performMirroring exception: ${err.message}`);
    return { success: false, reason: "exception", error: err.message };
  }
}

// ─── backupAllGames ───────────────────────────────────────────────────────────

async function backupAllGames(games, backupDir, onProgress) {
  const results = [];
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const result = await backupGame(game, backupDir, null, game.path || null);
    results.push({ game: game.name, ...result });
    if (typeof onProgress === "function") {
      onProgress({ game, done: i + 1, total: games.length, result });
    }
  }
  return results;
}

// ─── Helper: Verify ZIP belongs to target game folder ─────────────────────────

function isZipOwnedByGame(zipPath, gameName) {
  if (!zipPath || !gameName) return false;
  const expectedFolder = sanitizeName(gameName).toLowerCase();
  const parentFolder = path
    .basename(path.dirname(path.normalize(zipPath)))
    .toLowerCase();
  return parentFolder === expectedFolder;
}

// ─── restoreBackup ────────────────────────────────────────────────────────────

async function restoreBackup(zipPath, gameName) {
  if (!AdmZip)
    return {
      success: false,
      code: "ADMZIP_MISSING",
      error: "adm-zip not installed",
    };
  if (!gameName)
    return {
      success: false,
      code: "INVALID_GAME",
      error: "Game name is required for restore",
    };

  if (!isZipOwnedByGame(zipPath, gameName)) {
    return {
      success: false,
      code: "GAME_ARCHIVE_MISMATCH",
      error: `Archive "${path.basename(zipPath || "")}" does not belong to "${gameName}". Restore aborted.`,
    };
  }

  const info = getGameBackupInfo(gameName);
  const targetPath = info.config?.originPath || null;

  if (!targetPath)
    return {
      success: false,
      code: "NO_SAVE_PATH_CONFIGURED",
      error: `No restore path configured for "${gameName}"`,
    };
  if (!fs.existsSync(zipPath))
    return {
      success: false,
      code: "ARCHIVE_NOT_FOUND",
      error: `ZIP not found: ${zipPath}`,
    };

  try {
    fs.mkdirSync(targetPath, { recursive: true });
    new AdmZip(zipPath).extractAllTo(targetPath, true);
    console.log(`[Backup] ✅ Restored "${gameName}" → ${targetPath}`);
    return { success: true, targetPath };
  } catch (err) {
    return {
      success: false,
      code: "RESTORE_EXTRACT_FAILED",
      error: `Restore failed: ${err.message}`,
    };
  }
}

// ─── listBackups ──────────────────────────────────────────────────────────────

function listBackups(gameName, backupDir) {
  if (!gameName || !backupDir) return [];
  const safeGameFolder = sanitizeName(gameName);
  const dir = path.join(backupDir, "NexusBackups", safeGameFolder);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => {
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

// ─── scanVaultForExistingBackups ──────────────────────────────────────────────

function scanVaultForExistingBackups(vaultPath, gameNames = []) {
  const nexusBackupsDir = path.join(vaultPath, "NexusBackups");
  const result = { linked: 0, skipped: 0, details: [] };

  if (!fs.existsSync(nexusBackupsDir)) {
    console.log(
      `[Backup] scanVault: NexusBackups folder not found in ${vaultPath}`,
    );
    return result;
  }

  let folders;
  try {
    folders = fs
      .readdirSync(nexusBackupsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    console.error(`[Backup] scanVault read error: ${err.message}`);
    return result;
  }

  for (const folderName of folders) {
    const folderPath = path.join(nexusBackupsDir, folderName);

    let zips;
    try {
      zips = fs.readdirSync(folderPath).filter((f) => f.endsWith(".zip"));
    } catch {
      continue;
    }

    if (zips.length === 0) continue;

    const matchedGame = gameNames.find((name) => {
      const sanitized = sanitizeName(name);
      return (
        sanitized.toLowerCase() === folderName.toLowerCase() ||
        name.toLowerCase() === folderName.toLowerCase()
      );
    });

    if (matchedGame) {
      updateBackupConfig(matchedGame, { backupPath: vaultPath });
      result.linked++;
      result.details.push({
        folder: folderName,
        game: matchedGame,
        zips: zips.length,
        status: "linked",
      });
    } else {
      result.skipped++;
      result.details.push({
        folder: folderName,
        game: null,
        zips: zips.length,
        status: "no_match",
      });
    }
  }

  return result;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function sanitizeName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\u2013\u2014]/g, "_")
    .trim();
}

function addFolderToZip(zip, folderPath, zipFolder = "") {
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(folderPath, entry.name);
    const zipBase = zipFolder ? `${zipFolder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      addFolderToZip(zip, full, zipBase);
    } else if (entry.isFile()) {
      try {
        zip.addLocalFile(full, zipFolder || "");
      } catch (err) {
        console.warn(`[Backup] Skip: ${full} — ${err.message}`);
      }
    }
  }
}

function cleanOldBackups(dir, maxKeep = 10) {
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".zip"))
      .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    files.slice(maxKeep).forEach((f) => {
      try {
        fs.unlinkSync(path.join(dir, f.name));
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

function deleteBackup(gameName, zipPath) {
  try {
    if (!isZipOwnedByGame(zipPath, gameName)) {
      return {
        success: false,
        code: "GAME_ARCHIVE_MISMATCH",
        error: `Backup file does not belong to "${gameName}"`,
      };
    }
    if (!fs.existsSync(zipPath)) {
      return {
        success: false,
        code: "ARCHIVE_NOT_FOUND",
        error: "Backup file not found",
      };
    }
    fs.unlinkSync(zipPath);
    console.log(`[Backup] Deleted: ${zipPath}`);
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
