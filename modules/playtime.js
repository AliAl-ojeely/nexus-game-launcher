const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ptPath = path.join(app.getPath('userData'), 'playTime.json');

function initPlaytimeDB() {
    if (!fs.existsSync(ptPath)) {
        try {
            fs.writeFileSync(ptPath, '{}', 'utf-8');
            console.log('[Playtime DB] Created:', ptPath);
        } catch (err) {
            console.error('[Playtime DB] Init Error:', err);
        }
    }
}

function readDB() {
    try {
        if (!fs.existsSync(ptPath)) return {};
        const content = fs.readFileSync(ptPath, 'utf-8').trim();
        if (!content) return {};
        const parsed = JSON.parse(content);
        return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch {
        return {};
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(ptPath, JSON.stringify(data, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('[Playtime DB] Write Error:', err);
        return false;
    }
}

/**
 * Returns total playtime in minutes (based on stored minutes + seconds/60)
 * @param {string} gameName
 * @returns {number}
 */
function getPlaytime(gameName) {
    const data = readDB();
    const entry = data[gameName];
    if (!entry) return 0;
    // Support old format (just a number)
    if (typeof entry === 'number') return entry;
    // New format: { minutes, seconds }
    if (typeof entry === 'object') {
        return entry.minutes + (entry.seconds / 60);
    }
    return 0;
}

/**
 * Adds a play session (raw seconds) to the game's total.
 * The 'minutes' parameter is ignored (kept for backward compatibility).
 * @param {string} gameName
 * @param {number} minutes       (ignored – derived from totalSeconds)
 * @param {number} totalSeconds  Raw seconds played in this session
 * @returns {number|false} New total minutes, or false on error
 */
function addPlaytime(gameName, minutes, totalSeconds = 0) {
    if (!gameName || totalSeconds < 30) {
        console.log(`[Playtime DB] ⏭️ Session too short for "${gameName}" (${totalSeconds}s) — skipping`);
        return 0;
    }

    const data = readDB();

    // Ensure entry exists with correct structure
    if (!data[gameName] || typeof data[gameName] !== 'object') {
        // Migrate old number format to object
        const oldMinutes = (typeof data[gameName] === 'number') ? data[gameName] : 0;
        data[gameName] = { minutes: oldMinutes, seconds: 0 };
    }

    const entry = data[gameName];

    // Convert existing minutes+seconds into total seconds
    let totalSecs = (entry.minutes || 0) * 60 + (entry.seconds || 0);

    // Add the new session seconds
    totalSecs += totalSeconds;

    // Convert back to minutes and seconds
    const newMinutes = Math.floor(totalSecs / 60);
    const newSeconds = totalSecs % 60;

    entry.minutes = newMinutes;
    entry.seconds = newSeconds;
    entry.lastPlayed = new Date().toISOString();

    const success = writeDB(data);
    if (!success) return false;

    console.log(`✅ [Playtime DB] "${gameName}" → ${newMinutes} min ${newSeconds} sec (+${totalSeconds}s)`);
    return newMinutes + (newSeconds / 60);
}

function resetPlaytime(gameName) {
    const data = readDB();
    if (data[gameName]) {
        delete data[gameName];
        writeDB(data);
        console.log(`[Playtime DB] Reset playtime for: ${gameName}`);
    }
}

module.exports = { initPlaytimeDB, getPlaytime, addPlaytime, resetPlaytime };