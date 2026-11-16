'use strict';
// Metadata-only, bounded pre/post-game snapshot worker. Never opens file contents.
const fs = require('node:fs');
const path = require('node:path');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');

const SKIP_DIR = new Set([
  '.git', 'node_modules', 'windows', 'program files', 'program files (x86)', '$recycle.bin',
  'system volume information', 'appdata', 'cache', 'caches', 'temp', 'tmp', 'crashdumps',
  'logs', 'log', 'dumps', '.cache', 'webcache', 'service worker', 'code cache', 'gpu cache',
  'google', 'mozilla', 'bravesoftware', 'microsoft', 'discord', 'telegram desktop',
  'signal', 'credentials', 'keychain', 'secrets', 'passwords', 'cookies', 'extensions',
]);
const IGNORE_FILE = /(?:\.(?:tmp|log|lock|journal|dmp|bak~|cache)|^thumbs\.db$|^desktop\.ini$)/i;
const SAVE_EXTENSION = /\.(?:sav|save|dat|bin|rpgsave|rvdata2?|rxdata|sol|srm|state|json|profile|ini|slot|saves|db)$/i;
const SAVE_DIR = /^(?:save|saves|saved|savedata|savegame|savegames|profiles?|userdata|remote|playerdata|persist|persistent)$/i;
const DEFAULT_BUDGET = Object.freeze({ maxDirs: 25000, maxFiles: 65000, maxMs: 18000 });
function safeStat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function normalized(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
    .replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function collectLegacy(roots, budget = {}) {
  const limits = {
    maxDirs: Math.max(40, Math.min(DEFAULT_BUDGET.maxDirs, Number(budget.maxDirs) || DEFAULT_BUDGET.maxDirs)),
    maxFiles: Math.max(100, Math.min(DEFAULT_BUDGET.maxFiles, Number(budget.maxFiles) || DEFAULT_BUDGET.maxFiles)),
    maxMs: Math.max(1000, Math.min(DEFAULT_BUDGET.maxMs, Number(budget.maxMs) || DEFAULT_BUDGET.maxMs)),
  };
  const start = Date.now(), visited = new Set();
  const files = Object.create(null);
  let scannedDirectories = 0, scannedFiles = 0, partial = false, depthLimited = false, skippedLinks = 0, blockedFiles = 0;
  const queue = [];
  for (const r of Array.isArray(roots) ? roots.slice(0, 12) : []) {
    if (typeof r?.root !== 'string' || !path.isAbsolute(r.root) || r.root.length > 1024) continue;
    const st = safeStat(r.root);
    if (!st?.isDirectory() || st.isSymbolicLink()) { partial = true; continue; }
    queue.push({ root: path.resolve(r.root), path: path.resolve(r.root), depth: 0,
      maxDepth: Math.min(8, Math.max(1, Number(r.maxDepth) || 4)), kind: String(r.kind || 'root') });
  }
  // Each scope is scanned before descending into less relevant roots.
  let cursor = 0;
  while (cursor < queue.length) {
    if (Date.now() - start >= limits.maxMs || scannedDirectories >= limits.maxDirs || scannedFiles >= limits.maxFiles) {
      partial = true;
      break;
    }
    const item = queue[cursor++];
    const key = item.path.toLocaleLowerCase('en-US');
    if (visited.has(key)) continue;
    visited.add(key);
    const currentStat = safeStat(item.path);
    if (!currentStat?.isDirectory() || currentStat.isSymbolicLink()) { skippedLinks++; continue; }
    let entries;
    try { entries = fs.readdirSync(item.path, { withFileTypes: true }); }
    catch { partial = true; continue; }
    scannedDirectories++;
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const e of entries) {
      if (scannedFiles >= limits.maxFiles || Date.now() - start >= limits.maxMs) { partial = true; break; }
      if (e.isSymbolicLink()) { skippedLinks++; continue; }
      const full = path.join(item.path, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name.toLocaleLowerCase('en-US'))) continue;
        if (item.depth >= item.maxDepth) { depthLimited = true; continue; }
        queue.push({ ...item, path: full, depth: item.depth + 1 });
      } else if (e.isFile()) {
        if (IGNORE_FILE.test(e.name)) { blockedFiles++; continue; }
        const stat = safeStat(full);
        if (!stat?.isFile() || stat.isSymbolicLink()) continue;
        files[full] = [stat.size, Math.round(stat.mtimeMs)];
        scannedFiles++;
      }
    }
    if (partial && (scannedFiles >= limits.maxFiles || Date.now() - start >= limits.maxMs)) break;
  }
  return { files, scannedDirectories, scannedFiles, partial, depthLimited, skippedLinks, blockedFiles, elapsedMs: Date.now() - start };
}
function within(file, root) {
  const rel = path.relative(root, file);
  return rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
function candidateDir(fileName, scope) {
  const rel = path.relative(scope.root, fileName);
  const parts = rel.split(path.sep).filter(Boolean);
  if (!parts.length) return '';
  const folders = parts.slice(0, -1);
  // A nested SaveGames/remote directory is more precise than the installation or AppData root.
  for (let i = folders.length - 1; i >= 0; i--) {
    if (SAVE_DIR.test(folders[i])) return path.join(scope.root, ...folders.slice(0, i + 1));
  }
  if (!folders.length) return scope.kind === 'chosen-root' ? scope.root : '';
  if (scope.kind === 'game-install') return path.join(scope.root, ...folders);
  if (scope.kind === 'unity-locallow' && folders.length >= 2) return path.join(scope.root, ...folders.slice(0, 2));
  if (scope.kind === 'gse-saves' && folders.length >= 2) return path.join(scope.root, ...folders.slice(0, Math.min(4, folders.length)));
  return path.join(scope.root, ...folders.slice(0, Math.min(2, folders.length)));
}
function compareSnapshots(before, after, roots, identity = {}) {
  const baseline = before && typeof before === 'object' && !Array.isArray(before) ? before : {};
  const changed = [];
  for (const [name, state] of Object.entries(after.files || {})) {
    const old = baseline[name];
    if (!old || old[0] !== state[0] || old[1] !== state[1]) changed.push(name);
  }
  const folders = new Map();
  const title = normalized(identity.title);
  const steamId = /^\d{1,12}$/.test(String(identity.steamAppId || '')) ? String(identity.steamAppId) : '';
  for (const fileName of changed) {
    const matches = roots.filter(r => within(fileName, r.root));
    if (!matches.length) continue;
    // Prefer specific observation roots, not their broad ancestors.
    matches.sort((a, b) => b.root.length - a.root.length);
    const scope = matches[0];
    const folder = candidateDir(fileName, scope);
    if (!folder || folder === scope.root && scope.kind !== 'chosen-root') continue;
    const key = path.resolve(folder).toLocaleLowerCase('en-US');
    const current = folders.get(key) || { path: folder, changedFiles: 0, saveLike: 0,
      nameMatch: false, steamMatch: false, scope: scope.originalKind || scope.kind };
    current.changedFiles++;
    if (SAVE_EXTENSION.test(fileName) || /(?:^|[\\/])(?:save|saves|savedata|savegames|remote)(?:[\\/])/i.test(fileName)) current.saveLike++;
    const components = path.relative(scope.root, folder).split(path.sep).map(normalized);
    if (title && components.some(x => x === title)) current.nameMatch = true;
    if (steamId && components.includes(steamId)) current.steamMatch = true;
    folders.set(key, current);
  }
  const candidates = [...folders.values()].filter(f => f.changedFiles > 0).map(f => {
    const confidence = Math.min(84, 25 + (f.nameMatch ? 30 : 0) + (f.steamMatch ? 28 : 0) +
      (f.saveLike ? 13 : 0) + (f.changedFiles > 1 ? 6 : 0));
    return { path: f.path, confidence, changedFiles: f.changedFiles, evidenceKind: f.scope,
      files: f.changedFiles, bytes: 0, kind: 'directory', partial: false };
  }).sort((a, b) => {
    // Prefer exact game-scoped evidence over busy unrelated application caches.
    const relevance = c => {
      const specific = new Set(['confirmed-save', 'manifest-save', 'upstream-save', 'chosen-root', 'game-install']);
      const components = path.resolve(c.path).split(path.sep).filter(Boolean);
      const compact = s => normalized(s).replace(/\s+/g, '');
      const titleMatch = title && components.some(x => compact(x) === compact(title));
      const steamMatch = steamId && components.some(x => x === steamId);
      return (specific.has(c.evidenceKind) ? 100 : 0) + (titleMatch ? 45 : 0) + (steamMatch ? 40 : 0);
    };
    return relevance(b) - relevance(a) || b.confidence - a.confidence || b.changedFiles - a.changedFiles;
  });
  return { ...after, changedFiles: changed.length, candidates: candidates.slice(0, 100) };
}

const previous = { collect: collectLegacy, compareSnapshots };
const DEFAULTS = Object.freeze({ maxDirs: 25000, maxFiles: 65000, maxMs: 18000 });
const EXACT_SCOPE = new Set(['confirmed-save', 'manifest-save', 'upstream-save', 'chosen-root']);

function integer(value, fallback, low, high) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(low, Math.min(high, Math.floor(n))) : fallback;
}
function scopeId(scope) {
  return `${path.resolve(scope.root).toLocaleLowerCase('en-US')}\0${scope.maxDepth || 4}\0${scope.kind || 'root'}`;
}
function collect(roots, inputBudget = {}) {
  const scopes = (Array.isArray(roots) ? roots : []).slice(0, 12).filter(r =>
    r && typeof r.root === 'string' && path.isAbsolute(r.root) && r.root.length < 1024);
  const maxMs = integer(inputBudget.maxMs, DEFAULTS.maxMs, 1000, DEFAULTS.maxMs);
  const maxDirs = integer(inputBudget.maxDirs, DEFAULTS.maxDirs, 40, DEFAULTS.maxDirs);
  const maxFiles = integer(inputBudget.maxFiles, DEFAULTS.maxFiles, 100, DEFAULTS.maxFiles);
  const share = Math.max(1, Math.min(8, scopes.length));
  const perRootMs = scopes.length === 1 ? maxMs : Math.min(4000, Math.max(1000, Math.floor(maxMs / share)));
  const perRootDirs = scopes.length === 1 ? maxDirs : Math.min(10000, Math.max(40, Math.floor(maxDirs / share)));
  const perRootFiles = scopes.length === 1 ? maxFiles : Math.min(25000, Math.max(100, Math.floor(maxFiles / share)));
  const started = Date.now();
  const result = { files: Object.create(null), scopeFiles: Object.create(null), scopes: [],
    scannedFiles: 0, scannedDirectories: 0, partial: false, depthLimited: false,
    skippedLinks: 0, blockedFiles: 0, elapsedMs: 0, completedRoots: 0, limitedRoots: 0 };
  for (const root of scopes) {
    const id = scopeId(root);
    const elapsed = Date.now() - started;
    const remainingMs = maxMs - elapsed;
    const remainingDirs = maxDirs - result.scannedDirectories;
    const remainingFiles = maxFiles - result.scannedFiles;
    if (remainingMs < 1000 || remainingDirs < 40 || remainingFiles < 100) {
      result.scopes.push({ id, root: root.root, kind: root.kind, complete: false,
        reason: 'GLOBAL_SCAN_BUDGET', depthLimited: false });
      result.limitedRoots++;
      result.partial = true;
      continue;
    }
    const budget = {
      maxMs: Math.min(perRootMs, remainingMs),
      maxDirs: Math.min(perRootDirs, remainingDirs),
      maxFiles: Math.min(perRootFiles, remainingFiles),
    };
    const captured = previous.collect([root], budget);
    const complete = !captured.partial;
    result.scannedFiles += captured.scannedFiles;
    result.scannedDirectories += captured.scannedDirectories;
    result.skippedLinks += captured.skippedLinks;
    result.blockedFiles += captured.blockedFiles;
    result.depthLimited ||= !!captured.depthLimited;
    result.scopes.push({ id, root: root.root, kind: root.kind, complete,
      reason: complete ? (captured.depthLimited ? 'DEPTH_BOUND' : '') : 'LIMIT_OR_UNREADABLE',
      depthLimited: !!captured.depthLimited, scannedFiles: captured.scannedFiles,
      scannedDirectories: captured.scannedDirectories });
    if (complete) {
      result.completedRoots++;
      result.scopeFiles[id] = captured.files;
      Object.assign(result.files, captured.files);
    } else {
      // Never include files from a partially observed scope in any comparison.
      result.partial = true;
      result.limitedRoots++;
    }
  }
  result.elapsedMs = Date.now() - started;
  return result;
}
function compare(baseline, after, roots, identity = {}) {
  const beforeScopes = new Map((baseline.scopes || []).map(s => [s.id, s]));
  const afterScopes = new Map((after.scopes || []).map(s => [s.id, s]));
  const reliable = (roots || []).filter(root => {
    const id = scopeId(root);
    return beforeScopes.get(id)?.complete && afterScopes.get(id)?.complete &&
      baseline.scopeFiles?.[id] && after.scopeFiles?.[id];
  });
  const beforeFiles = Object.create(null);
  const afterFiles = Object.create(null);
  for (const scope of reliable) {
    Object.assign(beforeFiles, baseline.scopeFiles[scopeId(scope)]);
    Object.assign(afterFiles, after.scopeFiles[scopeId(scope)]);
  }
  // A specifically identified save directory may itself contain the changed file.
  const comparisonScopes = reliable.map(r => EXACT_SCOPE.has(r.kind) ? { ...r, kind: 'chosen-root', originalKind: r.kind } : r);
  const evidence = previous.compareSnapshots(beforeFiles, { ...after, files: afterFiles }, comparisonScopes, identity);
  const reliableScopeIds = new Set(reliable.map(scopeId));
  const droppedScopes = (roots || []).filter(r => !reliableScopeIds.has(scopeId(r)));
  return { ...evidence, files: afterFiles, scopeFiles: after.scopeFiles, scopes: after.scopes,
    partial: !!(baseline.partial || after.partial || droppedScopes.length),
    limitedRoots: droppedScopes.length, completedRoots: reliable.length,
    coverageLimited: droppedScopes.length > 0 || !!(baseline.depthLimited || after.depthLimited),
    changedFiles: evidence.changedFiles, elapsedMs: after.elapsedMs };
}
function operate(data) {
  if (!data || !Array.isArray(data.roots)) throw new Error('INVALID_SCOPES');
  const current = collect(data.roots, data.budget || {});
  if (data.mode === 'snapshot') return current;
  if (data.mode === 'compare') {
    if (!data.baseline || !Array.isArray(data.baseline.scopes) || !data.baseline.scopeFiles)
      throw new Error('INVALID_BASELINE');
    return compare(data.baseline, current, data.roots, data.identity || {});
  }
  throw new Error('UNKNOWN_OBSERVATION_OPERATION');
}
if (!isMainThread && workerData) {
  try { parentPort.postMessage({ ok: true, value: operate(workerData) }); }
  catch (error) { parentPort.postMessage({ ok: false, error: String(error?.message || error) }); }
}
module.exports = { collect, compare, operate, scopeId };
