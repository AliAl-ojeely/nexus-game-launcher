import { state, userSettings } from '../state.js';
import { renderGameDetails } from './render.js';
import { updateBackupSidebarUI } from '../details-components.js';
import { formatPlaytime } from '../details-utils.js';
import { t } from './helpers.js';

export async function openGameDetailsPage(game) {
    if (!game || !game.name) return;

    // Switch UI immediately
    document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');
    document.getElementById('gameDetailsArea').scrollTop = 0;

    document.getElementById('detailsGameTitle').innerText = game.name;
    state.currentGameExePath = game.path;
    state.currentGameId = game.id;

    const headerName = document.getElementById('detailsHeaderName');
    if (headerName) headerName.textContent = game.name;

    // Reset description wrapper
    const descWrapper = document.getElementById('descWrapper');
    const readMoreBtn = document.getElementById('readMoreBtn');
    if (descWrapper) descWrapper.classList.remove('expanded');
    if (readMoreBtn) { readMoreBtn.style.display = 'none'; readMoreBtn.classList.remove('active'); }

    // Render existing data instantly
    renderGameDetails(game);

    // Playtime and backup info
    const totalMinutes = await window.api.getPlaytime(game.name);
    const playtimeDisplay = document.getElementById('totalPlaytimeValue');
    if (playtimeDisplay) playtimeDisplay.innerText = formatPlaytime(totalMinutes || 0, userSettings.lang);

    // Last Played (below playtime container)
    const lastPlayedContainer = document.getElementById('lastPlayedContainer');
    const lastPlayedValueSpan = document.getElementById('lastPlayedValue');
    if (lastPlayedContainer && lastPlayedValueSpan) {
        const playtimeInfo = await window.api.getPlaytimeInfo(game.name);
        if (playtimeInfo.lastPlayed) {
            const date = new Date(playtimeInfo.lastPlayed);
            const formatted = date.toLocaleString(userSettings.lang === 'ar' ? 'ar-EG' : 'en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            lastPlayedValueSpan.innerText = formatted;
            lastPlayedContainer.style.display = 'flex';
        } else {
            lastPlayedContainer.style.display = 'none';
        }
    }

    const bInfo = await window.api.backup.getInfo(game.name);
    updateBackupSidebarUI(bInfo, game.name, userSettings.lang);

    // Play button state
    const playBtn = document.getElementById('detailsPlayBtn');
    const timerContainer = document.getElementById('sessionTimerContainer');
    if (state.isGameRunning && state.currentGameExePath === game.path) {
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.add('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
        }
        if (timerContainer) timerContainer.style.display = 'flex';
    } else {
        if (timerContainer) timerContainer.style.display = 'none';
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
            playBtn.style.cssText = '';
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
        }
    }

    // Background fetch if data not cached
    const isCached = !!(
        game.metadata?.description &&
        game.metadata.description.trim() !== '' &&
        game.assets?.poster?.startsWith('local-resource://')
    );

    if (!isCached) {
        console.log(`[FRONTEND] ⚡ Background fetch for: ${game.name}`);
        window.api.fetchGameDetails(game.name).then(async (freshData) => {
            if (freshData?.assets && freshData?.metadata) {
                console.log(`[FRONTEND] ✅ Background fetch complete for: ${game.name}`);
                game.assets = freshData.assets;
                game.metadata = freshData.metadata;
                renderGameDetails(game);
                await window.api.saveGameDetails(game.id, {
                    name: game.name,
                    assets: freshData.assets,
                    metadata: freshData.metadata,
                });
            }
        }).catch(err => console.error('[FRONTEND] Background fetch failed:', err));
    }

    // Adjust sidebar visibility
    const sidebar = document.querySelector('.details-sidebar');
    const detailsContent = document.querySelector('.details-content');
    if (sidebar && bInfo?.lastBackupDate) {
        sidebar.style.display = 'block';
        if (detailsContent) detailsContent.style.gridTemplateColumns = '3fr 1fr';
    }
}