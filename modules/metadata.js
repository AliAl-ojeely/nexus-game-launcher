const rawgApi = require('./rawg-api');
const steamApi = require('./steam-api');
const steamGridApi = require('./steamGrid-api');
const youtubeApi = require('./youtube-api');

function mergeMetadata({
    name,
    rawgData,
    steamData,
    sgAssets,
    trailerYouTubeId,
    trailerThumbnail,
}) {
    const trailerSearchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' official trailer')}`;

    // ── Text fields ───────────────────────────────────────────────────────────
    const description = rawgData?.description || steamData?.description || '';
    const developer = steamData?.developer || rawgData?.developer || '';
    const publisher = steamData?.publisher || rawgData?.publisher || '';
    const releaseDate = steamData?.releaseDate || rawgData?.releaseDate || '';

    // ── Rating: prefer RAWG Metacritic, fallback to Steam user rating percentage ──
    let metacritic = rawgData?.metacritic || '';
    let steamRatingDesc = steamData?.steam_rating || '';

    if (!metacritic && steamData?.steam_rating_percent) {
        metacritic = String(steamData.steam_rating_percent);
        console.log(`[Metadata] Using Steam user rating (${metacritic}%) as fallback for "${name}"`);
    }

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

    // ── Raw assets (remote URLs — downloaded locally by assets.js) ────────────
    const rawAssets = {
        poster: sgAssets?.poster || rawgData?.poster || '',
        background: sgAssets?.background || rawgData?.background || '',
        logo: sgAssets?.logo || '',
        icon: sgAssets?.icon || '',
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
        genres,
        tags,
        steamAppId,                 // ← added
        media: {
            screenshots,
            trailerYouTubeId,
            trailerThumbnail,
            trailerSearchUrl,
        },
    };

    return { metadata, rawAssets };
}

async function fetchAllMetadata(gameName) {
    console.log(`\n--- Starting Metadata Fetch Pipeline for: "${gameName}" ---`);

    const rawgData = await rawgApi.fetchGameDetails(gameName);

    let steamData = null;
    let sgAssets = null;
    let steamAppId = rawgData?.steamAppId || null;

    if (!steamAppId) {
        console.log(`[Pipeline] No Steam AppID from RAWG, searching Steam by name...`);
        steamAppId = await steamApi.searchAppId(gameName);
        if (steamAppId) console.log(`[Pipeline] Found Steam AppID via name search: ${steamAppId}`);
    }

    if (steamAppId) {
        console.log(`[Pipeline] Fetching Steam data for AppID ${steamAppId}...`);
        [steamData, sgAssets] = await Promise.all([
            steamApi.fetchGameDetails(steamAppId),
            steamGridApi.fetchGameAssets(steamAppId)
        ]);
    } else {
        console.log(`[Pipeline] No Steam AppID found, fetching SteamGrid assets by name...`);
        sgAssets = await steamGridApi.fetchGameAssets(gameName);
    }

    let trailerYouTubeId = rawgData?.media?.trailerYouTubeId || null;
    let trailerThumbnail = rawgData?.media?.trailerThumbnail || null;
    if (!trailerYouTubeId) {
        console.log(`[Pipeline] No RAWG clip found. Searching YouTube...`);
        const ytResult = await youtubeApi.getTrailerData(gameName);
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