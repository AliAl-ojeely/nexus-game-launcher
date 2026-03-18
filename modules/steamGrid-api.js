const axios = require('axios');

const API_KEY = 'ccef0466bd452420835c81d0fc63a789';
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

/*
تنظيف اسم اللعبة قبل البحث
*/
function cleanName(name) {
    return name
        .replace(/[-_.]/g, ' ')
        .replace(/\b(repack|fitgirl|empress|codex|skidrow|goldberg)\b/gi, '')
        .replace(/\b(edition|complete|ultimate|deluxe|remastered|definitive|enhanced)\b/gi, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/*
الحصول على Steam AppID من اسم اللعبة
*/
async function getSteamAppId(gameName) {
    try {

        const cleaned = cleanName(gameName);

        const res = await axios.get(
            `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleaned)}&l=english&cc=US`
        );

        if (!res.data || !res.data.items || res.data.items.length === 0)
            return null;

        return res.data.items[0].id;

    } catch (err) {
        console.error("Steam AppID Search Error:", err.message);
        return null;
    }
}

/*
جلب الصور من SteamGridDB باستخدام Steam AppID
*/
async function fetchGameAssets(gameName) {
    try {

        const appId = await getSteamAppId(gameName);

        if (!appId) {
            console.log("No Steam AppID found for:", gameName);
            return null;
        }

        console.log("Steam AppID:", appId);

        const [grids, heroes, logos] = await Promise.all([
            axios.get(`${SGDB_BASE}/grids/steam/${appId}?dimensions=600x900`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            }),
            axios.get(`${SGDB_BASE}/heroes/steam/${appId}`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            }),
            axios.get(`${SGDB_BASE}/logos/steam/${appId}`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            })
        ]);

        return {
            poster: grids.data.data?.[0]?.url || "",
            background: heroes.data.data?.[0]?.url || "",
            logo: logos.data.data?.[0]?.url || ""
        };

    } catch (error) {

        console.error("SteamGridDB API Error:", error.message);

        return null;
    }
}

module.exports = { fetchGameAssets };