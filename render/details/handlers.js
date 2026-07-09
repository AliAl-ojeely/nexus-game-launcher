import { state, userSettings } from '../state.js';
import { formatTime, formatPlaytime } from '../details-utils.js';
import { showToast, updateBackupSidebarUI, pulseBackupSuccess } from '../details-components.js';
import { t } from './helpers.js';
import { session, resetSession } from './state.js';
import { renderGames } from '../library.js';

export async function handleGameStop(gameName, elapsedSecondsFromBackend) {
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

    // ✅ Use elapsed from backend (already accounts for pauses)
    const elapsedSeconds = elapsedSecondsFromBackend || 0;
    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    console.log(`[FRONTEND] ⏱️ Session (active): ${elapsedSeconds}s = ${elapsedMinutes}min`);

    const newTotalPlaytime = await window.api.addPlaytime(gameName, elapsedMinutes, elapsedSeconds);
    if (elapsedSeconds >= 60 && newTotalPlaytime !== false && newTotalPlaytime !== undefined) {
        const playtimeDisplay = document.getElementById('totalPlaytimeValue');
        const currentGame = state.allGamesData.find(g => g.name === gameName);
        if (playtimeDisplay && currentGame && state.currentGameExePath === currentGame.path) {
            playtimeDisplay.innerText = formatPlaytime(newTotalPlaytime, userSettings.lang);
        }
    } else {
        const existingTotal = await window.api.getPlaytime(gameName);
        const playtimeDisplay = document.getElementById('totalPlaytimeValue');
        const currentGame = state.allGamesData.find(g => g.name === gameName);
        if (playtimeDisplay && currentGame && state.currentGameExePath === currentGame.path) {
            playtimeDisplay.innerText = formatPlaytime(existingTotal, userSettings.lang);
        }
    }

    // Refresh Last Played (unchanged)
    const updatedInfo = await window.api.getPlaytimeInfo(gameName);
    const lastPlayedContainer = document.getElementById('lastPlayedContainer');
    const lastPlayedValueSpan = document.getElementById('lastPlayedValue');
    if (lastPlayedContainer && lastPlayedValueSpan && updatedInfo.lastPlayed) {
        const date = new Date(updatedInfo.lastPlayed);
        const formatted = date.toLocaleString(userSettings.lang === 'ar' ? 'ar-EG' : 'en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
        lastPlayedValueSpan.innerText = formatted;
        lastPlayedContainer.style.display = 'flex';
    } else if (lastPlayedContainer) {
        lastPlayedContainer.style.display = 'none';
    }

    // Check auto backup setting
    let autoBackup = true;
    try {
        autoBackup = await window.api.backup.getAutoBackup();
        console.log(`[FRONTEND] 🔍 autoBackup = ${autoBackup}`);
    } catch (err) {
        console.warn('[FRONTEND] Failed to get autoBackup setting:', err);
    }

    const playBtn = document.getElementById('detailsPlayBtn');
    let backupResult = { success: false };

    if (!autoBackup) {
        console.log(`[FRONTEND] ⏭️ Auto backup disabled, skipping backup for "${gameName}"`);
    } else {
        // Show securing UI
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
    }

    // Final cleanup
    state.isGameRunning = false;
    session.startTime = 0;
    session.isHandlingStop = false;

    const timerContainer = document.getElementById('sessionTimerContainer');
    if (timerContainer) timerContainer.style.display = 'none';
    const timerValue = document.getElementById('sessionTimerValue');
    if (timerValue) timerValue.innerText = '00:00:00';

    const resetDelay = (autoBackup && backupResult.success) ? 3000 : 500;
    setTimeout(async () => {
        const btn = document.getElementById('detailsPlayBtn');
        if (btn) {
            btn.disabled = false;
            btn.style.cssText = '';
            btn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
            const playLabel = t('btn_play', userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play');
            btn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${playLabel}</span>`;
        }
        await renderGames();
    }, resetDelay);
}

function extractRequiredRam(reqText) {
    if (!reqText) return 0;
    const match = reqText.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|mb)\s*ram/);
    if (match) {
        const val = parseFloat(match[1]);
        const unit = match[2];
        if (unit === 'mb') return val / 1024;
        return val;
    }
    return 0;
}

export async function handleCanIRunItCheck() {
    const btn = document.getElementById('runItCheckBtn');
    const resultBox = document.getElementById('runItResultBox');
    if (!btn || !resultBox) return;

    btn.disabled = true;
    const originalText = btn.innerHTML;
    const checkingLabel = t('btn_checking', userSettings.lang === 'ar' ? 'جاري الفحص...' : 'Checking...');
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${checkingLabel}`;
    
    try {
        const mySpecs = await window.api.getSystemSpecs();
        if (!mySpecs) throw new Error("Could not fetch specs");

        document.getElementById('myOs').innerText = mySpecs.os || 'Unknown';
        document.getElementById('myCpu').innerText = mySpecs.cpu || 'Unknown';
        document.getElementById('myRam').innerText = mySpecs.ramGB || '0';
        document.getElementById('myGpu').innerText = mySpecs.gpu || 'Unknown';

        const rawMinReqs = document.getElementById('gameMinReqsText').getAttribute('data-raw-req') || '';
        const reqRamGB = extractRequiredRam(rawMinReqs);

        const titleEl = document.getElementById('runItScoreTitle');
        const descEl = document.getElementById('runItScoreDesc');
        const reqBox = document.querySelector('#runItResultBox .req-box');

        if (reqRamGB > 0) {
            if (mySpecs.ramGB >= reqRamGB * 2) {
                titleEl.innerText = t('run_it_excellent', 'Excellent!');
                titleEl.style.color = "#10b981";
                descEl.innerText = t('run_it_excellent_desc', 'Your PC easily exceeds the basic memory requirements. High settings expected.');
                if (reqBox) reqBox.style.borderColor = "#10b981";
            } else if (mySpecs.ramGB >= reqRamGB) {
                titleEl.innerText = t('run_it_playable', 'Playable');
                titleEl.style.color = "#e6f63b";
                descEl.innerText = t('run_it_playable_desc', 'Your PC meets the memory requirements. Expect decent performance on medium settings.');
                if (reqBox) reqBox.style.borderColor = "#e6f63b";
            } else {
                titleEl.innerText = t('run_it_warning', 'Warning');
                titleEl.style.color = "#ef4444";
                descEl.innerText = t('run_it_warning_desc', 'Your PC RAM is below the minimum required. You may experience severe stuttering.');
                if (reqBox) reqBox.style.borderColor = "#ef4444";
            }
        } else {
            titleEl.innerText = t('run_it_specs_loaded', 'Specs Loaded');
            titleEl.style.color = "var(--text-main)";
            descEl.innerText = t('run_it_specs_loaded_desc', 'Compare your specs manually with the text provided.');
            if (reqBox) reqBox.style.borderColor = "var(--border-color)";
        }

        resultBox.style.display = 'block';
    } catch (err) {
        console.error("Can I Run It Error:", err);
        const isAr = userSettings.lang === 'ar';
        showToast('error', isAr ? 'فشل فحص النظام' : 'System Check Failed', err.message, 4000);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}