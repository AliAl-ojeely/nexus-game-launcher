const axios = require('axios');

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

async function searchAppId(gameName) {
    try {
        const res = await axios.get(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=en&cc=US`,
            { timeout: 10000 }
        );

        const items = res.data?.items;
        if (!items?.length) {
            console.warn(`[Steam Search] No results for "${gameName}"`);
            return null;
        }

        const target = norm(gameName);

        // 1. Exact match
        const exact = items.find(g => norm(g.name) === target);
        if (exact) {
            console.log(`[Steam Search] Exact match: "${exact.name}" → ${exact.id}`);
            return String(exact.id);
        }

        // 2. Score each result: lower Levenshtein distance + higher word overlap
        const scored = items.map(g => {
            const nameNorm = norm(g.name);
            const distance = levenshtein(nameNorm, target);
            const overlap = wordOverlapRatio(g.name, gameName);
            // Combine scores: lower distance better, higher overlap better
            const score = (overlap * 100) - (distance * 2);
            return { g, score, overlap, distance };
        });

        // Filter: require at least 40% overlap OR distance <= 5
        const viable = scored.filter(x => x.overlap >= 0.4 || x.distance <= 5);
        if (!viable.length) {
            console.warn(`[Steam Search] No viable match for "${gameName}" (overlap < 0.4 and distance > 5)`);
            return null;
        }

        const best = viable.sort((a, b) => b.score - a.score)[0];
        console.log(`[Steam Search] Best match: "${best.g.name}" → ${best.g.id} (overlap: ${(best.overlap * 100).toFixed(0)}%, distance: ${best.distance})`);
        return String(best.g.id);

    } catch (err) {
        console.error('[Steam Search] Error:', err.message);
        return null;
    }
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