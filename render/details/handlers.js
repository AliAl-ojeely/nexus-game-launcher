import { state, userSettings } from '../state.js';
import { formatTime, formatPlaytime } from '../details-utils.js';
import { showToast, updateBackupSidebarUI, pulseBackupSuccess } from '../details-components.js';
import { t } from './helpers.js';
import { session, resetSession } from './state.js';

export async function handleGameStop(gameName) {
    if (session.isHandlingStop) {
        console.log(`[FRONTEND] ⚠️ handleGameStop already running for: ${gameName} — skipping`);
        return;
    }

    if (!state.isGameRunning || session.startTime === 0) {
        console.log(`[FRONTEND] ⚠️ handleGameStop called but no active session — skipping`);
        return;
    }

    session.isHandlingStop = true;
    console.log(`[FRONTEND] ⏹️ Session ended for: ${gameName}`);

    if (session.timerInterval) clearInterval(session.timerInterval);
    session.timerInterval = null;

    const playBtn = document.getElementById('detailsPlayBtn');
    if (playBtn) {
        playBtn.disabled = true;
        playBtn.classList.remove('play-btn-running', 'play-btn-stopping');
        playBtn.classList.add('play-btn-securing');
        playBtn.style.cssText += `
            background: linear-gradient(135deg, #f59e0b, #d97706) !important;
            border-color: #f59e0b !important;
            color: #fff !important;
            cursor: not-allowed !important;
        `;
        const securingLabel = t('backup_securing_short', userSettings.lang === 'ar' ? 'جاري التأمين...' : 'Securing Save...');
        playBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-spin"></i> ${securingLabel}`;
    }

    const savingLabel = userSettings.lang === 'ar'
        ? `${t('backup_securing', 'جاري تأمين نسخة لـ')} "${gameName}"...`
        : `${t('backup_securing', 'Securing save for')} "${gameName}"...`;
    const savingToast = showToast('saving', savingLabel, '', 0);

    const elapsedSeconds = Math.floor((Date.now() - session.startTime) / 1000);
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    console.log(`[FRONTEND] ⏱️ Session: ${elapsedSeconds}s = ${elapsedMinutes}min`);

    const newTotalPlaytime = await window.api.addPlaytime(gameName, elapsedMinutes, elapsedSeconds);
    if (newTotalPlaytime !== false && newTotalPlaytime !== undefined) {
        const playtimeDisplay = document.getElementById('totalPlaytimeValue');
        const currentGame = state.allGamesData.find(g => g.name === gameName);
        if (playtimeDisplay && currentGame && state.currentGameExePath === currentGame.path) {
            playtimeDisplay.innerText = formatPlaytime(newTotalPlaytime, userSettings.lang);
        }
    }

    let backupResult = { success: false };
    try {
        const currentGame = state.allGamesData.find(g => g.name === gameName);
        const bInfo = await window.api.backup.getInfo(gameName);
        const backupDir = bInfo.config?.backupPath || '';

        if (backupDir) {
            backupResult = await window.api.backup.now(gameName, backupDir, currentGame?.path || null);
        } else {
            const freshInfo = await window.api.backup.getInfo(gameName);
            backupResult.success = (freshInfo?.backupCounter || 0) > 0;
        }
    } catch (err) {
        console.warn('[FRONTEND] Backup check error:', err.message);
    }

    if (savingToast) {
        savingToast.style.opacity = '0';
        savingToast.style.transform = 'translateX(20px)';
        setTimeout(() => savingToast.remove(), 280);
    }

    if (backupResult.success) {
        if (playBtn) {
            playBtn.style.cssText += `
                background: linear-gradient(135deg, #10b981, #059669) !important;
                border-color: #10b981 !important;
                cursor: not-allowed !important;
            `;
            const savedLabel = t('backup_saved', userSettings.lang === 'ar' ? 'تم الحفظ! ✓' : 'Saved! ✓');
            playBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${savedLabel}`;
        }

        const successMsg = userSettings.lang === 'ar'
            ? `${t('backup_success_msg', 'تم تأمين نسخة احتياطية لـ')} "${gameName}" ✅`
            : `${t('backup_success_msg', 'Save secured for')} "${gameName}" ✅`;
        const subMsg = backupResult.zipPath ? backupResult.zipPath.split('\\').pop() : '';
        showToast('success', successMsg, subMsg, 5000);

        pulseBackupSuccess();
        const freshInfo = await window.api.backup.getInfo(gameName);
        const currentGame = state.allGamesData.find(g => g.name === gameName);
        if (currentGame && state.currentGameExePath === currentGame.path) {
            updateBackupSidebarUI(freshInfo, gameName, userSettings.lang);
        }
    } else {
        const warnMsg = userSettings.lang === 'ar'
            ? `${t('backup_no_backup_created', 'لم يتم إنشاء نسخة احتياطية لـ')} "${gameName}"`
            : `${t('backup_no_backup_created', 'No backup created for')} "${gameName}"`;
        const warnSub = t('backup_no_path_hint', userSettings.lang === 'ar' ? 'تأكد من ضبط مسار الخزنة في الإعدادات' : 'Set a backup vault in Settings to enable auto-backup');
        showToast('info', warnMsg, warnSub, 5000);
    }

    state.isGameRunning = false;
    session.startTime = 0;
    session.isHandlingStop = false;

    const timerContainer = document.getElementById('sessionTimerContainer');
    if (timerContainer) timerContainer.style.display = 'none';
    const timerValue = document.getElementById('sessionTimerValue');
    if (timerValue) timerValue.innerText = '00:00:00';

    setTimeout(() => {
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.style.cssText = '';
            playBtn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
            const playLabel = t('btn_play', userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play');
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${playLabel}</span>`;
        }
    }, 3000);
}