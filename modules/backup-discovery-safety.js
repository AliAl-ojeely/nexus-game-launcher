'use strict';
// Fail closed on ambiguous account wildcards and report backup configuration safely.
// All functions are read-only and never edit game saves, user configuration, or vaults.
const fs = require('node:fs');
const path = require('node:path');

const MAX_SCAN_ENTRIES = 2000;
const MAX_DEPTH = 32;
const MAX_CONFIG_BYTES = 16 * 1024 * 1024;

function resolveWildcardUnique(value, io = fs) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return null;
  const expanded = value.replace(/<storeUserId>/gi, '*');
  if (!path.isAbsolute(expanded)) return null;
  const normalized = path.normalize(expanded);
  const root = path.parse(normalized).root;
  const relative = path.relative(root, normalized);
  const pieces = relative.split(path.sep).filter(Boolean);
  if (!pieces.length || pieces.length > MAX_DEPTH || pieces.some(p =>
      p === '.' || p === '..' || (p.includes('*') && p !== '*') ||
      /[<>?\[\]{}%]/.test(p))) return null;
  if (!pieces.includes('*')) return expanded;

  let examined = 0;
  let exceeded = false;
  const matches = [];
  function walk(current, index) {
    if (matches.length > 1 || exceeded) return;
    if (++examined > MAX_SCAN_ENTRIES) { exceeded = true; return; }
    if (index === pieces.length) {
      try {
        const stat = io.lstatSync(current);
        if (stat.isFile() || stat.isDirectory()) matches.push(current);
      } catch { /* missing candidate */ }
      return;
    }
    const component = pieces[index];
    if (component === '*') {
      let entries;
      try { entries = io.readdirSync(current, { withFileTypes: true }); }
      catch { return; }
      if (entries.length + examined > MAX_SCAN_ENTRIES) { exceeded = true; return; }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.')) {
          walk(path.join(current, entry.name), index + 1);
          if (matches.length > 1 || exceeded) return;
        }
      }
      return;
    }
    const next = path.join(current, component);
    try {
      const stat = io.lstatSync(next);
      if (stat.isSymbolicLink()) return;
      if (index < pieces.length - 1 && !stat.isDirectory()) return;
      walk(next, index + 1);
    } catch { /* missing candidate */ }
  }
  walk(root, 0);
  return !exceeded && matches.length === 1 ? matches[0] : null;
}

function auditBackupConfiguration(config, { existsSync = fs.existsSync } = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('Backup configuration must be a JSON object.');
  }
  const entries = Object.entries(config);
  const groups = new Map();
  const result = {
    records: entries.length,
    configuredSaves: 0,
    existingSavePaths: 0,
    missingSavePaths: 0,
    unconfiguredSaves: 0,
    configuredVaults: 0,
    existingVaultRoots: 0,
    missingVaultRoots: 0,
    caseCollisionGroups: 0,
    caseCollisionExtraRecords: 0,
    collisions: [],
  };
  for (const [name, raw] of entries) {
    const configItem = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const save = typeof configItem.originPath === 'string' ? configItem.originPath.trim() : '';
    const vault = typeof configItem.backupPath === 'string' ? configItem.backupPath.trim() : '';
    const saveExists = !!save && existsSync(save);
    const vaultExists = !!vault && existsSync(vault);
    if (save) { result.configuredSaves++; if (saveExists) result.existingSavePaths++; else result.missingSavePaths++; }
    else result.unconfiguredSaves++;
    if (vault) { result.configuredVaults++; if (vaultExists) result.existingVaultRoots++; else result.missingVaultRoots++; }
    const key = name.normalize('NFKC').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      name, saveConfigured: !!save, saveExists,
      vaultConfigured: !!vault, vaultExists,
      // Intentionally excludes filesystem locations and credentials.
    });
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    result.caseCollisionGroups++;
    result.caseCollisionExtraRecords += group.length - 1;
    result.collisions.push(group);
  }
  return result;
}

function auditBackupFile(filename, { io = fs } = {}) {
  const stat = io.statSync(filename);
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new Error('Backup configuration is not a regular JSON file within the audit size limit.');
  }
  const config = JSON.parse(io.readFileSync(filename, 'utf8'));
  return auditBackupConfiguration(config, { existsSync: p => io.existsSync(p) });
}

module.exports = { resolveWildcardUnique, auditBackupConfiguration, auditBackupFile };
