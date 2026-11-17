'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadProvider() {
    // Stubs only the networking module and credentials. Never reads a real key.
    const originalLoad = Module._load;
    const target = require.resolve('../modules/steamGrid-api.js');
    delete require.cache[target];
    try {
        Module._load = function(specifier, parent, isMain) {
            if (specifier === 'axios') return { get: () => { throw Error('unexpected live HTTP'); } };
            if (specifier === './provider-credentials' && parent?.filename === target) return { SGDB_API_KEY: '' };
            return originalLoad.call(this, specifier, parent, isMain);
        };
        return require(target);
    } finally {
        Module._load = originalLoad;
    }
}

const artwork = { url: 'https://cdn2.steamgriddb.com/test/dantes-inferno-poster.png', width: 600, height: 900 };

test('name-only SteamGridDB lookup recovers 2010 poster without a Steam AppID', async () => {
    const { fetchGameAssets } = loadProvider();
    const requested = [];
    const fakeHttp = {
        get: async (url, cfg) => {
            requested.push(url);
            assert.equal(cfg.headers.Authorization, 'Bearer isolated-test-key');
            if (url.includes('/search/autocomplete/')) return {
                data: { success: true, data: [
                    { id: 41, name: "Dante's Inferno (2010)", release_date: '2010-02-05', verified: true, types: ['game'] },
                    { id: 42, name: "Dante's Inferno", release_date: '2007-01-01', verified: true, types: ['game'] },
                ] },
            };
            if (url.includes('/grids/game/41')) return { data: { data: [artwork] } };
            if (url.includes('/grids/game/42')) throw Error('wrong game accessed');
            throw Error('Unexpected endpoint ' + url);
        },
    };
    const output = await fetchGameAssets("Dante's Inferno (2010)", undefined, {
        apiKey: 'isolated-test-key', http: fakeHttp, kinds: ['poster'], canonicalName: "Dante's Inferno", releaseYear: 2010,
    });
    assert.equal(output.poster, artwork.url);
    assert.equal(requested.some(url => url.includes('/grids/game/41')), true);
    assert.equal(requested.some(url => url.includes('/grids/game/42')), false);
    assert.equal(requested.some(url => /\/logos\//.test(url)), false);
});

test('ambiguous equal candidates never download arbitrary game art', async () => {
    const { fetchGameAssets } = loadProvider();
    const requested = [];
    const http = { get: async (url) => {
        requested.push(url);
        assert.match(url, /\/search\/autocomplete\//);
        return { data: { success: true, data: [
            { id: 81, name: 'Same Title', verified: true },
            { id: 82, name: 'Same Title', verified: true },
        ] } };
    } };
    assert.equal(await fetchGameAssets('Same Title', null, { http, apiKey: 'test', kinds: ['poster'] }), null);
    assert.equal(requested.some(url => url.includes('/grids/')), false);
});

test('verified Steam AppID lookup remains the first and preferred identity source', async () => {
    const { fetchGameAssets } = loadProvider();
    const calls = [];
    const response = { data: { success: true, data: { id: 55 } } };
    const http = { get: async url => {
        calls.push(url);
        if (url.endsWith('/games/steam/12345')) return response;
        if (url.includes('/grids/game/55')) return { data: { data: [artwork] } };
        throw Error('Unexpected endpoint ' + url);
    } };
    const actual = await fetchGameAssets('Verified Steam Game', 12345, {
        http, apiKey: 'test', kinds: ['poster'],
    });
    assert.equal(actual.poster, artwork.url);
    assert.ok(calls.every(url => !url.includes('/search/autocomplete/')));
});

test('missing SteamGridDB API key returns without a network request', async () => {
    const { fetchGameAssets } = loadProvider();
    let called = false;
    const result = await fetchGameAssets('Dantes Inferno', null, {
        apiKey: '', http: { get: async () => { called = true; return {}; } },
    });
    assert.equal(result, null);
    assert.equal(called, false);
});
