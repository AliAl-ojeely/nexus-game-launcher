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

const STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'for', 'to']);

function getSignificantWords(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
}

function wordOverlapRatio(resultName, queryName) {
    const queryWords = getSignificantWords(queryName);
    if (!queryWords.length) return 1;
    const normResult = norm(resultName);
    const matched = queryWords.filter(w => normResult.includes(norm(w)));
    return matched.length / queryWords.length;
}

function pickBestMatch(results, originalName, cleanName, year) {
    const target = norm(cleanName);
    const originalLower = originalName.toLowerCase();

    // Get significant words from original name (exclude stop words)
    const querySignificant = getSignificantWords(originalName);

    // Helper: check if a game name contains all significant words
    function containsAllSignificant(gameName) {
        const gameLower = gameName.toLowerCase();
        return querySignificant.every(word => gameLower.includes(word));
    }

    // 1. Exact match on original name (case-insensitive)
    const exactOriginal = results.find(g => g.name.toLowerCase() === originalLower);
    if (exactOriginal) return exactOriginal;

    // 2. Exact match on normalized name
    const exactNorm = results.find(g => norm(g.name) === target);
    if (exactNorm) return exactNorm;

    // 3. Filter by year if provided
    let yearFiltered = results;
    if (year) {
        yearFiltered = results.filter(g => g.released && g.released.startsWith(year));
        // Within same year, must contain all significant words
        const yearMatches = yearFiltered.filter(g => containsAllSignificant(g.name));
        if (yearMatches.length) {
            // Sort by word overlap (higher better)
            yearMatches.sort((a, b) => wordOverlapRatio(b.name, cleanName) - wordOverlapRatio(a.name, cleanName));
            const bestYear = yearMatches[0];
            if (wordOverlapRatio(bestYear.name, cleanName) >= 0.6) // stricter
                return bestYear;
        }
    }

    // 4. Prefer PC games with Metacritic, but require all significant words
    const pcWithRating = results.filter(g => {
        const hasPc = g.platforms?.some(p => p.platform?.slug === 'pc' || p.platform?.name === 'PC');
        const hasMetacritic = g.metacritic && g.metacritic > 0;
        return hasPc && hasMetacritic && containsAllSignificant(g.name);
    });
    if (pcWithRating.length) {
        pcWithRating.sort((a, b) => levenshtein(norm(a.name), target) - levenshtein(norm(b.name), target));
        const bestPc = pcWithRating[0];
        if (wordOverlapRatio(bestPc.name, cleanName) >= 0.6)
            return bestPc;
    }

    // 5. All results – must contain all significant words AND overlap >= 0.6
    const viable = results.filter(g => containsAllSignificant(g.name) && wordOverlapRatio(g.name, cleanName) >= 0.6);
    if (viable.length) {
        viable.sort((a, b) => levenshtein(norm(a.name), target) - levenshtein(norm(b.name), target));
        return viable[0];
    }

    console.warn(`[RAWG] No match for "${originalName}" – required significant words: [${querySignificant.join(', ')}]`);
    return null;
}

