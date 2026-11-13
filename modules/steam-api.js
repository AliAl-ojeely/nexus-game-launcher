const axios = require('axios');
const { titleVariants, selectTitleMatch, suggestTitleCandidates } = require('./asset-resolver');

// ─────────────────────────────────────────────────────────────────────────────
// UTILS (reused from rawg-api for consistency)
// ─────────────────────────────────────────────────────────────────────────────

function norm(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++)
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    return dp[a.length][b.length];
}

const STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'for', 'to']);

function wordOverlapRatio(resultName, queryName) {
    const queryWords = (queryName || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2 && !STOP_WORDS.has(w));
    if (!queryWords.length) return 0;
    const normResult = norm(resultName);
    return queryWords.filter(w => normResult.includes(norm(w))).length / queryWords.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH AppID BY NAME — improved with Levenshtein + word overlap
// ─────────────────────────────────────────────────────────────────────────────

// Avoid repeated lookups for the same game during one launcher session.
// A transient network failure is never a negative cache hit.
const lookupCache = new Map();
const lookupPending = new Map();
const SUCCESS_TTL = 12 * 60 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;

async function searchAppId(gameName, options = {}) {
    const http = options.http || axios;
    const name = String(gameName || '').trim();
    if (!name) return null;
    const useCache = options.cache === true || (options.cache !== false && http === axios);
    const cacheKey = name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();
    if (useCache) {
        const hit = lookupCache.get(cacheKey);
        if (hit?.expires > now) return hit.id;
        if (hit) lookupCache.delete(cacheKey);
        if (lookupPending.has(cacheKey)) return lookupPending.get(cacheKey);
    }

    async function perform() {
        let successfulQueries = 0;
        const variants = titleVariants(name);
        for (const query of variants) {
            try {
                const res = await http.get(
                    `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(query)}&l=en&cc=US`,
                    { timeout: 11000 },
                );
                successfulQueries++;
                const items = res.data?.items || [];
                const match = selectTitleMatch(name, items, 0.85);
                if (match && /^\d{1,12}$/.test(String(match.item.id))) {
                    console.log(`[Steam Search] Verified match: "${match.item.name}" (${match.score.toFixed(2)})`);
                    if (useCache) cacheResult(cacheKey, String(match.item.id), SUCCESS_TTL);
                    return String(match.item.id);
                }
                const suggestions = suggestTitleCandidates(name, items, 2);
                for (const suggestion of suggestions) {
                    console.log(`[Steam Search] Possible alternate title (requires identity verification): "${suggestion.item.name}"`);
                }
            } catch (err) {
                console.warn(`[Steam Search] Query unavailable: ${err.message}`);
            }
        }
        if (useCache && successfulQueries > 0) cacheResult(cacheKey, null, MISS_TTL);
        console.warn(`[Steam Search] No sufficiently confident AppID for "${name}"`);
        return null;
    }
    if (!useCache) return perform();
    const pending = perform().finally(() => lookupPending.delete(cacheKey));
    lookupPending.set(cacheKey, pending);
    return pending;
}

function cacheResult(key, id, ttl) {
    if (lookupCache.size >= MAX_CACHE_ENTRIES) lookupCache.delete(lookupCache.keys().next().value);
    lookupCache.set(key, { id, expires: Date.now() + ttl });
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH REVIEW SUMMARY (user rating)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchReviewSummary(appid) {
    try {
        const res = await axios.get(
            `https://store.steampowered.com/appreviews/${appid}?json=1&language=english&num_per_page=0`,
            { timeout: 10000 }
        );
        const summary = res.data?.query_summary;
        if (!summary) return null;

        const totalReviews = summary.total_reviews || 0;
        const positive = summary.total_positive || 0;
        const negative = summary.total_negative || 0;
        const percentPositive = totalReviews > 0 ? Math.round((positive / totalReviews) * 100) : 0;

        // Steam review score description: "Overwhelmingly Positive", "Very Positive", etc.
        const scoreDesc = summary.review_score_desc || '';

        return {
            steam_rating: scoreDesc,
            steam_rating_percent: percentPositive,
            total_reviews: totalReviews,
            positive: positive,
            negative: negative
        };
    } catch (err) {
        console.warn(`[Steam] Review fetch failed for ${appid}:`, err.message);
        return null;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// FETCH GAME DETAILS BY AppID (enhanced with review score)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGameDetails(appid) {
    if (!appid) return null;

    try {
        const res = await axios.get(
            `https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`,
            { timeout: 15000 }
        );

        if (!res.data[appid]?.success) return null;

        const data = res.data[appid].data;

        // System requirements
        let sysReq = { minimum: '', recommended: '' };
        if (data.pc_requirements && !Array.isArray(data.pc_requirements)) {
            sysReq.minimum = data.pc_requirements.minimum || '';
            sysReq.recommended = data.pc_requirements.recommended || '';
        }

        // Fetch review summary (optional, non‑critical)
        const reviews = await fetchReviewSummary(appid);

        return {
            name: data.name || '',
            appid: appid,
            description: data.short_description || '',
            developer: data.developers?.join(', ') || '',
            publisher: data.publishers?.join(', ') || '',
            releaseDate: data.release_date?.date || '',
            systemRequirements: sysReq,
            media: {
                screenshots: data.screenshots?.map(s => s.path_full) || []
            },
            poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
            background: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`,
            // NEW: Steam user rating (fallback for missing Metacritic)
            steam_rating: reviews?.steam_rating || '',
            steam_rating_percent: reviews?.steam_rating_percent || 0,
            total_reviews: reviews?.total_reviews || 0
        };

    } catch (err) {
        console.error('[Steam] API Error:', err.message);
        return null;
    }
}

module.exports = { fetchGameDetails, searchAppId };