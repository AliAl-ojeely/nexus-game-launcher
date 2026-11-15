'use strict';

// Shared process-level concurrency cap: avoid parallel refreshes exhausting
// bandwidth or Electron's memory while downloading large game artwork.
function createLimiter(maxConcurrent = 3) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new TypeError('Invalid concurrency limit');
    let active = 0;
    const waiting = [];
    const drain = () => {
        while (active < maxConcurrent && waiting.length) {
            const item = waiting.shift();
            active++;
            Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
                active--;
                drain();
            });
        }
    };
    return function limited(task) {
        if (typeof task !== 'function') return Promise.reject(new TypeError('Task must be a function'));
        return new Promise((resolve, reject) => {
            waiting.push({ task, resolve, reject });
            drain();
        });
    };
}

const limitAssetDownloads = createLimiter(3);
module.exports = { createLimiter, limitAssetDownloads };
