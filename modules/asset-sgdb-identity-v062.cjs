'use strict';

// SteamGridDB's game ID is independent of a Steam AppID. Never infer one from the other.
const { titleTokens, titleScore, titleVariants } = require('./asset-resolver');

const YEAR_SUFFIX = /\s*[\[(]((?:19|20)\d{2})[\])]\s*$/;
const EXCLUDED_TYPES = new Set(['movie', 'film', 'video', 'soundtrack', 'music', 'book', 'dlc', 'demo']);
const GAME_TYPES = new Set(['game', 'software', 'mod', 'application', 'app']);

function displayTitle(value) {
    return String(value || '').normalize('NFKC').trim();
}

function titleAndYear(value) {
    const text = displayTitle(value);
    const match = YEAR_SUFFIX.exec(text);
    return {
        title: match ? text.slice(0, match.index).trim() : text,
        year: match ? Number(match[1]) : null,
    };
}

function normalizedTitle(title) {
    return titleTokens(title).join(' ');
}

function validYear(value) {
    const year = Number(value);
    return Number.isInteger(year) && year >= 1970 && year <= 2099 ? year : null;
}

function releaseYear(value) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return validYear(value.slice(0, 4));
    }
    if (typeof value === 'string' && /^\d{4}$/.test(value)) return validYear(value);
    if (typeof value === 'number' && Number.isFinite(value) && value > 100000000) {
        const ms = value < 100000000000 ? value * 1000 : value;
        return validYear(new Date(ms).getUTCFullYear());
    }
    if (typeof value === 'string' && /^\d{10,13}$/.test(value)) return releaseYear(Number(value));
    return null;
}

function requestedIdentity(gameName, options = {}) {
    const requested = titleAndYear(gameName);
    const canonical = titleAndYear(options.canonicalName || '');
    const requestedName = normalizedTitle(requested.title);
    const canonicalName = normalizedTitle(canonical.title);
    const canonicalMatches = !!canonicalName && !!requestedName &&
        (canonicalName === requestedName || titleScore(requested.title, canonical.title) >= 0.85);
    return {
        name: requestedName,
        canonical: canonicalMatches ? canonicalName : '',
        year: requested.year || validYear(options.releaseYear) || (canonicalMatches ? canonical.year : null),
        raw: requested.title,
        canonicalRaw: canonicalMatches ? canonical.title : '',
    };
}

function searchQueries(gameName, options = {}) {
    const identity = requestedIdentity(gameName, options);
    const queries = [];
    const seen = new Set();
    function push(value) {
        const title = displayTitle(value);
        if (!title || seen.has(title.toLowerCase())) return;
        seen.add(title.toLowerCase());
        queries.push(title);
    }
    push(gameName);
    if (identity.year && identity.raw) push(`${identity.raw} (${identity.year})`);
    if (identity.canonicalRaw) push(identity.canonicalRaw);
    if (identity.year && identity.canonicalRaw) push(`${identity.canonicalRaw} (${identity.year})`);
    push(identity.raw);
    for (const variant of titleVariants(identity.raw)) push(variant);
    return queries.slice(0, 5);
}

function permittedType(item) {
    if (!Array.isArray(item?.types)) return true;
    const types = item.types.map(v => String(v).toLowerCase());
    return !types.some(t => EXCLUDED_TYPES.has(t)) || types.some(t => GAME_TYPES.has(t));
}

function candidateNameAndYear(item, wantedYear) {
    const parsed = titleAndYear(item?.name);
    if (!parsed.year && wantedYear) {
        // A bare year is removed only when independently supplied by RAWG or by the user.
        const ending = new RegExp(`\\s+${wantedYear}$`);
        if (ending.test(parsed.title)) {
            return { title: parsed.title.replace(ending, '').trim(), year: wantedYear };
        }
    }
    const dated = releaseYear(item?.release_date);
    return {
        title: parsed.title,
        year: parsed.year || dated,
        conflictingYears: !!(parsed.year && dated && parsed.year !== dated),
    };
}

function chooseSteamGridGame(gameName, items, options = {}) {
    const identity = requestedIdentity(gameName, options);
    if (!identity.name) return { id: null, reason: 'empty_title' };
    const unique = new Map();
    for (const item of Array.isArray(items) ? items : []) {
        const id = String(item?.id ?? '');
        if (!/^\d{1,12}$/.test(id) || unique.has(id) || !permittedType(item)) continue;
        unique.set(id, item);
    }
    const scored = [];
    for (const [id, item] of unique) {
        const candidate = candidateNameAndYear(item, identity.year);
        if (candidate.conflictingYears) continue;
        const name = normalizedTitle(candidate.title);
        const exact = !!name && (name === identity.name || (identity.canonical && name === identity.canonical));
        const similarity = Math.max(titleScore(identity.raw, candidate.title),
            identity.canonicalRaw ? titleScore(identity.canonicalRaw, candidate.title) : 0);
        if (!exact && similarity < 0.85) continue;
        if (identity.year && candidate.year && identity.year !== candidate.year) continue;
        let confidence = exact ? 100 : Math.floor(similarity * 70);
        if (identity.year && candidate.year === identity.year) confidence += 30;
        if (item.verified === true) confidence += 5;
        if (Array.isArray(item.types) && item.types.some(t => GAME_TYPES.has(String(t).toLowerCase()))) confidence += 1;
        scored.push({ id, confidence, year: candidate.year, exact });
    }
    if (!scored.length) return { id: null, reason: 'no_safe_title_and_year_match' };
    scored.sort((a, b) => b.confidence - a.confidence);
    if (scored.length > 1 && scored[0].confidence === scored[1].confidence) {
        return { id: null, reason: 'ambiguous_identity', tied: scored.filter(item => item.confidence === scored[0].confidence).length };
    }
    return { id: scored[0].id, reason: identity.year && scored[0].year === identity.year
        ? 'title_and_release_year' : scored[0].exact ? 'exact_title' : 'high_confidence_title' };
}

module.exports = { titleAndYear, releaseYear, requestedIdentity, searchQueries, chooseSteamGridGame };
