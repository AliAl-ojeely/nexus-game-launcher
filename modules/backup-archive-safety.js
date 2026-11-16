'use strict';
// Fail-closed ZIP creation for confirmed game-save paths only.
// Never modifies live saves, settings, or existing backup archives.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class ArchiveSafetyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArchiveSafetyError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new ArchiveSafetyError(code, message);
}

function sameOrBelow(parent, candidate) {
  const base = path.resolve(parent);
  const item = path.resolve(candidate);
  const rel = path.relative(base, item);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function realPathAllowMissing(location) {
  let cursor = path.resolve(location);
  const missing = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
  const resolved = fs.existsSync(cursor) ? fs.realpathSync(cursor) : cursor;
  return path.resolve(resolved, ...missing);
}

function checkNoOverlap(sourcePath, backupRoot, gameFolder = 'Game') {
  // Compare the actual destination directory, not the entire vault root.
  // A global vault on C:\\ or Documents can safely coexist with saves in a sibling path.
  const destination = path.join(backupRoot, 'NexusBackups', gameFolder);
  const source = realPathAllowMissing(sourcePath);
  const target = realPathAllowMissing(destination);
  if (sameOrBelow(source, target) || sameOrBelow(target, source)) {
    reject('SAVE_VAULT_PATH_OVERLAP', 'The backup archive location overlaps the save path.');
  }
}

function inventorySaveFiles(sourcePath) {
  const root = path.resolve(sourcePath);
  let rootStat;
  try { rootStat = fs.lstatSync(root); }
  catch (error) { reject('SAVE_PATH_UNREADABLE', `Save path unavailable: ${error.code || error.message}`); }
  if (rootStat.isSymbolicLink()) reject('SAVE_LINK_NOT_SUPPORTED', 'Save root is a link; manual review required.');
  if (!rootStat.isFile() && !rootStat.isDirectory()) reject('SAVE_PATH_UNSUPPORTED', 'Save path is not a file or directory.');

  const result = [];
  const register = (absolute, relative) => {
    if (result.length >= 30000) reject('SAVE_TOO_MANY_FILES', 'More than 30,000 save files; manual review required.');
    const st = fs.lstatSync(absolute);
    if (!st.isFile() || st.isSymbolicLink()) reject('SAVE_ENTRY_UNSUPPORTED', 'Non-regular save file found.');
    if (!Number.isSafeInteger(st.size) || st.size < 0) reject('SAVE_SIZE_INVALID', 'Save file size is invalid.');
    const name = relative.replace(/\\/g, '/');
    if (name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) {
      reject('SAVE_ENTRY_INVALID', 'Unsafe archive entry name.');
    }
    result.push({ absolute, name, bytes: st.size, modified: st.mtimeMs });
  };
  const walk = (dir, base) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      const relative = base ? path.join(base, entry.name) : entry.name;
      if (entry.isSymbolicLink()) reject('SAVE_LINK_NOT_SUPPORTED', 'Save folder contains a link; manual review required.');
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.isFile()) register(absolute, relative);
      else reject('SAVE_ENTRY_UNSUPPORTED', 'Save folder contains an unsupported file type.');
    }
  };
  try {
    if (rootStat.isFile()) register(root, path.basename(root));
    else walk(root, '');
  } catch (error) {
    if (error instanceof ArchiveSafetyError) throw error;
    reject('SAVE_SCAN_FAILED', `Cannot read all save files: ${error.code || error.message}`);
  }
  if (!result.length) reject('NO_SAVE_FILES', 'Save location contains no files; refusing an empty backup.');
  return result;
}

function verifySourceUnchanged(items) {
  for (const item of items) {
    let stat;
    try { stat = fs.lstatSync(item.absolute); }
    catch { reject('SAVE_CHANGED_DURING_BACKUP', 'Save file disappeared while creating archive.'); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== item.bytes || stat.mtimeMs !== item.modified) {
      reject('SAVE_CHANGED_DURING_BACKUP', 'Save file changed while creating archive.');
    }
  }
}

