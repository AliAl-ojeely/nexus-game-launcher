const axios = require("axios");

async function fetchGameDetails(name) {
    try {

        // البحث عن اللعبة
        const search = await axios.get("https://api.rawg.io/api/games", {
            params: {
                key: process.env.RAWG_API_KEY,
                search: name,
                page_size: 1
            }
        });

        if (!search.data.results.length) return null;

        const exactMatch = search.data.results.find(g => g.name.toLowerCase() === name.toLowerCase());
        const game = exactMatch || search.data.results[0];

        // جلب التفاصيل
        const details = await axios.get(`https://api.rawg.io/api/games/${game.id}`, {
            params: { key: process.env.RAWG_API_KEY }
        });

        const data = details.data;

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
                minimum: minimum,
                recommended: recommended
            },
            media: {
                trailer: data.clip?.clip || "",
                // التعديل هنا: استخدام game بدلاً من data لجلب الصور
                screenshots: game.short_screenshots
                    ? game.short_screenshots.map(s => s.image)
                    : []
            },
            poster: data.background_image || "",
            background: data.background_image_additional || data.background_image || ""
        };

    } catch (error) {

        console.error("RAWG API Error:", error);
        return null;

    }
}

module.exports = { fetchGameDetails };