'use strict';

// Development-only, opt-in Steam PICS logo fallback. No keys or game DB writes.
const VALID_ID = /^[1-9]\d{0,11}$/;
const HOSTS = new Set([
    'shared.cloudflare.steamstatic.com', 'shared.fastly.steamstatic.com',
    'shared.akamai.steamstatic.com', 'shared.steamstatic.com',
    'cdn.fastly.steamstatic.com', 'cdn.cloudflare.steamstatic.com',
    'cdn.akamai.steamstatic.com', 'cdn.steamstatic.com',
]);
const inFlight = new Map();

function authorized(id, env = process.env) {
    if (env?.NEXUS_PICS_EXPERIMENT !== '1' || !VALID_ID.test(String(id))) return false;
    const ids = String(env.NEXUS_PICS_APPIDS || '').split(',').map(v => v.trim()).filter(Boolean);
    if (!ids.length || ids.length > 8 || ids.some(v => !VALID_ID.test(v))) return false;
    return new Set(ids).has(String(id));
}

function checkedLogoUrl(input, appId) {
    if (!VALID_ID.test(String(appId))) return null;
    try {
        const url = new URL(input);
        const path = new RegExp('^/store_item_assets/steam/apps/' + String(appId) + '/[a-f0-9]{40}/logo(?:_2x)?\\.png$', 'i');
        if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || !path.test(url.pathname) ||
            url.port || url.username || url.password || url.search || url.hash) return null;
        return url;
    } catch { return null; }
}

function defaultProbe() {
    // The separate v0.3.3 probe is intentionally not bundled into production releases.
    return require('../tools/nexus-asset-provider-pilot-v033/run-pilot.cjs');
}

async function getPicsFallbackLogo(gameName, metadata, options = {}) {
    const id = String(metadata?.steamAppId || '');
    const env = options.env || process.env;
    if (!authorized(id, env)) return { status: 'disabled', candidates: [] };
    if (options.firstPassLogo) return { status: 'already_resolved', candidates: [] };
    if (typeof gameName !== 'string' || !gameName.trim()) return { status: 'invalid_title', candidates: [] };
    if (options.manualLogo === true) return { status: 'manual_artwork_preserved', candidates: [] };
    const key = `${id}:${gameName.normalize('NFKC').trim().toLowerCase()}`;
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (async () => {
        try {
            const module = (options.probe && options.verify) ? null : defaultProbe();
            const run = options.probe || module.runSteamKit;
            const verify = options.verify || module.verifyLogoCandidates;
            const pics = await run(id, gameName);
            if (pics?.provider !== 'steam-pics' || pics?.status !== 'ok' ||
                String(pics.appId) !== id || !['pics_name_exact', 'official_store_appid_and_title'].includes(pics.identityProof)) {
                return { status: 'identity_not_verified', candidates: [] };
            }
            const urls = (Array.isArray(pics?.assets?.logo) ? pics.assets.logo : []).slice(0, 3);
            if (!urls.length || !urls.every(item => checkedLogoUrl(item?.url, id)))
                return { status: 'unsafe_or_missing_logo', candidates: [] };
            const results = await verify([pics], { timeoutMs: 9000 });
            const index = (Array.isArray(results) ? results : []).findIndex(item =>
                item?.provider === 'steam-pics' && item.status === 'valid_image' && item.alpha === true &&
                Number.isInteger(item.width) && item.width >= 64 &&
                Number.isInteger(item.height) && item.height >= 24);
            if (index < 0 || index >= urls.length) return { status: 'image_not_verified', candidates: [] };
            const target = checkedLogoUrl(urls[index].url, id);
            const host = results[index].host;
            if (!target || !HOSTS.has(host)) return { status: 'untrusted_final_host', candidates: [] };
            // Validator permits only same-path trusted CDN redirects; preserve the hash path.
            target.hostname = host;
            return { status: 'candidate_verified', candidates: [{ url: target.toString(), source: 'steam-pics-opt-in' }] };
        } catch {
            // Fail closed without logging remote responses, secrets, or credentials.
            return { status: 'pics_unavailable', candidates: [] };
        }
    })().finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
}

// Network adapter for the second-pass downloader. It never auto-follows redirects.
function picsStrictHttp({ fetchImpl = globalThis.fetch, timeoutMs = 9000 } = {}) {
    return {
        async get(url) {
            // Always recheck the downloaded bytes; URL validation alone is not enough.
            const { fetchTrusted, boundedImageBytes } = defaultProbeValidator();
            const { response } = await fetchTrusted(url, fetchImpl, timeoutMs);
            const bytes = await boundedImageBytes(response);
            return { data: bytes, headers: { 'content-type': response.headers?.get?.('content-type') || 'application/octet-stream' } };
        },
    };
}

function defaultProbeValidator() {
    return require('../tools/nexus-asset-provider-pilot-v033/logo-validator.cjs');
}

module.exports = { authorized, checkedLogoUrl, getPicsFallbackLogo, picsStrictHttp };

