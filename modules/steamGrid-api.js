const axios = require('axios');

const API_KEY = process.env.SGDB_API_KEY;
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

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

async function fetchGameAssets(gameName, steamAppId = null) {

    try {

        let gameId = null;

        // =====================================
        // إذا توفر Steam AppID نستخدمه مباشرة
        // =====================================
        if (steamAppId) {

            const steamMatch = await axios.get(
                `${SGDB_BASE}/games/steam/${steamAppId}`,
                { headers: { Authorization: `Bearer ${API_KEY}` } }
            );

            if (steamMatch.data.success && steamMatch.data.data) {
                gameId = steamMatch.data.data.id;
            }
        }

        // =====================================
        // fallback البحث بالاسم
        // =====================================
        if (!gameId) {

            const cleaned = cleanName(gameName);

            const searchRes = await axios.get(
                `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(cleaned)}`,
                { headers: { Authorization: `Bearer ${API_KEY}` } }
            );

            if (!searchRes.data.success || !searchRes.data.data.length) {
                return null;
            }

            gameId = searchRes.data.data[0].id;
        }

        // =====================================
        // جلب الصور
        // =====================================

        const [grids, heroes, logos] = await Promise.all([

            axios.get(`${SGDB_BASE}/grids/game/${gameId}`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            }),

            axios.get(`${SGDB_BASE}/heroes/game/${gameId}`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            }),

            axios.get(`${SGDB_BASE}/logos/game/${gameId}`, {
                headers: { Authorization: `Bearer ${API_KEY}` }
            })

        ]);

        return {
            poster: grids.data.data?.[0]?.url || "",
            background: heroes.data.data?.[0]?.url || "",
            logo: logos.data.data?.[0]?.url || ""
        };

    } catch (error) {

        console.error("[SteamGrid] API Error:", error.message);
        return null;

    }
}

module.exports = { fetchGameAssets };