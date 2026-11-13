const rawgApi = require('./rawg-api');
const steamApi = require('./steam-api');
const steamGridApi = require('./steamGrid-api');
const steamArtworkApi = require('./steam-artwork');
const youtubeApi = require('./youtube-api');
const { buildAssetCandidates } = require('./asset-resolver');

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

    // One shared source order for all entry points; the downloader validates bytes.
    const rawAssets = buildAssetCandidates({ steamGrid: sgAssets, steamArtwork, steamData });

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

async function fetchAllMetadata(gameName, options = {}) {
    // Legacy entry point delegates to the one shared provider orchestrator.
    const { collectMetadata } = require('./asset-pipeline');
    return collectMetadata(gameName, options);
}

module.exports = {
    mergeMetadata,
    fetchAllMetadata
};