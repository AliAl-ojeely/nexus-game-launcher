'use strict';

const axios = require('axios');
const secrets = require('./provider-credentials');
const { validHttpUrl } = require('./asset-resolver');
const { searchQueries, chooseSteamGridGame } = require('./asset-sgdb-identity-v062.cjs');
const BASE = 'https://www.steamgriddb.com/api/v2';

function urlList(res, limit = 6, kind = '') {
    const list = res?.data?.data || [];
    return (Array.isArray(list) ? list : []).filter(item => {
        if (!validHttpUrl(item?.url)) return false;
        if (kind === 'poster' && item.width && item.height) {
            const ratio = item.width / item.height;
            return ratio >= 0.4 && ratio <= 0.9;
        }
        return true;
    }).map(item => item.url).slice(0, limit);
}

function distinct(...collections) {
    return [...new Set(collections.flat(2).filter(validHttpUrl))].slice(0, 8);
}

async function fetchGameAssets(gameName, steamAppId = null, options = {}) {
    const key = options.apiKey === undefined ? secrets.SGDB_API_KEY : options.apiKey;
    if (!key || !gameName?.trim()) return null;
    const http = options.http || axios;
    const cfg = { headers: { Authorization: `Bearer ${key}` }, timeout: 11000 };
    let gameId = null;

    if (steamAppId && /^\d{1,12}$/.test(String(steamAppId))) {
        try {
            const res = await http.get(`${BASE}/games/steam/${steamAppId}`, cfg);
            if (res.data?.success && res.data.data?.id) gameId = res.data.data.id;
        } catch (err) {
            console.warn(`[SteamGrid] AppID lookup unavailable: ${err.message}`);
        }
    }

    if (!gameId) {
        // SteamGridDB does not require a Steam AppID. Resolve its own game ID
        // using the user's title and a verified RAWG release year when available.
        const results = new Map();
        for (const query of searchQueries(gameName, options)) {
            try {
                const res = await http.get(`${BASE}/search/autocomplete/${encodeURIComponent(query)}`, cfg);
                const list = Array.isArray(res.data?.data) && res.data?.success !== false ? res.data.data : [];
                for (const item of list) {
                    const id = String(item?.id ?? '');
                    if (/^\d{1,12}$/.test(id) && !results.has(id)) results.set(id, item);
                }
            } catch (err) {
                const reason = err?.response?.status || err?.code || 'request_failed';
                console.warn(`[SteamGrid] Name lookup unavailable: ${reason}`);
            }
        }
        const selected = chooseSteamGridGame(gameName, [...results.values()], options);
        if (selected.id) {
            gameId = selected.id;
            console.log(`[SteamGrid] Artwork identity accepted (${selected.reason}) for "${gameName}"`);
        } else {
            console.warn(`[SteamGrid] Artwork identity unresolved (${selected.reason}, results=${results.size}) for "${gameName}"`);
        }
    }
    if (!gameId) return null;

    // Query only artwork types requested by the caller. Previously even a
    // quick poster lookup consumed six image-list API calls per game.
    const requested = new Set(Array.isArray(options.kinds) ? options.kinds : ['poster', 'background', 'logo', 'icon']);
    const paths = {};
    if (requested.has('poster')) {
        paths.portrait = `/grids/game/${gameId}?dimensions=600x900`;
        paths.grids = `/grids/game/${gameId}`;
    }
    if (requested.has('background')) {
        paths.heroes = `/heroes/game/${gameId}`;
        paths.wide = `/grids/game/${gameId}?dimensions=460x215`;
    }
    if (requested.has('logo')) paths.logos = `/logos/game/${gameId}`;
    if (requested.has('icon')) paths.icons = `/icons/game/${gameId}`;
    const entries = await Promise.all(Object.entries(paths).map(async ([name, suffix]) => {
        try { return [name, await http.get(BASE + suffix, cfg)]; }
        catch { return [name, null]; }
    }));
    const responses = Object.fromEntries(entries);
    const candidates = {
        poster: distinct(urlList(responses.portrait, 6, 'poster'), urlList(responses.grids, 8, 'poster')),
        background: distinct(urlList(responses.heroes), urlList(responses.wide)),
        logo: urlList(responses.logos),
        icon: urlList(responses.icons),
    };
    return {
        poster: candidates.poster[0] || '',
        background: candidates.background[0] || '',
        logo: candidates.logo[0] || '',
        icon: candidates.icon[0] || '',
        candidates,
    };
}

module.exports = { fetchGameAssets, urlList };
