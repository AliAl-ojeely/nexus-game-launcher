'use strict';
// Read-only, user-confirmed candidate discovery. Never writes backup configurations.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Worker } = require('node:worker_threads');

const INDEX_FILE = 'gameSaveManifest.v1.json';
const IGNORE = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'windows', 'winsxs', 'appdata\\local\\temp']);
const SAVE_FOLDERS = ['Saved', 'Saved/SaveGames', 'Saves', 'Save', 'SaveGames', 'SaveData', 'savedata', 'Profiles', 'profiles'];
const MAX_INDEX_BYTES = 30 * 1024 * 1024;
let indexCache = { file: '', stamp: '', index: null };
let unityCache = { root: '', stamp: '', games: new Map() };

function normalize(x) {
  return String(x || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
function safeLstat(p) { try { return fs.lstatSync(p); } catch { return null; } }
function safeReaddir(p) { try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; } }
function safeResolve(p) { try { return path.resolve(p); } catch { return ''; } }
function isWithin(p, root) {
  if (!p || !root) return false;
  const rel = path.relative(safeResolve(root), safeResolve(p));
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}
function hasSymlinkAncestor(p) {
  let cur = safeResolve(p);
  for (let i = 0; cur && i < 40; i++) {
    const s = safeLstat(cur);
    if (s?.isSymbolicLink()) return true;
    const next = path.dirname(cur);
    if (next === cur) return false;
    cur = next;
  }
  return true;
}
function stats(location) {
  if (!location || !path.isAbsolute(location) || hasSymlinkAncestor(location)) return null;
  const s = safeLstat(location);
  if (!s || (!s.isFile() && !s.isDirectory())) return null;
  if (s.isFile()) return s.size > 0 ? { kind: 'file', files: 1, bytes: s.size, partial: false } : null;
  const todo = [[location, 0]];
  let files = 0, bytes = 0, visited = 0, partial = false;
  while (todo.length && visited < 600) {
    const [dir, depth] = todo.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { partial = true; continue; }
    for (const e of entries) {
      if (++visited >= 600) { partial = true; break; }
      if (e.isSymbolicLink()) { partial = true; continue; }
      if (e.isFile()) {
        const st = safeLstat(path.join(dir, e.name));
        if (st) { files++; bytes += st.size; } else partial = true;
      } else if (e.isDirectory()) {
        if (depth < 4) todo.push([path.join(dir, e.name), depth + 1]);
        else partial = true;
      }
    }
  }
  if (todo.length) partial = true;
  return files ? { kind: 'directory', files, bytes, partial } : null;
}
function context(game, env = process.env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const low = path.join(home, 'AppData', 'LocalLow');
  const executable = typeof game?.path === 'string' && path.isAbsolute(game.path) ? game.path : '';
  const exeStat = executable ? safeLstat(executable) : null;
  const install = game?.isInstalled === false || !exeStat?.isFile() ? '' : path.dirname(executable);
  const doc = env.USER_DOCUMENTS || path.join(home, 'Documents');
  const roots = [home, local, roaming, low, doc, path.join(home, 'Saved Games'),
    ...(env.PROGRAMDATA ? [env.PROGRAMDATA] : []), ...(env.PUBLIC ? [env.PUBLIC] : []),
    ...(env.OneDrive ? [path.join(env.OneDrive, 'Documents')] : []),
    ...(install ? [install] : [])].filter(Boolean);
  return { home, local, roaming, low, install, doc, roots, env };
}
function placeholders(template, game, c, steamId = '') {
  if (typeof template !== 'string' || template.length > 1000 || /[\r\n\0]/.test(template)) return '';
  const map = {
    '<home>': c.home, '<winappdata>': c.roaming, '<winlocalappdata>': c.local,
    '<winlocalappdatalow>': c.low, '<windocuments>': c.doc,
    '<winsavedgames>': path.join(c.home, 'Saved Games'),
    '<winprogramdata>': c.env.PROGRAMDATA || '', '<winpublic>': c.env.PUBLIC || '',
    '<base>': c.install, '<root>': c.install, '<game>': String(game?.name || ''),
    '<storegameid>': steamId, '<storeuserid>': '*',
    '{{p|appdata}}': c.roaming, '{{p|localappdata}}': c.local,
    '{{p|documents}}': c.doc, '{{p|userprofile}}': c.home,
    '{{p|savedgames}}': path.join(c.home, 'Saved Games'), '{{p|game}}': c.install,
  };
  let s = template.replace(/%([a-z_()0-9]+)%/gi, (m, v) => c.env[v] || c.env[v.toUpperCase()] || m);
  s = s.replace(/<[^>]+>|\{\{p\|[^}]+\}\}/gi, m => map[m.toLowerCase()] === undefined ? m : map[m.toLowerCase()]);
  if (/[<>{}%]/.test(s) || s.includes('..' + path.sep)) return '';
  if (/^(?:[.][.][\\/]|[.][\\/])/.test(s)) return '';
  s = path.normalize(s);
  return path.isAbsolute(s) ? s : '';
}
function trustedPath(p, c) {
  const exact = safeResolve(p).toLowerCase();
  if (c.roots.some(root => safeResolve(root).toLowerCase() === exact)) return false;
  // Never offer entire profile, AppData, Documents, Saved Games, or install roots.
  return c.roots.some(root => isWithin(p, root));
}
function patternRegex(s) {
  return new RegExp('^' + s.replace(/[|\\{}()[\]^$+.]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}
// Expand only bounded glob segments. For a file glob, return the matching parent folder.
function expandPattern(raw, c, max = 24) {
  if (!raw || !path.isAbsolute(raw)) return [];
  const root = path.parse(raw).root;
  const segments = raw.slice(root.length).split(/[\\/]/).filter(Boolean);
  let states = [root];
  for (let i = 0; i < segments.length && states.length; i++) {
    const part = segments[i];
    const glob = /[*?]/.test(part);
    const next = [];
    for (const base of states) {
      if (next.length >= max) break;
      if (glob) {
        const re = patternRegex(part);
        const entries = safeReaddir(base).slice(0, 2500);
        for (const e of entries) {
          if (next.length >= max) break;
          if (e.isSymbolicLink() || !re.test(e.name)) continue;
          const target = path.join(base, e.name);
          if (i === segments.length - 1 && e.isFile()) next.push(base);
          else if (e.isDirectory()) next.push(target);
        }
      } else {
        const target = path.join(base, part);
        if (safeLstat(target) && !safeLstat(target).isSymbolicLink()) next.push(target);
      }
    }
    states = [...new Set(next)];
  }
  return states.filter(p => trustedPath(p, c)).slice(0, max);
}
function readIndex(indexPath) {
  if (!indexPath) return null;
  const st = safeLstat(indexPath);
  if (!st?.isFile() || st.size < 10 || st.size > MAX_INDEX_BYTES || st.isSymbolicLink()) return null;
  const stamp = st.size + ':' + st.mtimeMs;
  if (indexCache.file === indexPath && indexCache.stamp === stamp) return indexCache.index;
  let value;
  try { value = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { return null; }
  if (value?.version !== 1 || !Array.isArray(value.games) || value.games.length > 100000) return null;
  const byName = new Map(), bySteam = new Map();
  for (const item of value.games) {
    if (!item || typeof item.name !== 'string' || !Array.isArray(item.paths)) continue;
    for (const name of [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])]) {
      const key = normalize(name);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, new Set());
      byName.get(key).add(item);
    }
    if (item.steamId && /^\d{1,12}$/.test(String(item.steamId))) {
      const k = String(item.steamId);
      if (!bySteam.has(k)) bySteam.set(k, new Set());
      bySteam.get(k).add(item);
    }
  }
  indexCache = { file: indexPath, stamp, index: { value, byName, bySteam } };
  return indexCache.index;
}
function explicitSteamId(game) {
  for (const x of [game?.metadata?.steamAppId, game?.steamAppId, game?.steamId, game?.steam_appid, game?.steam_app_id, game?.storeIds?.steam]) {
    if (x !== undefined && x !== null && /^\d{1,12}$/.test(String(x))) return String(x);
  }
  return '';
}
function isWindowsRule(rule) {
  if (!rule?.when || !Array.isArray(rule.when)) return true;
  return rule.when.some(cond => !cond?.os || cond.os === 'windows');
}
function unityMatches(low, name) {
  const s = safeLstat(low);
  if (!s?.isDirectory()) return [];
  const stamp = s.mtimeMs + ':' + s.ino;
  if (unityCache.root !== low || unityCache.stamp !== stamp) {
    const gameDirs = new Map();
    for (const publisher of safeReaddir(low).slice(0, 350)) {
      if (!publisher.isDirectory() || publisher.isSymbolicLink()) continue;
      const publisherDir = path.join(low, publisher.name);
      for (const child of safeReaddir(publisherDir).slice(0, 350)) {
        if (!child.isDirectory() || child.isSymbolicLink()) continue;
        const key = normalize(child.name);
        if (!gameDirs.has(key)) gameDirs.set(key, []);
        gameDirs.get(key).push(path.join(publisherDir, child.name));
      }
    }
    unityCache = { root: low, stamp, games: gameDirs };
  }
  return unityCache.games.get(normalize(name)) || [];
}
function candidatesFor(game, { indexPath, env = process.env } = {}) {
  const c = context(game, env);
  const out = [], warnings = [], used = new Set();
  function add(p, source, confidence, tags = []) {
    if (!p || !trustedPath(p, c)) return;
    const info = stats(p);
    if (!info) return;
    const key = safeResolve(p).toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    out.push({ path: p, source, confidence, ...info, ...(tags.length ? { tags } : {}) });
  }
  const id = explicitSteamId(game);
  const index = readIndex(indexPath);
  let hit = null;
  if (index) {
    let matches = index.byName.get(normalize(game?.name)) || new Set();
    if (id && index.bySteam.has(id)) matches = index.bySteam.get(id);
    if (matches.size === 1) hit = [...matches][0];
    if (matches.size > 1) warnings.push({ code: 'UPSTREAM_TITLE_AMBIGUOUS', message: 'More than one manifest identity matches this game' });
  } else warnings.push({ code: 'UPSTREAM_MANIFEST_NOT_READY', message: 'Refresh the upstream save database to cover recent games' });
  if (hit) {
    const sid = id || hit.steamId || '';
    for (const rule of hit.paths.slice(0, 60)) {
      if (!isWindowsRule(rule)) continue;
      const resolved = placeholders(rule.path, game, c, sid);
      if (!resolved) continue;
      for (const p of expandPattern(resolved, c)) add(p, 'upstream-manifest', 90, rule.tags || []);
    }
  }
  const names = [game?.name, c.install ? path.basename(c.install) : '', game?.path ? path.parse(game.path).name : '']
    .filter(Boolean).slice(0, 3);
  for (const name of names) {
    if (!name || name.length > 110 || /[\\/]/.test(name)) continue;
    for (const root of [c.local, c.roaming, c.doc, path.join(c.doc, 'My Games'),
      path.join(c.home, 'Saved Games'), ...(env.OneDrive ? [path.join(env.OneDrive, 'Documents')] : [])]) {
      if (!root) continue;
      for (const child of [name, ...SAVE_FOLDERS.map(folder => path.join(name, folder))]) {
        add(path.join(root, child), 'name-convention', 55);
      }
    }
    add(path.join(c.roaming, 'Godot', 'app_userdata', name), 'godot-convention', 64);
    add(path.join(c.local, name, 'Saved', 'SaveGames'), 'unreal-convention', 64);
    // Unity usually stores saves under LocalLow/<publisher>/<game name>.
    for (const match of unityMatches(c.low, name)) add(match, 'unity-locallow', 63);
  }
  if (c.install && c.install !== path.parse(c.install).root) {
    for (const folder of SAVE_FOLDERS) add(path.join(c.install, folder), 'installation-folder', 54);
  }
  const ids = new Set([id, hit?.steamId].filter(x => /^\d{1,12}$/.test(String(x || ''))));
  const steamRoots = [env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Steam'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Steam'),
    path.join(c.home, 'AppData', 'Local', 'Steam')].filter(Boolean);
  for (const steamId of ids) {
    for (const steamRoot of steamRoots) {
      const userData = path.join(steamRoot, 'userdata');
      for (const account of safeReaddir(userData).slice(0, 200)) {
        if (!account.isDirectory() || !/^\d{1,24}$/.test(account.name)) continue;
        const dir = path.join(userData, account.name, steamId, 'remote');
        // Only the user's Steam installation is scanned; no inference from Nexus game ID.
        if (isWithin(dir, steamRoot)) {
          const info = stats(dir);
          if (info) addSteamCandidate(dir, info);
        }
      }
    }
  }
  function addSteamCandidate(p, info) {
    const key = safeResolve(p).toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    out.push({ path: p, source: 'steam-cloud-remote', confidence: 88, ...info });
  }
  if (out.filter(x => x.confidence >= 88).length > 1) {
    warnings.push({ code: 'MULTIPLE_SAVE_LOCATIONS', message: 'More than one save location found. Nexus currently confirms one originPath at a time; review all locations.' });
  }
  return { candidates: out.slice(0, 90), warnings, upstreamUpdatedAt: index?.value?.updatedAt || null, upstreamMatched: !!hit };
}
function mergePreview(base, extra, scanMode = 'fast') {
  const map = new Map();
  for (const candidate of [...(base.candidates || []), ...(extra.candidates || [])]) {
    const key = safeResolve(candidate.path).toLowerCase();
    if (!map.has(key) || map.get(key).confidence < candidate.confidence) map.set(key, candidate);
  }
  return { ...base, scanMode, candidates: [...map.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 120),
    warnings: [...(base.warnings || []), ...(extra.warnings || [])],
    upstreamMatched: extra.upstreamMatched, upstreamUpdatedAt: extra.upstreamUpdatedAt };
}
function scanDeepInWorker(game, { extraRoot = '', env = process.env, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'backup-save-scan-worker-v060.cjs'), {
      workerData: { action: 'scan', game: { name: game.name, path: game.path || '', isInstalled: game.isInstalled },
        extraRoot, env: { USERPROFILE: env.USERPROFILE, HOME: env.HOME, APPDATA: env.APPDATA, LOCALAPPDATA: env.LOCALAPPDATA,
          OneDrive: env.OneDrive, USER_DOCUMENTS: env.USER_DOCUMENTS } },
    });
    let ended = false;
    const timer = setTimeout(() => finish(new Error('Deep discovery time limit reached')), timeoutMs);
    function finish(error, result) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(result);
    }
    worker.on('message', message => message?.ok ? finish(null, message.value) : finish(new Error(message?.error || 'Worker scan failed')));
    worker.on('error', error => finish(error));
    worker.on('exit', code => { if (code !== 0 && !ended) finish(new Error('Worker stopped during scan')); });
  });
}
module.exports = { INDEX_FILE, normalize, context, placeholders, expandPattern, readIndex, stats,
  candidatesFor, mergePreview, scanDeepInWorker, isWithin, hasSymlinkAncestor };
