'use strict';
const axios = require('axios');
const secrets = require('./provider-credentials');
const { lookupTitle, queryVariants, chooseRawg, exactRows, providerStatus, diagnostic, relatedCandidates } = require('./asset-search-identity-v063.cjs');
const BASE = 'https://api.rawg.io/api/games';

function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

function steamId(data) {
    const steam = data.stores?.find(s => s.store?.slug === 'steam' || s.store?.id === 1);
    const match = /^https:\/\/store\.steampowered\.com\/app\/(\d{1,12})(?:\/|\?|$)/i.exec(steam?.url || '');
    return match ? match[1] : null;
}

function requirements(data) {
    const pc = data.platforms?.find(p => p.platform?.slug === 'pc');
    return { minimum: pc?.requirements?.minimum || '', recommended: pc?.requirements?.recommended || '' };
}

function rating(data) {
    return data.metacritic || data.metacritic_platforms?.find(p => p.platform?.slug === 'pc')?.metacritic ||
        data.metacritic_platforms?.[0]?.metacritic || '';
}

function metadata(data, game, selection, requested) {
    const original = selection.relation === 'base_game';
    const trailerYouTubeId = extractYouTubeId(data.clip?.video) || extractYouTubeId(data.clip?.clip);
    return {
        name: data.name || game.name || '',
        steamAppId: original ? null : steamId(data),
        description: data.description_raw || '',
        developer: data.developers?.map(d => d.name).join(', ') || '',
        publisher: data.publishers?.map(p => p.name).join(', ') || '',
        releaseDate: data.released || '',
        metacritic: rating(data),
        genres: data.genres?.map(g => g.name).join(', ') || '',
        tags: data.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 8).join(', ') || '',
        // The original catalog entry's PC requirements must not be represented as
        // the requirements for a separately labeled unofficial port.
        systemRequirements: original ? { minimum: '', recommended: '' } : requirements(data),
        media: {
            screenshots: game.short_screenshots?.map(s => s.image).filter(Boolean) || [],
            trailerYouTubeId,
            trailerThumbnail: data.clip?.preview || (trailerYouTubeId ? `https://img.youtube.com/vi/${trailerYouTubeId}/maxresdefault.jpg` : ''),
            trailerSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(data.name + ' official trailer')}`,
        },
        poster: data.background_image || '',
        background: data.background_image_additional || data.background_image || '',
        catalogIdentity: { provider: 'rawg', id: selection.id, name: data.name || game.name,
            relation: selection.relation, releaseYear: selection.year, requestedYear: requested.year, edition: selection.edition || null },
    };
}

async function fetchGameDetails(name, options = {}) {
    const q = lookupTitle(name);
    if (!q.key || q.conflict) { if (q.conflict) diagnostic(options, 'RAWG', 'conflicting_edition_intent'); return null; }
    const key = options.apiKey === undefined ? secrets.RAWG_API_KEY : options.apiKey;
    if (!key) { diagnostic(options, 'RAWG', 'missing_api_key'); return null; }
    const http = options.http || axios;
    const cfg = { timeout: 10000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024 };
    const queries = queryVariants(name, [], 3);
    const rows = [];
    let complete = true;
    // Always query the base title even when a year-qualified query returned
    // unrelated games. A bounded secondary search is not gated on result count.
    for (const search of queries) {
        try {
            const res = await http.get(BASE, { ...cfg, params: { key, search, page_size: 20, search_precise: true } });
            if (!Array.isArray(res.data?.results)) { complete = false; continue; }
            rows.push(...res.data.results);
        } catch (error) {
            complete = false;
            const reason = providerStatus(error);
            diagnostic(options, 'RAWG', reason);
            if (['http_401', 'http_403', 'http_429'].includes(reason)) break;
        }
    }
    // If precise queries did not resolve a title, try one broader catalog search.
    // This expands discovery, not the criteria for automatic selection.
    if (!exactRows(name, rows).length && complete) {
        try {
            const res = await http.get(BASE, { ...cfg, params: { key, search: q.base, page_size: 20 } });
            if (!Array.isArray(res.data?.results)) complete = false;
            else rows.push(...res.data.results);
        } catch (error) { complete = false; diagnostic(options, 'RAWG', providerStatus(error)); }
    }
    // Edition labels are often absent from autocomplete. Inspect a bounded
    // number of same-title catalog records, and reuse the selected details.
    const hydrated = new Map();
    if (q.edition && complete) {
        const matching = exactRows(name, rows).filter(x => !q.year || !x.year || x.year === q.year);
        if (matching.length > 4) complete = false;
        else for (const item of matching) {
            try {
                const detail = await http.get(`${BASE}/${item.id}`, { ...cfg, params: { key } });
                const data = detail.data;
                const actual = exactRows(name, [data])[0];
                if (!actual || actual.id !== item.id || (item.year && actual.year !== item.year)) { complete = false; break; }
                hydrated.set(item.id, data);
            } catch (error) { complete = false; diagnostic(options, 'RAWG', providerStatus(error)); break; }
        }
    }
    const enriched = rows.map(row => hydrated.has(String(row.id)) ? { ...row, ...hydrated.get(String(row.id)) } : row);
    const selection = chooseRawg(name, enriched, complete);
    if (!selection) {
        diagnostic(options, 'RAWG', q.edition || q.port ? 'edition_confirmation_required' : 'no_unambiguous_catalog_match',
            { candidates: relatedCandidates(q, enriched) });
        return null;
    }
    try {
        const data = hydrated.get(selection.id) || (await http.get(`${BASE}/${selection.id}`, { ...cfg, params: { key } })).data;
        // Validate the final response, rather than trusting only a search hit.
        const actual = exactRows(name, [data])[0];
        if (!actual || actual.id !== selection.id || (selection.year && actual.year !== selection.year)) {
            diagnostic(options, 'RAWG', 'details_identity_mismatch'); return null;
        }
        const verified = { ...selection, year: actual.year || selection.year };
        if (q.year && verified.relation === 'exact_release' && verified.year !== q.year) return null;
        diagnostic(options, 'RAWG', verified.relation, { releaseYear: verified.year, gameId: selection.id });
        return metadata(data, selection.row, verified, q);
    } catch (error) {
        diagnostic(options, 'RAWG', providerStatus(error));
        return null;
    }
}

// Preserve the legacy Steam-ID entry point, but require explicit same-AppID
// evidence from the details response. This path never substitutes a name match.
async function fetchGameDetailsBySteamId(steamAppId) {
    const key = secrets.RAWG_API_KEY;
    const wanted = String(steamAppId || '');
    if (!key || !/^\d{1,12}$/.test(wanted)) return null;
    const cfg = { timeout: 10000, maxRedirects: 0, maxContentLength: 4 * 1024 * 1024 };
    try {
        const res = await axios.get(BASE, { ...cfg, params: { key, stores: '1', search: wanted, page_size: 5 } });
        const direct = await axios.get(BASE, { ...cfg, params: { key, search: wanted, page_size: 5 } }).catch(() => null);
        const ids = [...new Set([...(res.data?.results || []), ...(direct?.data?.results || [])].map(g => String(g.id)).filter(id => /^\d{1,12}$/.test(id)))].slice(0, 5);
        for (const id of ids) {
            const detail = await axios.get(`${BASE}/${id}`, { ...cfg, params: { key } });
            const data = detail.data;
            if (String(data?.id) === id && steamId(data) === wanted) return {
                metacritic: rating(data), genres: data.genres?.map(g => g.name).join(', ') || '',
                tags: data.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 8).join(', ') || '',
                description: data.description_raw || '', systemRequirements: requirements(data),
            };
        }
    } catch (error) { diagnostic({}, 'RAWG', providerStatus(error)); }
    return null;
}

module.exports = { fetchGameDetails, fetchGameDetailsBySteamId };
