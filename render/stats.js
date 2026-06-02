import { state, userSettings } from './state.js';
import { toSafeUrl } from './library.js';

let currentGame = null;
let currentPeriodDays = 1;
let statsChart = null;
let weekdayChart = null;
let hourChart = null;
let topGamesChart = null;

// -----------------------------------------------------------------------------
// Helper: get grid line color based on current theme
// -----------------------------------------------------------------------------
function getGridColor() {
    // Light mode: dark gray lines
    if (document.body.classList.contains('light-mode')) {
        return 'rgba(0, 0, 0, 0.15)';
    }
    // Darker mode: medium-light gray
    if (document.body.classList.contains('darker-mode')) {
        return '#4a5568';   // clearly visible gray
    }
    // Default dark mode: light gray (not black)
    return 'rgba(255, 255, 255, 0.25)';
}

// -----------------------------------------------------------------------------
// Translation helper
// -----------------------------------------------------------------------------
function t(key, fallback = '') {
    if (typeof dictionary !== 'undefined' && dictionary[userSettings.lang] && dictionary[userSettings.lang][key]) {
        return dictionary[userSettings.lang][key];
    }
    return fallback;
}

// -----------------------------------------------------------------------------
// Load game list (left sidebar)
// -----------------------------------------------------------------------------
async function loadGameList() {
    const gameNames = await window.api.getGameNamesWithSessions();
    const allGames = await window.api.getGames();
    const gamesWithAssets = gameNames.map(name => allGames.find(g => g.name === name)).filter(g => g);
    const container = document.getElementById('statsGameList');
    if (!container) return;
    container.innerHTML = '';
    if (gamesWithAssets.length === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center;">${t('stats_no_sessions', 'No game sessions yet. Play a game first!')}</div>`;
        return;
    }
    gamesWithAssets.forEach(game => {
        const logoUrl = toSafeUrl(game.assets?.logo || game.assets?.poster || '');
        const div = document.createElement('div');
        div.className = 'stats-game-item';
        div.setAttribute('data-game', game.name);
        div.innerHTML = `
            ${logoUrl ? `<img src="${logoUrl}" class="stats-game-logo" onerror="this.style.display='none'">` : '<div class="stats-game-logo" style="background:var(--accent);"></div>'}
            <span class="stats-game-name">${escapeHtml(game.name)}</span>
        `;
        div.addEventListener('click', () => {
            document.querySelectorAll('.stats-game-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            currentGame = game.name;
            refreshAllStats();
        });
        container.appendChild(div);
    });
}

// -----------------------------------------------------------------------------
// Refresh all stats when a game is selected
// -----------------------------------------------------------------------------
async function refreshAllStats() {
    await updateStatsForGame(currentGame, currentPeriodDays);
    await loadExtraMetrics(currentGame);
    await loadSessionHistory(currentGame);
    await loadWeekdayChart(currentGame);
    await loadHourChart(currentGame);
    await loadTopGamesChart(currentPeriodDays);
    await loadMonthlyChart();
}

// -----------------------------------------------------------------------------
// Update main stat cards for a specific game
// -----------------------------------------------------------------------------
async function updateStatsForGame(gameName, days) {
    const stats = await window.api.getGameStats(gameName, days);
    document.getElementById('statTotalPlaytime').innerText = formatDuration(stats.totalDuration);
    document.getElementById('statPlayCount').innerText = stats.playCount;
    document.getElementById('statAvgSession').innerText = formatDuration(stats.avgDuration);
    await updateDailyChart(gameName, days);
}

// -----------------------------------------------------------------------------
// Overall stats (no game selected)
// -----------------------------------------------------------------------------
async function updateOverallStats(days) {
    const stats = await window.api.getOverallStats(days);
    document.getElementById('statTotalPlaytime').innerText = formatDuration(stats.totalPlaytime);
    document.getElementById('statPlayCount').innerText = stats.totalSessions;
    document.getElementById('statAvgSession').innerText = formatDuration(stats.avgSession);
    await loadTopGamesChart(days);
    await loadExtraMetrics(null);
    await loadSessionHistory(null);
    await loadWeekdayChart(null);
    await loadHourChart(null);
    await loadMonthlyChart();
}

// -----------------------------------------------------------------------------
// Extra metrics (cards below main stats)
// -----------------------------------------------------------------------------
async function loadExtraMetrics(gameName) {
    const longest = await window.api.getLongestSession(gameName);
    const shortest = await window.api.getShortestSession(gameName);
    const weekdayData = await window.api.getPlaytimeByWeekday();
    const hourData = await window.api.getPlaytimeByHour();
    const streak = await window.api.getLongestStreak();
    const uniqueGames = await window.api.getUniqueGamesCount();
    const firstPlayed = await window.api.getFirstPlayedDate();

    document.getElementById('longestSession').innerText = longest ? `${formatDuration(longest.durationSeconds)} (${longest.gameName})` : '-';
    document.getElementById('shortestSession').innerText = shortest ? `${formatDuration(shortest.durationSeconds)} (${shortest.gameName})` : '-';
    let bestWeekday = weekdayData.reduce((best, curr) => curr.playCount > best.playCount ? curr : best, weekdayData[0]);
    document.getElementById('favWeekday').innerText = bestWeekday ? t(`weekday_${bestWeekday.day.toLowerCase()}`, bestWeekday.day) : '-';
    let maxHour = hourData.indexOf(Math.max(...hourData));
    document.getElementById('peakHour').innerText = maxHour !== -1 ? `${maxHour}:00` : '-';
    document.getElementById('longestStreak').innerText = streak;
    document.getElementById('uniqueGamesCount').innerText = uniqueGames;
    document.getElementById('firstPlayedDate').innerText = firstPlayed ? new Date(firstPlayed).toLocaleDateString() : '-';
}

// -----------------------------------------------------------------------------
// Session history table
// -----------------------------------------------------------------------------
async function loadSessionHistory(gameName) {
    let sessions = await window.api.getAllSessions();
    if (gameName) sessions = sessions.filter(s => s.gameName === gameName);
    const recent = sessions.slice(-20).reverse();
    const tbody = document.getElementById('sessionHistoryBody');
    tbody.innerHTML = '';
    for (const s of recent) {
        const row = tbody.insertRow();
        row.insertCell(0).innerText = new Date(s.startTime).toLocaleString();
        row.insertCell(1).innerText = s.gameName;
        row.insertCell(2).innerText = formatDuration(s.durationSeconds);
    }
}

// -----------------------------------------------------------------------------
// Weekday chart
// -----------------------------------------------------------------------------
async function loadWeekdayChart(gameName) {
    let data = await window.api.getPlaytimeByWeekday();
    if (gameName) {
        const sessions = (await window.api.getAllSessions()).filter(s => s.gameName === gameName);
        const counts = new Array(7).fill(0);
        for (const s of sessions) {
            if (s.endTime) {
                const wd = new Date(s.endTime).getDay();
                counts[wd] += s.durationSeconds;
            }
        }
        data = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, i) => ({ day, playCount: counts[i], totalSeconds: counts[i] }));
    }
    const labels = data.map(d => t(`weekday_${d.day.toLowerCase()}`, d.day));
    const playCounts = data.map(d => d.playCount);
    if (weekdayChart) weekdayChart.destroy();
    const ctx = document.getElementById('weekdayChart').getContext('2d');
    const gridColor = getGridColor();
    weekdayChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: t('play_count_short', 'Play Count'), data: playCounts, backgroundColor: 'rgba(255,70,85,0.6)' }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { color: gridColor } } }
        }
    });
}

