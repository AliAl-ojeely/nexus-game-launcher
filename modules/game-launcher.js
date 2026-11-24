const { spawn, exec, execFile } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app } = require('electron');
const { net } = require('electron');
const { pathToFileURL } = require('url');
const processSelector = require('./game-process-selector');
const { describeLaunchError } = require('./game-launch-diagnostics');

const gameMonitors = new Map();  // gameId → setInterval (process polling)
const gameTimers = new Map();    // gameId → setInterval (playtime tick)
const runningGames = new Map();  // gameId → { pid, exeName, gameName, installPath, proc, startTime, pauseOffset, pauseStartTime, event, sessionIndex }
const backups = require('./backup');
const { readSettings } = require('./app-settings');
const sessions = require('./playSessions');  // 🆕 SESSION LOGGING
const overlaySessionFeed = require('./overlay-session-feed');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

// Read-only authority for renderer recovery and game-by-game selection.
// No process handles or mutable objects cross the IPC boundary.
function getRunningSessions() {
    return [...runningGames].map(([gameId, game]) => ({
        gameId, sessionId: game.sessionId,
        elapsed: getElapsedSeconds(gameId), paused: game.pauseReasons.size > 0,
        stopping: !!game.stopping,
    }));
}

function getElapsedSeconds(gameId) {
    const game = runningGames.get(gameId);
    if (!game) return 0;
    if (game.startHrtime !== undefined) {
        const now = process.hrtime.bigint();
        const pause = game.pauseStartedHrtime === null ? 0n : now - game.pauseStartedHrtime;
        const active = now - game.startHrtime - game.pausedNanoseconds - pause;
        return Math.max(0, Number(active > 0n ? active / 1000000000n : 0n));
    }
    return Math.max(0, Math.floor((Date.now() - game.startTime) / 1000));
}

function publishOverlaySessions() {
    // One small, local, sanitized snapshot per tick. The overlay never touches the DB.
    const active = [];
    for (const [gameId, game] of runningGames) {
        if (game.stopping) continue;
        active.push({
            gameId,
            gameName: game.gameName,
            activePid: game.activePid,
            launchPid: game.launchPid,
            sessionId: game.sessionId,
            elapsedSeconds: getElapsedSeconds(gameId),
            paused: game.pauseReasons.size > 0,
            stopping: game.stopping
        });
    }
    // This dependency is read lazily so monitoring unit tests do not need an Electron runtime.
    let readSavedTime = () => ({ minutes: 0, seconds: 0 });
    try { readSavedTime = require('./playtime').getPlaytimeInfo; }
    catch (error) {
        if (!publishOverlaySessions.loggedPlaytimeError) {
            console.warn('[NEXUS SESSION] Saved time reader unavailable:', error.message);
            publishOverlaySessions.loggedPlaytimeError = true;
        }
    }
    overlaySessionFeed.publish(active, app.getPath('userData'), readSavedTime);
}

function setPauseReason(gameId, reason, paused) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping) return false;
    if (game.pauseReasons.has(reason) === paused) return false;
    if (paused) game.pauseReasons.add(reason);
    else game.pauseReasons.delete(reason);
    const now = process.hrtime.bigint();
    if (game.pauseReasons.size && game.pauseStartedHrtime === null) {
        game.pauseStartedHrtime = now;
    } else if (!game.pauseReasons.size && game.pauseStartedHrtime !== null) {
        game.pausedNanoseconds += now - game.pauseStartedHrtime;
        game.pauseStartedHrtime = null;
    }
    publishOverlaySessions();
    if (game.event && !game.event.sender.isDestroyed()) {
        game.event.sender.send('game:timer-state', {
            gameId, sessionId: game.sessionId, paused: game.pauseReasons.size > 0, elapsed: getElapsedSeconds(gameId)
        });
    }
    return true;
}

function stopTimer(gameId) {
    const interval = gameTimers.get(gameId);
    if (interval) {
        clearInterval(interval);
        gameTimers.delete(gameId);
    }
}

