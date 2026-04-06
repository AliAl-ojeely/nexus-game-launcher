const rawgApi = require('./rawg-api');
const steamApi = require('./steam-api');
const steamGridApi = require('./steamGrid-api');
const youtubeApi = require('./youtube-api');

// ─────────────────────────────────────────────────────────────────────────────
// metadata.js — fetches sequentially and merges RAWG + Steam + SteamGrid + YT
//
// Priority rules:
//   description        RAWG (long/raw)  › Steam (short)
//   developer          Steam            › RAWG
//   publisher          Steam            › RAWG
//   releaseDate        Steam            › RAWG
//   systemRequirements Steam (HTML)     › RAWG
//   screenshots        Steam            › RAWG
//   metacritic         RAWG (or fallback to Steam user rating %)
//   genres             RAWG             › Steam
//   tags               RAWG only
//   poster             SteamGrid        › RAWG › Steam
//   background         SteamGrid        › RAWG › Steam
//   logo               SteamGrid only
//   icon               SteamGrid only   (null = not found, no fallback)
//   trailer            RAWG clip        › YouTube
// ─────────────────────────────────────────────────────────────────────────────

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

    // ── Final metadata ────────────────────────────────────────────────────────
    const metadata = {
        name,           // always the original game name
        description,
        developer,
        publisher,
        releaseDate,
        systemRequirements,
        metacritic,     // now can be Steam rating percentage if Metacritic missing
        genres,
        tags,
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
// ORCHESTRATOR: The Sequential Pipeline
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAllMetadata(gameName) {
    console.log(`\n--- Starting Metadata Fetch Pipeline for: "${gameName}" ---`);

    // 1. RAWG First
    const rawgData = await rawgApi.fetchGameDetails(gameName);

    let steamData = null;
    let sgAssets = null;
    let steamAppId = rawgData?.steamAppId || null;

    // 2. If RAWG gave a Steam AppID, use it. Otherwise, try to find Steam AppID by name.
    if (!steamAppId) {
        console.log(`[Pipeline] No Steam AppID from RAWG, searching Steam by name...`);
        steamAppId = await steamApi.searchAppId(gameName);
        if (steamAppId) console.log(`[Pipeline] Found Steam AppID via name search: ${steamAppId}`);
    }

    // 3. Fetch Steam details and SteamGrid assets (if we have an AppID)
    if (steamAppId) {
        console.log(`[Pipeline] Fetching Steam data for AppID ${steamAppId}...`);
        [steamData, sgAssets] = await Promise.all([
            steamApi.fetchGameDetails(steamAppId),
            steamGridApi.fetchGameAssets(steamAppId)
        ]);
    } else {
        // No AppID at all – fallback to SteamGrid search by name only
        console.log(`[Pipeline] No Steam AppID found, fetching SteamGrid assets by name...`);
        sgAssets = await steamGridApi.fetchGameAssets(gameName);
    }

    // 4. YouTube trailer (same as before)
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

    // 5. Merge
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