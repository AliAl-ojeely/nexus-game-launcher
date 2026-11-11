'use strict';
// Pure snapshot validation. Invalid, stale, or mismatched data must NEVER become game time.
const MAX_AGE_MS = 8000;
const MAX_FUTURE_MS = 1000;
function validSeconds(value) {
    return Number.isSafeInteger(value) && value >= 0 && value <= 999999999;
}
function selectSession(snapshot, expectedGameId, expectedPid, now = Date.now()) {
    const unavailable = { connected: false, status: 'Unavailable' };
    if ((typeof expectedGameId !== 'string' && typeof expectedGameId !== 'number') ||
        !Number.isSafeInteger(expectedPid) || expectedPid <= 0 ||
        !snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.sessions) ||
        !Number.isSafeInteger(snapshot.updatedAt) ||
        now - snapshot.updatedAt > MAX_AGE_MS || snapshot.updatedAt - now > MAX_FUTURE_MS) return unavailable;
    const session = snapshot.sessions.find(item => item &&
        String(item.gameId) === String(expectedGameId) &&
        (item.gamePid === expectedPid || item.launchPid === expectedPid) &&
        typeof item.gameName === 'string' && item.gameName.trim() &&
        (item.status === 'Running' || item.status === 'Paused') &&
        validSeconds(item.elapsedSeconds) && validSeconds(item.totalSavedSeconds));
    if (!session) return unavailable;
    const elapsedSeconds = session.elapsedSeconds;
    const totalSavedSeconds = session.totalSavedSeconds;
    return {
        connected: true,
        gameName: session.gameName.slice(0, 160),
        sessionId: typeof session.sessionId === 'string' ? session.sessionId : '',
        status: session.status,
        elapsedSeconds,
        totalSavedSeconds,
        estimatedTotalSeconds: Math.min(999999999, elapsedSeconds + totalSavedSeconds),
    };
}
module.exports = { MAX_AGE_MS, selectSession };
