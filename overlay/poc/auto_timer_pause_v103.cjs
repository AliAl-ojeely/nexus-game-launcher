'use strict';
/**
 * Session-scoped, fail-closed automatic timer pause. This never controls the
 * game process; it requests only the Nexus-managed timer through the existing
 * authenticated session-action pipe.
 */
class AutoTimerPause {
    constructor(send, log = () => {}) {
        if (typeof send !== 'function') throw new TypeError('send must be a function');
        this.send = send;
        this.log = log;
        this.visible = false;
        this.enabled = false;
        this.session = null;
        this.openNumber = 0;
        this.attempted = null;
        this.ownedSession = null;
        this.seenPaused = false;
        this.pending = Promise.resolve();
    }
    update({ visible = false, enabled = false, session = null } = {}) {
        const nextVisible = visible === true;
        if (nextVisible && !this.visible) this.openNumber += 1;
        this.visible = nextVisible;
        this.enabled = enabled === true;
        this.session = session && typeof session === 'object' ? { ...session } : null;
        return this._enqueue();
    }
    _eligible(s) {
        return s && s.connected === true && s.canControlTimer === true &&
            typeof s.sessionId === 'string' && s.sessionId.length > 0 && s.sessionId.length <= 128;
    }
    _enqueue() {
        this.pending = this.pending.catch(() => {}).then(() => this._reconcile());
        return this.pending;
    }
    async _reconcile() {
        const s = this.session;
        if (!this._eligible(s)) {
            // Never send a timer request for a stale or disconnected session.
            this.ownedSession = null;
            this.seenPaused = false;
            return;
        }
        if (this.ownedSession && this.ownedSession !== s.sessionId) {
            this.ownedSession = null;
            this.seenPaused = false;
        }
        if (this.ownedSession === s.sessionId && this.visible && this.enabled) {
            if (s.status === 'Paused') this.seenPaused = true;
            else if (s.status === 'Running' && this.seenPaused) {
                // An external/manual resume occurred after observing our pause.
                this.ownedSession = null;
                this.seenPaused = false;
            }
            return;
        }
        if (!this.visible || !this.enabled) {
            if (this.ownedSession === s.sessionId) {
                this.ownedSession = null; // Exactly one best-effort resume.
                this.seenPaused = false;
                try {
                    const result = await this.send(false, 'auto-hide');
                    if (result && result.ok && result.paused === false)
                        this.log('AUTO_TIMER_RESUMED');
                    else this.log('AUTO_TIMER_RESUME_UNCONFIRMED');
                } catch (_) {
                    this.log('AUTO_TIMER_RESUME_FAILED');
                }
            }
            return;
        }
        if (s.status !== 'Running') return; // Already paused by the player.
        const attempt = this.openNumber + ':' + s.sessionId;
        if (this.attempted === attempt) return;
        this.attempted = attempt;
        try {
            const result = await this.send(true, 'auto-show');
            if (result && result.ok && result.paused === true &&
                    this._eligible(this.session) && this.session.sessionId === s.sessionId) {
                this.ownedSession = s.sessionId;
                this.seenPaused = false;
                this.log('AUTO_TIMER_PAUSED');
                // Handles a hide/config change while the pause request was in flight.
                void this._enqueue();
            } else this.log('AUTO_TIMER_PAUSE_UNCONFIRMED');
        } catch (_) {
            this.log('AUTO_TIMER_PAUSE_FAILED');
        }
    }
    async manual(paused) {
        // A manual click takes precedence over automatic ownership, even if an
        // automatic pause is still in flight. Do not re-pause during this opening.
        this.attempted = this.openNumber + ':' + (this.session?.sessionId || '');
        await this.pending.catch(() => {});
        this.ownedSession = null;
        this.seenPaused = false;
        return this.send(paused === true, 'manual');
    }
    idle() { return this.pending; }
}
module.exports = { AutoTimerPause };
