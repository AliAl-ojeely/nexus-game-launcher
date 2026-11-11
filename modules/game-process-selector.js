'use strict';
// Pure path/PID rules, independently testable without Electron or Windows.
const path = require('node:path').win32;
const HELPERS = /(?:^|[-_. ])(?:unitycrashhandler(?:64)?|crashreport(?:client|er)?|crashhandler|crashpad_handler|unins\d*|updater|uninstaller|reporter|errorreport)(?:[-_. ]|\.exe$)/i;
const WRAPPERS = /(?:launcher|bootstrap|starter|hypervisorlauncher|startgame)\.exe$/i;

function normalized(file) {
    return path.normalize(String(file || '').replace(/\//g, '\\')).toLowerCase();
}
function inside(file, folder) {
    const value = normalized(file);
    const root = normalized(folder).replace(/\\+$/, '') + '\\';
    return value.startsWith(root);
}
function helper(file) {
    const name = path.basename(String(file || ''));
    return !name.toLowerCase().endsWith('.exe') || HELPERS.test(name);
}
function processForPid(processes, pid) {
    return processes.find(p => p.pid === pid && p.path && !helper(p.path));
}
function selectGameProcess(processes, rootPid, launchPath, knownPid, knownPath) {
    const root = processForPid(processes, rootPid);
    const launched = normalized(launchPath);
    const dir = path.dirname(launchPath);
    // Never replace a still-running direct game with arbitrary siblings like UnityCrashHandler.
    if (root && normalized(root.path) === launched && !WRAPPERS.test(path.basename(launchPath))) {
        return { pid: root.pid, path: root.path, reason: 'direct-executable' };
    }
    const established = processForPid(processes, knownPid);
    if (established && established.pid !== rootPid && normalized(established.path) === normalized(knownPath) &&
        inside(established.path, dir)) {
        return { pid: established.pid, path: established.path, reason: 'established-child' };
    }
    // Same EXE restarted by a bootstrapper is stronger evidence than a random sibling.
    const sameExe = processes.filter(p => p.pid !== rootPid && !helper(p.path) &&
        normalized(p.path) === launched);
    if (sameExe.length === 1) {
        return { pid: sameExe[0].pid, path: sameExe[0].path, reason: 'exact-executable' };
    }
    // A real child must have the launching process as a parent. Folder membership alone
    // is not enough evidence (UnityCrashHandler is often in that same folder).
    const children = processes.filter(p => p.pid !== rootPid && p.ppid === rootPid &&
        inside(p.path, dir) && !helper(p.path));
    if (children.length === 1) {
        return { pid: children[0].pid, path: children[0].path, reason: 'verified-launcher-child' };
    }
    if (root && normalized(root.path) === launched) {
        return { pid: root.pid, path: root.path, reason: 'launcher-still-running' };
    }
    return null;
}
/**
 * Exit confirmation only advances when a COMPLETE and successful process
 * snapshot fails to find a verified game process. A failed probe resets the
 * streak. The last successful observation is the best available end time.
 */
function createMonitorHealth(maxMissing = 7) {
    if (!Number.isInteger(maxMissing) || maxMissing < 1) throw new RangeError('maxMissing must be positive');
    let missingCount = 0;
    let lastSeen = null;
    return {
        found(selected, elapsedSeconds, wallTime) {
            const recoveredAfter = missingCount;
            missingCount = 0;
            lastSeen = {
                pid: selected.pid,
                path: selected.path,
                elapsed: Math.max(0, Math.floor(elapsedSeconds)),
                endTime: wallTime
            };
            return { recoveredAfter, lastSeen: { ...lastSeen } };
        },
        missing() {
            missingCount++;
            return {
                missingCount,
                shouldStop: missingCount >= maxMissing,
                lastSeen: lastSeen ? { ...lastSeen } : null
            };
        },
        unavailable() {
            const previousMissing = missingCount;
            missingCount = 0;
            return { previousMissing };
        }
    };
}

module.exports = { normalized, inside, helper, selectGameProcess, createMonitorHealth };