// -----------------------------------------------------------------------------
// Hour chart
// -----------------------------------------------------------------------------
async function loadHourChart(gameName) {
    let hourData = await window.api.getPlaytimeByHour();
    if (gameName) {
        const sessions = (await window.api.getAllSessions()).filter(s => s.gameName === gameName);
        const hours = new Array(24).fill(0);
        for (const s of sessions) {
            if (s.endTime) {
                const hour = new Date(s.endTime).getHours();
                hours[hour] += s.durationSeconds;
            }
        }
        hourData = hours;
    }
    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    if (hourChart) hourChart.destroy();
    const ctx = document.getElementById('hourChart').getContext('2d');
    const gridColor = getGridColor();
    hourChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets: [{ label: t('total_playtime_short', 'Playtime (sec)'), data: hourData, borderColor: '#3b82f6', fill: false }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { grid: { color: gridColor } }, x: { grid: { color: gridColor } } }
        }
    });
}

// -----------------------------------------------------------------------------
// Top games chart
// -----------------------------------------------------------------------------
async function loadTopGamesChart(periodDays) {
    const topGames = await window.api.getTopGames(5, periodDays);
    const labels = topGames.map(g => g.name);
    const playtimes = topGames.map(g => g.totalSeconds / 60);
    if (topGamesChart) topGamesChart.destroy();
    const ctx = document.getElementById('topGamesChart').getContext('2d');
    const gridColor = getGridColor();
    topGamesChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: t('total_playtime_minutes', 'Playtime (minutes)'), data: playtimes, backgroundColor: 'rgba(255,70,85,0.6)' }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { color: gridColor } } }
        }
    });
}

