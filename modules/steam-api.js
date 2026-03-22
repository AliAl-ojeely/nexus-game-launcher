const axios = require('axios');

function normalizeName(name) {
    return name
        .toLowerCase()
        .replace(/\b(edition|remake|remastered|definitive|ultimate|deluxe)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
}

function extractYear(name) {
    const match = name.match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : null;
}

async function fetchGameDetails(name) {

    try {

        const year = extractYear(name);

        const search = await axios.get(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`
        );

        if (!search.data.items || !search.data.items.length) return null;

        const targetName = normalizeName(name);

        let game = null;

        // محاولة مطابقة الاسم
        game = search.data.items.find(g => normalizeName(g.name) === targetName);

        // محاولة مطابقة السنة
        if (!game && year) {

            game = search.data.items.find(g => {
                if (!g.release_date) return false;
                return g.release_date.includes(year);
            });

        }

        // fallback أول نتيجة
        if (!game) {
            game = search.data.items[0];
        }

        const appid = game.id;

        const details = await axios.get(
            `https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`
        );

        if (!details.data[appid].success) return null;

        const data = details.data[appid].data;

        return {

            appid: appid,

            description: data.short_description || "",

            developer: data.developers?.join(", ") || "N/A",

            publisher: data.publishers?.join(", ") || "N/A",

            releaseDate: data.release_date?.date || "N/A",

            systemRequirements: {

                minimum: data.pc_requirements?.minimum || "N/A",

                recommended: data.pc_requirements?.recommended || "N/A"

            },

            media: {

                screenshots: data.screenshots
                    ? data.screenshots.map(s => s.path_full)
                    : []

            },

            poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`

        };

    } catch (err) {

        console.error("Steam API Error:", err.message);
        return null;

    }

}

module.exports = { fetchGameDetails };