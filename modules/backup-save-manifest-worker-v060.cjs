'use strict';
// Explicit, opt-in upstream update. Network input is never executed as code.
const { isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const URL = 'https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/master/data/manifest.yaml';
const MAX_BYTES = 28 * 1024 * 1024;
function compileManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('MANIFEST_INVALID_ROOT');
  const aliases = new Map();
  const games = [];
  for (const [title, data] of Object.entries(raw)) {
    if (typeof title !== 'string' || title.length > 220 || !data || typeof data !== 'object') continue;
    if (typeof data.alias === 'string' && data.alias.length <= 220) {
      if (!aliases.has(data.alias)) aliases.set(data.alias, []);
      aliases.get(data.alias).push(title);
      continue;
    }
    const files = data.files;
    if (!files || typeof files !== 'object' || Array.isArray(files)) continue;
    const paths = [];
    for (const [p, config] of Object.entries(files).slice(0, 80)) {
      if (typeof p !== 'string' || p.length > 1000 || /[\r\n\0]/.test(p)) continue;
      const tags = Array.isArray(config?.tags) ? config.tags.filter(t => t === 'save' || t === 'config') : [];
      // Prefer actual save data; configuration-only and unrelated files are not save candidates.
      if (Array.isArray(config?.tags) && config.tags.length && !tags.includes('save')) continue;
      const when = Array.isArray(config?.when) ? config.when.map(x => ({ os: x?.os || null })).slice(0, 8) : [];
      paths.push({ path: p, tags, when });
    }
    if (!paths.length) continue;
    const steamId = data?.steam?.id == null ? '' : String(data.steam.id);
    games.push({ name: title, aliases: [], steamId: /^\d{1,12}$/.test(steamId) ? steamId : '', paths });
  }
  for (const game of games) game.aliases = (aliases.get(game.name) || []).slice(0, 40);
  return games;
}
function getText(etag) {
  return new Promise((resolve, reject) => {
    const headers = { 'User-Agent': 'Nexus-Game-Save-Discovery/0.6', 'Accept': 'text/plain' };
    if (etag && etag.length <= 250) headers['If-None-Match'] = etag;
    const request = https.get(URL, { headers, timeout: 20000 }, response => {
      if (response.statusCode === 304) { response.resume(); resolve({ notModified: true }); return; }
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error(`MANIFEST_HTTP_${response.statusCode}`)); return;
      }
      const parts = [];
      let total = 0;
      response.on('data', part => {
        total += part.length;
        if (total > MAX_BYTES) { request.destroy(new Error('MANIFEST_TOO_LARGE')); return; }
        parts.push(part);
      });
      response.on('end', () => resolve({ text: Buffer.concat(parts).toString('utf8'),
        etag: typeof response.headers.etag === 'string' ? response.headers.etag : '' }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('MANIFEST_TIMEOUT')));
    request.on('error', reject);
  });
}
function updateManifest(output) {
  return (async () => {
    if (typeof output !== 'string' || !path.isAbsolute(output) || path.basename(output) !== 'gameSaveManifest.v1.json') {
      throw new Error('MANIFEST_OUTPUT_INVALID');
    }
    const parent = path.dirname(output);
    const parentStat = fs.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
      throw new Error('MANIFEST_PARENT_INVALID');
    }
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(output, 'utf8')); } catch { /* no previous valid index */ }
    const downloaded = await getText(typeof previous?.etag === 'string' ? previous.etag : '');
    if (downloaded.notModified) return { updated: false, notModified: true, games: previous?.games?.length || 0 };
    // js-yaml is already a production dependency of Nexus; it is loaded in this worker only.
    const yaml = require('js-yaml');
    const parsed = yaml.load(downloaded.text, { schema: yaml.JSON_SCHEMA });
    const games = compileManifest(parsed);
    if (games.length < 1000 || games.length > 100000) throw new Error('MANIFEST_COUNT_IMPLAUSIBLE');
    const index = { version: 1, source: URL, updatedAt: new Date().toISOString(),
      sourceSha256: crypto.createHash('sha256').update(downloaded.text).digest('hex'), etag: downloaded.etag,
      games };
    const serialized = JSON.stringify(index);
    if (Buffer.byteLength(serialized) > 28 * 1024 * 1024) throw new Error('INDEX_TOO_LARGE');
    const temp = path.join(parent, '.nexus-save-manifest-' + crypto.randomBytes(8).toString('hex') + '.tmp');
    try {
      fs.writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, output);
    } finally { try { fs.unlinkSync(temp); } catch { /* temporary file already moved */ } }
    return { updated: true, games: games.length, updatedAt: index.updatedAt,
      sourceSha256: index.sourceSha256 };
  })();
}
if (!isMainThread) {
  updateManifest(workerData?.outputPath).then(value => parentPort.postMessage({ ok: true, value }),
    error => parentPort.postMessage({ ok: false, error: String(error?.message || error) }));
}
module.exports = { compileManifest, updateManifest, URL };
