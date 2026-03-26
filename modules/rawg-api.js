const axios = require("axios");
const secrets = require('../src/secrets.json');
const API_KEY = secrets.RAWG_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function extractYear(name) {
    const match = name.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : null;
}

function stripYear(name) {
    return name.replace(/\b(19|20)\d{2}\d{2}\b/g, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' ').trim();
}

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

function pickBestMatch(results, cleanName, year) {
    const target = norm(cleanName);
    if (year) {
        const byYear = results.filter(g => g.released?.startsWith(year));
        const exactYearName = byYear.find(g => norm(g.name) === target);
        if (exactYearName) return exactYearName;
        if (byYear.length) {
            return byYear.sort((a, b) =>
                levenshtein(norm(a.name), target) - levenshtein(norm(b.name), target)
            )[0];
        }
    }
    const exact = results.find(g => norm(g.name) === target);
    if (exact) return exact;
    return results.sort((a, b) =>
        levenshtein(norm(a.name), target) - levenshtein(norm(b.name), target)
    )[0];
}

function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(
        /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FETCH
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGameDetails(name) {
    try {
        const year = extractYear(name);
        const cleanName = stripYear(name);

        const search = await axios.get('https://api.rawg.io/api/games', {
            params: {
                key: API_KEY,
                search: cleanName,
                page_size: 10,
                ordering: year ? undefined : '-added'
            }
        });

        if (!search.data.results?.length) return null;

        const game = pickBestMatch(search.data.results, cleanName, year);

        const details = await axios.get(`https://api.rawg.io/api/games/${game.id}`, {
            params: { key: API_KEY }
        });

        const data = details.data;

        const pcPlatform = data.platforms?.find(p => p.platform.slug === 'pc');

        // إرجاع نصوص فارغة بدلاً من N/A
        const systemRequirements = {
            minimum: pcPlatform?.requirements?.minimum || '',
            recommended: pcPlatform?.requirements?.recommended || ''
        };

        let metacritic = data.metacritic;
        if (!metacritic && data.metacritic_platforms?.length) {
            const pcMeta = data.metacritic_platforms.find(p => p.platform.slug === 'pc');
            metacritic = pcMeta?.metacritic || data.metacritic_platforms[0].metacritic;
        }

        let trailerYouTubeId = null;
        let trailerThumbnail = null;

        if (data.clip) {
            trailerYouTubeId = extractYouTubeId(data.clip.video) || extractYouTubeId(data.clip.clip);
            // جلب جودة عالية maxresdefault
            trailerThumbnail = data.clip.preview || (trailerYouTubeId ? `https://img.youtube.com/vi/${trailerYouTubeId}/maxresdefault.jpg` : '');
        }

        const trailerSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(game.name + ' official trailer')}`;

        return {
            description: data.description_raw || '',
            developer: data.developers?.map(d => d.name).join(', ') || '',
            publisher: data.publishers?.map(p => p.name).join(', ') || '',
            releaseDate: data.released || '',
            metacritic: metacritic || '',
            genres: data.genres?.map(g => g.name).join(', ') || '',
            tags: data.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 8).join(', ') || '',
            systemRequirements,
            media: {
                screenshots: game.short_screenshots?.map(s => s.image) || [],
                trailerYouTubeId,
                trailerThumbnail,
                trailerSearchUrl
            },
            poster: data.background_image || '',
            background: data.background_image_additional || data.background_image || ''
        };

    } catch (error) {
        console.error('[RAWG] API Error:', error.message);
        return null;
    }
}

module.exports = { fetchGameDetails };