'use strict';

// Conservative coordinator for full artwork-detail requests only.
// No filesystem writes or provider credentials; quick poster lookups stay free.
const TRANSIENT_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN']);
const TRANSIENT_STATUS = new Set([408, 429, 502, 503, 504]);

function transientReason(error) {
    const status = Number(error?.response?.status || error?.status || 0);
    if (TRANSIENT_STATUS.has(status)) return 'http_' + status;
    const rawCode = String(error?.code || error?.cause?.code || '').toUpperCase();
    if (TRANSIENT_CODES.has(rawCode)) return rawCode.toLowerCase();
    return null;
}

function safeErrorCode(error) {
    if (error?.code === 'NEXUS_QUEUE_FULL') return 'queue_full';
    return transientReason(error) || 'unexpected_failure';
}

function createCoordinator(settings = {}) {
    const delayMs = Number.isInteger(settings.afterFinishMs) && settings.afterFinishMs >= 0 && settings.afterFinishMs <= 30000
        ? settings.afterFinishMs : 2500;
    const retryDelayMs = Number.isInteger(settings.retryDelayMs) && settings.retryDelayMs >= 0 && settings.retryDelayMs <= 30000
        ? settings.retryDelayMs : 1800;
    const maxQueue = Number.isInteger(settings.maxQueue) && settings.maxQueue >= 1 && settings.maxQueue <= 512
        ? settings.maxQueue : 96;
    const sleep = typeof settings.sleep === 'function' ? settings.sleep : ms => new Promise(resolve => setTimeout(resolve, ms));
    const emit = typeof settings.onDiagnostic === 'function' ? settings.onDiagnostic : () => {};
    const now = typeof settings.now === 'function' ? settings.now : () => Date.now();
    const pending = new Map();
    const jobs = [];
    let active = false;
    let nextAllowedAt = 0;
    let completed = 0;
    let retried = 0;
    let rejected = 0;

    function status() {
        return Object.freeze({ active, queued: jobs.length, pending: pending.size, completed, retried, rejected,
            afterFinishMs: delayMs, maxQueue });
    }

    async function run() {
        if (active) return;
        active = true;
        try {
            while (jobs.length) {
                const job = jobs.shift();
                const waitMs = Math.max(0, nextAllowedAt - now());
                if (waitMs) await sleep(waitMs);
                try {
                    let output;
                    for (let attempt = 0; attempt < 2; attempt++) {
                        try {
                            output = await job.operation();
                            break;
                        } catch (error) {
                            const transient = transientReason(error);
                            if (attempt === 0 && transient) {
                                retried++;
                                emit({ type: 'retry', reason: transient, attempt: 2 });
                                await sleep(retryDelayMs);
                                continue;
                            }
                            throw error;
                        }
                    }
                    completed++;
                    job.resolve(output);
                } catch (error) {
                    rejected++;
                    emit({ type: 'failed', reason: safeErrorCode(error) });
                    job.reject(error);
                } finally {
                    pending.delete(job.key);
                }
                // Even a failed request gets a cooldown, including future jobs.
                nextAllowedAt = now() + delayMs;
            }
        } finally {
            active = false;
        }
    }

    function schedule(key, operation) {
        if (typeof key !== 'string' || !key.trim() || key.length > 256 || typeof operation !== 'function') {
            return Promise.reject(Object.assign(new Error('Invalid artwork request'), { code: 'NEXUS_BAD_REQUEST' }));
        }
        const normalized = key.normalize('NFKC').trim().toLowerCase();
        if (pending.has(normalized)) return pending.get(normalized);
        if (jobs.length >= maxQueue) {
            rejected++;
            emit({ type: 'rejected', reason: 'queue_full' });
            return Promise.reject(Object.assign(new Error('Artwork request queue at capacity'), { code: 'NEXUS_QUEUE_FULL' }));
        }
        const promise = new Promise((resolve, reject) => jobs.push({ key: normalized, operation, resolve, reject }));
        pending.set(normalized, promise);
        void run();
        return promise;
    }

    return Object.freeze({ schedule, status });
}

module.exports = { createCoordinator, transientReason, safeErrorCode };