async function stopMonitor(gameId, verifiedExit = null) {
    const game = runningGames.get(gameId);
    if (!game) {
        console.error('[BACKEND] stopMonitor: game not found');
        return;
    }

    if (game.stopping) return;
    game.stopping = true;
    game.cancelExitMonitor?.();
    game.fastStop = null;
    const monitor = gameMonitors.get(gameId);
    if (monitor) {
        clearInterval(monitor);
        gameMonitors.delete(gameId);
    }
    stopTimer(gameId);
    if (process.platform === 'win32') {
        try { require('./overlay-manager').stop(gameId); }
        catch (error) { console.warn('[NEXUS OVERLAY] Stop error:', error.message); }
    }
    publishOverlaySessions(); // Immediately remove an ended game, even while backup runs.

    // Do not add the 14-second exit-confirmation delay to recorded playtime.
    const elapsed = verifiedExit && Number.isFinite(verifiedExit.elapsed)
        ? verifiedExit.elapsed : getElapsedSeconds(gameId);
    const endTime = verifiedExit && Number.isFinite(verifiedExit.endTime)
        ? verifiedExit.endTime : Date.now();

    if (game.sessionIndex !== undefined) {
        try {
            const recorded = sessions.endSession(game.sessionIndex, endTime, elapsed, game.sessionId);
            if (recorded) console.log(`[BACKEND] Session recorded for "${game.gameName}": ${elapsed}s`);
            else console.warn(`[BACKEND] Session not finalized for "${game.gameName}" (record missing/already closed).`);
        } catch (error) {
            // A disk/JSON error must not leave the game stuck as running.
            console.error(`[BACKEND] Could not save session for "${game.gameName}":`, error);
        }
    }

    // Compare after verified game exit; never block session finalization or automatic backup.
    try {
        void require('./backup-discovery-engine-v070').noteGameStopped({
            gameId, name: game.gameName, sessionId: game.sessionId
        }).then(result => {
            if (result && game.event && !game.event.sender.isDestroyed())
                game.event.sender.send('backup:observation-updated', { gameId });
        }).catch(error => console.warn('[NEXUS SAVE OBSERVER] Comparison failed:', error.message));
    } catch (error) { console.warn('[NEXUS SAVE OBSERVER] Exit hook unavailable:', error.message); }

    const settings = readSettings();
    const autoBackup = settings.autoBackup !== undefined ? settings.autoBackup : true;

    if (autoBackup && game.gameName) {
        console.log(`[BACKEND] 📂 Starting backup for: "${game.gameName}"`);
        try {
            await backups.performMirroring(game.gameName, game.installPath || null);
        } catch (err) {
            console.error('[BACKEND] Backup error:', err);
        }
    } else if (!autoBackup && game.gameName) {
        console.log(`[BACKEND] ⏭️ Auto backup disabled for: "${game.gameName}"`);
    }

    if (runningGames.get(gameId) === game) runningGames.delete(gameId);

    if (game.event && !game.event.sender.isDestroyed()) {
        game.event.sender.send('game:stopped', { gameId, sessionId: game.sessionId, elapsed });
        console.log(`[BACKEND] ✅ game:stopped sent → gameId: ${gameId}, elapsed: ${elapsed}s`);
    }
}

