'use strict';
// Bounded, read-only, fair search. No save files are opened, written or linked.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalize, stats, context, hasSymlinkAncestor } = require('./backup-save-discovery-v060');
const { exclusionReason } = require('./backup-deep-scan-safety-v074.cjs');

const SKIP = new Set(['.git', 'node_modules', '$recycle.bin', 'system volume information', 'windows',
  'winsxs', 'program files', 'program files (x86)', 'msocache', 'cache', 'caches', 'temp', 'tmp']);
const SAVES = new Set(['save', 'saves', 'savedata', 'savegame', 'savegames', 'saved', 'profiles']);
const EXT = /\.(sav|save|rpgsave|rxdata|rvdata2|sol|srm|state)$/i;
const NAMED_SAVE = /(?:save|profile|progress|slot|persistent)/i;
const HARD_MAX_DIRS = 30000;
const HARD_MAX_MS = 18000;
const HARD_MAX_RESULTS = 50;
const HARD_MAX_CHILDREN = 2000;
const MAX_PENDING_PER_ROOT = 12000;
const LIMITS = Object.freeze({ maxDirs: HARD_MAX_DIRS, maxMs: HARD_MAX_MS, maxDepth: 9,
  gameDepth: 12, maxResults: HARD_MAX_RESULTS, maxChildren: HARD_MAX_CHILDREN });

