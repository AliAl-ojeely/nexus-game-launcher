const rawgApi = require('./rawg-api');
const steamApi = require('./steam-api');
const steamGridApi = require('./steamGrid-api');
const steamArtworkApi = require('./steam-artwork');
const youtubeApi = require('./youtube-api');

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: Clean description from markdown and special symbols
// ─────────────────────────────────────────────────────────────────────────────

function cleanDescription(text) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text
        .replace(/#{1,3}/g, '')
        .replace(/\*{3,}/g, '')
        .replace(/_{3,}/g, '')
        .replace(/-{3,}/g, '')
        .replace(/\$\$+/g, '')
        .replace(/@@+/g, '')
        .replace(/!!+/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    cleaned = cleaned.replace(/\.\s+\./g, '. .');
    return cleaned;
}

// ─────────────────────────────────────────────────────────────────────────────
// MERGE METADATA
// ─────────────────────────────────────────────────────────────────────────────

function mergeMetadata({
    name,
    rawgData,
    steamData,
    sgAssets,
    steamArtwork,
    trailerYouTubeId,
    trailerThumbnail,
}) {
    const trailerSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' official trailer')}`;

    // ── Text fields (description cleaned) ─────────────────────────────────────
    const rawDescription = rawgData?.description || steamData?.description || '';
    const description = cleanDescription(rawDescription);
    const developer = steamData?.developer || rawgData?.developer || '';
    const publisher = steamData?.publisher || rawgData?.publisher || '';
    const releaseDate = steamData?.releaseDate || rawgData?.releaseDate || '';

    // Steam user reviews are not critic ratings and must not be labeled Metacritic.
    const metacritic = rawgData?.metacritic || '';

    const genres = rawgData?.genres || steamData?.genres || '';
    const tags = rawgData?.tags || '';

    // ── System requirements ───────────────────────────────────────────────────
    const hasGoodSteamReqs =
        steamData?.systemRequirements?.minimum &&
        steamData.systemRequirements.minimum !== '';

    const systemRequirements = hasGoodSteamReqs
        ? steamData.systemRequirements
        : (rawgData?.systemRequirements || { minimum: '', recommended: '' });

    // ── Screenshots ───────────────────────────────────────────────────────────
    const screenshots = steamData?.media?.screenshots?.length
        ? steamData.media.screenshots
        : (rawgData?.media?.screenshots || []);

    // Prefer SGDB, then verified-by-downloader Steam Library artwork, then RAWG.
    // Candidate lists are intentional: a URL alone does not prove an image exists.
    // Never substitute screenshots for poster/background/logo/icon.
    const candidates = (...values) => [...new Set(values.flat(Infinity).filter(
        x => typeof x === 'string' && /^https:\/\//i.test(x)
    ))];
    const rawAssets = {
        // RAWG background_image often is a screenshot, so it is not an art fallback.
        poster: candidates(sgAssets?.poster, steamArtwork?.poster, steamData?.poster),
        background: candidates(sgAssets?.background, steamArtwork?.background, steamData?.background),
        logo: candidates(sgAssets?.logo, steamArtwork?.logo),
        icon: candidates(sgAssets?.icon, steamArtwork?.icon),
    };

    // ── Steam AppID for achievements link ─────────────────────────────────────
    const steamAppId = rawgData?.steamAppId || steamData?.appid || null;

    // ── Final metadata ────────────────────────────────────────────────────────
    const metadata = {
        name,
        description,
        developer,
        publisher,
        releaseDate,
        systemRequirements,
        metacritic,
        steamRatingPercent: steamData?.steam_rating_percent || 0,
        steamRatingText: steamData?.steam_rating || '',
        genres,
        tags,
        steamAppId,
        media: {
            screenshots,
            trailerYouTubeId,
            trailerThumbnail,
            trailerSearchUrl,
        },
    };

    return { metadata, rawAssets };
}

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAllMetadata(gameName) {
    console.log(`\n--- Starting Metadata Fetch Pipeline for: "${gameName}" ---`);

    const rawgData = await rawgApi.fetchGameDetails(gameName).catch(err => {
        console.warn(`[Pipeline] RAWG API Error:`, err.message);
        return null;
    });

    let steamData = null;
    let sgAssets = null;
    let steamArtwork = null;
    let steamAppId = rawgData?.steamAppId || null;

    if (!steamAppId) {
        console.log(`[Pipeline] No Steam AppID from RAWG, searching Steam by name...`);
        steamAppId = await steamApi.searchAppId(gameName).catch(() => null);
        if (steamAppId) console.log(`[Pipeline] Found Steam AppID via name search: ${steamAppId}`);
    }

    if (steamAppId) {
        console.log(`[Pipeline] Fetching Steam data for AppID ${steamAppId}...`);
        [steamData, sgAssets, steamArtwork] = await Promise.all([
            steamApi.fetchGameDetails(steamAppId).catch(() => null),
            steamGridApi.fetchGameAssets(gameName, steamAppId).catch(() => null),
            steamArtworkApi.fetchSteamArtwork(steamAppId).catch(() => null)
        ]);
    } else {
        console.log(`[Pipeline] No Steam AppID found, fetching SteamGrid assets by name...`);
        sgAssets = await steamGridApi.fetchGameAssets(gameName).catch(() => null);
    }

    let trailerYouTubeId = rawgData?.media?.trailerYouTubeId || null;
    let trailerThumbnail = rawgData?.media?.trailerThumbnail || null;

    if (!trailerYouTubeId) {
        console.log(`[Pipeline] No RAWG clip found. Searching YouTube...`);
        const ytResult = await youtubeApi.getTrailerData(gameName).catch(() => null);
        if (ytResult) {
            trailerYouTubeId = ytResult.videoId;
            trailerThumbnail = ytResult.thumbnail;
        }
    }

    const finalResult = mergeMetadata({
        name: gameName,
        rawgData,
        steamData,
        sgAssets,
        steamArtwork,
        trailerYouTubeId,
        trailerThumbnail
    });

    console.log(`--- Pipeline Complete for: "${gameName}" ---\n`);
    return finalResult;
}

module.exports = {
    mergeMetadata,
    fetchAllMetadata
};