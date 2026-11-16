'use strict';
// Bounded, read-only search in user-selected and conventional save roots.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const { normalize, stats, context, isWithin } = require('./backup-save-discovery-v060');
const { exclusionReason } = require('./backup-deep-scan-safety-v074.cjs');
const { deepScan: fairDeepScan } = require('./backup-deep-scan-fair-v075.cjs');
const SKIP = new Set(['.git', 'node_modules', '$recycle.bin', 'system volume information', 'windows',
  'winsxs', 'program files', 'program files (x86)', 'msocache', 'cache', 'caches', 'temp', 'tmp']);
const SAVES = new Set(['save', 'saves', 'savedata', 'savegame', 'savegames', 'saved', 'profiles']);
const EXT = /\.(sav|save|rpgsave|rxdata|rvdata2|sol|srm|state)$/i;
const NAMED_SAVE = /(?:save|profile|progress|slot|persistent)/i;
function deepScan(game, options = {}) {
  return fairDeepScan(game, options);
}

if (!isMainThread && workerData?.action === 'scan') {
  try { parentPort.postMessage({ ok: true, value: deepScan(workerData.game, workerData) }); }
  catch (err) { parentPort.postMessage({ ok: false, error: err.message }); }
}
module.exports = { deepScan };