function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FETCH
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGameDetails(name) {
    try {
        const year = extractYear(name);
        const cleanName = stripYear(name);
        const originalName = name.trim();

        // ── Step 1: Search with original name (including year) if year exists ──
        let results = [];
        if (year) {
            const searchWithYear = await axios.get('https://api.rawg.io/api/games', {
                params: {
                    key: API_KEY,
                    search: originalName,
                    page_size: 10,
                    search_precise: true,
                }
            }).catch(() => null);
            if (searchWithYear?.data?.results?.length) {
                results = searchWithYear.data.results;
                console.log(`[RAWG] Search with year returned ${results.length} results`);
            }
        }

        // ── Step 2: If no results, fallback to clean name (no year) ──────────
        if (results.length === 0) {
            const firstSearch = await axios.get('https://api.rawg.io/api/games', {
                params: {
                    key: API_KEY,
                    search: cleanName,
                    page_size: 10,
                    search_precise: true,
                }
            }).catch(() => null);
            if (firstSearch?.data?.results?.length) {
                results = firstSearch.data.results;
            }
        }

        // ── Step 3: If still less than 3 results, do a broader search ────────
        if (results.length < 3) {
            const secondSearch = await axios.get('https://api.rawg.io/api/games', {
                params: {
                    key: API_KEY,
                    search: cleanName,
                    page_size: 10,
                    ordering: '-added',
                }
            }).catch(() => null);
            if (secondSearch?.data?.results?.length) {
                const existingIds = new Set(results.map(g => g.id));
                const extra = secondSearch.data.results.filter(g => !existingIds.has(g.id));
                results = [...results, ...extra];
            }
        }

        if (!results.length) return null;

        const game = pickBestMatch(results, originalName, cleanName, year);
        if (!game) {
            console.warn(`[RAWG] No suitable match for "${originalName}"`);
            return null;
        }

        const details = await axios.get(`https://api.rawg.io/api/games/${game.id}`, {
            params: { key: API_KEY }
        });
        const data = details.data;

        const pcPlatform = data.platforms?.find(p => p.platform.slug === 'pc');
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
            trailerThumbnail = data.clip.preview || (trailerYouTubeId ? `https://img.youtube.com/vi/${trailerYouTubeId}/maxresdefault.jpg` : '');
        }

        const trailerSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(game.name + ' official trailer')}`;

        let steamAppId = null;
        if (data.stores) {
            const steamStore = data.stores.find(s => s.store.slug === 'steam' || s.store.id === 1);
            if (steamStore?.url) {
                const match = steamStore.url.match(/\/app\/(\d+)/);
                if (match) steamAppId = match[1];
            }
        }

        console.log(`[RAWG] Match: "${data.name}" | metacritic:${metacritic} | year:${data.released?.slice(0, 4)} | steamAppId:${steamAppId}`);

        return {
            name: data.name || game.name || '',
            steamAppId,
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

// ── جلب بيانات RAWG عبر Steam AppID مباشرة (أدق من البحث بالاسم) ──────────
async function fetchGameDetailsBySteamId(steamAppId) {
    try {
        const search = await axios.get('https://api.rawg.io/api/games', {
            params: {
                key: API_KEY,
                stores: '1',
                search: steamAppId,
                page_size: 5,
            }
        });
        const directSearch = await axios.get('https://api.rawg.io/api/games', {
            params: {
                key: API_KEY,
                search: steamAppId,
                page_size: 5,
            }
        }).catch(() => null);

        let results = search.data?.results || [];
        if (directSearch?.data?.results?.length) {
            const existingIds = new Set(results.map(g => g.id));
            results = [...results, ...directSearch.data.results.filter(g => !existingIds.has(g.id))];
        }
        if (!results.length) return null;

        const details = await axios.get(`https://api.rawg.io/api/games/${results[0].id}`, {
            params: { key: API_KEY }
        });
        const data = details.data;

        const steamStore = data.stores?.find(s => s.store.slug === 'steam' || s.store.id === 1);
        if (steamStore?.url) {
            const match = steamStore.url.match(/\/app\/(\d+)/);
            if (match && match[1] === String(steamAppId)) {
                console.log(`[RAWG] Found via Steam AppID ${steamAppId}: "${data.name}"`);
                let metacritic = data.metacritic;
                if (!metacritic && data.metacritic_platforms?.length) {
                    const pcMeta = data.metacritic_platforms.find(p => p.platform.slug === 'pc');
                    metacritic = pcMeta?.metacritic || data.metacritic_platforms[0].metacritic;
                }
                return {
                    metacritic: metacritic || '',
                    genres: data.genres?.map(g => g.name).join(', ') || '',
                    tags: data.tags?.filter(t => t.language === 'eng').map(t => t.name).slice(0, 8).join(', ') || '',
                    description: data.description_raw || '',
                    systemRequirements: (() => {
                        const pcPlatform = data.platforms?.find(p => p.platform.slug === 'pc');
                        return {
                            minimum: pcPlatform?.requirements?.minimum || '',
                            recommended: pcPlatform?.requirements?.recommended || ''
                        };
                    })(),
                };
            }
        }
        return null;
    } catch (err) {
        console.warn('[RAWG] fetchGameDetailsBySteamId error:', err.message);
        return null;
    }
}

module.exports = { fetchGameDetails, fetchGameDetailsBySteamId };