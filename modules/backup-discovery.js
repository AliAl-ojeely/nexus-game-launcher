'use strict';
// Discovery preview ONLY. No archive writes or config mutation.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const safeStat = p => { try { return fs.statSync(p); } catch { return null; } };
const isDir = p => !!safeStat(p)?.isDirectory();
const isFile = p => !!safeStat(p)?.isFile();

function resolveTemplate(raw, exe, env = process.env) {
  if (typeof raw !== 'string') return null;
  const home = env.USERPROFILE || os.homedir();
  const gameDir = exe ? path.dirname(exe) : null;
  const vars = {
    '{{p|localappdata}}': env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    '{{p|appdata}}': env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    '{{p|userprofile}}': home,
    '{{p|documents}}': path.join(home, 'Documents'),
    '{{p|savedgames}}': path.join(home, 'Saved Games'),
    '{{p|game}}': gameDir,
    '<winlocalappdata>': env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
    '<winappdata>': env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    '<windocuments>': path.join(home, 'Documents'),
    '<winsavedgames>': path.join(home, 'Saved Games'),
    '<root>': gameDir,
    '<base>': gameDir,
  };
  let value = raw;
  for (const [key, replacement] of Object.entries(vars)) {
    if (replacement) value = value.replaceAll(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => replacement);
  }
  value = value.replace(/%([^%]+)%/g, (whole, key) => env[key] || env[key.toUpperCase()] || whole);
  if (/[<>*?\[\]{}%]/.test(value)) return null; // unsupported placeholder or wildcard
  value = path.normalize(value);
  return path.isAbsolute(value) ? value : null;
}

function inspect(location) {
  const stat = safeStat(location);
  if (!stat) return null;
  if (stat.isFile()) return { kind: 'file', files: 1, bytes: stat.size, partial: false };
  if (!stat.isDirectory()) return null;
  let files = 0, bytes = 0, visited = 0, partial = false;
  const todo = [[location, 0]];
  while (todo.length && visited < 1500) {
    const [dir, depth] = todo.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { partial = true; continue; }
    for (const entry of entries) {
      visited++;
      if (visited > 1500) { partial = true; break; }
      if (entry.isSymbolicLink()) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 6) todo.push([p, depth + 1]); else partial = true;
      } else if (entry.isFile()) {
        files++;
        const s = safeStat(p);
        if (s) bytes += s.size; else partial = true;
      }
    }
  }
  if (todo.length) partial = true;
  return { kind: 'directory', files, bytes, partial };
}

function detectEngine(exe) {
  if (!exe || !isFile(exe)) return 'unknown';
  const dir = path.dirname(exe);
  const stem = path.parse(exe).name;
  if (isFile(path.join(dir, 'UnityPlayer.dll')) || isDir(path.join(dir, stem + '_Data'))) return 'unity';
  if (isDir(path.join(dir, 'Engine')) || isDir(path.join(dir, 'Content', 'Paks'))) return 'unreal';
  if (isFile(path.join(dir, 'data.win'))) return 'gamemaker';
  if (isDir(path.join(dir, 'renpy')) && isDir(path.join(dir, 'game'))) return 'renpy';
  if (isFile(path.join(dir, stem + '.pck'))) return 'godot';
  if (isDir(path.join(dir, 'www', 'js'))) return 'rpgmaker';
  return 'unknown';
}

function previewDiscovery(game, { manifestPath, env = process.env } = {}) {
  if (!game || !game.name || !game.id) {
    const e = new Error('Game ID/name missing'); e.code = 'INVALID_GAME'; throw e;
  }
  const name = String(game.name);
  const exactName = normalize(name);
  const exe = game.isInstalled === false ? '' : String(game.path || '');
  const engine = detectEngine(exe);
  const candidates = new Map();
  const warnings = [];
  const add = (value, source, confidence) => {
    const resolved = resolveTemplate(value, exe, env);
    if (!resolved) return;
    const info = inspect(resolved);
    if (!info) return;
    const key = resolved.toLowerCase();
    if (!candidates.has(key) || candidates.get(key).confidence < confidence) {
      candidates.set(key, { path: resolved, source, confidence, ...info });
    }
  };

  // Built-in rule for the 2026 Fatal Frame II remake.
  // Launcher names are often shortened; never require the full store title.
  // Explicit aliases are narrow: the original PS2 title must not match.
  const fatalFrameRemakeAliases = new Set([
    'fatal frame ii remake',
    'fatal frame 2 remake',
    'fatal frame ii crimson butterfly remake',
    'fatal frame 2 crimson butterfly remake',
    'project zero ii remake',
    'project zero 2 remake',
    'project zero ii crimson butterfly remake',
    'project zero 2 crimson butterfly remake',
  ]);
  const gameExeName = exe ? path.basename(exe).toLowerCase() : '';
  const hasRemakeExe = gameExeName === 'fatalframeii.exe' && isFile(exe);
  const hasCorrectFranchiseAndNumber = /^(?:fatal frame|project zero) (?:ii|2)(?: |$)/.test(exactName);
  if (fatalFrameRemakeAliases.has(exactName) || (hasRemakeExe && hasCorrectFranchiseAndNumber)) {
    add(path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'KoeiTecmo', 'FatalFrameII', 'Savedata'), 'known-rule', 100);
  }

  // Use exact name/alias only, never fuzzy-overlap automatic selection.
  if (manifestPath) {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (err) { warnings.push({ code: 'MANIFEST_UNAVAILABLE', message: err.message }); }
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
      const matches = Object.entries(manifest).filter(([key, item]) => normalize(key) === exactName ||
        (Array.isArray(item?.aliases) && item.aliases.some(alias => normalize(alias) === exactName)));
      if (matches.length === 1) {
        const [title, entry] = matches[0];
        for (const rule of Array.isArray(entry?.paths) ? entry.paths : []) add(rule, `Ludusavi: ${title}`, 75);
      } else if (matches.length > 1) {
        warnings.push({ code: 'NAME_AMBIGUOUS', message: `More than one manifest entry matches "${name}"` });
      }
    }
  }

  if (exe && isFile(exe)) {
    const base = path.dirname(exe);
    for (const child of ['SaveGames', 'Saves', 'Save', 'save', 'savedata']) {
      add(path.join(base, child), 'installation-folder', 35);
    }
    if (engine === 'unreal') {
      const hints = [path.basename(base), path.parse(exe).name];
      for (const hint of hints) add(path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), hint, 'Saved', 'SaveGames'), 'unreal-convention', 45);
    }
    if (engine === 'godot') add(path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Godot', 'app_userdata', name), 'godot-convention', 45);
  }
  return { ok: true, gameId: game.id, game: name, engine,
    candidates: [...candidates.values()].sort((a, b) => b.confidence - a.confidence), warnings };
}
module.exports = { previewDiscovery, resolveTemplate, normalize, inspect };
