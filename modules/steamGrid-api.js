'use strict';

const axios = require('axios');
const secrets = require('./provider-credentials');
const { validHttpUrl } = require('./asset-resolver');
const { searchQueries, chooseSteamGridGame } = require('./asset-sgdb-identity-v062.cjs');
const { lookupTitle, queryVariants, exactRows, chooseBaseArtwork, providerStatus, diagnostic, relatedCandidates } = require('./asset-search-identity-v063.cjs');
const { selectEdition, editionEvidence } = require('./asset-edition-v064.cjs');
const BASE = 'https://www.steamgriddb.com/api/v2';

function urlList(res, limit = 6, kind = '') {
    const list = res?.data?.data || [];
    return (Array.isArray(list) ? list : []).filter(item => {
        if (!validHttpUrl(item?.url) || item.nsfw === true || item.humor === true || item.epilepsy === true || /image\/gif/i.test(item.mime || '')) return false;
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
    if (!gameName?.trim()) return null;
    if (!key) { diagnostic(options, 'SteamGridDB', 'missing_api_key'); return null; }
    const requestedTitle = lookupTitle(gameName);
    gameName = requestedTitle.year ? `${requestedTitle.base} (${requestedTitle.year})` : requestedTitle.base;
    if (!requestedTitle.key || requestedTitle.conflict) { if (requestedTitle.conflict) diagnostic(options, 'SteamGridDB', 'conflicting_edition_intent'); return null; }
    const http = options.http || axios;
    const cfg = { headers: { Authorization: `Bearer ${key}` }, timeout: 11000,
        maxRedirects: 0, maxContentLength: 4 * 1024 * 1024 };
    let gameId = null;
    let resolved = null;

    if (!requestedTitle.port && (!requestedTitle.edition || options.verifiedSteamEdition === true) && steamAppId && /^\d{1,12}$/.test(String(steamAppId))) {
        try {
            const res = await http.get(`${BASE}/games/steam/${steamAppId}`, cfg);
            if (res.data?.success && /^\d{1,12}$/.test(String(res.data.data?.id ?? ''))) {
                gameId = String(res.data.data.id);
                resolved = { id: gameId, reason: 'verified_steam_mapping', name: res.data.data.name || requestedTitle.base };
            }
        } catch (err) {
            diagnostic(options, 'SteamGridDB', providerStatus(err));
        }
    }

    if (!gameId) {
        // Independent SteamGridDB identity; neither its numeric ID nor a
        // catalog release year is a Steam AppID.
        const allRows = [];
        let complete = true;
        const canonicalYearQuery = options.releaseYear && options.canonicalName
            ? `${options.canonicalName} (${options.releaseYear})` : '';
        const queries = queryVariants(requestedTitle.original,
            [canonicalYearQuery, ...searchQueries(gameName, options)]);
        for (const query of queries) {
            try {
                const res = await http.get(`${BASE}/search/autocomplete/${encodeURIComponent(query)}`, cfg);
                if (!Array.isArray(res.data?.data)) { complete = false; continue; }
                if (res.data?.success === false && res.data.data.length) { complete = false; continue; }
                allRows.push(...res.data.data);
            } catch (err) {
                const reason = providerStatus(err);
                // This search endpoint may report an empty result as 404.
                if (reason !== 'http_404') complete = false;
                diagnostic(options, 'SteamGridDB', reason);
                if (['http_401', 'http_403', 'http_429'].includes(reason)) break;
            }
        }
        const catalogYear = requestedTitle.year || Number(options.releaseYear) || null;
        // Autocomplete may omit release_date. Hydrate only exact candidate IDs,
        // not arbitrary search results, and keep a small fixed request budget.
        if (catalogYear || requestedTitle.edition || requestedTitle.port) {
            const undated = exactRows(requestedTitle.original, allRows).filter(x => !x.year);
            if (undated.length > 3) complete = false;
            await Promise.all(undated.slice(0, 3).map(async item => {
                try {
                    const response = await http.get(`${BASE}/games/id/${item.id}`, cfg);
                    const details = response.data?.data;
                    const verified = exactRows(requestedTitle.original, [details])[0];
                    if (response.data?.success === false || !verified || verified.id !== item.id || !verified.year) {
                        complete = false;
                        return;
                    }
                    allRows.push(details);
                } catch (error) { complete = false; diagnostic(options, 'SteamGridDB', providerStatus(error)); }
            }));
        }
        const exact = exactRows(requestedTitle.original, allRows);
        const strict = exact.filter(x => !catalogYear || x.year === catalogYear || (!requestedTitle.year && !x.year && exact.length === 1));
        const results = new Map(strict.map(x => [x.id, x.row]));
        let selected = chooseSteamGridGame(gameName, [...results.values()], options);
        // Keep explicit-date matches ahead of an older base-game fallback.
        // Ambiguous same-name releases must never be silently merged.
        if (strict.length > 1) selected = { id: null, reason: 'ambiguous_identity' };
        if (!selected.id && selected.reason !== 'ambiguous_identity') {
            selected = chooseBaseArtwork(requestedTitle.original, allRows, options, complete) || selected;
        }
        // Explicit edition/port intent must never be overridden by the local
        // label year or the legacy matcher. A RAWG edition proof can bridge an
        // unmarked SGDB title only with a unique same-title same-year entry.
        if (requestedTitle.port) {
            selected = chooseBaseArtwork(requestedTitle.original, allRows, options, complete) ||
                { id: null, reason: 'edition_confirmation_required' };
        } else if (requestedTitle.edition) {
            const q = requestedTitle, proof = options.catalogIdentity;
            let chosen = null;
            if (complete && ['rawg','steam'].includes(proof?.provider) && proof.relation === 'verified_edition' && proof.edition === q.edition &&
                lookupTitle(proof.name).key === q.key && proof.releaseYear && (!q.year || q.year === proof.releaseYear)) {
                const matches = exact.filter(x => x.year === proof.releaseYear &&
                    (!editionEvidence(x.row,q.base) || editionEvidence(x.row,q.base) === q.edition));
                if (matches.length === 1 && !exact.some(x => !x.year)) chosen = matches[0];
            } else if (!proof) chosen = selectEdition(q, exact, complete);
            selected = chosen ? { id: chosen.id, reason: 'verified_edition', edition: q.edition } :
                { id: null, reason: 'edition_confirmation_required' };
        }
        if (selected.id) {
            gameId = String(selected.id);
            const candidate = exact.find(x => x.id === gameId);
            resolved = { ...selected, id: gameId, name: candidate?.title || requestedTitle.base,
                releaseYear: candidate?.year || null };
            diagnostic(options, 'SteamGridDB', selected.reason, { releaseYear: resolved.releaseYear, gameId });
            console.log(`[SteamGrid] Artwork identity accepted (${selected.reason}) for "${gameName}"`);
        } else {
            diagnostic(options, 'SteamGridDB', selected.reason, { candidateCount: exact.length,
                candidates: relatedCandidates(requestedTitle, allRows) });
            console.warn(`[SteamGrid] Artwork identity unresolved (${selected.reason}, results=${allRows.length}) for "${gameName}"`);
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
        catalogIdentity: { provider: 'steamgriddb', ...resolved },
    };
}

module.exports = { fetchGameAssets, urlList };
