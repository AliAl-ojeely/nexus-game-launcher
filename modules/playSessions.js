const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const db = require('./database');

const SESSIONS_PATH = path.join(app.getPath('userData'), 'playSessions.json');

function initSessionsDB() {
    if (!fs.existsSync(SESSIONS_PATH)) {
        fs.writeFileSync(SESSIONS_PATH, '[]', 'utf-8');
    }
}

function readSessions() {
    try {
        const data = fs.readFileSync(SESSIONS_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        return [];
    }
}

function writeSessions(sessions) {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2), 'utf-8');
}

function startSession(gameName) {
    const sessions = readSessions();
    sessions.push({
        gameName,
        startTime: Date.now(),
        endTime: null,
        durationSeconds: 0
    });
    writeSessions(sessions);
    return sessions.length - 1;
}

function endSession(sessionIndex, endTime, durationSeconds) {
    const sessions = readSessions();
    if (sessions[sessionIndex]) {
        sessions[sessionIndex].endTime = endTime;
        sessions[sessionIndex].durationSeconds = durationSeconds;
        writeSessions(sessions);
    }
}

function getGameStats(gameName, periodDays) {
    const sessions = readSessions();
    const now = Date.now();
    const cutoff = now - (periodDays * 24 * 60 * 60 * 1000);
    const relevant = sessions.filter(s => s.gameName === gameName && s.endTime && s.endTime >= cutoff);
    const playCount = relevant.length;
    const totalDuration = relevant.reduce((sum, s) => sum + s.durationSeconds, 0);
    const avgDuration = playCount ? totalDuration / playCount : 0;
    return { playCount, totalDuration, avgDuration };
}

function getOverallStats(periodDays) {
    const sessions = readSessions();
    const now = Date.now();
    const cutoff = now - (periodDays * 24 * 60 * 60 * 1000);
    const relevant = sessions.filter(s => s.endTime && s.endTime >= cutoff);
    const totalSessions = relevant.length;
    const totalPlaytime = relevant.reduce((sum, s) => sum + s.durationSeconds, 0);
    const avgSession = totalSessions ? totalPlaytime / totalSessions : 0;
    return { totalSessions, totalPlaytime, avgSession };
}

function getDailyStats(gameName, periodDays) {
    const sessions = readSessions();
    const now = Date.now();
    const cutoff = now - (periodDays * 24 * 60 * 60 * 1000);
    const filtered = sessions.filter(s => s.gameName === gameName && s.endTime && s.endTime >= cutoff);
    const grouped = {};
    for (const s of filtered) {
        const date = new Date(s.endTime).toISOString().split('T')[0];
        if (!grouped[date]) grouped[date] = { count: 0, totalDuration: 0 };
        grouped[date].count++;
        grouped[date].totalDuration += s.durationSeconds;
    }
    return Object.entries(grouped).map(([date, data]) => ({
        date,
        count: data.count,
        avgDuration: data.totalDuration / data.count
    })).sort((a, b) => a.date.localeCompare(b.date));
}

function getGameNamesWithSessions() {
    const sessions = readSessions();
    return [...new Set(sessions.map(s => s.gameName))];
}

function getAllSessions() {
    return readSessions();
}

function getLongestSession(gameName = null) {
    const sessions = readSessions();
    const filtered = gameName ? sessions.filter(s => s.gameName === gameName) : sessions;
    if (filtered.length === 0) return null;
    let longest = filtered.reduce((max, s) => s.durationSeconds > max.durationSeconds ? s : max, filtered[0]);
    return { gameName: longest.gameName, durationSeconds: longest.durationSeconds, startTime: longest.startTime };
}

function getShortestSession(gameName = null, minSeconds = 60) {
    const sessions = readSessions();
    const filtered = (gameName ? sessions.filter(s => s.gameName === gameName) : sessions).filter(s => s.durationSeconds >= minSeconds);
    if (filtered.length === 0) return null;
    let shortest = filtered.reduce((min, s) => s.durationSeconds < min.durationSeconds ? s : min, filtered[0]);
    return { gameName: shortest.gameName, durationSeconds: shortest.durationSeconds, startTime: shortest.startTime };
}

