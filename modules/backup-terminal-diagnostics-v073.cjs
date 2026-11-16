'use strict';
// Console-only diagnostic trace. Never reads/writes game saves, settings or archives.
const { AsyncLocalStorage } = require('node:async_hooks');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const context = new AsyncLocalStorage();
let sequence = 0;
const INSTRUMENTED = Symbol.for('nexus.backup.terminal.v073.instrumented');
const READ_ONLY = new Set(['backup:getInfo', 'backup:listBackups', 'backup:getGlobalPath',
  'getGameBackupInfo', 'listBackups', 'getGlobalBackupPath', 'resolvePath', 'findExistingPath']);
const BACKUP_METHODS = ['backupGame', 'backupAllGames', 'performMirroring', 'restoreBackup',
  'deleteBackup', 'scanVaultForExistingBackups', 'updateBackupConfig', 'autoDiscoverSavePath',
  'getGameBackupInfo', 'listBackups'];
const BAD_KEYS = /pass(word)?|secret|token|cookie|auth(orization)?|api.?key|credential/i;
function newId() { return 'B' + (++sequence).toString(36).toUpperCase().padStart(5, '0'); }
function debugEnabled() { return String(process.env.NEXUS_BACKUP_LOG_LEVEL || '').toLowerCase() === 'debug'; }
function enabled() { return process.env.NEXUS_BACKUP_TERMINAL !== '0'; }
function tracePaths() { return process.env.NEXUS_BACKUP_LOG_PATHS === '1'; }
function clean(raw, limit = 140) {
  const text = String(raw == null ? '' : raw).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029\u001b]/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
}
function shortPath(value) {
  const p = clean(value, 650);
  if (!p) return '';
  if (tracePaths()) return clean(p, 400);
  const name = path.win32.basename(p) || path.posix.basename(p);
  return `[path:${clean(name, 75)}]`;
}
function field(key, value) {
  if (BAD_KEYS.test(key)) return '[redacted]';
  if (/path|root|folder|file|location|archive|zip/i.test(key) && typeof value === 'string')
    return shortPath(value);
  if (Array.isArray(value)) return clean(value.slice(0, 12).map(x => String(x)).join(','));
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '[object]';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'invalid';
  return clean(value);
}
function details(data = {}) {
  return Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 18).map(([key, value]) => `${clean(key, 36)}=${JSON.stringify(field(key, value))}`).join(' ');
}
function output(state, label, data = {}, { id } = {}) {
  if (!enabled()) return;
  if (state === 'DEBUG' && !debugEnabled()) return;
  const traceId = id || context.getStore()?.id || newId();
  const stamp = new Date().toISOString();
  const msg = `[NEXUS BACKUP][${stamp}][${traceId}][${state}] ${clean(label, 80)}${Object.keys(data).length ? ' ' + details(data) : ''}`;
  if (state === 'FAIL') console.error(msg);
  else if (state === 'WARN' || state === 'BLOCK') console.warn(msg);
  else console.log(msg);
}
function currentId() { return context.getStore()?.id || null; }
function summarizeArgs(channel, args) {
  const a = Array.isArray(args) ? args : [];
  const first = a[0];
  const data = {};
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    if (first.name) data.game = first.name;
    if (first.id !== undefined) data.gameId = first.id;
  } else if (typeof first === 'string' && !/^(?:[A-Z]:\\|\/)/i.test(first)) {
    if (/preview|confirm|observe|cancel|coverage/i.test(channel)) data.gameId = first;
    else data.game = first;
  } else if (Number.isFinite(first)) data.gameId = first;
  if (/confirmCandidate/.test(channel)) data.candidatePath = a[1];
  if (/restore/i.test(channel)) { data.archivePath = first; data.game = a[1]; }
  if (/updateConfig/.test(channel) && a[1] && typeof a[1] === 'object')
    data.configFields = Object.keys(a[1]).filter(key => !BAD_KEYS.test(key));
  if (/armSaveObservation/.test(channel)) data.chosenFolder = a[1] === true;
  if (/scanVault/i.test(channel)) data.vaultRoot = first;
  return data;
}
function summarizeResult(value) {
  if (value == null) return { outcome: value === null ? 'null' : 'undefined' };
  if (typeof value === 'boolean') return { outcome: value ? 'true' : 'false' };
  if (typeof value === 'string') return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('/') ? { sourcePath: value } : { result: value.length < 60 ? value : '[text]' };
  if (typeof value !== 'object') return { result: value };
  const keys = ['ok', 'success', 'status', 'code', 'reason', 'linked', 'skipped', 'count',
    'files', 'sizeKB', 'sizeBytes', 'scannedFiles', 'scannedDirectories', 'changedFiles',
    'candidateFolders', 'suppressedUnrelated', 'partial', 'completedRoots', 'limitedRoots',
    'scanElapsedMs', 'manifestStatus', 'entries', 'updated', 'cacheHit', 'source'];
  const out = {};
  for (const key of keys) if (value[key] !== undefined && typeof value[key] !== 'object') out[key] = value[key];
  if (Array.isArray(value.candidates)) {
    out.candidates = value.candidates.length;
    const bySource = Object.create(null);
    for (const x of value.candidates) {
      const name = String(x?.source || 'unknown').slice(0, 40);
      bySource[name] = (bySource[name] || 0) + 1;
    }
    out.sources = Object.entries(bySource).slice(0, 8).map(([k,v]) => `${k}:${v}`).join('|');
  }
  if (Array.isArray(value.warnings)) out.warnings = value.warnings.length;
  if (value.observation && typeof value.observation === 'object') {
    out.observation = value.observation.status;
    out.changedFiles = value.observation.changedFiles;
    out.candidateFolders = value.observation.candidateFolders;
  }
  if (value.error && typeof value.error === 'string') out.errorCode = value.code || 'REPORTED_ERROR';
  if (value.zipPath) out.archivePath = value.zipPath;
  if (value.savePath) out.sourcePath = value.savePath;
  return out;
}
function resultState(value) {
  if (value?.ok === false || value?.success === false) {
    const code = String(value.code || value.reason || '');
    return /CANCEL|NO_|NOT_FOUND|DISABLED|UNCONFIGURED|SKIP/i.test(code) ? 'SKIP' : 'BLOCK';
  }
  return value === false ? 'WARN' : 'PASS';
}
function wrapCall(label, handler, args, { category = 'IPC', skip = false } = {}) {
  if (typeof handler !== 'function') return handler;
  if (!enabled() || (skip && !debugEnabled())) return handler(...args);
  const existing = context.getStore();
  const id = existing?.id || newId();
  const started = performance.now();
  const run = () => {
    output('START', `${category}:${label}`, summarizeArgs(label, args), { id });
    const done = value => {
      output(resultState(value), `${category}:${label}`, { ...summarizeResult(value), durationMs: Number((performance.now() - started).toFixed(1)) }, { id });
      return value;
    };
    const failure = error => {
      output('FAIL', `${category}:${label}`, { code: error?.code || 'EXCEPTION', reason: error?.message || String(error), durationMs: Number((performance.now() - started).toFixed(1)) }, { id });
      throw error;
    };
    try {
      const value = handler(...args);
      return value && typeof value.then === 'function' ? value.then(done, failure) : done(value);
    } catch (error) { return failure(error); }
  };
  return existing ? run() : context.run({ id }, run);
}
function wrapIpc(channel, handler) {
  if (typeof handler !== 'function') throw new TypeError('Invalid IPC handler');
  return function(event, ...payload) {
    // Electron event object intentionally never serialized or logged.
    return wrapCall(channel, (...args) => handler(event, ...args), payload, {
      category: 'IPC', skip: READ_ONLY.has(channel),
    });
  };
}
function instrumentBackups(backups) {
  if (!backups || typeof backups !== 'object') return 0;
  if (backups[INSTRUMENTED]) return 0;
  let wrapped = 0;
  for (const name of BACKUP_METHODS) {
    const original = backups[name];
    if (typeof original !== 'function') continue;
    backups[name] = function(...args) {
      return wrapCall(name, (...parameters) => original.apply(this, parameters), args, {
        category: 'CORE', skip: READ_ONLY.has(name),
      });
    };
    wrapped++;
  }
  Object.defineProperty(backups, INSTRUMENTED, { value: true, enumerable: false });
  output('INFO', 'DIAGNOSTICS_READY', { wrappedCoreMethods: wrapped,
    logLevel: debugEnabled() ? 'debug' : 'info', pathLogging: tracePaths() ? 'enabled' : 'masked',
    storage: 'terminal-only' });
  return wrapped;
}
function scopeReport(label, snapshot, { game = '', id = null } = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  output('INFO', label, { game, scannedFiles: snapshot.scannedFiles,
    scannedDirectories: snapshot.scannedDirectories, completedRoots: snapshot.completedRoots,
    limitedRoots: snapshot.limitedRoots, partial: !!snapshot.partial,
    depthLimited: !!snapshot.depthLimited, changedFiles: snapshot.changedFiles,
    candidates: snapshot.candidates?.length, elapsedMs: snapshot.elapsedMs }, { id });
  for (const scope of snapshot.scopes || []) output('DEBUG', `${label}:SCOPE`, {
    kind: scope.kind, path: scope.root, complete: scope.complete,
    reason: scope.reason || 'OK', scannedFiles: scope.scannedFiles,
    scannedDirectories: scope.scannedDirectories, depthLimited: scope.depthLimited,
  }, { id });
}
module.exports = { newId, currentId, clean, shortPath, output, wrapIpc, instrumentBackups,
  wrapCall, summarizeResult, summarizeArgs, scopeReport, debugEnabled };
