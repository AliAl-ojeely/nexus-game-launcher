'use strict';
// Read-only export of Nexus's already-running sessions for the separate OSR Electron process.
// Writes ONLY nexus-overlay-session-v1.json under app userData; never edits playTime or playSessions.
const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'nexus-overlay-session-v1.json';
let lastError = null;
let lastSavedReadError = null;

function safeSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.min(999999999, Math.floor(number)) : 0;
}

function buildSnapshot(games, getPlaytimeInfo = () => ({ minutes: 0, seconds: 0 }), now = Date.now()) {
    const sessions = [];
    for (const game of games) {
        if (!game || game.stopping) continue;
        const gameId = game.gameId;
        const gamePid = Number(game.activePid);
        const launchPid = Number(game.launchPid);
        if ((typeof gameId !== 'string' && typeof gameId !== 'number') ||
            !Number.isSafeInteger(gamePid) || gamePid < 1 ||
            !Number.isSafeInteger(launchPid) || launchPid < 1 ||
            typeof game.gameName !== 'string' || !game.gameName.trim()) continue;
        let saved = 0;
        try {
            const total = getPlaytimeInfo(game.gameName);
            saved = safeSeconds(Number(total.minutes) * 60 + Number(total.seconds));
            lastSavedReadError = null;
        } catch (error) {
            // A missing/unavailable playtime DB must not disrupt game monitoring.
            if (lastSavedReadError !== error.message) {
                console.warn('[NEXUS SESSION] Could not read saved total:', error.message);
                lastSavedReadError = error.message;
            }
        }
        const elapsed = safeSeconds(game.elapsedSeconds);
        sessions.push({
            gameId: String(gameId),
            gameName: game.gameName.slice(0, 160),
            gamePid,
            launchPid,
            sessionId: typeof game.sessionId === 'string' ? game.sessionId : '',
            status: game.paused ? 'Paused' : 'Running',
            elapsedSeconds: elapsed,
            totalSavedSeconds: saved,
            estimatedTotalSeconds: safeSeconds(saved + elapsed)
        });
    }
    return { version: 1, updatedAt: now, publisherPid: process.pid, sessions };
}

function publish(games, userDataPath, getPlaytimeInfo) {
    let stage = null;
    try {
        const dest = path.join(userDataPath, FILE_NAME);
        stage = dest + '.tmp-' + process.pid;
        const snapshot = buildSnapshot(games, getPlaytimeInfo);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(stage, JSON.stringify(snapshot), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(stage, dest);
        lastError = null;
        return true;
    } catch (error) {
        if (stage) try { fs.unlinkSync(stage); } catch { /* best effort */ }
        if (lastError !== error.message) {
            console.warn('[NEXUS SESSION] Snapshot publish failed (timer unaffected):', error.message);
            lastError = error.message;
        }
        return false;
    }
}

module.exports = { FILE_NAME, safeSeconds, buildSnapshot, publish };