function getPlaytimeByWeekday() {
    const sessions = readSessions();
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const counts = new Array(7).fill(0);
    const totalDuration = new Array(7).fill(0);
    for (const s of sessions) {
        if (s.endTime) {
            const weekday = new Date(s.endTime).getDay();
            counts[weekday]++;
            totalDuration[weekday] += s.durationSeconds;
        }
    }
    return weekdays.map((day, i) => ({ day, playCount: counts[i], totalSeconds: totalDuration[i] }));
}

function getPlaytimeByHour() {
    const sessions = readSessions();
    const hours = Array(24).fill(0);
    for (const s of sessions) {
        if (s.endTime) {
            const hour = new Date(s.endTime).getHours();
            hours[hour] += s.durationSeconds;
        }
    }
    return hours;
}

function getLongestStreak() {
    const sessions = readSessions();
    if (sessions.length === 0) return 0;
    const dates = sessions
        .filter(s => s.endTime)
        .map(s => new Date(s.endTime).toISOString().split('T')[0])
        .filter((v, i, a) => a.indexOf(v) === i) // unique dates
        .sort();
    let maxStreak = 1;
    let currentStreak = 1;
    for (let i = 1; i < dates.length; i++) {
        const prev = new Date(dates[i - 1]);
        const curr = new Date(dates[i]);
        const diffDays = (curr - prev) / (1000 * 60 * 60 * 24);
        if (diffDays === 1) {
            currentStreak++;
            maxStreak = Math.max(maxStreak, currentStreak);
        } else {
            currentStreak = 1;
        }
    }
    return maxStreak;
}

function getTopGames(limit = 5, periodDays = null) {
    const now = Date.now();
    const cutoff = periodDays ? now - (periodDays * 24 * 60 * 60 * 1000) : 0;
    const sessions = readSessions().filter(s => s.endTime && s.endTime >= cutoff);
    const gameMap = new Map();
    for (const s of sessions) {
        const prev = gameMap.get(s.gameName) || { playCount: 0, totalSeconds: 0 };
        prev.playCount++;
        prev.totalSeconds += s.durationSeconds;
        gameMap.set(s.gameName, prev);
    }
    const sorted = Array.from(gameMap.entries()).map(([name, data]) => ({ name, ...data }));
    sorted.sort((a, b) => b.totalSeconds - a.totalSeconds);
    return sorted.slice(0, limit);
}

function getUniqueGamesCount() {
    const sessions = readSessions();
    const unique = new Set(sessions.map(s => s.gameName));
    return unique.size;
}

function getFirstPlayedDate() {
    const sessions = readSessions();
    if (sessions.length === 0) return null;
    const first = sessions.reduce((earliest, s) => s.startTime < earliest.startTime ? s : earliest, sessions[0]);
    return first.startTime;
}

function getMonthlyPlaytime(monthsBack = 12) {
    const sessions = readSessions();
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const monthly = {};
    for (const s of sessions) {
        if (!s.endTime) continue;
        const date = new Date(s.endTime);
        if (date < startDate) continue;
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        monthly[key] = (monthly[key] || 0) + s.durationSeconds;
    }
    // sort by date
    const sorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([month, seconds]) => ({ month, seconds }));
}

function getMonthlyStatsForGame(gameName, monthsBack = 12) {
    const sessions = readSessions();
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const monthly = {};

    for (const s of sessions) {
        if (s.gameName !== gameName || !s.endTime) continue;
        const date = new Date(s.endTime);
        if (date < startDate) continue;
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        if (!monthly[key]) {
            monthly[key] = { seconds: 0, count: 0 };
        }
        monthly[key].seconds += s.durationSeconds;
        monthly[key].count += 1;
    }

    const result = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        const data = monthly[key] || { seconds: 0, count: 0 };
        result.push({
            month: key,
            label: d.toLocaleString('default', { month: 'short', year: 'numeric' }),
            seconds: data.seconds,
            hours: data.seconds / 3600,
            count: data.count,
        });
    }
    return result;
}

