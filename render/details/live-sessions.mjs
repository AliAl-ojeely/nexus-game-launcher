'use strict';
// Renderer-only, per-game session projection. The main-process game launcher
// remains the sole authority for processes, elapsed time and session identity.
export function gameKey(gameId) {
    return (typeof gameId === 'string' && gameId.length && gameId.length <= 128) ||
        (typeof gameId === 'number' && Number.isSafeInteger(gameId))
        ? String(gameId) : null;
}
function seconds(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function validSessionId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
export class LiveGameSessions {
    constructor() {
        this.records = new Map();
        this.finalized = new Set();
    }
    get(gameId) {
        const key = gameKey(gameId);
        return key === null ? null : this.records.get(key) || null;
    }
    launch(gameId) {
        const key = gameKey(gameId);
        if (key === null || this.records.has(key)) return false;
        this.records.set(key, { gameId, phase: 'launching', sessionId: null,
            elapsed: 0, paused: false });
        return true;
    }
    started(data) {
        const key = gameKey(data?.gameId);
        if (key === null || !validSessionId(data?.sessionId)) return false;
        const token = key + '\0' + data.sessionId;
        if (this.finalized.has(token)) return false;
        const existing = this.records.get(key);
        // A duplicate STARTED event for one session must not erase a more
        // recent tick or a pause confirmation.
        if (existing && existing.sessionId === data.sessionId) {
            existing.elapsed = Math.max(existing.elapsed, seconds(data.elapsed));
            if (data.stopping === true) existing.phase = 'stopping';
            return true;
        }
        this.records.set(key, { gameId: data.gameId, phase: data.stopping ? 'stopping' : 'running',
            sessionId: data.sessionId, elapsed: seconds(data.elapsed), paused: data.paused === true });
        return true;
    }
    tick(data) {
        const current = this.get(data?.gameId);
        if (!current || !validSessionId(data?.sessionId) || current.sessionId !== data.sessionId ||
            current.phase === 'stopping') return false;
        const elapsed = seconds(data.elapsed);
        current.elapsed = Math.max(current.elapsed, elapsed);
        return true;
    }
    timerState(data) {
        const current = this.get(data?.gameId);
        if (!current || current.sessionId !== data?.sessionId ||
            (current.phase !== 'running' && current.phase !== 'stopping') ||
            typeof data?.paused !== 'boolean') return false;
        current.paused = data.paused;
        if (Number.isSafeInteger(data.elapsed) && data.elapsed >= 0) current.elapsed = Math.max(current.elapsed, data.elapsed);
        return true;
    }
    stop(data) {
        const key = gameKey(data?.gameId);
        if (key === null || !validSessionId(data?.sessionId)) return null;
        const current = this.records.get(key);
        // The main process can stop a game before a reloaded renderer sees
        // its STARTED/snapshot event. Finalize that authoritative STOP too.
        if (current && current.sessionId !== data.sessionId) return null;
        const token = key + '\0' + data.sessionId;
        if (this.finalized.has(token)) return null;
        this.finalized.add(token);
        // Limit the dedupe history without weakening live-session isolation.
        if (this.finalized.size > 512) this.finalized.delete(this.finalized.values().next().value);
        this.records.delete(key);
        return { ...(current || { gameId: data.gameId, sessionId: data.sessionId }), elapsed: seconds(data.elapsed) };
    }
    failed(data) {
        const key = gameKey(data?.gameId);
        if (key === null) return false;
        const current = this.records.get(key);
        // Never clear a confirmed live game because an earlier launch failed.
        if (!current || current.phase !== 'launching') return false;
        this.records.delete(key);
        return true;
    }
    reconcile(rows) {
        if (!Array.isArray(rows)) return 0;
        let recovered = 0;
        for (const row of rows) {
            const key = gameKey(row?.gameId);
            if (key === null || !validSessionId(row.sessionId)) continue;
            const existing = this.records.get(key);
            if (!existing) {
                if (this.started(row)) recovered++;
            } else if (existing.sessionId === row.sessionId) {
                // A late response to an earlier snapshot must never rewind
                // the visible timer or reset an already-updated pause state.
                existing.elapsed = Math.max(existing.elapsed, seconds(row.elapsed));
            }
        }
        return recovered;
    }
}
export const liveSessions = new LiveGameSessions();