// -----------------------------------------------------------------------------
// Daily chart (for selected game)
// -----------------------------------------------------------------------------
async function updateDailyChart(gameName, days) {
    const daily = await window.api.getDailyStats(gameName, days);
    if (statsChart) statsChart.destroy();
    const ctx = document.getElementById('statsChart').getContext('2d');
    const labels = daily.map(d => d.date);
    const playCounts = daily.map(d => d.count);
    const avgMins = daily.map(d => d.avgDuration / 60);
    const gridColor = getGridColor();
    statsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: t('play_count', 'Play Count'), data: playCounts, backgroundColor: 'rgba(255,70,85,0.6)', yAxisID: 'y' },
                { label: t('avg_minutes', 'Avg Minutes'), data: avgMins, type: 'line', borderColor: '#3b82f6', backgroundColor: 'transparent', tension: 0.3, yAxisID: 'y1' }
            ]
        },
        options: {
            responsive: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { beginAtZero: true, title: { display: true, text: t('play_count', 'Plays') }, grid: { color: gridColor } },
                y1: { position: 'right', title: { text: t('avg_minutes', 'Avg Minutes') }, grid: { drawOnChartArea: false }, beginAtZero: true }
            }
        }
    });
}

// -----------------------------------------------------------------------------
// Monthly chart
// -----------------------------------------------------------------------------
async function loadMonthlyChart() {
    const monthly = await window.api.getMonthlyPlaytime(12);
    const labels = monthly.map(m => m.month);
    const data = monthly.map(m => Math.round(m.seconds / 60));
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    if (window.monthlyChart && typeof window.monthlyChart.destroy === 'function') {
        window.monthlyChart.destroy();
    }
    const ctx = canvas.getContext('2d');
    const gridColor = getGridColor();
    window.monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets: [{ label: t('total_playtime_minutes', 'Playtime (minutes)'), data, backgroundColor: 'rgba(255,70,85,0.6)' }] },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { beginAtZero: true, grid: { color: gridColor } }, x: { grid: { color: gridColor } } }
        }
    });
}

// -----------------------------------------------------------------------------
// Utility: format seconds to "Xh Ym"
// -----------------------------------------------------------------------------
function formatDuration(seconds) {
    if (!seconds) return '0h 0m';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

// -----------------------------------------------------------------------------
// Export to CSV
// -----------------------------------------------------------------------------
async function exportToCSV() {
    let sessions = await window.api.getAllSessions();
    if (currentGame) sessions = sessions.filter(s => s.gameName === currentGame);
    const headers = ['Game Name', 'Start Time', 'End Time', 'Duration (seconds)'];
    const rows = sessions.map(s => [s.gameName, new Date(s.startTime).toISOString(), s.endTime ? new Date(s.endTime).toISOString() : '', s.durationSeconds]);
    const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sessions_${currentGame || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

async function exportStatsAsPNG() {
    const dashboard = document.querySelector('.stats-dashboard');
    if (!dashboard) return;
    try {
        // Use global html2canvas from CDN
        const canvas = await html2canvas(dashboard, {
            scale: 2,
            backgroundColor: null,
            logging: false,
            useCORS: true
        });
        const link = document.createElement('a');
        link.download = 'nexus-stats.png';
        link.href = canvas.toDataURL();
        link.click();
    } catch (err) {
        console.error('Export failed:', err);
        if (window.showToast) window.showToast('error', 'Export failed', err.message, 3000);
    }
}

// -----------------------------------------------------------------------------
// INIT
// -----------------------------------------------------------------------------
export async function initStatsPage() {
    await loadGameList();

    // Export PNG button
    const exportPngBtn = document.getElementById('exportStatsPngBtn');
    if (exportPngBtn) exportPngBtn.addEventListener('click', exportStatsAsPNG);

    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriodDays = parseInt(btn.dataset.days, 10);
            if (currentGame) refreshAllStats();
            else updateOverallStats(currentPeriodDays);
        });
    });

    // Overall stats button
    document.getElementById('overallStatsBtn').addEventListener('click', () => {
        currentGame = null;
        document.querySelectorAll('.stats-game-item').forEach(el => el.classList.remove('active'));
        updateOverallStats(currentPeriodDays);
    });

    // Export CSV button
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);

    // Refresh when a game stops
    if (window.api.onGameStopped) {
        window.api.onGameStopped(async () => {
            await loadGameList();
            if (currentGame) refreshAllStats();
            else updateOverallStats(currentPeriodDays);
        });
    }

    // Watch theme changes to redraw charts
    const observer = new MutationObserver(() => {
        if (currentGame) refreshAllStats();
        else updateOverallStats(currentPeriodDays);
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    // Initial load
    updateOverallStats(currentPeriodDays);
}