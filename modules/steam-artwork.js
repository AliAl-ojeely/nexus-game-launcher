'use strict';

// Steam Library artwork fallback. No new API key, Twitch or IGDB dependency.
// IStoreBrowseService is publicly reachable but not a stability-guaranteed API.
const axios = require('axios');

const BASE = 'https://shared.steamstatic.com/store_item_assets/';
const COMMUNITY_BASE = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/';
const KINDS = ['poster', 'background', 'logo', 'icon'];

function unique(values) {
    return [...new Set(values.filter(value =>
        typeof value === 'string' && value.startsWith('https://')
    ))];
}

function safeAssetPath(value) {
    return typeof value === 'string' &&
        value.length > 0 && value.length < 300 &&
        !value.includes('..') && !value.includes('//') &&
        !value.startsWith('/') &&
        /^[a-zA-Z0-9_./-]+$/.test(value);
}

/**
 * Steam often returns an asset_url_format such as:
 *   steam/apps/4115450/${FILENAME}?t=1786510431
 *
 * The previous resolver rejected the entire URL because of the '?', silently
 * discarding valid hash-based library artwork. Validate the PATH separately
 * from Steam's timestamp query instead.
 */
function resolveReturnedUrl(asset, assets, appid) {
    if (!safeAssetPath(asset)) return '';
    const format = assets?.asset_url_format;
    if (typeof format !== 'string' || !format.includes('${FILENAME}')) return '';

    const expanded = format.replace('${FILENAME}', asset);
    const parts = expanded.split('?');
    if (parts.length > 2) return '';
    const [pathname, query = ''] = parts;

    if (!pathname.startsWith(`steam/apps/${appid}/`) ||
        !safeAssetPath(pathname) || pathname.includes('${')) {
        return '';
    }

    // Versioned Steam links use ?t=<numeric timestamp>. Do not allow an
    // arbitrary query string or redirect to an outside origin.
    if (query && !/^t=\d{1,20}$/.test(query)) return '';
    return `${BASE}${pathname}${query ? `?${query}` : ''}`;
}

function staticUrl(appid, filename) {
    return `${BASE}steam/apps/${appid}/${filename}`;
}

function steamCommunityIcon(assets, appid) {
    const value = assets?.community_icon;
    if (typeof value !== 'string') return '';

    // Depending on the game, Steam returns a 40-character image hash instead
    // of a path relative to asset_url_format.
    if (/^[a-f0-9]{40}$/i.test(value)) {
        return `${COMMUNITY_BASE}${appid}/${value}.jpg`;
    }
    return resolveReturnedUrl(value, assets, appid);
}

function fromStoreBrowse(assets, appid) {
    const urls = keys => keys.map(key => resolveReturnedUrl(assets?.[key], assets, appid));
    return {
        poster: urls(['library_capsule_2x', 'library_capsule']),
        background: urls(['library_hero_2x', 'library_hero']),
        logo: urls(['library_logo_2x', 'library_logo', 'logo_2x', 'logo']),
        icon: [steamCommunityIcon(assets, appid)],
    };
}

async function fetchSteamArtwork(appid, options = {}) {
    if (!/^\d{1,12}$/.test(String(appid || ''))) return null;
    const id = String(appid);
    let remote = {};

    try {
        const query = {
            ids: [{ appid: Number(id) }],
            context: { language: 'english', country_code: 'US' },
            data_request: { include_assets: true },
        };
        const { data } = await (options.http || axios).get(
            'https://api.steampowered.com/IStoreBrowseService/GetItems/v1/',
            { params: { input_json: JSON.stringify(query) }, timeout: 12000 },
        );
        const item = data?.response?.store_items?.find(item =>
            String(item.appid) === id && item.success !== 0
        );
        remote = item?.assets || {};

        const candidateCount = ['library_capsule', 'library_capsule_2x',
            'library_hero', 'library_hero_2x', 'community_icon']
            .filter(key => Boolean(remote[key])).length;
        console.log(`[SteamArtwork] StoreBrowse ${id}: ${candidateCount} artwork fields`);
    } catch (err) {
        console.warn(`[SteamArtwork] StoreBrowse unavailable for ${id}: ${err.message}`);
    }

    const api = fromStoreBrowse(remote, id);
    const fallbacks = {
        poster: ['library_600x900_2x.jpg', 'library_600x900.jpg'],
        background: ['library_hero_2x.jpg', 'library_hero.jpg'],
        logo: ['logo_2x.png', 'logo.png'],
        icon: [],
    };

    const result = {};
    for (const kind of KINDS) {
        result[kind] = unique([
            ...api[kind],
            ...fallbacks[kind].map(filename => staticUrl(id, filename)),
        ]);
    }
    console.log(`[SteamArtwork] ${id} candidates: poster=${result.poster.length} bg=${result.background.length} logo=${result.logo.length} icon=${result.icon.length}`);
    return result;
}

module.exports = { fetchSteamArtwork, fromStoreBrowse, resolveReturnedUrl };
