'use strict';
// Identity-first discovery and opt-in session observation. Never writes game saves or backup configs.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');
const coverage = require('./backup-save-discovery-v060');

const LEGACY_LIMIT = 24 * 1024 * 1024;
const OBS_WORKER = path.join(__dirname, 'backup-save-observe-worker-v071.cjs');
const observationReview = require('./backup-save-observe-review-v072.cjs');
const backupTerminal = require('./backup-terminal-diagnostics-v073.cjs');
const observations = new Map();
let manifestCache = { name: '', stamp: '', value: null };

function normalize(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}
function metadataSteamId(game) {
  const id = String(game?.metadata?.steamAppId ?? game?.steamAppId ?? '').trim();
  return /^\d{1,12}$/.test(id) && id !== '0' ? id : '';
}
function ls(p) { try { return fs.lstatSync(p); } catch { return null; } }
function dir(p) { const s = ls(p); return !!s?.isDirectory() && !s.isSymbolicLink(); }
function file(p) { const s = ls(p); return !!s?.isFile() && !s.isSymbolicLink(); }
function safeAbsolute(p) {
  return typeof p === 'string' && p.length >= 3 && p.length < 1024 &&
    !/[\x00-\x1f]/.test(p) && path.isAbsolute(p) ? path.resolve(p) : '';
}
function isRootOrBroad(p, game, env = process.env) {
  const r = safeAbsolute(p);
  if (!r) return true;
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const broad = [path.parse(r).root, home, path.join(home, 'AppData'),
    env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    path.join(home, 'AppData', 'LocalLow'),
    env.USER_DOCUMENTS || path.join(home, 'Documents'),
    path.join(home, 'Saved Games'), path.dirname(String(game?.path || ''))].filter(Boolean);
  return broad.some(x => path.resolve(x).toLocaleLowerCase('en-US') === r.toLocaleLowerCase('en-US'));
}
function hasLinks(p) {
  let current = safeAbsolute(p);
  if (!current) return true;
  for (let i = 0; i < 48; i++) {
    const s = ls(current);
    if (s?.isSymbolicLink()) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  return true;
}

// Infer installation root from an exact title or a recognized executable tree, not a guessed drive parent.
function installRoots(game) {
  const exe = safeAbsolute(game?.path);
  if (!exe || !file(exe) || game?.isInstalled === false) return [];
  const wanted = normalize(game.name);
  let cur = path.dirname(exe);
  const ascended = [];
  for (let depth = 0; depth < 8; depth++) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    const part = normalize(path.basename(cur));
    const exact = wanted && part === wanted;
    // Only exact title match is considered a high-confidence root.
    if (exact) return [{ root: cur, certainty: 'exact-title', depth }];
    ascended.push(cur);
    cur = parent;
  }
  const bin = ascended.findIndex(x => /^(?:win64|win32|binaries|shipping|x64|x86|wingdk)$/i.test(path.basename(x)));
  // If executable is deep below Binaries/Win64, offer its grandparent only as a cautious fallback.
  if (bin >= 0 && ascended[bin + 2] && dir(ascended[bin + 2]))
    return [{ root: ascended[bin + 2], certainty: 'executable-layout', depth: bin + 2 }];
  return [{ root: path.dirname(exe), certainty: 'executable-folder', depth: 0 }];
}