function startTimer(gameId) {
    if (gameTimers.has(gameId)) return;

    const interval = setInterval(() => {
        const game = runningGames.get(gameId);
        if (!game) {
            stopTimer(gameId);
            return;
        }
        const elapsed = getElapsedSeconds(gameId);
        publishOverlaySessions();
        if (!game.event.sender.isDestroyed()) {
            game.event.sender.send('game:tick', { gameId, sessionId: game.sessionId, elapsed });
        }
    }, 1000);

    gameTimers.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSS‑PLATFORM PROCESS LISTING (Optimized - No PowerShell)
// ─────────────────────────────────────────────────────────────────────────────
// Resolve the SAME executable for polling and adaptive guard eligibility.
// Packaged native binaries must live outside the Electron ASAR archive.
function resolveNativeProcessProbe() {
    if (process.platform !== 'win32') return null;
    if (app.isPackaged && (process.arch !== 'x64' || !process.resourcesPath)) return null;
    const root = app.isPackaged ? path.join(process.resourcesPath, 'overlay-runtime') : path.join(__dirname, '..');
    const probe = path.join(root, 'native', 'nexus-overlay', 'build', 'bin', 'NexusProcessProbe.exe');
    return fs.existsSync(probe) ? probe : null;
}
let lastProcessProbeSource = null;
function getProcesses(callback) {
    if (process.platform === 'win32') {
        const probe = resolveNativeProcessProbe();
        const source = probe ? 'native' : 'powershell';
        if (source !== lastProcessProbeSource) {
            lastProcessProbeSource = source;
            console.log(`[NEXUS EXIT] PROCESS_PROBE source=${source} runtime=${app.isPackaged ? 'packaged' : 'development'}`);
        }
        const deliver = (err, output) => {
            try {
                if (err) throw err;
                const json = JSON.parse(output);
                if (!Array.isArray(json) || json.length === 0) throw new Error('Empty process snapshot');
                const valid = json.filter(p => Number.isInteger(Number(p.pid)) && typeof p.path === 'string' && p.path);
                // Treat an unusable/empty snapshot as a probe error, never as
                // evidence that all running games disappeared.
                if (!valid.length) throw new Error('Process snapshot contained no usable executable paths');
                callback(valid.map(p => ({ pid: Number(p.pid), ppid: Number(p.ppid) || 0, path: p.path })));
            } catch (error) { callback(null, error); }
        };
        if (probe) {
            execFile(probe, [], { windowsHide: true, timeout: 12000, maxBuffer: 12 * 1024 * 1024 }, deliver);
        } else {
            // Slow compatibility path when the native probe hasn't been built.
            const script = 'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath } | ' +
                'Select-Object @{N="pid";E={$_.ProcessId}},@{N="ppid";E={$_.ParentProcessId}},' +
                '@{N="path";E={$_.ExecutablePath}} | ConvertTo-Json -Compress';
            execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
                { windowsHide: true, timeout: 25000, maxBuffer: 12 * 1024 * 1024 }, (err, output) => {
                    if (!err) {
                        try {
                            const parsed = JSON.parse(output);
                            deliver(null, JSON.stringify(Array.isArray(parsed) ? parsed : [parsed]));
                            return;
                        } catch (error) { err = error; }
                    }
                    deliver(err || new Error('Process probe unavailable'), output);
                });
        }
        return;
    }
    exec('ps -eo pid=,ppid=,args=', { maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) return callback(null, err || new Error('ps failed'));
        const found = [];
        for (const line of stdout.split('\n')) {
            const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
            if (match) found.push({ pid: Number(match[1]), ppid: Number(match[2]), path: match[3].split(' ')[0] });
        }
        callback(found.length ? found : null);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMART MONITOR (Optimized with Grace Period)
// ─────────────────────────────────────────────────────────────────────────────
// NEXUS_SMART_EXIT_V100: explicit Stop and uncertain restart are different.
// Monotonic time prevents wall-clock adjustments from shortening the guard.
const EXIT_POLL_MS = 2000;
const RESTART_GUARD_MS = 12000;
// NEXUS_ADAPTIVE_RESTART_GUARD_V101. A clean exit is evidence of the
// original process ending, NOT proof that no delayed relaunch will happen.
const BALANCED_GUARD_MS = 4000;
const BALANCED_MIN_MISSES = 3;
const restartObserved = new Set(); // per game ID + executable, this app lifetime only
function restartProfileKey(gameId, launchPath) {
    return JSON.stringify([String(gameId), processSelector.normalized(launchPath)]);
}
function conservativeRestartRequested(gameId) {
    const entries = String(process.env?.NEXUS_RESTART_GUARD_GAME_IDS || '')
        .split(',').map(value => value.trim());
    return entries.includes('*') || entries.includes(String(gameId));
}
const FAST_CONFIRM_MS = 450;
const FAST_WINDOW_MS = 4500;
function exitClockMs() { return Number(process.hrtime.bigint() / 1000000n); }

function startSmartMonitor(gameDir, launcherPid, exeName, gameId) {
    const game = runningGames.get(gameId);
    if (!game) return;
    let busy = false, urgent = false, wakeTimer = null;
    let probeFailures = 0, missingSince = null;
    let verifiedDirect = false, previouslyVerified = false;
    let extendedForExit = false, processedNaturalExit = null;
    const profile = restartProfileKey(gameId, game.installPath);
    const useBalanced = () => nativeProbe && verifiedDirect && !!game.cleanNaturalExit &&
        game.cleanNaturalExit.pid === game.activePid && !game.stopRequestPending &&
        !game.stopAttempted && !game.fastStop && !extendedForExit &&
        !restartObserved.has(profile) && !conservativeRestartRequested(gameId);
    function extendGuard(reason) {
        if (!extendedForExit) {
            extendedForExit = true;
            console.log(`[NEXUS EXIT] BALANCED_FALLBACK gameId=${gameId} reason=${reason}`);
        }
    }
    const MAX_MISSING = 7;
    const health = processSelector.createMonitorHealth(MAX_MISSING);
    const nativeProbe = !!resolveNativeProcessProbe();
    const isCurrent = () => runningGames.get(gameId) === game && !game.stopping;
    function cancelWake() {
        if (wakeTimer !== null) clearTimeout(wakeTimer);
        wakeTimer = null;
        urgent = false;
    }
    function wake(delay = 0) {
        if (!isCurrent()) return;
        if (busy) { if (delay === 0) urgent = true; return; }
        if (wakeTimer !== null) {
            if (delay > 0) return;
            clearTimeout(wakeTimer);
        }
        wakeTimer = setTimeout(() => { wakeTimer = null; poll(); }, delay);
    }
    game.wakeExitMonitor = () => wake(0);
    game.cancelExitMonitor = cancelWake;
    function poll() {
        if (!isCurrent() || busy) return;
        cancelWake();
        busy = true;
        // A probe launched before taskkill completed is NOT fresh evidence.
        const ackAtStart = game.fastStop;
        const naturalExitAtStart = game.cleanNaturalExit;
        let retrySoon = false, balancedWake = null;
        getProcesses((processes, error) => {
            try {
                if (!isCurrent()) return;
                if ((game.fastStop && game.fastStop !== ackAtStart) ||
                    game.cleanNaturalExit !== naturalExitAtStart) {
                    urgent = true;
                    return;
                }
                if (naturalExitAtStart && processedNaturalExit !== naturalExitAtStart) {
                    if (missingSince !== null || probeFailures > 0) extendGuard('uncertain-before-exit');
                    health.unavailable();
                    missingSince = null;
                    processedNaturalExit = naturalExitAtStart;
                }
                const now = exitClockMs();
                let fast = game.fastStop;
                if (fast && (now - fast.acknowledgedAt > FAST_WINDOW_MS ||
                    game.activePid !== fast.pid ||
                    processSelector.normalized(game.activePath) !== fast.path)) {
                    game.fastStop = fast = null;
                    console.log(`[NEXUS EXIT] FAST_FALLBACK gameId=${gameId}`);
                }
                if (!processes) {
                    const { previousMissing } = health.unavailable();
                    missingSince = null;
                    if (game.cleanNaturalExit) extendGuard('probe-failed');
                    // A failed snapshot proves nothing. Fall back to full guard.
                    if (fast) {
                        game.fastStop = null;
                        console.log(`[NEXUS EXIT] FAST_FALLBACK probe-failed gameId=${gameId}`);
                    }
                    probeFailures++;
                    if (probeFailures === 1 || probeFailures % 10 === 0 || previousMissing) {
                        console.warn(`[BACKEND] Process probe failed (${probeFailures}); exit confirmation reset:`,
                            error?.message || 'empty snapshot');
                    }
                    return;
                }
                if (probeFailures) {
                    console.log(`[BACKEND] Process probe recovered after ${probeFailures} failed snapshots.`);
                    probeFailures = 0;
                }
                const selected = processSelector.selectGameProcess(
                    processes, game.launchPid, game.installPath, game.activePid, game.activePath
                );
                if (selected) {
                    missingSince = null;
                    const { recoveredAfter } = health.found(selected, getElapsedSeconds(gameId), Date.now());
                    const pidChanged = game.activePid !== selected.pid ||
                        processSelector.normalized(game.activePath) !== processSelector.normalized(selected.path);
                    if (previouslyVerified && pidChanged) {
                        restartObserved.add(profile);
                        console.log(`[NEXUS EXIT] RESTART_PROFILE_EXTENDED gameId=${gameId}`);
                    }
                    // A successful post-exit snapshot is never treated as an
                    // absence. If the process was replaced (or appears again
                    // with the same PID), use the extended policy thereafter.
                    if (game.cleanNaturalExit) {
                        extendGuard('process-returned');
                        if (pidChanged) restartObserved.add(profile);
                        game.cleanNaturalExit = null;
                    }
                    previouslyVerified = true;
                    verifiedDirect = selected.reason === 'direct-executable' &&
                        selected.pid === game.launchPid &&
                        processSelector.normalized(selected.path) === processSelector.normalized(game.installPath);
                    if (fast) {
                        if (selected.pid !== fast.pid || processSelector.normalized(selected.path) !== fast.path) {
                            game.fastStop = null;
                            console.log(`[NEXUS EXIT] FAST_FALLBACK replacement gameId=${gameId}`);
                        } else {
                            fast.firstMissingAt = null;
                        }
                    }
                    if (recoveredAfter) {
                        const recoveredLabel = game.activePid === selected.pid ? 'PROCESS_RECOVERED' : 'RESTART_RECOVERED';
                        console.log(`[NEXUS EXIT] ${recoveredLabel} gameId=${gameId} pid=${selected.pid} sessionId=${game.sessionId}`);
                    }
                    if (game.activePid !== selected.pid ||
                        processSelector.normalized(game.activePath) !== processSelector.normalized(selected.path)) {
                        game.activePid = selected.pid;
                        game.activePath = selected.path;
                        game.pid = selected.pid; // forceStopGame uses the verified active PID.
                        console.log(`[BACKEND] Verified game PID ${selected.pid} (${selected.reason})`);
                        publishOverlaySessions();
                    }
                    // Preserve the existing per-game overlay attachment contract.
                    if (process.platform === 'win32') {
                        try { require('./overlay-manager').attach({
                            gameId, gameName: game.gameName, sessionId: game.sessionId,
                            activePid: game.activePid, activePath: game.activePath,
                            installPath: game.installPath, stopping: game.stopping
                        }); }
                        catch (error) { console.warn('[NEXUS OVERLAY] Start error:', error.message); }
                    }
                    return;
                }
                if (game.cleanNaturalExit && !extendedForExit) {
                    const launchPath = processSelector.normalized(game.installPath);
                    const activePath = processSelector.normalized(game.activePath);
                    const candidate = processes.some(p => p.pid === game.activePid || p.pid === game.launchPid ||
                        processSelector.normalized(p.path) === launchPath ||
                        processSelector.normalized(p.path) === activePath ||
                        ((p.ppid === game.activePid || p.ppid === game.launchPid) && !processSelector.helper(p.path)));
                    if (candidate) extendGuard('ambiguous-candidate');
                }
                if (missingSince === null) missingSince = now;
                const missing = health.missing();
                if (missing.missingCount === 1) {
                    const balanced = useBalanced();
                    console.log(`[NEXUS EXIT] RESTART_GUARD gameId=${gameId} pid=${game.activePid} mode=${balanced ? 'balanced' : 'extended'} graceMs=${balanced ? BALANCED_GUARD_MS : RESTART_GUARD_MS}`);
                    // One bounded early recheck helps a quick graphics restart.
                    retrySoon = nativeProbe;
                }
                if (fast) {
                    // A null selector can also mean multiple candidates, not
                    // absence. Do not accelerate while any relevant PID/path/
                    // child is present, even if it cannot be selected safely.
                    const launchPath = processSelector.normalized(game.installPath);
                    const candidate = processes.some(p => p.pid === fast.pid || p.pid === game.launchPid ||
                        p.ppid === fast.pid || p.ppid === game.launchPid ||
                        processSelector.normalized(p.path) === fast.path ||
                        processSelector.normalized(p.path) === launchPath);
                    if (candidate) {
                        game.fastStop = null;
                        console.log(`[NEXUS EXIT] FAST_FALLBACK ambiguous-candidate gameId=${gameId}`);
                    } else if (fast.firstMissingAt === null) {
                        fast.firstMissingAt = now;
                    } else if (now - fast.firstMissingAt >= FAST_CONFIRM_MS) {
                        const last = missing.lastSeen;
                        const verified = last && last.pid === fast.pid &&
                            processSelector.normalized(last.path) === fast.path &&
                            last.endTime >= fast.verified.endTime ? last : fast.verified;
                        console.log(`[NEXUS EXIT] FAST_CONFIRMED gameId=${gameId} pid=${fast.pid} verifyMs=${now-fast.acknowledgedAt}`);
                        void stopMonitor(gameId, verified);
                        return;
                    }
                }
                // The balanced deadline begins with the FIRST fresh missing
                // snapshot, never the exit event or a failed/in-flight probe.
                // All uncertain cases retain seven good misses and 12 seconds.
                const balanced = useBalanced();
                const guardMs = balanced ? BALANCED_GUARD_MS : RESTART_GUARD_MS;
                const enoughMisses = balanced ? missing.missingCount >= BALANCED_MIN_MISSES : missing.shouldStop;
                if (enoughMisses && now - missingSince >= guardMs) {
                    const verified = missing.lastSeen;
                    if (verified) {
                        console.log(`[BACKEND] Confirmed exit. Last seen PID ${verified.pid}, ` +
                            `played ${verified.elapsed}s; confirmation delay excluded.`);
                    } else {
                        console.warn('[BACKEND] No game process was verified after launch; recording zero-duration session.');
                    }
                    console.log(`[NEXUS EXIT] GUARD_CONFIRMED gameId=${gameId} verifyMs=${now-missingSince} mode=${balanced ? 'balanced' : 'extended'}`);
                    void stopMonitor(gameId, verified || { elapsed: 0, endTime: Date.now() });
                } else if (balanced) {
                    // Recheck at the actual deadline, not up to two seconds
                    // later. Only one bounded per-game timeout is kept alive.
                    balancedWake = Math.max(enoughMisses ? 1 : FAST_CONFIRM_MS, guardMs - (now - missingSince));
                }
            } finally {
                busy = false;
                if (isCurrent()) {
                    if (urgent) { urgent = false; wake(0); }
                    else if (game.fastStop || retrySoon) wake(FAST_CONFIRM_MS);
                    else if (balancedWake !== null) wake(balancedWake);
                }
            }
        });
    }
    console.log(`[BACKEND] Monitoring verified game process: ${exeName}`);
    const interval = setInterval(poll, EXIT_POLL_MS);
    gameMonitors.set(gameId, interval);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH GAME (with session creation)
// ─────────────────────────────────────────────────────────────────────────────
function launchGame(event, gamePath, showFPS, launchArgs, gameId, gameName) {
    // A second click or a stale details view must never replace a live
    // process monitor, timer, or overlay session for this same game ID.
    const existing = runningGames.get(gameId);
    if (existing) {
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:started', { gameId, sessionId: existing.sessionId,
                elapsed: getElapsedSeconds(gameId), paused: existing.pauseReasons.size > 0,
                stopping: !!existing.stopping });
        }
        return;
    }
    if (!gamePath) {
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { gameId, message: 'No game executable path provided.' });
        }
        return;
    }

    if (!fs.existsSync(gamePath)) {
        const errorMsg = `Game executable not found.\nPath: ${gamePath}\nPlease update the game path in the edit modal.`;
        console.error('[BACKEND] Launch error:', errorMsg);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { gameId, message: errorMsg });
        }
        return;
    }

    const isLinux = process.platform === 'linux';
    const isExe = gamePath.toLowerCase().endsWith('.exe');
    const gameDir = path.dirname(gamePath);
    const exeName = path.basename(gamePath);
    const argsArray = launchArgs ? launchArgs.split(' ').filter(a => a.trim()) : [];

    try {
        console.log(`[BACKEND] Launching: ${exeName} (game: "${gameName}")`);

        let proc;

        if (isLinux && isExe) {
            const protonVersion = 'GE-Proton10-32';
            const userHome = os.homedir();
            const protonPath = path.join(userHome, 'Nexus-Proton', protonVersion, 'proton');
            const compatDataPath = path.join(app.getPath('userData'), 'nexus_proton_prefix');
            if (!fs.existsSync(compatDataPath)) fs.mkdirSync(compatDataPath, { recursive: true });
            const env = Object.assign({}, process.env, {
                STEAM_COMPAT_DATA_PATH: compatDataPath,
                DXVK_HUD: showFPS ? 'compiler,fps' : '0'
            });
            proc = spawn(protonPath, ['run', gamePath, ...argsArray], { cwd: gameDir, env, detached: true, stdio: 'ignore' });
        } else {
            const lower = gamePath.toLowerCase();
            const isBatOrLnk = lower.endsWith('.bat') || lower.endsWith('.lnk');
            proc = spawn(gamePath, argsArray, { cwd: gameDir, detached: true, shell: isBatOrLnk, stdio: 'ignore' });
        }

        // A failed CreateProcess can return a ChildProcess with no PID. Node
        // emits 'error' asynchronously. Do not create a session or generate a
        // second, misleading "invalid PID" toast while waiting for it.
        let launchErrorReported = false;
        function reportLaunchFailure(error) {
            if (launchErrorReported) return;
            launchErrorReported = true;
            console.error('[BACKEND] Spawn error:', error);
            const diagnostic = describeLaunchError(error, gamePath, gameName);
            if (!event.sender.isDestroyed()) {
                event.sender.send('game:error', { ...diagnostic, gameId });
            }
        }
        proc.on('spawn', () => console.log(`[BACKEND] PID: ${proc.pid}`));
        proc.on('exit', (code, signal) => {
            console.log(`[BACKEND] Spawned process PID ${proc.pid} exited (code=${code}, signal=${signal}); monitor will verify the game process.`);
            const tracked = runningGames.get(gameId);
            if (tracked && tracked.proc === proc && tracked.activePid === proc.pid && !tracked.stopping) {
                // The original child's clean exit can enable the bounded
                // balanced policy, but only after verified direct-process
                // observations and new successful absence snapshots.
                if (process.platform === 'win32' && code === 0 && signal == null &&
                    !tracked.stopRequestPending && !tracked.stopAttempted && !tracked.fastStop) {
                    tracked.cleanNaturalExit = { pid: proc.pid };
                }
                tracked.wakeExitMonitor?.();
            }
        });
        proc.once('error', (error) => {
            // On a successfully spawned game, a later error should be logged
            // without rolling back an already running game/session.
            if (runningGames.get(gameId)?.proc === proc) {
                console.warn('[BACKEND] Process runtime error:', error);
                return;
            }
            reportLaunchFailure(error);
        });
        if (!Number.isInteger(proc.pid) || proc.pid <= 0) {
            console.warn('[BACKEND] Process not created; waiting for OS launch error. No game session started.');
            return;
        }
        // Begin the game session ONLY after Windows returned a valid process.
        const sessionIndex = sessions.startSession(gameName, gameId);
        const sessionId = sessions.getSessionId(sessionIndex);

        runningGames.set(gameId, {
            pid: proc.pid,
            launchPid: proc.pid,
            activePid: proc.pid,
            activePath: gamePath,
            exeName,
            gameName,
            installPath: gamePath,
            proc,
            startTime: Date.now(),
            startHrtime: process.hrtime.bigint(),
            pausedNanoseconds: 0n,
            pauseStartedHrtime: null,
            pauseReasons: new Set(),
            stopping: false,
            event,
            sessionIndex,
            sessionId
        });

        proc.unref();
        // Only an explicitly armed, completed baseline observes this verified Nexus session.
        try { require('./backup-discovery-engine-v070').noteGameStarted({ gameId, name: gameName, sessionId }); }
        catch (error) { console.warn('[NEXUS SAVE OBSERVER] Session start unavailable:', error.message); }
        publishOverlaySessions();
        startSmartMonitor(gameDir, proc.pid, exeName, gameId);
        startTimer(gameId);

        if (!event.sender.isDestroyed()) {
            event.sender.send('game:started', { gameId, sessionId, elapsed: 0, paused: false, stopping: false });
        }
    } catch (err) {
        console.error(`[BACKEND ERROR] ${err.message}`);
        const diagnostic = describeLaunchError(err, gamePath, gameName);
        if (!event.sender.isDestroyed()) {
            event.sender.send('game:error', { ...diagnostic, gameId });
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MANUAL PAUSE / RESUME
// ─────────────────────────────────────────────────────────────────────────────
function resolveGameId(gameId) {
    if (gameId !== undefined && gameId !== null) {
        return runningGames.has(gameId) ? gameId : null;
    }
    // Do not randomly pause the first game if several are running.
    return runningGames.size === 1 ? runningGames.keys().next().value : null;
}
function pauseTimer(gameId) {
    const target = resolveGameId(gameId);
    if (target === null) return false;
    return setPauseReason(target, 'manual', true);
}
function resumeTimer(gameId) {
    const target = resolveGameId(gameId);
    if (target === null) return false;
    return setPauseReason(target, 'manual', false);
}

// Only a live, matching session may be controlled by the in-game UI.
// Pause/resume changes the Nexus timer state; the overlay does not own a timer.
function applyOverlayTimerAction(gameId, sessionId, gamePid, paused) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping || !sessionId || game.sessionId !== sessionId ||
        game.activePid !== gamePid || typeof paused !== 'boolean') return { ok: false };
    setPauseReason(gameId, 'manual', paused);
    return { ok: true, paused: game.pauseReasons.size > 0 };
}