function verifyArchive(zipPath, expectedFiles, ZipCtor) {
  let zip;
  try { zip = new ZipCtor(zipPath); }
  catch (error) { reject('ZIP_VALIDATION_FAILED', `Cannot open written ZIP: ${error.message}`); }
  if (!zip || typeof zip.getEntries !== 'function' || typeof zip.test !== 'function') {
    reject('ZIP_VALIDATION_UNAVAILABLE', 'ZIP validation interface unavailable.');
  }
  let entries;
  try { entries = zip.getEntries(); }
  catch (error) { reject('ZIP_VALIDATION_FAILED', `Cannot read ZIP entries: ${error.message}`); }
  const actual = new Map();
  for (const entry of entries) {
    const name = String(entry.entryName || '');
    if (name.startsWith('/') || name.startsWith('\\') || name.includes('\\') ||
      name.split('/').some(part => part === '..' || part === '.') || /^[A-Za-z]:/.test(name)) {
      reject('ZIP_ENTRY_UNSAFE', 'Archive contains an unsafe path.');
    }
    if (entry.isDirectory) continue;
    if (!name || actual.has(name.toLowerCase())) reject('ZIP_DUPLICATE_ENTRY', 'Duplicate or empty archive entry.');
    actual.set(name.toLowerCase(), entry);
  }
  if (actual.size !== expectedFiles.length) reject('ZIP_ENTRY_COUNT_MISMATCH', 'ZIP file count does not match source.');
  for (const item of expectedFiles) {
    const entry = actual.get(item.name.toLowerCase());
    if (!entry || entry.entryName !== item.name || Number(entry.header?.size) !== item.bytes) {
      reject('ZIP_ENTRY_MISMATCH', 'ZIP entry path or size does not match source.');
    }
  }
  try {
    if (zip.test() !== true) reject('ZIP_INTEGRITY_FAILED', 'ZIP CRC/integrity test failed.');
  } catch (error) {
    if (error instanceof ArchiveSafetyError) throw error;
    reject('ZIP_INTEGRITY_FAILED', `ZIP integrity check raised an error: ${error.message}`);
  }
  return true;
}

function createVerifiedBackupZip({ sourcePath, backupRoot, gameFolder, ZipCtor }) {
  if (typeof ZipCtor !== 'function') reject('ADMZIP_MISSING', 'ZIP creator not available.');
  if (typeof sourcePath !== 'string' || typeof backupRoot !== 'string' ||
    typeof gameFolder !== 'string' || !gameFolder.trim() || gameFolder === '.' || gameFolder === '..' ||
    /[<>:"/\\|?*]/.test(gameFolder) || gameFolder.endsWith('.') || gameFolder.endsWith(' ')) {
    reject('BACKUP_ARGUMENT_INVALID', 'Source, vault, or game folder is invalid.');
  }
  if (!path.isAbsolute(sourcePath) || !path.isAbsolute(backupRoot)) {
    reject('BACKUP_PATH_NOT_ABSOLUTE', 'Save and backup paths must be absolute.');
  }
  const source = path.resolve(sourcePath);
  const vault = path.resolve(backupRoot);
  checkNoOverlap(source, vault, gameFolder);
  const files = inventorySaveFiles(source);
  const gameDir = path.join(vault, 'NexusBackups', gameFolder);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basename = `${gameFolder}_${timestamp}_${crypto.randomBytes(5).toString('hex')}`;
  const finalPath = path.join(gameDir, basename + '.zip');
  const tempPath = path.join(gameDir, basename + '.partial');

  try {
    fs.mkdirSync(gameDir, { recursive: true });
    const zip = new ZipCtor();
    for (const file of files) {
      const directory = path.posix.dirname(file.name);
      zip.addLocalFile(file.absolute, directory === '.' ? '' : directory);
    }
    zip.writeZip(tempPath);
    if (!fs.statSync(tempPath).isFile() || fs.statSync(tempPath).size === 0) {
      reject('ZIP_EMPTY_OUTPUT', 'ZIP writer produced an empty archive.');
    }
    verifyArchive(tempPath, files, ZipCtor);
    verifySourceUnchanged(files);
    // A new unique path ensures that existing archives are not replaced.
    if (fs.existsSync(finalPath)) reject('BACKUP_NAME_COLLISION', 'Archive filename collision.');
    fs.renameSync(tempPath, finalPath);
    return { zipPath: finalPath, sizeKB: Math.round(fs.statSync(finalPath).size / 1024), files: files.length };
  } catch (error) {
    if (error instanceof ArchiveSafetyError) throw error;
    reject('ZIP_WRITE_FAILED', error.message);
  } finally {
    // The only automatic deletion is a temporary, incomplete archive created here.
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  }
}

module.exports = { ArchiveSafetyError, inventorySaveFiles, verifyArchive, createVerifiedBackupZip, checkNoOverlap };
