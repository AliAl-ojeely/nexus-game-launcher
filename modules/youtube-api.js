const axios = require('axios');
const secrets = require('../src/secrets.json');

const API_KEY = secrets.YOUTUBE_API_KEY;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

// Only check TITLE for movie keywords — descriptions are too noisy
const MOVIE_TITLE_KEYWORDS = [
    'full movie', 'the movie', 'official movie', 'film trailer',
    'tv series', 'tv show', 'episode 1', 'clip from the movie',
    'short film', 'fan film',
];

const GAME_TITLE_KEYWORDS = [
    'gameplay', 'game trailer', 'official game', 'gameplay trailer',
    'walkthrough', 'playthrough', 'game preview', 'video game',
    'pc game', 'console game', 'reveal trailer', 'launch trailer',
    'announce trailer', 'announcement trailer', 'cinematic trailer',
    'official trailer',
];

const TRUSTED_CHANNELS = [
    'ign', 'gamespot', 'playstation', 'xbox', 'nintendo', 'pc gamer',
    'easy allies', 'game informer', 'acg', 'skill up', 'worth a buy',
    'gameranx', 'ubisoft', 'electronic arts', 'bethesda', 'rockstar',
    'cd projekt red', 'bandai namco', '2k', 'sega', 'capcom',
    'square enix', 'activision', 'blizzard', 'ubisoftna',
];

const MOVIE_CHANNELS = [
    'movieclips', 'film trailer', 'movietrailers', 'netflix',
    'prime video', 'disney', 'marvel entertainment', 'dc comics',
    'warner bros. pictures', 'universal pictures', 'paramount pictures',
    'sony pictures', '20th century studios', 'lionsgate movies',
];

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'in', 'on', 'for', 'to', 'de']);

function getSignificantWords(name) {
    return (name || '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w));
}

/**
 * What fraction of the game's significant words appear in the video title.
 * "Prince of Persia The Lost Crown" → words: [prince, persia, lost, crown]
 * A title containing all 4 → 1.0
 */
function titleMatchScore(videoTitle, gameName) {
    const gameWords = getSignificantWords(gameName);
    if (!gameWords.length) return 1;
    const normTitle = (videoTitle || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
    const matched = gameWords.filter(w => normTitle.includes(w));
    return matched.length / gameWords.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER
// ─────────────────────────────────────────────────────────────────────────────

function isGameTrailer(video, gameName) {
    const title = (video.snippet.title || '').toLowerCase();
    const channelTitle = (video.snippet.channelTitle || '').toLowerCase();

    // 1. Hard exclude: known movie channels
    for (const ch of MOVIE_CHANNELS) {
        if (channelTitle.includes(ch)) {
            console.log(`[YouTube] Excluding "${video.snippet.title}" – movie channel`);
            return false;
        }
    }

    // 2. Hard exclude: movie keywords in title only
    for (const kw of MOVIE_TITLE_KEYWORDS) {
        if (title.includes(kw)) {
            console.log(`[YouTube] Excluding "${video.snippet.title}" – movie keyword: "${kw}"`);
            return false;
        }
    }

    // 3. Title must contain ≥60% of the game's significant words
    const score = titleMatchScore(title, gameName);
    const minScore = gameName.split(' ').length === 1 ? 0.3 : 0.4;
    if (score < minScore) {
        console.log(`[YouTube] Excluding – title mismatch (${(score * 100).toFixed(0)}%)`);
        return false;
    }

    // 4. Must have a positive game signal (keyword OR trusted channel)
    const hasTitleSignal = GAME_TITLE_KEYWORDS.some(kw => title.includes(kw));
    const isTrustedChannel = TRUSTED_CHANNELS.some(ch => channelTitle.includes(ch));

    if (!hasTitleSignal && !isTrustedChannel) {
        console.log(`[YouTube] Excluding "${video.snippet.title}" – no game signal and untrusted channel`);
        return false;
    }

    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function getTrailerData(gameName) {
    if (!API_KEY) return null;

    const queries = [
        `${gameName} official game trailer`,
        `${gameName} gameplay trailer`,
        `${gameName} game trailer`,
        `${gameName} trailer`,
    ];

    try {
        for (const query of queries) {
            const url = `https://www.googleapis.com/youtube/v3/search`
                + `?part=snippet`
                + `&q=${encodeURIComponent(query)}`
                + `&type=video`
                + `&maxResults=10`
                + `&key=${API_KEY}`;

            const response = await axios.get(url, { timeout: 10000 });
            if (!response.data.items?.length) continue;

            // Sort by title match score first, then filter
            const scored = response.data.items
                .map(video => ({ video, score: titleMatchScore(video.snippet.title, gameName) }))
                .sort((a, b) => b.score - a.score);

            const filtered = scored
                .filter(({ video }) => isGameTrailer(video, gameName))
                .map(({ video }) => video);

            if (!filtered.length) {
                console.log(`[YouTube] No valid trailer for query: "${query}"`);
                continue;
            }

            const best = filtered[0];
            const thumbnails = best.snippet.thumbnails;
            console.log(`[YouTube] Selected: "${best.snippet.title}" (${best.snippet.channelTitle})`);

            return {
                videoId: best.id.videoId,
                thumbnail:
                    thumbnails.maxres?.url ||
                    thumbnails.standard?.url ||
                    thumbnails.high?.url || '',
            };
        }

        console.log(`[YouTube] No suitable trailer found for "${gameName}"`);
        return null;

    } catch (err) {
        console.error('[YouTube] Search failed:', err.message);
        return null;
    }
}

module.exports = { getTrailerData };