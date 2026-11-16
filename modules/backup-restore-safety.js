'use strict';
// Restore only a verified game archive, preserving the live save as a recoverable sibling.
// No writes to the live save occur until staging and verification have completed.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILES = 30000;
const MAX_UNCOMPRESSED = 4 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;

class RestoreSafetyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RestoreSafetyError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(code, message, details) {
  throw new RestoreSafetyError(code, message, details);
}

function realExisting(location) {
  try { return fs.realpathSync(location); }
  catch (error) { fail('RESTORE_PATH_MISSING', `Path unavailable: ${error.code || error.message}`); }
}

function sameOrBelow(root, candidate) {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

function assertNoLinksInPath(location) {
  const full = path.resolve(location);
  let cursor = path.parse(full).root;
  const parts = path.relative(cursor, full).split(path.sep).filter(Boolean);
  for (const part of parts) {
    cursor = path.join(cursor, part);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') continue;
      fail('RESTORE_PATH_UNREADABLE', `Cannot inspect path: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail('RESTORE_LINK_UNSUPPORTED', 'Restore target uses a symbolic link or junction.');
  }
}

function checkTarget(targetPath, archiveDir) {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    fail('RESTORE_TARGET_INVALID', 'Configured save path must be absolute.');
  }
  const target = path.resolve(targetPath);
  const parent = path.dirname(target);
  const base = path.basename(target);
  if (target === path.parse(target).root || parent === target || !base || base === '.' || base === '..' ||
      parent === path.parse(parent).root || target === require('node:os').homedir()) {
    fail('RESTORE_TARGET_DANGEROUS', 'Save path is too broad for an automatic restore.');
  }
  // Never replace broad profile folders, launcher data, or OS directories.
  const os = require('node:os');
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const protectedRoots = [home, os.tmpdir(), appData, localData,
    path.join(appData, 'Nexus Game Launcher'),
    path.join(home, 'Desktop'), path.join(home, 'Documents'),
    path.join(home, 'Documents', 'My Games'), path.join(home, 'Downloads'),
    path.join(home, 'Saved Games'), path.join(home, 'AppData'),
    process.env.PROGRAMDATA, process.env.USERPROFILE];
  const eq = (a, b) => process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
  if (protectedRoots.filter(Boolean).some(root => eq(root, target))) {
    fail('RESTORE_TARGET_DANGEROUS', 'Configured save path is a broad user or application folder.');
  }
  const windowsRoot = process.env.WINDIR || process.env.SystemRoot;
  if (windowsRoot && sameOrBelow(windowsRoot, target)) {
    fail('RESTORE_TARGET_DANGEROUS', 'Restore target is inside the Windows system folder.');
  }
  assertNoLinksInPath(target);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    fail('RESTORE_PARENT_MISSING', 'Restore parent folder does not exist. Reconfirm the save path first.');
  }
  const canonicalParent = realExisting(parent);
  const actualTarget = path.join(canonicalParent, base);
  const vaultArchives = path.dirname(archiveDir);
  if (sameOrBelow(vaultArchives, actualTarget) || sameOrBelow(actualTarget, archiveDir)) {
    fail('RESTORE_VAULT_OVERLAP', 'Restore target and archive folder overlap.');
  }
  return { target, parent, exists: fs.existsSync(target) };
}

function fileEntries(zip, rawEntries) {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > MAX_FILES + 500) {
    fail('RESTORE_ARCHIVE_ENTRY_COUNT', 'Archive entry count is invalid or too large.');
  }
  const names = new Set();
  const files = [];
  let total = 0;
  for (const entry of rawEntries) {
    const raw = String(entry?.entryName || '');
    const directory = !!entry?.isDirectory || raw.endsWith('/');
    const clean = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const parts = clean.split('/');
    if (!clean || clean.length > 1024 || raw.includes('\\') || clean.startsWith('/') ||
      clean.includes('\u0000') || /^[A-Za-z]:/.test(clean) || parts.length > 24 ||
      parts.some(p => !p || p === '.' || p === '..' || p.length > 240 ||
        /[<>:"|?*\u0000-\u001f]/.test(p) || /[. ]$/.test(p) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
      fail('RESTORE_ZIP_ENTRY_UNSAFE', 'Archive contains a path that is unsafe on Windows.');
    }
    const unixMode = Number(entry?.header?.attr || 0) >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      fail('RESTORE_ZIP_LINK', 'Archive contains a symbolic link.');
    }
    const key = clean.toLowerCase();
    if (names.has(key)) fail('RESTORE_ZIP_DUPLICATE', 'Archive contains duplicate or case-colliding paths.');
    names.add(key);
    if (directory) continue;
    const bytes = Number(entry?.header?.size);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) {
      fail('RESTORE_ZIP_SIZE_INVALID', 'Archive entry size is invalid or too large.');
    }
    total += bytes;
    if (total > MAX_UNCOMPRESSED) fail('RESTORE_ZIP_TOO_LARGE', 'Archive exceeds the restore size limit.');
    files.push({ entry, name: clean, bytes, parts });
    if (files.length > MAX_FILES) fail('RESTORE_ZIP_TOO_MANY_FILES', 'Archive contains too many save files.');
  }
  if (files.length === 0) fail('RESTORE_ZIP_EMPTY', 'Archive contains no save files.');
  const fileKeys = new Set(files.map(f => f.name.toLowerCase()));
  for (const file of files) {
    for (let i = 1; i < file.parts.length; i++) {
      if (fileKeys.has(file.parts.slice(0, i).join('/').toLowerCase())) {
        fail('RESTORE_ZIP_FILE_DIR_CONFLICT', 'Archive has conflicting file and folder names.');
      }
    }
  }
  return files;
}

function checkArchive(zipPath, backupRoot, gameFolder, ZipCtor) {
  if (typeof ZipCtor !== 'function' || typeof zipPath !== 'string' ||
      typeof backupRoot !== 'string' || !path.isAbsolute(zipPath) || !path.isAbsolute(backupRoot) ||
      typeof gameFolder !== 'string' || !gameFolder.trim() || gameFolder === '.' || gameFolder === '..' ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(gameFolder) || /[. ]$/.test(gameFolder)) {
    fail('RESTORE_ARGUMENT_INVALID', 'Archive, vault, or game identity is invalid.');
  }
  const expectedDir = path.join(path.resolve(backupRoot), 'NexusBackups', gameFolder);
  if (!fs.existsSync(zipPath) || !fs.existsSync(expectedDir)) {
    fail('RESTORE_ARCHIVE_NOT_FOUND', 'Archive or configured game vault not found.');
  }
  assertNoLinksInPath(zipPath);
  let stat;
  try { stat = fs.lstatSync(zipPath); }
  catch (error) { fail('RESTORE_ARCHIVE_NOT_FOUND', error.message); }
  if (!stat.isFile() || stat.isSymbolicLink() || !zipPath.toLowerCase().endsWith('.zip')) {
    fail('RESTORE_ARCHIVE_INVALID', 'Expected a regular ZIP archive.');
  }
  const realDir = realExisting(expectedDir);
  const realZip = realExisting(zipPath);
  if (path.dirname(realZip).toLowerCase() !== realDir.toLowerCase()) {
    fail('RESTORE_ARCHIVE_OUTSIDE_VAULT', 'Archive is not inside the configured game vault.');
  }
  const filename = path.basename(zipPath);
  if (!filename.startsWith(gameFolder + '_') || !filename.toLowerCase().endsWith('.zip')) {
    fail('RESTORE_GAME_IDENTITY_MISMATCH', 'Archive filename does not match the exact game name.');
  }
  let archive;
  try { archive = new ZipCtor(realZip); }
  catch (error) { fail('RESTORE_ZIP_OPEN_FAILED', `Cannot open archive: ${error.message}`); }
  if (!archive || typeof archive.getEntries !== 'function' ||
      typeof archive.test !== 'function' || typeof archive.readFile !== 'function') {
    fail('RESTORE_ZIP_VALIDATION_UNAVAILABLE', 'ZIP integrity verification is unavailable.');
  }
  let files;
  try { files = fileEntries(archive, archive.getEntries()); }
  catch (error) {
    if (error instanceof RestoreSafetyError) throw error;
    fail('RESTORE_ZIP_READ_FAILED', error.message);
  }
  try { if (archive.test() !== true) fail('RESTORE_ZIP_CORRUPT', 'ZIP CRC verification failed.'); }
  catch (error) {
    if (error instanceof RestoreSafetyError) throw error;
    fail('RESTORE_ZIP_CORRUPT', `ZIP integrity verification failed: ${error.message}`);
  }
  return { archive, files, archiveDir: realDir };
}

function inventoryExistingTarget(target) {
  if (!fs.existsSync(target)) return { exists: false, kind: null, inventory: [] };
  const result = [];
  let bytes = 0;
  const visit = (current, depth) => {
    if (depth > 28 || result.length >= MAX_FILES) fail('RESTORE_TARGET_TOO_COMPLEX', 'Save tree exceeds safe limits.');
    const st = fs.lstatSync(current);
    if (st.isSymbolicLink()) fail('RESTORE_LINK_UNSUPPORTED', 'Save tree contains a symbolic link.');
    if (st.isFile()) {
      bytes += st.size;
      if (bytes > MAX_UNCOMPRESSED) fail('RESTORE_TARGET_TOO_LARGE', 'Existing save data exceeds safe staging limit.');
      result.push({ path: current, kind: 'file', bytes: st.size, modified: st.mtimeMs });
    } else if (st.isDirectory()) {
      result.push({ path: current, kind: 'directory', modified: st.mtimeMs });
      for (const child of fs.readdirSync(current).sort()) visit(path.join(current, child), depth + 1);
    } else fail('RESTORE_TARGET_UNSUPPORTED', 'Save folder contains a non-file entry.');
  };
  visit(target, 0);
  const st = fs.lstatSync(target);
  return { exists: true, kind: st.isFile() ? 'file' : 'directory', inventory: result };
}

function assertTargetUnchanged(target, before) {
  const after = inventoryExistingTarget(target);
  if (before.exists !== after.exists || before.kind !== after.kind || before.inventory.length !== after.inventory.length) {
    fail('RESTORE_TARGET_CHANGED', 'Live save tree changed during staging.');
  }
  for (let i = 0; i < before.inventory.length; i++) {
    const a = before.inventory[i];
    const b = after.inventory[i];
    if (a.path !== b.path || a.kind !== b.kind || a.modified !== b.modified ||
        (a.kind === 'file' && a.bytes !== b.bytes)) {
      fail('RESTORE_TARGET_CHANGED', 'Live save tree changed during staging.');
    }
  }
}

function verifyStagedFile(filename, contents) {
  const digest = buf => crypto.createHash('sha256').update(buf).digest('hex');
  if (digest(fs.readFileSync(filename)) !== digest(contents)) {
    fail('RESTORE_STAGE_VERIFICATION_FAILED', 'Staged file does not match the verified ZIP content.');
  }
}

function restoreVerifiedSave({ zipPath, gameName, sourcePath, backupRoot, ZipCtor, onBeforeCommit }) {
  const safeName = String(gameName || '').replace(/[<>:"/\\|?*\u2013\u2014]/g, '_').trim();
  const { archive, files, archiveDir } = checkArchive(zipPath, backupRoot, safeName, ZipCtor);
  const { target, parent, exists } = checkTarget(sourcePath, archiveDir);
  const state = inventoryExistingTarget(target);
  const asSingleFile = files.length === 1 && files[0].name.toLowerCase() === path.basename(target).toLowerCase();
  const kind = state.kind || (asSingleFile ? 'file' : 'directory');
  if ((kind === 'file' && !asSingleFile) || (kind === 'directory' && state.kind === 'file')) {
    fail('RESTORE_TARGET_TYPE_MISMATCH', 'ZIP content does not match the configured save file type.');
  }
  const token = crypto.randomUUID();
  const stage = path.join(parent, `.nexus-restore-stage-${token}`);
  const recovery = path.join(parent, `.nexus-restore-recovery-${path.basename(target)}-${token}`);
  let movedOriginal = false;
  let committed = false;
  try {
    if (kind === 'directory') {
      if (exists) fs.cpSync(target, stage, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true });
      else fs.mkdirSync(stage);
    }
    for (const file of files) {
      const destination = kind === 'file' ? stage : path.join(stage, ...file.parts);
      if (kind === 'directory' && !sameOrBelow(stage, destination)) {
        fail('RESTORE_ZIP_ENTRY_UNSAFE', 'Archive entry escaped the temporary restore directory.');
      }
      const contents = archive.readFile(file.entry);
      if (!Buffer.isBuffer(contents) || contents.length !== file.bytes) {
        fail('RESTORE_ZIP_CONTENT_MISMATCH', 'ZIP contents do not match declared file size.');
      }
      if (kind === 'directory') fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, contents, { flag: 'w' });
      verifyStagedFile(destination, contents);
    }
    assertTargetUnchanged(target, state);
    if (typeof onBeforeCommit === 'function') onBeforeCommit({ stage, target, recovery });
    if (exists) {
      fs.renameSync(target, recovery);
      movedOriginal = true;
    }
    fs.renameSync(stage, target);
    committed = true;
    return { targetPath: target, recoveryPath: movedOriginal ? recovery : null,
      previousSavePreserved: movedOriginal, restoredFiles: files.length };
  } catch (error) {
    if (movedOriginal && !committed) {
      try { fs.renameSync(recovery, target); }
      catch (rollbackError) {
        fail('RESTORE_ROLLBACK_FAILED', `Restore failed; original saves preserved at ${recovery}. Rollback: ${rollbackError.message}`,
          { recoveryPath: recovery });
      }
    }
    if (error instanceof RestoreSafetyError) throw error;
    fail('RESTORE_STAGE_OR_COMMIT_FAILED', `Restore was not completed: ${error.message}`);
  } finally {
    // Never delete a recovery snapshot. Only remove the staging path created by this call.
    try { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { RestoreSafetyError, restoreVerifiedSave, fileEntries, checkArchive };
