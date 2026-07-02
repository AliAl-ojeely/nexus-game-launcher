import { state, userSettings } from './state.js';
import { toSafeUrl } from './library.js';
import { showToast } from './details-components.js';

let currentGame = null;
let currentPeriodDays = 1;
let statsChart = null;
let weekdayChart = null;
let hourChart = null;
let topGamesChart = null;
let doughnutChart = null;
let monthlyLineChart = null;
let cumulativeChart = null;
let growthChart = null;
let heatmapCanvas = null;

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

function setDivider(id, visible) {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? 'block' : 'none';
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
            <button class="action-btn delete-stat-btn" title="Delete Stats">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `;

        div.addEventListener('click', () => {
            document.querySelectorAll('.stats-game-item').forEach(el => el.classList.remove('active'));
            div.classList.add('active');
            currentGame = game.name;
            refreshAllStats();
        });

        const deleteBtn = div.querySelector('.delete-stat-btn');
        deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

            const confirmMsg = userSettings.lang === 'ar'
                ? 'هل تريد حذف بيانات هذه اللعبة من لوحة الإحصائيات بالكامل؟'
                : 'Do you want to delete this game Info from the Static Dashboard?';

            if (confirm(confirmMsg)) {
                try {
                    deleteBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

                    if (window.api.deleteGameSessions) {
                        await window.api.deleteGameSessions(game.name);
                    }

                    if (window.showToast) {
                        window.showToast('success', userSettings.lang === 'ar' ? 'تم حذف الإحصائيات' : 'Stats deleted', '', 2000);
                    }

                    if (currentGame === game.name) {
                        currentGame = null;
                        const overallBtn = document.getElementById('overallStatsBtn');
                        if (overallBtn) overallBtn.click();
                    }

                    await loadGameList();
                } catch (err) {
                    console.error('[FRONTEND] Error deleting stats:', err);
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                }
            }
        });

        container.appendChild(div);
    });
}

// -----------------------------------------------------------------------------
// Refresh all stats when a game is selected
// -----------------------------------------------------------------------------
async function refreshAllStats() {
    // Hide overall‑only containers
    const doughnutContainer = document.getElementById('doughnutChartContainer');
    if (doughnutContainer) doughnutContainer.style.display = 'none';
    const doughnutDivider = document.getElementById('dividerDoughnut');
    if (doughnutDivider) doughnutDivider.style.display = 'none';

    // Show game‑specific containers
    const lineContainer = document.getElementById('monthlyLineChartContainer');
    if (lineContainer) lineContainer.style.display = 'block';
    const lineDivider = document.getElementById('dividerMonthlyLine');
    if (lineDivider) lineDivider.style.display = 'block';

    // Show daily circles container and its divider
    const dailyCircles = document.getElementById('statsDailyCircles');
    if (dailyCircles) dailyCircles.style.display = 'block';
    const circlesDivider = document.getElementById('dividerDailyCircles');
    if (circlesDivider) circlesDivider.style.display = 'block';

    // Show cumulative chart (per‑game) with its divider
    const cumContainer = document.getElementById('cumulativeChartContainer');
    const cumDivider = document.getElementById('dividerCumulative');
    if (cumContainer) cumContainer.style.display = 'block';
    if (cumDivider) cumDivider.style.display = 'block';
    await loadCumulativeChart(currentGame, currentPeriodDays);

    // Hide library growth and heatmap (overall only)
    const growthContainer = document.getElementById('growthChartContainer');
    const heatmapContainer = document.getElementById('heatmapContainer');
    if (growthContainer) growthContainer.style.display = 'none';
    if (heatmapContainer) heatmapContainer.style.display = 'none';
    const growthDivider = document.getElementById('dividerGrowth');
    const heatmapDivider = document.getElementById('dividerHeatmap');
    if (growthDivider) growthDivider.style.display = 'none';
    if (heatmapDivider) heatmapDivider.style.display = 'none';

    // Load all data
    await loadMonthlyLineChart(currentGame);
    await updateStatsForGame(currentGame, currentPeriodDays);
    await loadExtraMetrics(currentGame);
    await loadSessionHistory(currentGame);
    await loadWeekdayChart(currentGame);
    await loadHourChart(currentGame);
    await loadTopGamesChart(currentPeriodDays);
    await loadMonthlyChart();
    await loadDailyCircles(currentGame, currentPeriodDays);
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
    // Hide game‑specific containers
    const lineContainer = document.getElementById('monthlyLineChartContainer');
    if (lineContainer) lineContainer.style.display = 'none';
    const lineDivider = document.getElementById('dividerMonthlyLine');
    if (lineDivider) lineDivider.style.display = 'none';

    // Hide daily circles container and its divider
    const dailyCircles = document.getElementById('statsDailyCircles');
    if (dailyCircles) dailyCircles.style.display = 'none';
    const circlesDivider = document.getElementById('dividerDailyCircles');
    if (circlesDivider) circlesDivider.style.display = 'none';

    // Show overall‑only containers
    const doughnutContainer = document.getElementById('doughnutChartContainer');
    if (doughnutContainer) doughnutContainer.style.display = 'block';
    const doughnutDivider = document.getElementById('dividerDoughnut');
    if (doughnutDivider) doughnutDivider.style.display = 'block';

    // Show overall‑only charts (cumulative, growth, heatmap)
    const cumContainer = document.getElementById('cumulativeChartContainer');
    const cumDivider = document.getElementById('dividerCumulative');
    if (cumContainer) cumContainer.style.display = 'block';
    if (cumDivider) cumDivider.style.display = 'none'; // hide divider for overall
    await loadCumulativeChart(null, days);

    const growthContainer = document.getElementById('growthChartContainer');
    if (growthContainer) growthContainer.style.display = 'block';
    const growthDivider = document.getElementById('dividerGrowth');
    if (growthDivider) growthDivider.style.display = 'block';
    await loadGrowthChart();

    const heatmapContainer = document.getElementById('heatmapContainer');
    if (heatmapContainer) heatmapContainer.style.display = 'block';
    const heatmapDivider = document.getElementById('dividerHeatmap');
    if (heatmapDivider) heatmapDivider.style.display = 'block';
    await loadHeatmap();

    // Load overall data
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
    await loadDoughnutChart(days);
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

async function loadMonthlyLineChart(gameName) {
    const data = await window.api.getMonthlyStatsForGame(gameName, 12);
    const labels = data.map(d => d.label);
    const hoursData = data.map(d => d.hours);
    const sessionCounts = data.map(d => d.count);

    if (monthlyLineChart) monthlyLineChart.destroy();
    const ctx = document.getElementById('monthlyLineChart').getContext('2d');
    monthlyLineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: t('playtime_hours_label', 'Playtime (hours)'),
                data: hoursData,
                borderColor: '#ff4655',
                backgroundColor: 'rgba(255, 70, 85, 0.1)',
                tension: 0.3,
                fill: true,
                yAxisID: 'y'
            }, {
                label: t('session_count_label', 'Sessions'),
                data: sessionCounts,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.3,
                fill: true,
                yAxisID: 'y1'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { title: { display: true, text: t('playtime_hours_label', 'Hours') }, beginAtZero: true },
                y1: { position: 'right', title: { text: t('session_count_label', 'Sessions') }, beginAtZero: true, grid: { drawOnChartArea: false } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            let label = context.dataset.label || '';
                            let value = context.raw;
                            if (context.datasetIndex === 0) {
                                return `${label}: ${value.toFixed(1)} hours`;
                            } else {
                                return `${label}: ${value} sessions`;
                            }
                        }
                    }
                }
            }
        }
    });

    console.log('[LineChart] Data received:', data);
}

async function loadCumulativeChart(gameName, days) {
    const data = await window.api.getCumulativeStats(gameName, days);
    const labels = data.map(d => d.date);
    const hours = data.map(d => d.cumulativeHours);
    if (cumulativeChart) cumulativeChart.destroy();
    const ctx = document.getElementById('cumulativeChart').getContext('2d');
    cumulativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: t('cumulative_label', 'Cumulative Playtime (hours)'),
                data: hours,
                borderColor: '#ff4655',
                backgroundColor: 'transparent',
                tension: 0.1,
                fill: false,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { beginAtZero: true, title: { display: true, text: t('cumulative_label', 'Hours') } } }
        }
    });
}

async function loadGrowthChart() {
    const data = await window.api.getLibraryGrowth();
    const labels = data.map(d => d.month);
    const counts = data.map(d => d.count);
    if (growthChart) growthChart.destroy();
    const ctx = document.getElementById('growthChart').getContext('2d');
    growthChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: t('growth_label', 'Games Added'),
                data: counts,
                backgroundColor: '#3b82f6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: { y: { beginAtZero: true, stepSize: 1, title: { display: true, text: t('growth_label', 'Count') } } }
        }
    });
}

async function loadHeatmap() {
    const data = await window.api.getHeatmapData();
    const dateMap = new Map(data.map(d => [d.date, d.hours]));
    const now = new Date();
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 364); // 365 days including today
    const days = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        const hours = dateMap.get(dateStr) || 0;
        days.push({ date: dateStr, hours });
    }
    const canvas = document.getElementById('heatmapCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cellSize = 15;
    const cols = 53; // approx weeks
    const rows = 7;
    canvas.width = cols * cellSize;
    canvas.height = rows * cellSize;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < days.length; i++) {
        const day = days[i];
        const col = Math.floor(i / rows);
        const row = i % rows;
        const x = col * cellSize;
        const y = row * cellSize;
        let intensity = Math.min(1, day.hours / 10); // max 10 hours = darkest
        let color;
        if (day.hours === 0) color = '#2d2d2d';
        else if (day.hours < 1) color = '#1f4d2e';
        else if (day.hours < 3) color = '#2e6b3e';
        else if (day.hours < 6) color = '#3e8e4e';
        else color = '#4fae5e';
        ctx.fillStyle = color;
        ctx.fillRect(x, y, cellSize - 1, cellSize - 1);
    }
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
    const isAr = userSettings.lang === 'ar';
    let loadingToast = null;
    try {
        loadingToast = showToast('info', isAr ? 'جاري تحضير ملف CSV للجلسات...' : 'Preparing session CSV...', '', 0);

        let sessions = await window.api.getAllSessions();
        if (currentGame) sessions = sessions.filter(s => s.gameName === currentGame);

        if (!sessions || sessions.length === 0) {
            if (loadingToast && loadingToast.remove) loadingToast.remove();
            showToast('info', isAr ? 'لا توجد جلسات للتصدير' : 'No sessions to export', '', 2000);
            return;
        }

        const headers = ['Game Name', 'Start Time', 'End Time', 'Duration (seconds)'];
        const rows = sessions.map(s => [
            s.gameName,
            new Date(s.startTime).toISOString(),
            s.endTime ? new Date(s.endTime).toISOString() : '',
            s.durationSeconds
        ]);
        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sessions_${currentGame || 'all'}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        if (loadingToast && loadingToast.remove) loadingToast.remove();
        showToast('success', isAr ? 'تم تصدير الجلسات بنجاح' : 'Sessions exported successfully', '', 3000);
    } catch (err) {
        console.error('[Export CSV] Failed:', err);
        if (loadingToast && loadingToast.remove) loadingToast.remove();
        showToast('error', isAr ? 'فشل تصدير الجلسات' : 'Session export failed', err.message, 4000);
    }
}

// -----------------------------------------------------------------------------
// Export to PNG
// -----------------------------------------------------------------------------
async function exportStatsAsPNG() {
    const isAr = userSettings.lang === 'ar';
    const dashboard = document.querySelector('.stats-dashboard');
    if (!dashboard) {
        showToast('error', isAr ? 'لم يتم العثور على لوحة الإحصائيات' : 'Statistics dashboard not found', '', 3000);
        return;
    }
    try {
        const loadingToast = showToast('info', isAr ? 'جاري تحضير الصورة...' : 'Preparing image...', '', 0);
        const canvas = await html2canvas(dashboard, {
            scale: 2,
            backgroundColor: null,
            logging: false,
            useCORS: true
        });
        if (loadingToast && loadingToast.remove) loadingToast.remove();
        const link = document.createElement('a');
        link.download = `nexus-stats-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.png`;
        link.href = canvas.toDataURL();
        link.click();
        showToast('success', isAr ? 'تم تصدير الصورة بنجاح' : 'PNG exported successfully', '', 3000);
    } catch (err) {
        console.error('[Export PNG] Failed:', err);
        showToast('error', isAr ? 'فشل تصدير الصورة' : 'PNG export failed', err.message, 4000);
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
    const overallStatsBtn = document.getElementById('overallStatsBtn');
    if (overallStatsBtn) {
        overallStatsBtn.addEventListener('click', () => {
            currentGame = null;
            document.querySelectorAll('.stats-game-item').forEach(el => el.classList.remove('active'));
            const circlesContainer = document.getElementById('dailyCirclesContainer');
            if (circlesContainer) circlesContainer.innerHTML = '';
            updateOverallStats(currentPeriodDays);
        });
    }

    // Export CSV button
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', exportToCSV);
    }

    // Refresh when a game stops
    if (window.api && window.api.onGameStopped) {
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

async function loadDailyCircles(gameName, days) {
    const dailyData = await window.api.getDailyPlaytimeForGame(gameName, days);
    const container = document.getElementById('dailyCirclesContainer');
    if (!container) return;
    container.innerHTML = '';
    for (const day of dailyData) {
        const seconds = day.seconds;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const formattedTime = `${hours}h ${minutes}m`;
        const percentOfDay = (seconds / 86400) * 100;

        // 🆕 Increase canvas internal resolution for sharpness
        const canvas = document.createElement('canvas');
        const visualSize = 150; // desired display size in pixels
        const pixelRatio = 2;   // 2x for retina clarity (adjust to taste)
        canvas.width = visualSize * pixelRatio;
        canvas.height = visualSize * pixelRatio;
        canvas.style.width = `${visualSize}px`;
        canvas.style.height = `${visualSize}px`;
        canvas.className = 'circle-canvas';

        const ctx = canvas.getContext('2d');
        // Scale all drawing operations to match the higher resolution
        ctx.scale(pixelRatio, pixelRatio);

        drawProgressCircle(ctx, percentOfDay, formattedTime, visualSize);

        const div = document.createElement('div');
        div.className = 'circle-item';
        div.appendChild(canvas);
        const label = document.createElement('div');
        label.className = 'circle-label';
        label.innerText = day.date;
        div.appendChild(label);
        container.appendChild(div);
    }
}

function drawProgressCircle(ctx, percent, formattedTime, size) {
    const centerX = size / 2;
    const centerY = size / 2;
    const radius = size * 0.42;
    const startAngle = -0.5 * Math.PI;
    const endAngle = startAngle + (percent / 100) * 2 * Math.PI;

    ctx.clearRect(0, 0, size, size);

    // Background ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = '#2d2d2d';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Progress ring
    let ringColor = '#ff4655';
    if (percent >= 20) ringColor = '#f59e0b';
    if (percent >= 30) ringColor = '#3b82f6';
    if (percent >= 40) ringColor = '#10b981';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 6;
    ctx.stroke();

    // Text – use larger font for better readability
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fontSize = size * 0.12;
    ctx.font = `bold ${fontSize}px "Poppins", sans-serif`;
    ctx.fillText(formattedTime, centerX, centerY);
}

async function loadDoughnutChart(periodDays) {
    const topGames = await window.api.getTopGames(5, periodDays);
    const labels = topGames.map(g => g.name);
    const data = topGames.map(g => g.totalSeconds / 3600); // hours
    if (doughnutChart) doughnutChart.destroy();
    const ctx = document.getElementById('doughnutChart').getContext('2d');
    doughnutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#ff4655', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const hours = ctx.raw;
                            const totalMinutes = hours * 60;
                            const hrs = Math.floor(totalMinutes / 60);
                            const mins = Math.round(totalMinutes % 60);
                            return `${ctx.label}: ${hrs}h ${mins}m`;
                        }
                    }
                }
            }
        }
    });
}