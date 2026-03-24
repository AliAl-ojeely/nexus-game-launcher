const axios = require("axios");

const secrets = require('../src/secrets.json');
const API_KEY = secrets.RAWG_API_KEY;

async function fetchGameDetails(name) {
    try {
        const yearMatch = name.match(/\b(19|20)\d{2}\b/);
        const searchYear = yearMatch ? yearMatch[0] : null;
        const cleanName = name.replace(/\b(19|20)\d{2}\b/g, '').trim();

        const search = await axios.get("https://api.rawg.io/api/games", {
            params: {
                key: API_KEY,
                search: cleanName,
                page_size: 5
            }
        });

        if (!search.data.results.length) return null;

        let game = null;

        if (searchYear) {
            game = search.data.results.find(g => g.released && g.released.startsWith(searchYear));
        }

        if (!game) {
            const exactMatch = search.data.results.find(g => g.name.toLowerCase() === cleanName.toLowerCase());
            game = exactMatch || search.data.results[0];
        }

        const details = await axios.get(`https://api.rawg.io/api/games/${game.id}`, {
            params: { key: API_KEY }
        });

        const data = details.data;

        const pcPlatform = data.platforms?.find(p => p.platform.slug === "pc");
        const minimum = pcPlatform?.requirements?.minimum || "N/A";
        const recommended = pcPlatform?.requirements?.recommended || "N/A";

        let finalMetacritic = data.metacritic;

        if (!finalMetacritic && data.metacritic_platforms && data.metacritic_platforms.length > 0) {
            const pcMeta = data.metacritic_platforms.find(p => p.platform.slug === "pc");
            if (pcMeta) {
                finalMetacritic = pcMeta.metacritic;
            } else {
                finalMetacritic = data.metacritic_platforms[0].metacritic;
            }
        }

        const genresList = data.genres ? data.genres.map(g => g.name).join(", ") : "N/A";
        const tagsList = data.tags ? data.tags.filter(t => t.language === "eng").map(t => t.name).slice(0, 8).join(", ") : "N/A";

        console.log(`\n--- RAWG API Debug: ${game.name} ---`);
        console.log(`Extracted Year:`, searchYear || "None");
        console.log(`Metacritic Score:`, finalMetacritic || "N/A");
        console.log(`Genres:`, genresList);
        console.log(`Tags:`, tagsList);
        console.log(`-----------------------------------\n`);

        return {
            description: data.description_raw || "No description available",
            developer: data.developers?.map(d => d.name).join(", ") || "N/A",
            publisher: data.publishers?.map(p => p.name).join(", ") || "N/A",
            releaseDate: data.released || "N/A",
            metacritic: finalMetacritic || "N/A",
            genres: genresList,
            tags: tagsList,
            systemRequirements: {
                minimum: minimum,
                recommended: recommended
            },
            media: {
                screenshots: game.short_screenshots ? game.short_screenshots.map(s => s.image) : []
            },
            poster: data.background_image || "",
            background: data.background_image_additional || data.background_image || ""
        };

    } catch (error) {
        console.error("RAWG API Error:", error.message);
        return null;
    }
}

module.exports = { fetchGameDetails };