const axios = require('axios');
require('dotenv').config();

const RAWG_API_KEY = "aa4561f264de4ce097bb54c4d29953ad";

function cleanName(name) {
    return name
        .replace(/[-_.]/g, ' ')
        .replace(/\b(repack|fitgirl|empress|codex|skidrow|goldberg)\b/gi, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

async function fetchGameDetails(gameName) {
    try {
        const cleaned = cleanName(gameName);

        // البحث عن اللعبة
        const search = await axios.get("https://api.rawg.io/api/games", {
            params: {
                key: RAWG_API_KEY,
                search: cleaned,
                page_size: 1
            }
        });

        if (!search.data.results || search.data.results.length === 0)
            return null;

        const game = search.data.results[0];

        // جلب التفاصيل الأساسية
        const details = await axios.get(`https://api.rawg.io/api/games/${game.id}`, {
            params: { key: RAWG_API_KEY }
        });

        const data = details.data;

        // جلب Screenshots منفصلة
        const screenshotsRes = await axios.get(
            `https://api.rawg.io/api/games/${game.id}/screenshots`,
            { params: { key: RAWG_API_KEY } }
        );

        // استخراج متطلبات PC
        const pcPlatform = data.platforms?.find(p => p.platform.slug === "pc");
        const minimum = pcPlatform?.requirements?.minimum || "N/A";
        const recommended = pcPlatform?.requirements?.recommended || "N/A";

        return {
            description: data.description_raw || "No description available",
            developer: data.developers?.map(d => d.name).join(", ") || "N/A",
            publisher: data.publishers?.map(p => p.name).join(", ") || "N/A",
            releaseDate: data.released || "N/A",
            systemRequirements: {
                minimum,
                recommended
            },
            media: {
                trailer: data.clip?.clip || "",
                screenshots: screenshotsRes.data.results?.map(s => s.image) || []
            },
            poster: data.background_image || "",
            background: data.background_image_additional || data.background_image || ""
        };

    } catch (error) {
        console.error("RAWG API Error:", error.message || error);
        return null;
    }
}

module.exports = { fetchGameDetails };