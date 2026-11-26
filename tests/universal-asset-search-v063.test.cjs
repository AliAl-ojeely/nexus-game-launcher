'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { lookupTitle, queryVariants, exactRows, chooseRawg, chooseBaseArtwork, providerStatus } = require('../modules/asset-search-identity-v063.cjs');

// Real source modules; replace only external transport, Electron-backed service
// imports and credential access. No API keys, network, user profile or game data.
function loadModules() {
    const original = Module._load;
    const modules = ['asset-pipeline.js', 'metadata.js', 'rawg-api.js', 'steamGrid-api.js', 'asset-downloader.js'];
    for (const name of modules) delete require.cache[require.resolve(`../modules/${name}`)];
    try {
        Module._load = function(id, parent, isMain) {
            if (id === 'axios') return { get: async () => { throw Error('LIVE_HTTP_BLOCKED'); } };
            if (id === './provider-credentials') return {};
            if (['./steam-api', './steam-artwork', './youtube-api'].includes(id)) return {};
            if (id === './assets') return { downloadGameAssets: () => { throw Error('USER_DATA_BLOCKED'); } };
            if (id === './asset-request-limit') return { limitAssetDownloads: work => work() };
            return original.call(this, id, parent, isMain);
        };
        return {
            rawg: require('../modules/rawg-api'), grid: require('../modules/steamGrid-api'),
            pipeline: require('../modules/asset-pipeline'), downloader: require('../modules/asset-downloader'),
        };
    } finally { Module._load = original; }
}
const title = 'The Legend of Zelda: Ocarina of Time';
const localTitle = `${title} (2026)`;
const rawgRow = (id, name, year) => ({ id, name, released: year ? `${year}-11-21` : null });
const gridRow = (id, name, year, types = ['game']) => ({ id, name, release_date: year ? `${year}-11-21` : null, types, verified: true });
const original = rawgRow(9001, title, 1998); // Synthetic RAWG ID; not a live provider claim.
const originalGrid = gridRow(21202, title, 1998); // Public catalog ID; simulated response.
const version3d = gridRow(21203, `${title} 3D`, 2011);
const proof = { provider: 'rawg', id: '9001', name: title, relation: 'base_game', releaseYear: 1998, requestedYear: 2026 };
const opts = { canonicalName: title, releaseYear: 1998, catalogIdentity: proof };
const bg = 'https://media.rawg.io/media/games/test/hero.jpg';

function makeRawgHttp(rows, detail = original, options = {}) {
    const calls = [];
    return { calls, get: async (url, cfg) => {
        calls.push({ url, query: cfg.params?.search });
        assert.equal(cfg.maxRedirects, 0);
        assert.equal(cfg.timeout, 10000);
        if (url.endsWith('/games')) {
            if (options.failQualified && cfg.params.search.includes('(2026)')) throw Object.assign(Error('private-key'), { code: 'ETIMEDOUT' });
            return { data: { results: typeof rows === 'function' ? rows(cfg.params.search) : rows } };
        }
        if (url.endsWith(`/games/${detail.id}`)) return { data: {
            ...detail, description_raw: 'Catalog description', developers: [{ name: 'Nintendo' }],
            publishers: [{ name: 'Nintendo' }], metacritic: 99,
            platforms: [{ platform: { slug: 'pc' }, requirements: { minimum: 'Original requirements' } }],
            stores: [{ store: { slug: 'steam' }, url: 'https://store.steampowered.com/app/1234/' }],
            background_image: bg,
        } };
        throw Error('unexpected RAWG request');
    } };
}
function makeGridHttp(rows, options = {}) {
    const calls = [];
    return { calls, get: async (url, cfg) => {
        calls.push(url);
        assert.equal(cfg.maxRedirects, 0);
        if (url.includes('/search/autocomplete/')) {
            if (options.failQualified && decodeURIComponent(url).includes('(2026)')) throw Object.assign(Error('private-key'), { code: 'ETIMEDOUT' });
            if (options.emptyQualified && decodeURIComponent(url).includes('(2026)')) throw Object.assign(Error('empty'), { response: { status: 404 } });
            return { data: { success: true, data: rows } };
        }
        if (url.includes('/games/steam/')) return { data: { success: true, data: { id: 80 } } };
        const m = /\/(grids|heroes|logos|icons)\/game\/(\d+)/.exec(url);
        if (!m) throw Error('unexpected artwork endpoint');
        if (options.emptyArt) return { data: { data: [] } };
        const kind = m[1];
        return { data: { data: [{ url: `https://cdn2.steamgriddb.com/test/${m[2]}-${kind}.png`, width: kind === 'grids' ? 600 : 1200, height: kind === 'grids' ? 900 : 600 }] } };
    } };
}

