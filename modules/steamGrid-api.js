const axios = require('axios');

// التأكد من استدعاء المفتاح من ملف .env
const API_KEY = process.env.SGDB_API_KEY;
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

/**
 * تنظيف متقدم للاسم للتأكد من دقة البحث
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

/**
 * جلب الأصول المرئية (البوستر، الخلفية، الشعار) باستخدام المعرف الداخلي
 */
async function fetchGameAssets(gameName) {
    try {
        const cleaned = cleanName(gameName);
        console.log(`[SteamGrid] Searching assets for: "${cleaned}"`);

        // 1. البحث في قاعدة بيانات SteamGridDB الذكية
        const searchRes = await axios.get(`${SGDB_BASE}/search/autocomplete/${encodeURIComponent(cleaned)}`, {
            headers: { Authorization: `Bearer ${API_KEY}` }
        });

        // التحقق من وجود نتائج
        if (!searchRes.data.success || searchRes.data.data.length === 0) {
            console.log(`[SteamGrid] No game found for: ${cleaned}`);
            return null;
        }

        // 2. أخذ الـ ID الداخلي لأول نتيجة
        const results = searchRes.data.data;
        const exactMatch = results.find(g => g.name.toLowerCase() === cleaned.toLowerCase());
        const gameId = exactMatch ? exactMatch.id : results[0].id;
        console.log(`[SteamGrid] Found Internal Game ID: ${gameId}`);

        // 3. جلب جميع الصور بالتوازي لسرعة الاستجابة
        // ملاحظة: تم حذف شرط المقاس (?dimensions) لضمان جلب البوستر دائماً مهما كان مقاسه
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

        // 4. استخراج الروابط مع الحماية من الأخطاء (Optional Chaining)
        const posterUrl = grids.data.data?.[0]?.url || "";
        const backgroundUrl = heroes.data.data?.[0]?.url || "";
        const logoUrl = logos.data.data?.[0]?.url || "";

        // طباعة حالة الصور في الـ Console للتأكد
        console.log(`[SteamGrid] Poster: ${posterUrl ? 'Yes' : 'No'} | Background: ${backgroundUrl ? 'Yes' : 'No'} | Logo: ${logoUrl ? 'Yes' : 'No'}`);

        return {
            poster: posterUrl,
            background: backgroundUrl,
            logo: logoUrl
        };

    } catch (error) {
        console.error("[SteamGrid] API Error:", error.message);
        return null;
    }
}

module.exports = { fetchGameAssets };