function forceStopGame(gameId) {
    const game = runningGames.get(gameId);
    if (!game || game.stopping || game.stopRequestPending || game.fastStop) return;
    if (process.platform !== 'win32') {
        try { game.proc.kill('SIGKILL'); } catch (error) { console.warn('[BACKEND] Stop failed:', error); }
        return; // Monitor finalizes only when disappearance is verified.
    }
    // Scope the user's explicit Stop intent to the current session AND target.
    const targetPid = game.activePid;
    const targetPath = processSelector.normalized(game.activePath);
    game.stopAttempted = true; // failed/cancelled Stop must not enable balanced natural exit
    game.stopRequestPending = true;
    getProcesses((processes, error) => {
        const current = runningGames.get(gameId);
        // A PID lookup is asynchronous: do not stop a replacement session.
        if (current !== game || current.stopping) return;
        const cancel = (reason) => {
            game.stopRequestPending = false;
            console.warn('[BACKEND] Force-stop cancelled:', reason);
            game.wakeExitMonitor?.();
        };
        if (!processes) return cancel(error?.message || 'cannot validate target');
        if (current.activePid !== targetPid || processSelector.normalized(current.activePath) !== targetPath)
            return cancel('target changed while validating');
        const found = processes.find(p => p.pid === targetPid);
        if (!found || processSelector.normalized(found.path) !== targetPath)
            return cancel('PID/path no longer match');
        // Never send /T to a tree that contains a different tracked game.
        const tree = new Set([targetPid]);
        let expanded = true;
        while (expanded) {
            expanded = false;
            for (const p of processes) {
                if (tree.has(p.ppid) && !tree.has(p.pid)) { tree.add(p.pid); expanded = true; }
            }
        }
        if ([...runningGames.values()].some(other => other !== game && !other.stopping &&
            (tree.has(other.activePid) || tree.has(other.launchPid))))
            return cancel('process tree contains another tracked game');
        const verified = { pid: found.pid, path: found.path, elapsed: getElapsedSeconds(gameId), endTime: Date.now() };
        console.log(`[BACKEND] Force stopping verified PID ${found.pid}: ${found.path}`);
        execFile('taskkill.exe', ['/PID', String(found.pid), '/T', '/F'], { windowsHide: true, timeout: 12000 }, (err) => {
            if (runningGames.get(gameId) !== game || game.stopping) return;
            game.stopRequestPending = false;
            if (err) {
                console.warn('[BACKEND] taskkill warning:', err.message);
                game.wakeExitMonitor?.();
                return;
            }
            if (game.activePid !== targetPid || processSelector.normalized(game.activePath) !== targetPath) {
                console.log(`[NEXUS EXIT] FAST_FALLBACK target-changed gameId=${gameId}`);
                game.wakeExitMonitor?.();
                return;
            }
            // A successful taskkill is permission to verify quickly, not proof
            // by itself. The ordinary monitor still owns all finalization.
            game.fastStop = { pid: targetPid, path: targetPath, verified,
                acknowledgedAt: exitClockMs(), firstMissingAt: null };
            console.log(`[NEXUS EXIT] FAST_ARMED gameId=${gameId} pid=${targetPid}`);
            game.wakeExitMonitor?.();
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────
// Refuse a restore while Nexus still tracks an active session for this game.
function isGameRunningByName(gameName) {
    const requested = String(gameName || '').trim().toLowerCase();
    if (!requested) return false;
    return [...runningGames.values()].some(game =>
        !game.stopping && String(game.gameName || '').trim().toLowerCase() === requested);
}

module.exports = {
    launchGame,
    forceStopGame,
    pauseTimer,
    resumeTimer,
    applyOverlayTimerAction,
    isGameRunningByName,
    getRunningSessions,
};