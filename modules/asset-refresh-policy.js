'use strict';

const { KINDS } = require('./asset-resolver');
const RETRY_AFTER_MS = 12 * 60 * 60 * 1000;

function needsRefresh(game, now = Date.now()) {
    const assets = game?.assets || {};
    const missingArtwork = KINDS.some(kind => !assets[kind] || /^https?:\/\//i.test(assets[kind]));
    const missingText = !game?.metadata?.description?.trim();
    if (!missingArtwork && !missingText) return false;
    const resolution = game?.metadata?.artworkResolution;
    const retry = Date.parse(resolution?.retryAfter || '');
    return !Number.isFinite(retry) || now >= retry;
}

function mergeMetadataSafe(previous = {}, incoming = {}) {
    const result = { ...previous };
    for (const [key, value] of Object.entries(incoming || {})) {
        if (key === 'media' || key === 'artworkResolution') continue;
        if (value !== null && value !== undefined && value !== '') result[key] = value;
    }
    const prevMedia = previous.media || {};
    const nextMedia = incoming.media || {};
    result.media = { ...prevMedia };
    for (const [key, value] of Object.entries(nextMedia)) {
        if (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '') {
            result.media[key] = value;
        }
    }
    if (incoming.artworkResolution) result.artworkResolution = incoming.artworkResolution;
    return result;
}

function markAttempt(game, now = Date.now()) {
    const meta = game.metadata || (game.metadata = {});
    const original = meta.artworkResolution || {};
    meta.artworkResolution = {
        ...original, checkedAt: new Date(now).toISOString(),
        retryAfter: new Date(now + RETRY_AFTER_MS).toISOString(),
    };
}

module.exports = { RETRY_AFTER_MS, needsRefresh, mergeMetadataSafe, markAttempt };
