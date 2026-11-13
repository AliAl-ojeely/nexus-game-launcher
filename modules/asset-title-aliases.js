'use strict';

// Provider-verified title aliases. Do not infer identity from a shared prefix.
// Each entry requires a verified official store identity; add only after review.
const ENTRIES = Object.freeze({
    'desperados ii': Object.freeze({
        canonical: "Desperados 2: Cooper's Revenge",
        steamAppId: '9710',
    }),
});
function resolveTitleIdentity(name) {
    const input = String(name || '').trim();
    const match = ENTRIES[input.toLowerCase().replace(/\s+/g, ' ')];
    return match ? { displayName: input, searchName: match.canonical, steamAppId: match.steamAppId,
        origin: 'verified-alias' } : { displayName: input, searchName: input, steamAppId: null,
        origin: 'exact-title' };
}
module.exports = { resolveTitleIdentity };
