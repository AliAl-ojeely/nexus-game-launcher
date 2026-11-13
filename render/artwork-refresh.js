// Shared renderer-side refresh policy; no DOM or visual changes.
const KINDS = ['poster', 'background', 'logo', 'icon'];
const RETRY_MS = 12 * 60 * 60 * 1000;
const inFlight = new Map();

function isManual(value) {
    return typeof value === 'string' && /(?:^|[\\/])manual[\\/](?:poster|background|logo|icon)-[a-f0-9-]+\./i.test(value);
}

export function needsArtworkRefresh(game, now = Date.now()) {
    if (!game) return false;
    const data = game.metadata?.artworkResolution;
    const retry = Date.parse(data?.retryAfter || '');
    if (Number.isFinite(retry) && now < retry) return false;
    return KINDS.some(kind => !game.assets?.[kind] || /^https?:\/\//i.test(game.assets[kind]) ||
        data?.kinds?.[kind]?.status === 'fallback') ||
        !game.metadata?.description?.trim();
}

export function mergeFetchedArtwork(game, fetched) {
    const original = game.assets || {};
    const assets = { ...original };
    for (const kind of KINDS) {
        const value = fetched?.assets?.[kind];
        if (!isManual(original[kind]) && typeof value === 'string' && value.trim()) assets[kind] = value;
    }
    const before = game.metadata || {};
    const incoming = fetched?.metadata || {};
    const metadata = { ...before };
    for (const [key, value] of Object.entries(incoming)) {
        if (key === 'media' || key === 'artworkResolution') continue;
        if (typeof value === 'string' && !value.trim()) continue;
        if (value !== null && value !== undefined) metadata[key] = value;
    }
    metadata.media = { ...before.media };
    for (const [key, value] of Object.entries(incoming.media || {})) {
        if (Array.isArray(value) ? value.length : Boolean(value)) metadata.media[key] = value;
    }
    if (incoming.artworkResolution) metadata.artworkResolution = incoming.artworkResolution;
    return { ...game, assets, metadata };
}

export function markFailedArtworkRefresh(game, now = Date.now()) {
    if (!game.metadata) game.metadata = {};
    game.metadata.artworkResolution = {
        ...(game.metadata.artworkResolution || {}),
        checkedAt: new Date(now).toISOString(),
        retryAfter: new Date(now + RETRY_MS).toISOString(),
    };
}

export function fetchArtworkOnce(game, loader) {
    const key = String(game.id || game.name);
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = Promise.resolve().then(loader).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
}
