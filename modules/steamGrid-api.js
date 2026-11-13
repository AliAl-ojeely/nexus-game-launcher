'use strict';

const axios = require('axios');
const secrets = require('../src/secrets.json');
const { titleVariants, selectTitleMatch, validHttpUrl } = require('./asset-resolver');
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
        for (const query of titleVariants(gameName)) {
            try {
                const res = await http.get(`${BASE}/search/autocomplete/${encodeURIComponent(query)}`, cfg);
                const match = selectTitleMatch(gameName, res.data?.data || [], 0.85);
                if (match?.item?.id) { gameId = match.item.id; break; }
                console.warn(`[SteamGrid] Rejected ambiguous name result for "${query}"`);
            } catch (err) { console.warn(`[SteamGrid] Name lookup unavailable: ${err.message}`); }
        }
    }
    if (!gameId) return null;

    const paths = {
        portrait: `/grids/game/${gameId}?dimensions=600x900`,
        grids: `/grids/game/${gameId}`,
        heroes: `/heroes/game/${gameId}`,
        wide: `/grids/game/${gameId}?dimensions=460x215`,
        logos: `/logos/game/${gameId}`,
        icons: `/icons/game/${gameId}`,
    };
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
