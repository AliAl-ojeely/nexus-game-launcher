'use strict';
// Per-game consent. Previously user-approved Silksong is the only seeded default.
// Never automatically attach to an arbitrary newly imported game.
const path = require('node:path').win32;

function knownApprovedGame(game) {
    return !!game && String(game.name || '').trim().toLowerCase() === 'hollow knight silksong' &&
        path.basename(String(game.path || '').replace(/\//g, '\\')).toLowerCase() === 'hollow knight silksong.exe';
}
function approved(settings, game) {
    if (!game || (typeof game.id !== 'string' && typeof game.id !== 'number')) return false;
    const table = settings && settings.nexusOverlayApproved;
    const key = String(game.id);
    if (table && typeof table === 'object' && !Array.isArray(table) &&
        Object.prototype.hasOwnProperty.call(table, key)) return table[key] === true;
    return knownApprovedGame(game);
}
function updateApproval(settings, game, enabled) {
    if (!game || (typeof game.id !== 'string' && typeof game.id !== 'number') ||
        typeof enabled !== 'boolean') throw new TypeError('Invalid game approval update');
    const table = (settings?.nexusOverlayApproved && typeof settings.nexusOverlayApproved === 'object' &&
        !Array.isArray(settings.nexusOverlayApproved)) ? settings.nexusOverlayApproved : {};
    return { ...settings, nexusOverlayApproved: { ...table, [String(game.id)]: enabled } };
}
module.exports = { approved, knownApprovedGame, updateApproval };
