'use strict';
// Strict read-only vault inventory and guarded explicit actions.
const fs = require('node:fs');
const path = require('node:path');

const LIMITS = Object.freeze({ folders: 1200, archives: 6000, entries: 30000,
  archiveBytes: 4 * 1024 ** 3, expandedBytes: 4 * 1024 ** 3, entryBytes: 512 * 1024 ** 2 });

class VaultIntegrityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VaultIntegrityError';
    this.code = code;
  }
}
function fail(code, reason) { throw new VaultIntegrityError(code, reason); }
function caseKey(name) { return String(name).toLocaleLowerCase('en-US'); }
function safeGameFolder(name) {
  const folder = String(name || '').replace(/[<>:"/\\|?*\u2013\u2014]/g, '_').trim();
  if (!folder || folder === '.' || folder === '..' || /[. ]$/.test(folder) ||
      /[\u0000-\u001f]/.test(folder) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)) {
    fail('VAULT_GAME_ID_INVALID', 'Game folder name is not safe for a vault.');
  }
  return folder;
}
function assertAbsolute(location, code) {
  if (typeof location !== 'string' || !path.isAbsolute(location)) {
    fail(code, 'An absolute path is required.');
  }
  return path.resolve(location);
}
function requireNoLinks(location) {
  const full = path.resolve(location);
  const base = path.parse(full).root;
  let cursor = base;
  for (const section of path.relative(base, full).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, section);
    let s;
    try { s = fs.lstatSync(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') return false;
      fail('VAULT_PATH_UNREADABLE', 'Cannot inspect the vault path.');
    }
    if (s.isSymbolicLink()) fail('VAULT_LINK_UNSUPPORTED', 'Vault path includes a symbolic link or junction.');
  }
  return true;
}
function inspectVaultRoot(vaultRoot) {
  const root = assertAbsolute(vaultRoot, 'VAULT_PATH_INVALID');
  if (!requireNoLinks(root)) return { root, nexusRoot: path.join(root, 'NexusBackups'), exists: false };
  const nexusRoot = path.join(root, 'NexusBackups');
  if (!requireNoLinks(nexusRoot)) return { root, nexusRoot, exists: false };
  const s = fs.lstatSync(nexusRoot);
  if (!s.isDirectory()) fail('VAULT_STRUCTURE_INVALID', 'NexusBackups is not a directory.');
  return { root, nexusRoot, exists: true };
}
function isSafeEntryName(raw, directory) {
  const clean = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  const parts = clean.split('/');
  if (!clean || clean.length > 1024 || raw.includes('\\') || clean.startsWith('/') ||
      /^[A-Za-z]:/.test(clean) || parts.length > 24 ||
      parts.some(part => !part || part === '.' || part === '..' || part.length > 240 ||
        /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return false;
  return true;
}

// Inspect CRC and entry metadata without extracting anything into live saves.
function inspectArchive({ zipPath, gameFolder, ZipCtor }) {
  if (typeof ZipCtor !== 'function') fail('VAULT_ZIP_UNAVAILABLE', 'adm-zip is required for integrity checks.');
  const filename = assertAbsolute(zipPath, 'VAULT_ARCHIVE_PATH_INVALID');
  const folder = safeGameFolder(gameFolder);
  if (!requireNoLinks(filename)) fail('VAULT_ARCHIVE_MISSING', 'Archive does not exist.');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || !path.basename(filename).startsWith(folder + '_') ||
      !path.basename(filename).endsWith('.zip')) {
    fail('VAULT_ARCHIVE_IDENTITY', 'Archive filename or file type does not match the game.');
  }
  if (stat.size <= 0 || stat.size > LIMITS.archiveBytes) fail('VAULT_ARCHIVE_SIZE', 'Archive size is outside safe limits.');
  let zip, entries;
  try { zip = new ZipCtor(filename); entries = zip.getEntries(); }
  catch { fail('VAULT_ARCHIVE_OPEN_FAILED', 'Archive could not be opened.'); }
  if (!zip || typeof zip.test !== 'function' || !Array.isArray(entries) ||
      entries.length < 1 || entries.length > LIMITS.entries + 500) {
    fail('VAULT_ARCHIVE_ENTRIES', 'ZIP entry list is unavailable or exceeds limits.');
  }
  let expanded = 0, files = 0;
  const seen = new Set();
  const fileNames = new Set();
  const hierarchical = [];
  for (const entry of entries) {
    const name = String(entry?.entryName || '');
    const directory = !!entry?.isDirectory || name.endsWith('/');
    if (!isSafeEntryName(name, directory)) fail('VAULT_ZIP_ENTRY_UNSAFE', 'Archive has an unsafe entry name.');
    const normalized = directory && name.endsWith('/') ? name.slice(0, -1) : name;
    const key = caseKey(normalized);
    if (seen.has(key)) fail('VAULT_ZIP_DUPLICATE', 'Archive has duplicate or case-colliding names.');
    seen.add(key);
    const mode = Number(entry?.header?.attr || 0) >>> 16;
    if ((mode & 0o170000) === 0o120000) fail('VAULT_ZIP_LINK', 'Archive contains a symbolic link.');
    if (directory) continue;
    const size = Number(entry?.header?.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > LIMITS.entryBytes) {
      fail('VAULT_ZIP_ENTRY_SIZE', 'Archive entry is too large or has invalid size.');
    }
    expanded += size;
    if (expanded > LIMITS.expandedBytes) fail('VAULT_ZIP_EXPANDED_SIZE', 'Archive expanded size exceeds limit.');
    files++;
    fileNames.add(key);
    hierarchical.push(normalized.split('/'));
    if (files > LIMITS.entries) fail('VAULT_ZIP_TOO_MANY_FILES', 'Archive has too many files.');
  }
  if (!files) fail('VAULT_ZIP_EMPTY', 'Archive contains no files.');
  for (const parts of hierarchical) {
    for (let n = 1; n < parts.length; n++) {
      if (fileNames.has(caseKey(parts.slice(0, n).join('/')))) {
        fail('VAULT_ZIP_FILE_DIR_CONFLICT', 'Archive contains file/directory conflicts.');
      }
    }
  }
  try { if (zip.test() !== true) fail('VAULT_ZIP_CRC', 'Archive CRC verification failed.'); }
  catch (error) {
    if (error instanceof VaultIntegrityError) throw error;
    fail('VAULT_ZIP_CRC', 'Archive CRC verification failed.');
  }
  return { files, expandedBytes: expanded, archiveBytes: stat.size };
}

// Read-only inventory. Nothing is automatically linked, deleted, or repaired here.
function auditVault({ vaultRoot, gameNames = [], ZipCtor, quick = false }) {
  if (typeof ZipCtor !== 'function') fail('VAULT_ZIP_UNAVAILABLE', 'adm-zip is required for integrity checks.');
  const target = inspectVaultRoot(vaultRoot);
  const summary = { vaultExists: target.exists, gameFolders: 0, candidateArchives: 0,
    verifiedArchives: 0, rejectedArchives: 0, ignoredFiles: 0, ambiguousFolders: 0,
    unrecognizedFolders: 0, caseMismatchFolders: 0, eligibleGameFolders: 0,
    unsafeFolders: 0, entries: [] };
  if (!target.exists) return summary;
  if (!Array.isArray(gameNames) || gameNames.length > 20000) {
    fail('VAULT_GAME_LIST_INVALID', 'Game list must be a bounded array.');
  }
  const namesByFolder = new Map();
  for (const name of gameNames) {
    if (typeof name !== 'string' || !name.trim()) continue;
    let folder;
    try { folder = safeGameFolder(name); } catch { continue; }
    const key = caseKey(folder);
    if (!namesByFolder.has(key)) namesByFolder.set(key, []);
    namesByFolder.get(key).push({ name, folder });
  }
  let folders;
  try { folders = fs.readdirSync(target.nexusRoot, { withFileTypes: true }); }
  catch { fail('VAULT_SCAN_FAILED', 'Could not list vault folders.'); }
  if (folders.length > LIMITS.folders) fail('VAULT_SCAN_BUDGET', 'Too many vault folders for a safe scan.');
  for (const entry of folders) {
    if (entry.isSymbolicLink()) { summary.unsafeFolders++; continue; }
    if (!entry.isDirectory()) { summary.ignoredFiles++; continue; }
    summary.gameFolders++;
    const folderName = entry.name;
    const matches = namesByFolder.get(caseKey(folderName)) || [];
    const detail = { folder: folderName, game: null, zips: 0, verified: 0, rejected: 0, status: '' };
    if (matches.length > 1) {
      summary.ambiguousFolders++;
      detail.status = 'ambiguous_name';
    } else if (!matches.length) {
      summary.unrecognizedFolders++;
      detail.status = 'no_match';
    } else if (matches[0].folder !== folderName) {
      summary.caseMismatchFolders++;
      detail.status = 'case_mismatch';
    } else {
      detail.game = matches[0].name;
      detail.status = 'no_valid_archive';
    }
    const gameDir = path.join(target.nexusRoot, folderName);
    if (!requireNoLinks(gameDir)) { detail.status = 'unsafe_path'; summary.unsafeFolders++; summary.entries.push(detail); continue; }
    let archiveItems;
    try { archiveItems = fs.readdirSync(gameDir, { withFileTypes: true }); }
    catch { detail.status = 'unreadable'; summary.entries.push(detail); continue; }
    // Prefer newest timestamped archive during explicit re-link; the full CLI audit checks all.
    if (quick) archiveItems.sort((a, b) => b.name.localeCompare(a.name));
    if (summary.candidateArchives + archiveItems.length > LIMITS.archives) {
      fail('VAULT_SCAN_BUDGET', 'Too many archive entries for a safe scan.');
    }
    for (const item of archiveItems) {
      if (!item.isFile() || !item.name.toLowerCase().endsWith('.zip')) { summary.ignoredFiles++; continue; }
      summary.candidateArchives++;
      detail.zips++;
      if (!detail.game || (quick && detail.verified > 0)) continue;
      try {
        inspectArchive({ zipPath: path.join(gameDir, item.name), gameFolder: folderName, ZipCtor });
        summary.verifiedArchives++;
        detail.verified++;
      } catch {
        summary.rejectedArchives++;
        detail.rejected++;
      }
    }
    if (detail.game && detail.verified > 0) {
      detail.status = 'eligible';
      summary.eligibleGameFolders++;
    }
    summary.entries.push(detail);
  }
  return summary;
}

// Deletion requires an exact configured vault and another verified recovery ZIP.
function guardArchiveDeletion({ zipPath, gameName, vaultRoot, configNames = [], ZipCtor }) {
  const folder = safeGameFolder(gameName);
  const target = inspectVaultRoot(vaultRoot);
  if (!target.exists) fail('VAULT_ROOT_MISSING', 'Configured vault does not exist.');
  const names = Array.isArray(configNames) ? configNames : [];
  if (names.filter(n => caseKey(n) === caseKey(gameName)).length > 1) {
    fail('VAULT_GAME_AMBIGUOUS', 'Case-colliding game names must be resolved manually before deletion.');
  }
  const expected = path.join(target.nexusRoot, folder);
  if (!requireNoLinks(expected) || !fs.lstatSync(expected).isDirectory()) {
    fail('VAULT_GAME_FOLDER_INVALID', 'Game folder is missing or unsafe.');
  }
  const selected = assertAbsolute(zipPath, 'VAULT_ARCHIVE_PATH_INVALID');
  if (!requireNoLinks(selected)) fail('VAULT_ARCHIVE_MISSING', 'Archive is missing.');
  if (path.dirname(selected) !== expected) {
    fail('VAULT_ARCHIVE_OUTSIDE', 'Archive is not in the exact configured game vault.');
  }
  // The selected ZIP must be a valid regular archive, not a stale or arbitrary file.
  inspectArchive({ zipPath: selected, gameFolder: folder, ZipCtor });
  const others = fs.readdirSync(expected).filter(n => n.endsWith('.zip') && n !== path.basename(selected));
  if (others.length > LIMITS.archives) fail('VAULT_SCAN_BUDGET', 'Too many archives in game vault.');
  let preserved = false;
  for (const name of others) {
    try {
      inspectArchive({ zipPath: path.join(expected, name), gameFolder: folder, ZipCtor });
      preserved = true; break;
    } catch { /* invalid backups cannot protect the last known-good archive */ }
  }
  if (!preserved) fail('VAULT_LAST_VERIFIED', 'Refusing to remove the last verified backup.');
  return { permitted: true, verifiedOtherArchive: true };
}

module.exports = { VaultIntegrityError, safeGameFolder, inspectArchive, auditVault, guardArchiveDeletion };
