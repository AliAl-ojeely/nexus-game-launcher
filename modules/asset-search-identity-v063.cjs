'use strict';

// A local display label is not necessarily the provider's release identity.
const { titleTokens, titleVariants } = require('./asset-resolver');
const { titleAndYear, releaseYear } = require('./asset-sgdb-identity-v062.cjs');
const { parseLabel, portCandidate, selectEdition, relatedCandidates } = require('./asset-edition-v064.cjs');
const MAX_QUERIES = 5;
const NON_GAME_TYPES = new Set(['movie', 'film', 'video', 'soundtrack', 'music', 'book', 'dlc', 'demo', 'expansion', 'trailer']);

function lookupTitle(value) { return parseLabel(value); }

function queryVariants(name, extra = [], max = MAX_QUERIES) {
    const q = lookupTitle(name);
    const out = [];
    const seen = new Set();
    for (const value of [q.base, q.original, q.base.replace(/[:\u2013\u2014]+/g, " ").replace(/\s+/g, " "), ...extra, ...(q.year ? [`${q.base} (${q.year})`] : []), ...titleVariants(q.base)]) {
        const text = String(value || '').trim();
        if (!text || text.length > 240 || seen.has(text.toLowerCase())) continue;
        seen.add(text.toLowerCase());
        out.push(text);
    }
    return out.slice(0, Math.min(MAX_QUERIES, max));
}

function allowedType(row) {
    return !Array.isArray(row?.types) || !row.types.some(t => NON_GAME_TYPES.has(String(t).toLowerCase()));
}

// Require exact normalized base titles; a shared prefix or a high fuzzy score
// does not identify a sequel, remake, DLC, film, or another similarly named game.
function exactRows(name, rows) {
    const q = lookupTitle(name), found = new Map(), conflicts = new Set();
    if (!q.key || q.conflict) return [];
    for (const row of Array.isArray(rows) ? rows : []) {
        const id = String(row?.id ?? '');
        if (!/^\d{1,12}$/.test(id) || !allowedType(row)) continue;
        const raw = titleAndYear(row.name);
        const label = parseLabel(row.name);
        const p = (q.edition || q.port) ? { title: label.base, year: label.year } : raw;
        if (label.conflict || ((q.edition || q.port) && label.port)) continue;
        const dateYear = releaseYear(row.released ?? row.release_date);
        if (p.year && dateYear && p.year !== dateYear) continue;
        const year = p.year || dateYear;
        let title = p.title;
        // Some providers append a bare year. Remove it only if their own date
        // proves that it is a suffix and the remaining title exactly matches.
        if (titleTokens(title).join(' ') !== q.key && year && title.endsWith(` ${year}`)) {
            const without = title.slice(0, -5).trim();
            if (titleTokens(without).join(' ') === q.key) title = without;
        }
        if (titleTokens(title).join(' ') !== q.key) continue;
        const prior = found.get(id);
        if (prior && ((prior.year && year && prior.year !== year) ||
            (prior.rowEdition && label.edition && prior.rowEdition !== label.edition))) { conflicts.add(id); continue; }
        if (!prior || (!prior.year && year)) found.set(id, { id, row, title, year, rowEdition: label.edition, rowPort: label.port });
    }
    return [...found.values()].filter(x => !conflicts.has(x.id));
}

function chooseRawg(name, rows, complete = true) {
    const q = lookupTitle(name), exact = exactRows(name, rows);
    if (q.conflict) return null;
    if (q.port) { const chosen = portCandidate(q, exact, complete); return chosen ? { ...chosen, relation: 'base_game' } : null; }
    if (q.edition) { const chosen = selectEdition(q, exact, complete); return chosen ? { ...chosen, relation: 'verified_edition', edition: q.edition } : null; }
    if (q.year) {
        const dated = exact.filter(x => x.year === q.year);
        if (dated.length === 1) return { ...dated[0], relation: 'exact_release' };
        if (dated.length > 1) return null;
        // Only a single, earlier catalog release can be proposed as base-game
        // metadata. No arbitrary tie breaking or guessing a different edition.
        if (complete && exact.length === 1 && exact[0].year && exact[0].year < q.year)
            return { ...exact[0], relation: 'base_game' };
        return null;
    }
    return exact.length === 1 ? { ...exact[0], relation: 'exact_title' } : null;
}

function chooseBaseArtwork(name, rows, options, complete) {
    const q = lookupTitle(name), matches = exactRows(name, rows);
    if (q.port) {
        const only = portCandidate(q, matches, complete);
        if (!only) return null;
        const proof = options.catalogIdentity;
        if (proof && (proof.provider !== 'rawg' || proof.relation !== 'base_game' ||
            proof.releaseYear !== only.year || proof.requestedYear !== q.year || lookupTitle(proof.name).key !== q.key)) return null;
        if (!proof && only.row.verified !== true) return null;
        return { id: only.id, reason: proof ? 'corroborated_base_release' : 'explicit_port_base_release', name: only.title, releaseYear: only.year };
    }
    if (!complete || !q.year || matches.length !== 1) return null;
    const only = matches[0];
    if (!only.year || only.year >= q.year) return null;
    const proof = options.catalogIdentity;
    const canonical = lookupTitle(options.canonicalName || '');
    // A caller-supplied year by itself is NOT permission to relax the match.
    // The base release must have been resolved by the separate RAWG provider.
    if (!proof || proof.provider !== 'rawg' || proof.relation !== 'base_game' ||
        proof.releaseYear !== only.year || proof.requestedYear !== q.year ||
        canonical.key !== q.key || lookupTitle(proof.name).key !== q.key) return null;
    return { id: only.id, reason: 'corroborated_base_release', name: only.title, releaseYear: only.year };
}

function providerStatus(error) {
    const status = Number(error?.response?.status);
    if (Number.isInteger(status) && status >= 400 && status <= 599) return `http_${status}`;
    const code = String(error?.code || '');
    return /^[A-Z0-9_]{1,40}$/.test(code) ? code : 'request_failed';
}

function diagnostic(options, provider, reason, extra = {}) {
    const record = { provider, reason, ...extra };
    const id = /^\d{1,12}$/.test(String(extra.gameId || '')) ? ` catalogId=${extra.gameId}` : '';
    const candidates = Array.isArray(extra.candidates) ? ` candidates=${extra.candidates.map(c => `${c.id}/${c.releaseYear || 'unknown'}`).join(',')}` : '';
    console.log(`[AssetSearch] ${provider}: ${reason}${extra.releaseYear ? ` (catalog year ${extra.releaseYear})` : ''}${id}${candidates}`);
    if (typeof options?.onDiagnostic === 'function') options.onDiagnostic(record);
}

module.exports = { lookupTitle, queryVariants, exactRows, chooseRawg, chooseBaseArtwork, providerStatus, diagnostic, relatedCandidates };
