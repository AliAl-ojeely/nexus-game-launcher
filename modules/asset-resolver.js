'use strict';

// Shared, side-effect-free asset identity and candidate selection.
const KINDS = Object.freeze(['poster', 'background', 'logo', 'icon']);
const EDITION_SUFFIX = /\s+(?:complete|deluxe|ultimate|definitive|enhanced|standard|game of the year|goty)\s+edition$/i;
const PACKAGE_SUFFIX = /\s*[\[(](?:repack|portable|gog|steam|fitgirl|empress|codex|skidrow|v\d+(?:\.\d+)*|build\s+\d+)[^\])]*[\])]/gi;

function cleanTitle(value) {
    return String(value || '').normalize('NFKC').replace(PACKAGE_SUFFIX, '')
        .replace(/[™®©]/g, '').replace(EDITION_SUFFIX, '').replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

// Roman sequel numbers and Arabic numerals are equivalent for lookup only.
// Keep the user's original name; do not collapse different games or subtitles.
const ROMAN_NUMERALS = Object.freeze({
    ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7',
    viii: '8', ix: '9', x: '10', xi: '11', xii: '12',
    xiii: '13', xiv: '14', xv: '15', xvi: '16',
});
function numericSequelTitle(value) {
    return cleanTitle(value).replace(/\b(xvi|xv|xiv|xiii|xii|xi|viii|vii|vi|iv|iii|ii|ix|x|v)\b/gi,
        (token, _numeral, offset, full) => full.slice(0, offset).trim()
            ? (ROMAN_NUMERALS[token.toLowerCase()] || token) : token);
}
function titleTokens(value) {
    // Identical query tokens for straight/curly apostrophes and &/and.
    return numericSequelTitle(value).toLowerCase().replace(/[’']/g, '')
        .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(/\s+/).filter(Boolean);
}

function titleVariants(title) {
    const raw = String(title || '').trim();
    const clean = cleanTitle(raw);
    const numeric = numericSequelTitle(clean);
    // Additional *search queries*, never additional trusted identities.
    // Do not strip a sequel number or a real title/subtitle.
    const ampersand = numeric.includes('&') ? numeric.replace(/&/g, 'and') :
        /\band\b/i.test(numeric) ? numeric.replace(/\band\b/gi, '&') : '';
    const variants = [raw, clean, numeric, ampersand];
    return [...new Set(variants.filter(Boolean))].slice(0, 4);
}

// Do not mistake a sequel, demo, or unrelated same-prefix title for a match.
function titleScore(query, result) {
    const a = titleTokens(query);
    const b = titleTokens(result);
    if (!a.length || !b.length) return 0;
    if (a.join(' ') === b.join(' ')) return 1;
    const as = new Set(a), bs = new Set(b);
    const common = [...as].filter(x => bs.has(x)).length;
    const union = new Set([...as, ...bs]).size;
    const jaccard = common / union;
    const containment = common / Math.max(as.size, bs.size);
    return Math.min(0.99, 0.60 * jaccard + 0.40 * containment);
}

/**
 * Non-exact subtitle extensions are suggestions, NOT verified identities.
 * "Persona 5: Strikers" must not replace "Persona 5" automatically.
 */
function reviewTitleCandidate(query, candidate) {
    const fullScore = titleScore(query, candidate);
    if (fullScore >= 0.85) return { status: 'confirmed-title', score: fullScore };
    const normalizedQuery = titleTokens(query);
    const normalizedCandidate = numericSequelTitle(candidate).replace(/[’']/g, '');
    const colonIndex = normalizedCandidate.search(/\s*[:—–]\s*/);
    if (colonIndex > 0 && normalizedQuery.length >= 2) {
        const prefix = normalizedCandidate.slice(0, colonIndex);
        const suffix = normalizedCandidate.slice(colonIndex).replace(/^[\s:—–]+/, '').trim();
        const forbidden = /\b(?:soundtrack|ost|demo|playtest|beta|dlc|season pass|expansion|editor|trainer|bundle)\b/i;
        if (titleTokens(prefix).join(' ') === normalizedQuery.join(' ') &&
            suffix && !forbidden.test(suffix)) {
            return { status: 'needs-confirmation', score: 0.8,
                reason: 'official-subtitle-must-be-confirmed-with-a-store-id' };
        }
    }
    return { status: 'rejected', score: fullScore };
}

function selectTitleMatch(query, items, threshold = 0.85) {
    const sorted = (items || []).map(item => ({ item, score: titleScore(query, item?.name) }))
        .filter(x => x.score >= threshold).sort((a, b) => b.score - a.score);
    if (!sorted.length) return null;
    // Do not silently choose between equally plausible, different store IDs.
    const best = sorted[0];
    const tied = sorted.find(x => x !== best && x.score >= best.score - 0.02 &&
        String(x.item?.id) !== String(best.item?.id));
    return tied ? null : best;
}

function suggestTitleCandidates(query, items, limit = 3) {
    return (items || []).map(item => ({ item, ...reviewTitleCandidate(query, item?.name) }))
        .filter(x => x.status === 'needs-confirmation')
        .slice(0, Math.min(Math.max(0, limit), 5));
}

function validHttpUrl(url) {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return false;
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const isIpLiteral = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':');
        return !!hostname && !parsed.username && !parsed.password && !isIpLiteral &&
            !hostname.endsWith('.local') && !hostname.endsWith('.internal') && hostname !== 'localhost';
    } catch { return false; }
}

function uniqueCandidates(values, source, result = [], seen = new Set()) {
    const items = Array.isArray(values) ? values.flat(2) : [values];
    for (const value of items) {
        const url = typeof value === 'string' ? value : value?.url;
        if (!validHttpUrl(url) || seen.has(url)) continue;
        seen.add(url);
        result.push({ url, source: value?.source || source });
    }
    return result;
}

function buildAssetCandidates({ steamGrid = null, steamArtwork = null, steamData = null } = {}) {
    const all = {};
    for (const kind of KINDS) {
        const candidates = [];
        const seen = new Set();
        // A SteamGridDB item is not trusted until the downloader decodes its content.
        uniqueCandidates(steamGrid?.candidates?.[kind] || steamGrid?.[kind], 'steamgriddb', candidates, seen);
        uniqueCandidates(steamArtwork?.[kind], 'steam-library', candidates, seen);
        if (kind === 'poster' || kind === 'background') {
            uniqueCandidates(steamData?.[kind], 'steam-store', candidates, seen);
        }
        // RAWG background_image and Steam screenshots are photographs, not posters/logos.
        all[kind] = candidates.slice(0, 12);
    }
    return all;
}

function isManualResource(value) {
    return typeof value === 'string' && /(?:^|[\\/])manual[\\/](?:poster|background|logo|icon)-[a-f0-9-]+\./i.test(value);
}

function nonEmptyAssetMerge(previous = {}, incoming = {}) {
    const result = { ...previous };
    for (const kind of KINDS) {
        const next = incoming?.[kind];
        if (isManualResource(result[kind])) continue;
        if (typeof next === 'string' && next.trim()) result[kind] = next;
    }
    return result;
}

module.exports = {
    KINDS, cleanTitle, numericSequelTitle, titleTokens, titleVariants, titleScore, selectTitleMatch, reviewTitleCandidate, suggestTitleCandidates,
    validHttpUrl, uniqueCandidates, buildAssetCandidates, isManualResource, nonEmptyAssetMerge,
};