function limit(value, fallback, ceiling, floor = 1) {
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= floor ? Math.min(n, ceiling) : fallback;
}
function key(p) { return path.resolve(p).toLowerCase(); }
function normDir(s) { return normalize(s).replace(/ /g, ''); }
function isSafeRoot(p) {
  if (!p || !path.isAbsolute(p)) return false;
  try {
    const s = fs.lstatSync(p);
    return s.isDirectory() && !s.isSymbolicLink() && !hasSymlinkAncestor(p);
  } catch { return false; }
}
function evidence(entries, dir) {
  const savename = SAVES.has(normDir(path.basename(dir)));
  return entries.some(e => e.isFile() && (EXT.test(e.name) ||
    ((NAMED_SAVE.test(e.name) || savename) && /\.(?:json|dat|bin)$/i.test(e.name)))) ||
    entries.some(e => e.isDirectory() && SAVES.has(normDir(e.name)));
}
function childPriority(name, gameNames) {
  const normalized = normalize(name);
  if (gameNames.has(normalized)) return 0;
  if (SAVES.has(normDir(name))) return 1;
  return 2;
}
function rootPlan(c, extraRoot) {
  const proposed = [
    ['chosen', extraRoot && path.isAbsolute(extraRoot) ? extraRoot : ''],
    ['installation', c.install],
    ['locallow', c.low],
    ['saved-games', path.join(c.home, 'Saved Games')],
    ['documents', c.doc],
    ['roaming', c.roaming],
    ['local', c.local],
  ];
  const seen = new Set(), roots = [];
  for (const [kind, p] of proposed) {
    if (!isSafeRoot(p)) continue;
    const id = key(p);
    if (seen.has(id)) continue;
    seen.add(id);
    roots.push({ kind, root: p, queue: [[p, 0, false]], cursor: 0,
      scannedDirectories: 0, matchedDirectories: 0, depthSkipped: 0, childSkipped: 0,
      readErrors: 0, status: 'complete', reasons: new Set() });
  }
  return roots;
}
function reason(scope, code, count = 1) {
  scope.reasons.add(code);
  if (code === 'DEPTH_BOUND') scope.depthSkipped += count;
  if (code === 'CHILD_LIMIT') scope.childSkipped += count;
  if (code === 'READ_ERROR') scope.readErrors += count;
  scope.status = 'limited';
}
function summary(roots) {
  return roots.map(root => ({ kind: root.kind,
    scannedDirectories: root.scannedDirectories, matchedDirectories: root.matchedDirectories,
    depthSkipped: root.depthSkipped, childSkipped: root.childSkipped, readErrors: root.readErrors,
    status: root.status, reasons: [...root.reasons].sort() }));
}
function logCoverage(report, enabled = process.env.NEXUS_BACKUP_LOG_LEVEL === 'debug') {
  if (!enabled) return;
  const r = report.coverage;
  console.log(`[NEXUS BACKUP][DEEP_SCAN_COVERAGE] inspected=${report.scannedDirectories} ` +
    `roots=${r.length} partial=${report.partial} ` +
    `reasons=${report.limits.map(x => x.code).join(',') || 'none'} ` +
    `candidates=${report.candidates.length} installRootsBlocked=${report.blockedInstallRoots}`);
  for (const scope of r) {
    console.log(`[NEXUS BACKUP][DEEP_SCAN_SCOPE] kind=${scope.kind} ` +
      `directories=${scope.scannedDirectories} matched=${scope.matchedDirectories} ` +
      `status=${scope.status} depthSkipped=${scope.depthSkipped} ` +
      `childSkipped=${scope.childSkipped} readErrors=${scope.readErrors} ` +
      `reasons=${scope.reasons.join(',') || 'none'}`);
  }
}
function deepScan(game, opts = {}) {
  const { env = process.env, extraRoot = '' } = opts;
  const maxDirs = limit(opts.maxDirs, HARD_MAX_DIRS, HARD_MAX_DIRS);
  const maxMs = limit(opts.maxMs, HARD_MAX_MS, HARD_MAX_MS);
  const maxDepth = limit(opts.maxDepth, LIMITS.maxDepth, 12, 0);
  const gameDepth = limit(opts.gameDepth, LIMITS.gameDepth, 14, maxDepth);
  const maxResults = limit(opts.maxResults, HARD_MAX_RESULTS, HARD_MAX_RESULTS);
  const maxChildren = limit(opts.maxChildren, HARD_MAX_CHILDREN, HARD_MAX_CHILDREN);
  const c = context(game, env);
  const names = new Set([game?.name, game?.path ? path.parse(game.path).name : '',
    c.install ? path.basename(c.install) : ''].map(normalize).filter(s => s.length >= 4));
  const roots = rootPlan(c, extraRoot), seenDirs = new Set(), seenResults = new Set();
  const results = [];
  const start = Date.now();
  let visited = 0, matched = 0, blockedInstallRoots = 0;
  const globalReasons = new Set();
  let stopped = false;

  // Breadth-first within each root, round-robin between roots. A large AppData tree
  // cannot consume the whole budget before the install/Saved Games roots get a turn.
  while (roots.some(r => r.cursor < r.queue.length)) {
    if (visited >= maxDirs) { globalReasons.add('DIRECTORY_BUDGET'); stopped = true; break; }
    if (Date.now() - start >= maxMs) { globalReasons.add('TIME_BUDGET'); stopped = true; break; }
    if (results.length >= maxResults) { globalReasons.add('RESULT_BUDGET'); stopped = true; break; }
    for (const scope of roots) {
      if (scope.cursor >= scope.queue.length) continue;
      if (visited >= maxDirs) { globalReasons.add('DIRECTORY_BUDGET'); stopped = true; break; }
      if (Date.now() - start >= maxMs) { globalReasons.add('TIME_BUDGET'); stopped = true; break; }
      if (results.length >= maxResults) { globalReasons.add('RESULT_BUDGET'); stopped = true; break; }
      const [dir, depth, belongsToGame] = scope.queue[scope.cursor++];
      const id = key(dir);
      if (seenDirs.has(id)) continue;
      seenDirs.add(id);
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { reason(scope, 'READ_ERROR'); continue; }
      visited++;
      scope.scannedDirectories++;
      const folderIsGame = names.has(normalize(path.basename(dir))) || belongsToGame;
      let accepted = false;
      if (folderIsGame && evidence(entries, dir) && !seenResults.has(id)) {
        const unsafe = exclusionReason(game, dir, 'deep-scan-match');
        if (unsafe) {
          blockedInstallRoots++;
          if (unsafe === 'INSTALL_ROOT_OR_PARENT' || unsafe === 'EXECUTABLE_DIRECTORY') {
            for (const entry of entries) {
              if (results.length >= maxResults) break;
              if (!entry.isFile() || !EXT.test(entry.name)) continue;
              const p = path.join(dir, entry.name), fileId = key(p);
              if (seenResults.has(fileId) || exclusionReason(game, p, 'deep-scan-match')) continue;
              const info = stats(p);
              if (!info) continue;
              seenResults.add(fileId);
              results.push({ path: p, source: 'deep-scan-match', confidence: 38, ...info });
              matched++;
              scope.matchedDirectories++;
            }
          }
        } else {
          const info = stats(dir);
          if (info) {
            seenResults.add(id);
            results.push({ path: dir, source: 'deep-scan-match', confidence: 42, ...info });
            matched++;
            scope.matchedDirectories++;
            accepted = true;
          }
        }
      }
      if (accepted) continue; // Current v0.7.4 nearest-save-folder behavior retained.
      const allowedDepth = folderIsGame ? gameDepth :
        scope.kind === 'chosen' ? Math.max(maxDepth, 11) : maxDepth;
      const children = entries.filter(e => e.isDirectory() && !e.isSymbolicLink() && !SKIP.has(e.name.toLowerCase()));
      if (depth >= allowedDepth) {
        if (children.length) reason(scope, 'DEPTH_BOUND', children.length);
        continue;
      }
      children.sort((a, b) => {
        const ap = childPriority(a.name, names), bp = childPriority(b.name, names);
        return ap - bp || a.name.localeCompare(b.name);
      });
      if (children.length > maxChildren) reason(scope, 'CHILD_LIMIT', children.length - maxChildren);
      const allowed = children.slice(0, maxChildren);
      const available = Math.max(0, MAX_PENDING_PER_ROOT - (scope.queue.length - scope.cursor));
      if (allowed.length > available) reason(scope, 'QUEUE_BUDGET', allowed.length - available);
      for (const child of allowed.slice(0, available)) {
        scope.queue.push([path.join(dir, child.name), depth + 1, folderIsGame]);
      }
    }
    if (stopped) break;
  }
  if (stopped) {
    for (const r of roots) {
      if (r.cursor < r.queue.length) {
        r.reasons.add([...globalReasons][0]);
        r.status = 'limited';
      }
    }
  }
  const coverage = summary(roots);
  const reasons = new Set([...globalReasons, ...coverage.flatMap(x => x.reasons)]);
  const limits = [...reasons].sort().map(code => ({ code }));
  const partial = limits.length > 0;
  const warnings = partial ? [{ code: 'DEEP_SCAN_PARTIAL',
    message: `Search coverage was limited (${limits.map(x => x.code).join(', ')}). Some folders were not scanned.`,
    reasons: limits.map(x => x.code) }] : [];
  if (blockedInstallRoots) warnings.push({ code: 'INSTALL_ROOT_SKIPPED',
    message: 'Installation folders were excluded because they are not save-only locations' });
  const report = { candidates: results, warnings, scannedDirectories: visited,
    matchedDirectories: matched, blockedInstallRoots, partial, coverage, limits,
    elapsedMs: Date.now() - start };
  logCoverage(report, opts.debug === true || process.env.NEXUS_BACKUP_LOG_LEVEL === 'debug');
  return report;
}
module.exports = { deepScan, logCoverage, rootPlan, LIMITS };