function readLegacy(manifestPath) {
  const target = safeAbsolute(manifestPath);
  const st = target ? ls(target) : null;
  if (!st?.isFile() || st.isSymbolicLink() || st.size < 2 || st.size > LEGACY_LIMIT) return null;
  const stamp = st.size + ':' + st.mtimeMs;
  if (manifestCache.name === target && manifestCache.stamp === stamp) return manifestCache.value;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(target, 'utf8')); }
  catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const exact = new Map(), aliases = new Map();
  let titles = 0;
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || !Array.isArray(entry.paths)) continue;
    if (++titles > 30000) return null;
    const title = normalize(name);
    if (!exact.has(title)) exact.set(title, []);
    exact.get(title).push({ name, entry });
    for (const alias of Array.isArray(entry.aliases) ? entry.aliases.slice(0, 36) : []) {
      const key = normalize(alias);
      if (!key) continue;
      if (!aliases.has(key)) aliases.set(key, []);
      aliases.get(key).push({ name, entry });
    }
  }
  manifestCache = { name: target, stamp, value: { exact, aliases, titles } };
  return manifestCache.value;
}
function matchIdentity(game, legacyIndex) {
  const key = normalize(game?.name);
  const exact = legacyIndex?.exact.get(key) || [];
  if (exact.length === 1) return { kind: 'canonical', hits: exact };
  if (exact.length > 1) return { kind: 'ambiguous', hits: [] };
  const all = legacyIndex?.aliases.get(key) || [];
  const distinct = [...new Map(all.map(entry => [entry.name, entry])).values()];
  if (distinct.length === 1) return { kind: 'alias', hits: distinct };
  if (distinct.length > 1) return { kind: 'ambiguous', hits: [] };
  return { kind: 'not-found', hits: [] };
}
function repairWindowsPrefixes(rule) {
  if (typeof rule !== 'string') return '';
  // Older converted manifests accidentally append LocalLow/Local to the Roaming alias.
  return rule
    .replace(/^\{\{p\|appdata\}\}[\\/]LocalLow(?=[\\/]|$)/i, '{{p|userprofile}}/AppData/LocalLow')
    .replace(/^\{\{p\|appdata\}\}[\\/]Local(?=[\\/]|$)/i, '{{p|userprofile}}/AppData/Local')
    .replace(/^\{\{p\|appdata\}\}[\\/]Roaming(?=[\\/]|$)/i, '{{p|userprofile}}/AppData/Roaming');
}
function legacyCandidates(game, options = {}) {
  const env = options.env || process.env;
  const context = coverage.context(game, env);
  const roots = installRoots(game);
  const manifest = readLegacy(options.manifestPath);
  const identity = matchIdentity(game, manifest);
  const results = [], warnings = [], used = new Set();
  const add = (p, source, confidence, evidence) => {
    const location = safeAbsolute(p);
    if (!location || hasLinks(location) || isRootOrBroad(location, game, env)) return;
    if (!coverage.isWithin(location, context.home) && ![...context.roots, ...roots.map(r => r.root)].some(r => coverage.isWithin(location, r))) return;
    const info = coverage.stats(location);
    if (!info) return;
    const key = location.toLocaleLowerCase('en-US');
    if (used.has(key)) return;
    used.add(key);
    const backupLike = /(?:^|[\\/])(?:savegamesbackup|savefilebackup|backups?|old.?saves)(?:[\\/]|$)/i.test(location);
    results.push({ path: location, source, confidence: backupLike ? Math.min(confidence, 40) : confidence,
      ...info, ...(backupLike ? { tags: ['backup-like-location'] } : {}),
      evidence: backupLike ? [...evidence, 'Location resembles an in-game backup; confirm active saves'] : evidence });
  };
  if (identity.kind === 'ambiguous') warnings.push({ code: 'V070_IDENTITY_AMBIGUOUS', message: 'Multiple canonical/alias entries match; no manifest path was selected' });
  if (identity.hits.length) {
    const entry = identity.hits[0].entry;
    const declared = Array.isArray(entry.paths) ? entry.paths.slice(0, 80) : [];
    for (const rule of declared) {
      if (typeof rule !== 'string' || rule.length > 1024 || /^(?:\/Users\/|\/home\/|\$XDG)/i.test(rule)) continue;
      const revised = repairWindowsPrefixes(rule);
      const needsGameRoot = /(?:\{\{p\|game\}\}|<root>|<base>)/i.test(revised);
      const candidates = needsGameRoot ? roots : [{ root: context.install, certainty: 'profile-location' }];
      for (const installation of candidates) {
        if (needsGameRoot && !installation.root) continue;
        const nextContext = { ...context, install: installation.root || context.install,
          roots: installation.root ? [...context.roots, installation.root] : context.roots };
        const resolved = coverage.placeholders(revised, game, nextContext, metadataSteamId(game));
        if (!resolved) continue;
        const matches = coverage.expandPattern(resolved, nextContext, 35);
        const confidence = identity.kind === 'canonical' ? 90 : 77;
        for (const p of matches) add(p, 'manifest-winpath-v070',
          needsGameRoot && installation.certainty === 'executable-folder' ? Math.min(65, confidence) : confidence,
          ['Exact ' + identity.kind + ' identity: ' + identity.hits[0].name,
            needsGameRoot ? 'Installation root: ' + installation.certainty : 'Windows save rule']);
      }
    }
  }
  const id = metadataSteamId(game);
  if (id) {
    const gseRemote = path.join(context.roaming, 'GSE Saves', id, 'remote');
    const gseWin64 = path.join(gseRemote, 'win64_save');
    add(dir(gseWin64) ? gseWin64 : gseRemote, 'steam-id-save-v070', 86,
      ['Explicit game Steam AppID: ' + id, 'Existing save-like data']);
  }
  if (results.filter(x => x.confidence >= 65).length > 1)
    warnings.push({ code: 'V070_MULTI_SITE', message: 'More than one plausible save location exists; no automatic selection is made' });
  return { candidates: results.sort((a, b) => b.confidence - a.confidence).slice(0, 90),
    warnings, identity: { kind: identity.kind, manifestTitle: identity.hits[0]?.name || null,
      steamAppIdKnown: !!id, installRootMethod: roots[0]?.certainty || 'unknown' } };
}

