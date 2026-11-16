'use strict';
// Pure read-only filtering for opt-in observation results. A changed file is not proof of a game save.
const path = require('node:path');

const FOCUSED = new Set(['confirmed-save', 'manifest-save', 'upstream-save', 'chosen-root', 'game-install']);
const BAD_DIRECTORY = new Set([
  'cache', 'caches', 'shadercache', 'grshadercache', 'gpucache', 'gpu cache',
  'dawnwebgpucache', 'code cache', 'webcache', 'crashdumps', 'logs', 'log',
  'nexus game launcher', 'nexus overlay poc', 'service worker',
]);
function normalized(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}
function withinOrEqual(child, root) {
  if (!child || !root || !path.isAbsolute(child) || !path.isAbsolute(root)) return false;
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function parts(p) { return path.resolve(p).split(path.sep).filter(Boolean); }
function identityPartIndex(segments, title, steamId) {
  const normalizedTitle = normalized(title);
  for (let i = 0; i < segments.length; i++) {
    if (normalizedTitle && normalized(segments[i]) === normalizedTitle) return i;
    if (steamId && segments[i] === steamId) return i;
  }
  return -1;
}
function forbiddenSegment(p) { return parts(p).some(part => BAD_DIRECTORY.has(part.toLocaleLowerCase('en-US'))); }
function reviewCandidates(candidates, { gameName, steamId, roots } = {}) {
  const clean = [], seen = new Map();
  let excluded = 0;
  const trustedSteam = /^\d{1,12}$/.test(String(steamId || '')) ? String(steamId) : '';
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate.path !== 'string' || !path.isAbsolute(candidate.path) ||
        forbiddenSegment(candidate.path)) { excluded++; continue; }
    const scopes = (Array.isArray(roots) ? roots : []).filter(root =>
      root?.kind === candidate.evidenceKind && withinOrEqual(candidate.path, root.root));
    scopes.sort((a, b) => b.root.length - a.root.length);
    const scope = scopes[0];
    if (!scope) { excluded++; continue; }
    const relative = path.relative(scope.root, candidate.path);
    const segments = relative ? relative.split(path.sep).filter(Boolean) : [];
    const identityIndex = identityPartIndex(segments, gameName, trustedSteam);
    const focused = FOCUSED.has(scope.kind);
    // Broad Windows scopes require an EXACT game-title or trusted Steam ID component.
    if (!focused && identityIndex === -1) { excluded++; continue; }
    let selectedPath = candidate.path;
    // A trusted rule already owns the save root. Do not suggest a Unity cache or GUID child.
    if (['confirmed-save', 'manifest-save', 'upstream-save'].includes(scope.kind)) {
      selectedPath = scope.root;
    } else if (!focused && identityIndex >= 0) {
      selectedPath = path.join(scope.root, ...segments.slice(0, identityIndex + 1));
    }
    if (forbiddenSegment(selectedPath)) { excluded++; continue; }
    const key = path.resolve(selectedPath).toLocaleLowerCase('en-US');
    const previous = seen.get(key);
    const value = { ...candidate, path: selectedPath, observationOnly: true,
      tags: [...new Set([...(Array.isArray(candidate.tags) ? candidate.tags : []), 'observation-review-only'])] };
    if (previous) {
      previous.changedFiles += value.changedFiles || 0;
      previous.files = previous.changedFiles;
    } else {
      clean.push(value);
      seen.set(key, value);
    }
  }
  return { candidates: clean, excluded, reviewed: clean.length };
}
module.exports = { reviewCandidates, withinOrEqual, normalized, forbiddenSegment };