function integration(options = {}) {
    const { rawg, grid, pipeline } = loadModules();
    const rawgHttp = makeRawgHttp(options.rawgRows || [original], options.detail || original);
    const gridHttp = makeGridHttp(options.gridRows || [originalGrid, version3d], options.gridOptions);
    const calls = { steam: [], library: [] };
    const providers = {
        rawg: { fetchGameDetails: (name, cfg) => rawg.fetchGameDetails(name, { ...cfg, http: rawgHttp, apiKey: options.rawgKey ?? 'test' }) },
        steam: {
            searchAppId: async name => { calls.steam.push(name); return options.steamId || null; },
            fetchGameDetails: async id => { calls.steam.push(id); return options.steamDetails || null; },
        },
        grid: { fetchGameAssets: (name, id, cfg) => grid.fetchGameAssets(name, id, { ...cfg, http: gridHttp, apiKey: options.gridKey ?? 'test' }) },
        library: { fetchSteamArtwork: async id => { calls.library.push(id); return {}; } },
        youtube: { getTrailerData: async () => null },
    };
    return { pipeline, rawgHttp, gridHttp, calls, providers };
}

test('parenthesized version year and explicit port labels are separate from title identity', () => {
    assert.equal(lookupTitle(localTitle).base, title);
    assert.equal(lookupTitle(localTitle).year, 2026);
    assert.equal(lookupTitle(`${title} (2026) (PC Port)`).port, true);
    assert.equal(lookupTitle(`${title} (PC Port) (2026)`).base, title);
    assert.equal(lookupTitle(`${title} - Native PC Port`).base, title);
});
test('year and sequel numbers that belong to actual titles are not stripped', () => {
    for (const name of ['FIFA 2010', 'NBA 2K24', 'Cyberpunk 2077', 'Silent Hill 2', 'Formula 1 2026']) {
        assert.equal(lookupTitle(name).base, name);
        assert.equal(lookupTitle(name).year, null);
    }
});
test('search variants always include base title, preserve full label and remain bounded', () => {
    const queries = queryVariants(localTitle, [`${title} (1998)`, 'Other query']);
    assert.equal(queries[0], title); assert.ok(queries.includes(localTitle));
    assert.ok(queries.includes(`${title} (1998)`)); assert.ok(queries.length <= 5);
});
test('exact normalized base matching rejects sequels, 3D editions and non-game types', () => {
    const rows = exactRows(localTitle, [originalGrid, version3d, gridRow(3, title, 1998, ['movie']), gridRow(4, title+' II', 1998), gridRow(5, title, 1998, ['game','dlc'])]);
    assert.deepEqual(rows.map(x => x.id), ['21202']);
});
test('RAWG selects exact requested release before considering original release', () => {
    const modern = rawgRow(90, title, 2026);
    assert.equal(chooseRawg(localTitle, [original, modern]).id, '90');
    assert.equal(chooseRawg(localTitle, [original, modern]).relation, 'exact_release');
});
test('RAWG marks a unique earlier title as base game, not actual port release', () => {
    const selected = chooseRawg(localTitle, [original, rawgRow(2, `${title} 3D`, 2011)]);
    assert.equal(selected.relation, 'base_game'); assert.equal(selected.year, 1998);
});
test('RAWG refuses equally named releases, future mismatches and incomplete base searches', () => {
    assert.equal(chooseRawg(localTitle, [original, rawgRow(2, title, 2011)]), null);
    assert.equal(chooseRawg(localTitle, [rawgRow(3, title, 2027)]), null);
    assert.equal(chooseRawg(localTitle, [original], false), null);
});
test('base artwork requires two-provider corroboration and exact original year', () => {
    assert.equal(chooseBaseArtwork(localTitle, [originalGrid, version3d], opts, true).id, '21202');
    assert.equal(chooseBaseArtwork(localTitle, [originalGrid], { canonicalName: title, releaseYear: 1998 }, true), null);
    assert.equal(chooseBaseArtwork(localTitle, [originalGrid], { ...opts, catalogIdentity: { ...proof, releaseYear: 1999 } }, true), null);
    assert.equal(chooseBaseArtwork(localTitle, [originalGrid, gridRow(3, title, 2001)], opts, true), null);
    assert.equal(chooseBaseArtwork(localTitle, [originalGrid], opts, false), null);
});
test('RAWG provider uses base name even when year-qualified results are unrelated', async () => {
    const { rawg } = loadModules();
    const http = makeRawgHttp(q => q === title ? [original] : [rawgRow(4, `${title} 3D`, 2011)]);
    const data = await rawg.fetchGameDetails(localTitle, { http, apiKey: 'test' });
    assert.ok(data); assert.equal(data.releaseDate, '1998-11-21');
    assert.equal(data.catalogIdentity.relation, 'base_game'); assert.equal(data.catalogIdentity.requestedYear, 2026);
    assert.equal(data.steamAppId, null); assert.equal(data.systemRequirements.minimum, '');
    assert.ok(http.calls.some(c => c.query === title)); assert.ok(http.calls.some(c => c.query === localTitle));
});
test('RAWG refuses a mismatched final details response', async () => {
    const { rawg } = loadModules();
    const http = makeRawgHttp([original], rawgRow(original.id, `${title} 3D`, 2011));
    assert.equal(await rawg.fetchGameDetails(localTitle, { http, apiKey: 'test' }), null);
});
test('RAWG and SGDB missing keys do not touch network and report actionable status', async () => {
    const { rawg, grid } = loadModules(); const events = [];
    const http = { get() { throw Error('NETWORK_NOT_ALLOWED'); } };
    assert.equal(await rawg.fetchGameDetails(localTitle, { http, apiKey: '', onDiagnostic: e => events.push(e) }), null);
    assert.equal(await grid.fetchGameAssets(localTitle, null, { http, apiKey: '', onDiagnostic: e => events.push(e) }), null);
    assert.deepEqual(events.map(e => e.reason), ['missing_api_key', 'missing_api_key']);
});
test('SteamGridDB retrieves all four asset families from its own ID without a Steam AppID', async () => {
    const { grid } = loadModules(); const http = makeGridHttp([originalGrid, version3d], { emptyQualified: true });
    const result = await grid.fetchGameAssets(localTitle, null, { http, apiKey: 'test', ...opts });
    assert.equal(result.catalogIdentity.reason, 'corroborated_base_release');
    for (const k of ['poster','background','logo','icon']) assert.ok(result[k].includes('21202-'));
    assert.ok(http.calls.every(url => !url.includes('/games/steam/')));
    assert.ok(http.calls.every(url => !url.includes('/game/21203')));
});
test('SteamGridDB exact requested year beats the older corroborated base', async () => {
    const { grid } = loadModules(); const http = makeGridHttp([originalGrid, gridRow(300, title, 2026)]);
    const result = await grid.fetchGameAssets(localTitle, null, { http, apiKey: 'test', ...opts, kinds: ['poster'] });
    assert.equal(result.catalogIdentity.id, '300');
    assert.ok(http.calls.every(url => !url.includes('/game/21202')));
    assert.ok(http.calls.every(url => !url.includes('/heroes/')));
});
test('SteamGridDB never guesses a competing same-title release or failed partial base lookup', async () => {
    const { grid } = loadModules();
    for (const http of [makeGridHttp([originalGrid, gridRow(3, title, 2001)]), makeGridHttp([originalGrid], { failQualified: true })]) {
        assert.equal(await grid.fetchGameAssets(localTitle, null, { http, apiKey: 'test', ...opts }), null);
        assert.ok(http.calls.every(url => !url.includes('/grids/')));
    }
});
test('full pipeline combines non-Steam metadata and SGDB artwork; display name is unchanged', async () => {
    const x = integration();
    const data = await x.pipeline.collectMetadata(localTitle, { providers: x.providers, includeMedia: false });
    assert.equal(data.metadata.name, localTitle); assert.equal(data.metadata.description, 'Catalog description');
    assert.equal(data.metadata.releaseDate, '1998-11-21'); assert.equal(data.metadata.steamAppId, null);
    assert.equal(data.metadata.artworkIdentity.verified, false);
    assert.equal(data.metadata.assetSearch.metadataIdentity.relation, 'base_game');
    assert.equal(data.metadata.assetSearch.artworkIdentity.id, '21202');
    for (const k of ['poster','background','logo','icon']) assert.ok(data.rawAssets[k].some(a => a.source === 'steamgriddb'));
    assert.deepEqual(x.calls.library, []);
});
test('an explicit PC Port never binds a Steam AppID, including a saved one', async () => {
    const x = integration(); const data = await x.pipeline.collectMetadata(`${localTitle} (PC Port)`, {
        providers: x.providers, steamAppId: '1234', trustedSteamAppId: true, includeMedia: false,
    });
    assert.deepEqual(x.calls.steam, []); assert.equal(data.metadata.steamAppId, null);
    assert.ok(data.rawAssets.poster.length);
});
test('same-name Steam release with the wrong year cannot replace an older catalog fallback', async () => {
    const x = integration({ steamId: '1234', steamDetails: { name: title, releaseDate: 'Nov 21, 1998', appid: 1234 } });
    const data = await x.pipeline.collectMetadata(localTitle, { providers: x.providers, includeMedia: false });
    assert.equal(data.metadata.steamAppId, null); assert.equal(data.metadata.assetSearch.artworkIdentity.id, '21202');
    assert.deepEqual(x.calls.library, []);
});
test('same-name verified exact-year Steam release remains preferred and never mixes original metadata', async () => {
    const x = integration({ steamId: '1234', steamDetails: { name: title, releaseDate: 'Nov 25, 2026', description: 'New release', appid: 1234 } });
    const data = await x.pipeline.collectMetadata(localTitle, { providers: x.providers, includeMedia: false });
    assert.equal(data.metadata.steamAppId, '1234'); assert.equal(data.metadata.description, 'New release');
    assert.equal(data.metadata.assetSearch.metadataIdentity, null);
    assert.deepEqual(x.calls.library, ['1234']);
});
test('RAWG supplies a landscape fallback only, not a fake poster, logo or icon', async () => {
    const x = integration({ gridKey: '' });
    const data = await x.pipeline.collectMetadata(localTitle, { providers: x.providers, includeMedia: false });
    assert.deepEqual(data.rawAssets.background, [{ url: bg, source: 'rawg-background' }]);
    assert.deepEqual(data.rawAssets.poster, []); assert.deepEqual(data.rawAssets.logo, []); assert.deepEqual(data.rawAssets.icon, []);
    assert.ok(data.metadata.description);
});
test('normal non-Steam catalog lookup still works with RAWG unavailable', async () => {
    const x = integration({ rawgKey: '' });
    const data = await x.pipeline.collectMetadata(title, { providers: x.providers, requestedKinds: ['poster'], includeMedia: false });
    assert.ok(data.rawAssets.poster.length); assert.equal(data.metadata.steamAppId, null);
});
test('existing manual asset references survive the same downloader contract', async () => {
    const x = integration(); const prior = { poster: 'local-resource:///D:/Nexus/manual/poster-abc.png' };
    const result = await x.pipeline.fetchGameDetails(localTitle, { providers: x.providers, existingAssets: prior, includeMedia: false, force: true, picsEnv: {},
        downloader: async (_name, candidates, metadata, options) => {
            assert.deepEqual(options.existingAssets, prior); assert.ok(candidates.poster.length); assert.equal(metadata.steamAppId, null);
            return { assets: { ...prior }, media: {}, artworkResolution: {} };
        },
    });
    assert.equal(result.assets.poster, prior.poster);
});
test('RAWG image host is exact; private, arbitrary or lookalike hosts remain blocked', () => {
    const { downloader } = loadModules();
    assert.equal(downloader.trustedArtworkHost(bg), true);
    for (const url of ['http://media.rawg.io/x','https://media.rawg.io.evil.example/x','https://evil.example/x','https://127.0.0.1/x','https://localhost/x','https://user:pass@media.rawg.io/x']) assert.equal(downloader.trustedArtworkHost(url), false);
    assert.equal(downloader.trustedArtworkHost('https://cdn2.steamgriddb.com/x'), true);
    assert.equal(downloader.acceptable({width:600,height:900,ext:'.png'}, 'poster'), true);
    assert.equal(downloader.acceptable({width:1920,height:1080,ext:'.jpg'}, 'poster'), false);
});
test('real downloader preserves a valid manual file even on force refresh', async () => {
    const { downloader } = loadModules();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'nexus-assets-test-'));
    try {
        const manualDir = path.join(dir, 'manual'); fs.mkdirSync(manualDir);
        const file = path.join(manualDir, 'poster-abc.png');
        const bytes = Buffer.alloc(32); Buffer.from('89504e470d0a1a0a','hex').copy(bytes); bytes.writeUInt32BE(600,16); bytes.writeUInt32BE(900,20); fs.writeFileSync(file,bytes);
        const existing = `local-resource:///${file.replace(/\\/g,'/')}`;
        let contacted = false; const result = await downloader.downloadImageCandidates([{url:'https://cdn2.steamgriddb.com/other.png'}], dir, 'poster', {
            existing, force:true, enforceHosts:true, decode:async()=>true, http:{get:async()=>{contacted=true; throw Error('unexpected request');}},
        });
        assert.equal(result,existing); assert.equal(contacted,false); assert.deepEqual(fs.readFileSync(file),bytes);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('diagnostics never expose raw provider error messages or API keys', () => {
    assert.equal(providerStatus(Object.assign(Error('secret-key-in-url'), { response:{status:401} })), 'http_401');
    assert.equal(providerStatus(Error('secret-key-in-url')), 'request_failed');
});
test('explicit PC Port can reuse one verified dated SGDB base entry even without RAWG', async () => {
    const x = integration({ rawgKey: '' });
    const data = await x.pipeline.collectMetadata(`${localTitle} (PC Port)`, { providers: x.providers, includeMedia: false });
    assert.equal(data.metadata.assetSearch.artworkIdentity.reason, 'explicit_port_base_release');
    assert.ok(data.rawAssets.poster.length); assert.deepEqual(x.calls.steam, []);
});
test('plain wrong-year title without corroboration stays unbound instead of guessing', async () => {
    const { grid } = loadModules(); const events = [];
    const result = await grid.fetchGameAssets(localTitle, null, { http: makeGridHttp([originalGrid]), apiKey:'test', onDiagnostic:e=>events.push(e) });
    assert.equal(result,null); assert.equal(events.at(-1).candidates[0].id,'21202');
});
test('undated autocomplete results get bounded identity hydration before base selection', async () => {
    const { grid } = loadModules();
    const fake = makeGridHttp([{ ...originalGrid, release_date: null }]);
    let hydration = 0;
    const http = { get: async (url, cfg) => {
        if (url.endsWith('/games/id/21202')) { hydration++; return { data:{success:true,data:originalGrid} }; }
        return fake.get(url,cfg);
    } };
    const result = await grid.fetchGameAssets(localTitle, null, { http, apiKey:'test', ...opts });
    assert.equal(hydration, 1); assert.equal(result.catalogIdentity.reason,'corroborated_base_release');
});
test('exact new catalog artwork must not silently inherit older base-game metadata', async () => {
    const x = integration({ gridRows: [originalGrid, gridRow(300, title, 2026)] });
    const data = await x.pipeline.collectMetadata(localTitle, { providers:x.providers,includeMedia:false });
    assert.equal(data.metadata.assetSearch.artworkIdentity.id,'300');
    assert.equal(data.metadata.assetSearch.metadataIdentity,null);
    assert.equal(data.metadata.description,'');
});
