const axios = require('axios');
const secrets = require('../src/secrets.json');

const API_KEY = secrets.SGDB_API_KEY;
const SGDB_BASE = 'https://www.steamgriddb.com/api/v2';

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

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

function extractUrl(settled, assetType) {
    if (settled.status === 'rejected') {
        console.warn(`[SteamGrid] ${assetType} request failed:`, settled.reason?.message || 'unknown');
        return '';
    }
    const items = settled.value?.data?.data;
    if (!items?.length) {
        console.log(`[SteamGrid] ${assetType}: no results`);
        return '';
    }
    const url = items[0]?.url || '';
    console.log(`[SteamGrid] ${assetType}: found → ${url.slice(0, 60)}...`);
    return url;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN FETCH
// ─────────────────────────────────────────────────────────────────────────────

async function fetchGameAssets(gameName, steamAppId = null) {
    try {
        let gameId = null;

        // ── Step 1: Try via Steam AppID first (most accurate) ────────────────
        if (steamAppId) {
            try {
                const res = await axios.get(
                    `${SGDB_BASE}/games/steam/${steamAppId}`,
                    {
                        headers: { Authorization: `Bearer ${API_KEY}` },
                        timeout: 10000,
                    }
                );
                if (res.data.success && res.data.data?.id) {
                    gameId = res.data.data.id;
                    console.log(`[SteamGrid] Matched via AppID ${steamAppId} → SGDB ID ${gameId}`);
                }
            } catch (err) {
                console.warn(`[SteamGrid] AppID lookup failed (${steamAppId}):`, err.message);
            }
        }

        // ── Step 2: Fallback – search by name ────────────────────────────────
        if (!gameId) {
            const cleaned = cleanName(gameName);
            console.log(`[SteamGrid] Searching by name: "${cleaned}"`);
            try {
                const searchRes = await axios.get(
                    `${SGDB_BASE}/search/autocomplete/${encodeURIComponent(cleaned)}`,
                    {
                        headers: { Authorization: `Bearer ${API_KEY}` },
                        timeout: 10000,
                    }
                );
                if (!searchRes.data.success || !searchRes.data.data?.length) {
                    console.warn(`[SteamGrid] No results for "${cleaned}"`);
                    return null;
                }
                gameId = searchRes.data.data[0].id;
                console.log(`[SteamGrid] Matched via name "${cleaned}" → SGDB ID ${gameId}`);
            } catch (err) {
                console.error(`[SteamGrid] Name search failed:`, err.message);
                return null;
            }
        }

        const headers = { Authorization: `Bearer ${API_KEY}` };
        const cfg = { headers, timeout: 10000 };

        // ── Step 3: Poster (with fallback dimensions) ────────────────────────
        let poster = '';
        // Try 600x900 first
        let gridsRes = await axios.get(`${SGDB_BASE}/grids/game/${gameId}?dimensions=600x900`, cfg).catch(() => null);
        if (gridsRes?.data?.data?.length) {
            poster = gridsRes.data.data[0].url;
            console.log(`[SteamGrid] poster (600x900): found → ${poster.slice(0, 60)}...`);
        } else {
            // Fallback: any grid (no dimension filter)
            console.log(`[SteamGrid] No 600x900 poster, trying any grid...`);
            gridsRes = await axios.get(`${SGDB_BASE}/grids/game/${gameId}`, cfg).catch(() => null);
            if (gridsRes?.data?.data?.length) {
                poster = gridsRes.data.data[0].url;
                console.log(`[SteamGrid] poster (any): found → ${poster.slice(0, 60)}...`);
            } else {
                console.log(`[SteamGrid] poster: no results`);
            }
        }

        // ── Step 4: Heroes, Logos, Icons (parallel) ──────────────────────────
        const [heroes, logos, icons] = await Promise.allSettled([
            axios.get(`${SGDB_BASE}/heroes/game/${gameId}`, cfg),
            axios.get(`${SGDB_BASE}/logos/game/${gameId}`, cfg),
            axios.get(`${SGDB_BASE}/icons/game/${gameId}`, cfg),
        ]);

        let background = extractUrl(heroes, 'background');
        const logo = extractUrl(logos, 'logo');
        const iconUrl = extractUrl(icons, 'icon');

        // ── Step 5: Background fallback to wide grid if no hero ──────────────
        if (!background) {
            console.log(`[SteamGrid] No hero found — trying wide grid as background fallback`);
            try {
                const wideGrid = await axios.get(`${SGDB_BASE}/grids/game/${gameId}?dimensions=460x215`, cfg);
                background = wideGrid.data?.data?.[0]?.url || '';
                if (background) {
                    console.log(`[SteamGrid] Wide grid fallback found for background`);
                }
            } catch {
                // ignore
            }
        }

        console.log(`[SteamGrid] Final → poster:${!!poster} bg:${!!background} logo:${!!logo} icon:${!!iconUrl}`);

        return {
            poster,
            background,
            logo,
            icon: iconUrl || null,
        };

    } catch (error) {
        console.error('[SteamGrid] Unexpected error:', error.message);
        return null;
    }
}

module.exports = { fetchGameAssets };