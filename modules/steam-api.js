const axios = require('axios');

function normalizeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchGameDetails(name) {
    try {
        const search = await axios.get(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`
        );

        if (!search.data.items || !search.data.items.length) return null;

        const targetName = normalizeName(name);
        const exactMatch = search.data.items.find(g => normalizeName(g.name) === targetName);

        if (!exactMatch) {
            console.log(`[Steam API] Name mismatch for "${name}". Falling back to RAWG.`);
            return null; 
        }

        const appid = exactMatch.id;

        const details = await axios.get(
            `https://store.steampowered.com/api/appdetails?appids=${appid}&l=en`
        );

        if (!details.data[appid].success) return null;

        const data = details.data[appid].data;

        return {
            appid: appid, // التعديل هنا: أضفنا إرجاع الـ AppID
            description: data.short_description || "",
            developer: data.developers?.join(", ") || "N/A",
            publisher: data.publishers?.join(", ") || "N/A",
            releaseDate: data.release_date?.date || "N/A",
            systemRequirements: {
                minimum: data.pc_requirements?.minimum || "N/A",
                recommended: data.pc_requirements?.recommended || "N/A"
            },
            media: {
                trailer: data.movies?.[0]?.mp4?.max || data.movies?.[0]?.webm?.max || "",
                screenshots: data.screenshots ? data.screenshots.map(s => s.path_full) : []
            },
            poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`
        };

    } catch (err) {
        console.error("Steam API Error:", err.message);
        return null;
    }
}

module.exports = { fetchGameDetails };