// Cumulative playtime over time (returns array of { date, cumulativeSeconds })
function getCumulativeStats(gameName, days) {
    const sessions = readSessions();
    const now = Date.now();
    const cutoff = now - (days * 24 * 60 * 60 * 1000);
    const filtered = sessions.filter(s => {
        if (!s.endTime) return false;
        if (gameName && s.gameName !== gameName) return false;
        return s.endTime >= cutoff;
    });
    // group by date (YYYY-MM-DD)
    const dailyTotal = {};
    for (const s of filtered) {
        const date = new Date(s.endTime).toISOString().split('T')[0];
        dailyTotal[date] = (dailyTotal[date] || 0) + s.durationSeconds;
    }
    // generate all dates in range
    const result = [];
    let currentDate = new Date(cutoff);
    while (currentDate <= new Date(now)) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const seconds = dailyTotal[dateStr] || 0;
        result.push({ date: dateStr, seconds });
        currentDate.setDate(currentDate.getDate() + 1);
    }
    // compute cumulative sum
    let cumulative = 0;
    const cumulativeData = result.map(day => {
        cumulative += day.seconds;
        return { date: day.date, cumulativeHours: cumulative / 3600 };
    });
    return cumulativeData;
}

// Game library growth (monthly count of added games)
function getLibraryGrowth() {
    const games = db.getGames(); // from database.js – careful: we need to import db or pass it
    const monthly = {};
    for (const game of games) {
        const date = new Date(game.id); // game.id is a timestamp (milliseconds)
        if (isNaN(date.getTime())) continue;
        const key = `${date.getFullYear()}-${date.getMonth() + 1}`;
        monthly[key] = (monthly[key] || 0) + 1;
    }
    // sort by date
    const sorted = Object.entries(monthly).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([month, count]) => ({ month, count }));
}

// Heatmap data: { date: string, count: number } for last 365 days
function getHeatmapData() {
    const sessions = readSessions();
    const now = Date.now();
    const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
    const filtered = sessions.filter(s => s.endTime && s.endTime >= oneYearAgo);
    const daily = {};
    for (const s of filtered) {
        const date = new Date(s.endTime).toISOString().split('T')[0];
        daily[date] = (daily[date] || 0) + s.durationSeconds;
    }
    // convert to array of { date, hours }
    return Object.entries(daily).map(([date, seconds]) => ({ date, hours: seconds / 3600 }));
}

function getDailyPlaytimeForGame(gameName, periodDays) {
    const sessions = readSessions();
    const now = Date.now();
    const cutoff = now - (periodDays * 24 * 60 * 60 * 1000);
    const relevant = sessions.filter(s => s.gameName === gameName && s.endTime && s.endTime >= cutoff);
    const daily = {};
    for (const s of relevant) {
        const date = new Date(s.endTime).toISOString().split('T')[0];
        daily[date] = (daily[date] || 0) + s.durationSeconds;
    }
    const sorted = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
    return sorted.map(([date, seconds]) => ({ date, seconds }));
}

/**
 * Deletes all play sessions for a specific game.
 * @param {string} gameName
 */
function deleteSessionsByGame(gameName) {
    try {
        const sessions = readSessions();
        const filtered = sessions.filter(s => s.gameName !== gameName);
        fs.writeFileSync(SESSIONS_PATH, JSON.stringify(filtered, null, 2), 'utf-8');
        return true;
    } catch (err) {
        console.error('[Sessions] Error deleting sessions for game:', gameName, err);
        throw err;
    }
}

module.exports = {
    initSessionsDB,
    startSession,
    endSession,
    getGameStats,
    getOverallStats,
    getDailyStats,
    getGameNamesWithSessions,
    getAllSessions,
    getLongestSession,
    getShortestSession,
    getPlaytimeByWeekday,
    getPlaytimeByHour,
    getLongestStreak,
    getTopGames,
    getUniqueGamesCount, 
    getFirstPlayedDate, 
    getMonthlyPlaytime,
    getDailyPlaytimeForGame,
    getMonthlyStatsForGame,
    getCumulativeStats,
    getLibraryGrowth,
    getHeatmapData,
    deleteSessionsByGame,
};