// Observation captures filenames and stat metadata only. No file contents are opened.
// Narrow game-specific roots are sampled before broader Windows locations.
// Broad scopes may be incomplete without invalidating a separate, fully scanned save root.
function observationRoots(game, { extraRoot = '', env = process.env,
  manifestPath = '', indexPath = '', confirmedPath = '' } = {}) {
  const c = coverage.context(game, env);
  const rootFromExe = installRoots(game)[0]?.root || c.install;
  const proposed = [];
  if (extraRoot) proposed.push([extraRoot, 8, 'chosen-root']);
  else {
    if (confirmedPath) proposed.push([confirmedPath, 8, 'confirmed-save']);
    if (manifestPath) {
      for (const candidate of legacyCandidates(game, { manifestPath, env }).candidates.slice(0, 6))
        proposed.push([candidate.path, 8, 'manifest-save']);
    }
    for (const candidate of coverage.candidatesFor(game, { indexPath, env }).candidates.slice(0, 6))
      proposed.push([candidate.path, 8, 'upstream-save']);
    proposed.push(
      [c.low, 5, 'unity-locallow'],
      [path.join(c.doc, 'My Games'), 7, 'documents-my-games'],
      [path.join(c.home, 'Saved Games'), 7, 'saved-games'],
      [path.join(c.roaming, 'GSE Saves'), 7, 'gse-saves'],
      [c.roaming, 4, 'appdata-roaming'],
      [c.local, 4, 'appdata-local'],
      ...(rootFromExe ? [[rootFromExe, 7, 'game-install']] : []),
    );
  }
  const used = new Set();
  const result = [];
  for (const [candidate, maxDepth, kind] of proposed) {
    let root = safeAbsolute(candidate);
    if (!root || hasLinks(root)) continue;
    if (file(root)) root = path.dirname(root);
    if (!dir(root) || hasLinks(root)) continue;
    const key = root.toLocaleLowerCase('en-US');
    if (used.has(key)) continue;
    if ((kind === 'chosen-root' || kind === 'confirmed-save' || kind === 'manifest-save' || kind === 'upstream-save') &&
      isRootOrBroad(root, game, env)) continue;
    if (key === path.parse(root).root.toLocaleLowerCase('en-US') && kind !== 'chosen-root') continue;
    if (kind === 'chosen-root' && (key === c.home.toLocaleLowerCase('en-US') ||
      key === path.join(c.home, 'AppData').toLocaleLowerCase('en-US'))) continue;
    used.add(key);
    result.push({ root, maxDepth, kind });
    if (result.length === (extraRoot ? 1 : 12)) break;
  }
  return result;
}
function runSnapshotWorker(payload, { timeoutMs = 28000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(OBS_WORKER, { workerData: payload });
    let settled = false;
    const timer = setTimeout(() => finish(new Error('OBSERVATION_WORKER_TIMEOUT')), timeoutMs);
    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    }
    worker.once('message', msg => msg?.ok ? finish(null, msg.value) : finish(new Error(msg?.error || 'OBSERVATION_WORKER_FAILED')));
    worker.once('error', finish);
    worker.once('exit', code => { if (code !== 0 && !settled) finish(new Error('OBSERVATION_WORKER_EXIT_' + code)); });
  });
}
function keyFor(id) { return String(id); }
function publicStatus(entry) {
  if (!entry) return { status: 'idle' };
  return { status: entry.status, scannedFiles: entry.scannedFiles || 0,
    scannedDirectories: entry.scannedDirectories || 0, changedFiles: entry.changedFiles || 0,
    candidateFolders: entry.candidates?.length || 0, suppressedUnrelated: entry.suppressedUnrelated || 0, partial: !!entry.partial,
    depthLimited: !!entry.depthLimited, completedRoots: entry.completedRoots || 0,
    limitedRoots: entry.limitedRoots || 0, scanElapsedMs: entry.scanElapsedMs || 0,
    code: entry.code || '', message: entry.message || '',
    observationStartedAt: entry.observationStartedAt || null,
    sessionStartedAt: entry.sessionStartedAt || null, sessionEndedAt: entry.sessionEndedAt || null };
}
async function armObservation(game, options = {}) {
  if (!game?.id || !game?.name) return { ok: false, code: 'INVALID_GAME' };
  const key = keyFor(game.id);
  const current = observations.get(key);
  if (current && ['arming', 'observing', 'comparing'].includes(current.status))
    return { ok: false, code: 'OBSERVATION_ALREADY_ACTIVE', observation: publicStatus(current) };
  const roots = observationRoots(game, options);
  if (!roots.length) {
    backupTerminal.output('WARN', 'OBSERVE_NO_SCOPES', { game: game.name,
      reason: 'NO_OBSERVABLE_ROOTS' });
    return { ok: false, code: 'NO_OBSERVABLE_ROOTS' };
  }
  if (observations.size > 12) {
    const oldest = observations.keys().next().value;
    if (oldest !== key) observations.delete(oldest);
  }
  const token = Symbol('observation');
  const entry = { token, status: 'arming', id: key, gameName: game.name, roots, budget: options.budget || null, observationStartedAt: Date.now(), steamId: metadataSteamId(game), traceId: backupTerminal.currentId() || backupTerminal.newId() };
  observations.set(key, entry);
  backupTerminal.output('INFO', 'OBSERVE_SCOPE_PLAN', { game: game.name, roots: roots.length,
    kinds: roots.map(r => r.kind), chosenFolder: !!options.extraRoot }, { id: entry.traceId });
  for (const root of roots) backupTerminal.output('DEBUG', 'OBSERVE_SCOPE_SELECTED', {
    game: game.name, kind: root.kind, path: root.root, maxDepth: root.maxDepth,
  }, { id: entry.traceId });
  try {
    const result = await runSnapshotWorker({ mode: 'snapshot', roots, budget: entry.budget }, options);
    backupTerminal.scopeReport('OBSERVE_BASELINE', result, { game: entry.gameName, id: entry.traceId });
    if (observations.get(key)?.token !== token) return { ok: false, code: 'OBSERVATION_CANCELLED' };
    if (entry.status !== 'arming') return { ok: false, code: entry.code || 'OBSERVATION_INTERRUPTED', observation: publicStatus(entry) };
    entry.scannedFiles = result.scannedFiles;
    entry.scannedDirectories = result.scannedDirectories;
    entry.partial = result.partial;
    entry.depthLimited = result.depthLimited;
    entry.completedRoots = result.completedRoots;
    entry.limitedRoots = result.limitedRoots;
    entry.scanElapsedMs = result.elapsedMs;
    if (!result.completedRoots) {
      entry.status = 'incomplete';
      entry.code = 'BASELINE_SCAN_PARTIAL';
      entry.message = 'No observation scope was fully scanned; choose a smaller folder';
      backupTerminal.output('BLOCK', 'OBSERVE_BASELINE_REJECTED', { game: entry.gameName, code: entry.code }, { id: entry.traceId });
      return { ok: false, code: entry.code, observation: publicStatus(entry) };
    }
    entry.baseline = result;
    entry.status = 'armed';
    backupTerminal.output('PASS', 'OBSERVE_ARMED', { game: entry.gameName, completedRoots: result.completedRoots, limitedRoots: result.limitedRoots }, { id: entry.traceId });
    if (result.partial) {
      entry.code = 'BASELINE_LIMITED_COVERAGE';
      entry.message = 'Some scopes were incomplete; only complete scopes can provide evidence';
    }
    return { ok: true, observation: publicStatus(entry) };
  } catch (error) {
    if (observations.get(key)?.token !== token) return { ok: false, code: 'OBSERVATION_CANCELLED' };
    entry.status = 'error'; entry.code = 'BASELINE_FAILED'; entry.message = error.message;
    backupTerminal.output('FAIL', 'OBSERVE_BASELINE_ERROR', { game: entry.gameName, code: entry.code, reason: error.message }, { id: entry.traceId });
    return { ok: false, code: entry.code, observation: publicStatus(entry) };
  }
}
function noteGameStarted({ gameId, name, sessionId }) {
  const entry = observations.get(keyFor(gameId));
  if (!entry || entry.gameName !== name) return;
  if (entry.status === 'arming') {
    entry.status = 'incomplete'; entry.code = 'GAME_STARTED_BEFORE_BASELINE_READY';
    entry.message = 'The game started before baseline completed; re-arm before another session';
    backupTerminal.output('BLOCK', 'OBSERVE_GAME_TOO_EARLY', { game: name, code: entry.code }, { id: entry.traceId });
  } else if (entry.status === 'armed') {
    entry.status = 'observing'; entry.sessionId = String(sessionId || '');
    backupTerminal.output('INFO', 'OBSERVE_GAME_STARTED', { game: name }, { id: entry.traceId });
    entry.sessionStartedAt = Date.now();
  }
}
async function noteGameStopped({ gameId, name, sessionId }) {
  const entry = observations.get(keyFor(gameId));
  if (!entry || entry.status !== 'observing' || entry.gameName !== name || entry.sessionId !== String(sessionId || '')) return null;
  entry.status = 'comparing'; entry.sessionEndedAt = Date.now();
  backupTerminal.output('START', 'OBSERVE_COMPARE', { game: name, roots: entry.roots.length }, { id: entry.traceId });
  const token = entry.token;
  try {
    const result = await runSnapshotWorker({ mode: 'compare', roots: entry.roots,
      baseline: entry.baseline, budget: entry.budget,
      identity: { title: entry.gameName, steamAppId: entry.steamId || '' } });
    backupTerminal.scopeReport('OBSERVE_AFTER', result, { game: entry.gameName, id: entry.traceId });
    if (observations.get(keyFor(gameId))?.token !== token) return null;
    entry.scannedFiles = result.scannedFiles;
    entry.scannedDirectories = result.scannedDirectories;
    entry.partial = result.partial;
    entry.depthLimited = result.depthLimited;
    entry.completedRoots = result.completedRoots;
    entry.limitedRoots = result.limitedRoots;
    entry.scanElapsedMs = result.elapsedMs;
    entry.changedFiles = result.changedFiles;
    entry.baseline = null;
    // Filter unrelated app changes before exposing any candidate to IPC or renderer.
    const review = observationReview.reviewCandidates(result.completedRoots ? result.candidates : [], {
      gameName: entry.gameName, steamId: entry.steamId, roots: entry.roots,
    });
    entry.candidates = review.candidates;
    entry.suppressedUnrelated = review.excluded;
    backupTerminal.output('INFO', 'OBSERVE_ATTRIBUTION', { game: entry.gameName, rawCandidates: result.candidates?.length || 0,
      acceptedForReview: review.candidates.length, excludedUnrelated: review.excluded, changedFiles: result.changedFiles }, { id: entry.traceId });
    for (const candidate of review.candidates) backupTerminal.output('DEBUG', 'OBSERVE_REVIEW_ONLY', {
      path: candidate.path, changedFiles: candidate.changedFiles, confidence: candidate.confidence, evidenceKind: candidate.evidenceKind,
    }, { id: entry.traceId });
    entry.status = !result.completedRoots ? 'incomplete' :
      result.coverageLimited ? 'complete-limited' : 'complete';
    if (entry.status === 'incomplete') {
      entry.code = 'OBSERVATION_SCAN_PARTIAL';
      entry.message = 'No identical scope completed in both snapshots; do not trust partial evidence';
    } else if (entry.status === 'complete-limited') {
      entry.code = 'OBSERVATION_LIMITED_COVERAGE';
      entry.message = 'Only changes within fully scanned scopes are shown; skipped scopes are not verified';
    } else { entry.code = ''; entry.message = ''; }
    backupTerminal.output(entry.status === 'incomplete' ? 'WARN' : 'PASS', 'OBSERVE_COMPARE_DONE', {
      game: entry.gameName, status: entry.status, code: entry.code, completedRoots: entry.completedRoots,
      limitedRoots: entry.limitedRoots, changedFiles: entry.changedFiles, reviewCandidates: entry.candidates.length,
      excludedUnrelated: entry.suppressedUnrelated, durationMs: Date.now() - entry.sessionEndedAt,
    }, { id: entry.traceId });
    return publicStatus(entry);
  } catch (error) {
    if (observations.get(keyFor(gameId))?.token !== token) return null;
    entry.status = 'error'; entry.code = 'COMPARE_FAILED'; entry.message = error.message; entry.baseline = null;
    backupTerminal.output('FAIL', 'OBSERVE_COMPARE_ERROR', { game: entry.gameName, code: entry.code, reason: error.message }, { id: entry.traceId });
    return publicStatus(entry);
  }
}
function getObservation(game) {
  const entry = observations.get(keyFor(game?.id));
  if (!entry || entry.gameName !== game?.name) return { status: 'idle' };
  return publicStatus(entry);
}
function getObservedCandidates(game) {
  const entry = observations.get(keyFor(game?.id));
  if (!entry || entry.gameName !== game?.name || !['complete', 'complete-limited'].includes(entry.status)) return [];
  return (entry.candidates || []).filter(c => {
    const p = safeAbsolute(c.path);
    return p && dir(p) && !hasLinks(p) && !isRootOrBroad(p, game);
  }).map(c => ({ ...c, ...(coverage.stats(c.path) || {}), source: 'diff-changed-v070', observationOnly: true,
    ...(entry.status === 'complete-limited' ? { tags: ['observation-limited-coverage'] } : {}),
    evidence: ['Changed metadata was observed in a fully scanned scope only',
      `${c.changedFiles} changed files; this does not prove ownership`] }));
}
function cancelObservation(game) {
  const key = keyFor(game?.id);
  const entry = observations.get(key);
  if (!entry || entry.gameName !== game?.name) return { ok: true, status: 'idle' };
  observations.delete(key);
  backupTerminal.output('INFO', 'OBSERVE_CANCELLED', { game: entry.gameName }, { id: entry.traceId });
  return { ok: true, status: 'idle' };
}

module.exports = { normalize, metadataSteamId, installRoots, readLegacy, matchIdentity,
  repairWindowsPrefixes, legacyCandidates, observationRoots, armObservation, noteGameStarted,
  noteGameStopped, getObservation, getObservedCandidates, cancelObservation, runSnapshotWorker,
  safeAbsolute, hasLinks };
