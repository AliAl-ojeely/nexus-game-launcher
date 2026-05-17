import { state, userSettings } from '../state.js';
import { handleGameStop } from './handlers.js';
import { showToast, updateBackupSidebarUI, pulseBackupSuccess } from '../details-components.js';
import { formatTime } from '../details-utils.js';
import { t } from './helpers.js';
import { session, resetSession } from './state.js';

// Helper to get base filename from a full path (works without Node's 'path' module)
function getBasename(filePath) {
    if (!filePath) return '';
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1].toLowerCase();
}

export function initDetails() {
    // Play / Stop button
    document.getElementById('detailsPlayBtn').onclick = async () => {
        if (state.isGameRunning) {
            const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
            if (!currentGame) return;
            const playBtn = document.getElementById('detailsPlayBtn');
            if (playBtn) {
                playBtn.disabled = true;
                playBtn.classList.add('play-btn-stopping');
                playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('stopping', userSettings.lang === 'ar' ? 'جاري الإيقاف...' : 'Stopping...')}`;
            }
            window.api.forceStopGame(currentGame.id);
            return;
        }

        if (!state.currentGameExePath) return;
        const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
        if (!currentGame) return;

        console.log(`[FRONTEND] ▶️ Launching: ${currentGame.name}`);
        session.startTime = Date.now();
        state.isGameRunning = true;
        session.isHandlingStop = false;

        const playBtn = document.getElementById('detailsPlayBtn');
        if (playBtn) {
            playBtn.classList.add('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
        }

        const showFPS = localStorage.getItem('showFPS') === 'true';
        window.api.launchGame(
            currentGame.path, showFPS, currentGame.arguments || '',
            currentGame.id, currentGame.name
        );

        const timerContainer = document.getElementById('sessionTimerContainer');
        if (timerContainer) timerContainer.style.display = 'flex';
        // No local interval – display is updated by backend 'game:tick' events
    };

    // Game events
    if (window.api.removeGameStoppedListener) window.api.removeGameStoppedListener();
    if (window.api.removeGameErrorListener) window.api.removeGameErrorListener();

    window.api.onGameStopped(async (data) => {
        console.log(`[FRONTEND] 🛑 game:stopped → gameId: ${data.gameId}, elapsed: ${data.elapsed}s`);
        const currentGame = state.allGamesData.find(g => String(g.id) === String(data.gameId));
        if (currentGame) await handleGameStop(currentGame.name, data.elapsed);
    });

    window.api.onGameError((data) => {
        console.error(`[FRONTEND] ❌ Launch error: ${data.message}`);
        showToast('error', data.message || 'Launch failed', '', 5000);
        const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
        if (currentGame && state.isGameRunning) handleGameStop(currentGame.name);
    });

    // Folder button
    document.getElementById('detailsFolderBtn').onclick = () => {
        if (!state.currentGameExePath) return;
        const folderBtn = document.getElementById('detailsFolderBtn');
        folderBtn.disabled = true;
        folderBtn.style.opacity = '0.7';
        folderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('opening', userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...')}`;
        window.api.openFolder(state.currentGameExePath);
        setTimeout(() => {
            folderBtn.disabled = false;
            folderBtn.style.opacity = '1';
            folderBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> <span data-i18n="btn_folder">${t('btn_folder', userSettings.lang === 'ar' ? 'مجلد اللعبة' : 'Game Folder')}</span>`;
        }, 1200);
    };

    // Backup Now button
    const backupNowBtn = document.getElementById('backupNowBtn');
    if (backupNowBtn) {
        backupNowBtn.onclick = async () => {
            const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
            if (!currentGame) return;

            backupNowBtn.disabled = true;
            backupNowBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${t('backing_up', userSettings.lang === 'ar' ? 'جاري الحفظ...' : 'Backing up...')}</span>`;

            const result = await window.api.backup.now(currentGame.name, '', currentGame.path);

            if (result.success) {
                showToast('success',
                    t('backup_created', userSettings.lang === 'ar' ? 'تم الحفظ بنجاح ✅' : 'Backup created ✅'),
                    result.zipPath ? result.zipPath.split('\\').pop() : '',
                    5000
                );
                pulseBackupSuccess();
                const freshInfo = await window.api.backup.getInfo(currentGame.name);
                updateBackupSidebarUI(freshInfo, currentGame.name, userSettings.lang);
            } else {
                let errorMsg = result.error || '';
                if (errorMsg === 'No backup path configured') {
                    showToast('info',
                        t('backup_no_path', userSettings.lang === 'ar' ? 'لم يتم تحديد مسار النسخ الاحتياطي' : 'No backup path set'),
                        t('backup_no_path_hint', userSettings.lang === 'ar' ? 'حدد المسار في الإعدادات أو في نافذة تعديل اللعبة' : 'Set a path in Settings or in the game edit modal'),
                        5000
                    );
                } else {
                    showToast('error', t('backup_failed', 'Backup failed'), errorMsg, 5000);
                }
            }

            backupNowBtn.disabled = false;
            backupNowBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span data-i18n="btn_backup_now">${t('btn_backup_now', userSettings.lang === 'ar' ? 'حفظ الآن' : 'Backup Now')}</span>`;
        };
    }

    // Pause and Resume Timer
    const pauseBtn = document.getElementById('pauseTimerBtn');
    let timerPaused = false;

    window.api.onGameStarted(() => {
        pauseBtn.style.display = 'flex';
        timerPaused = false;
        pauseBtn.innerHTML = '<i class="fa-regular fa-circle-pause"></i>';
    });

    window.api.onGameStopped(() => {
        pauseBtn.style.display = 'none';
    });

    pauseBtn.onclick = async () => {
        timerPaused = !timerPaused;
        if (timerPaused) {
            pauseBtn.innerHTML = '<i class="fa-regular fa-circle-play"></i>';
            await window.api.pauseTimer();
        } else {
            pauseBtn.innerHTML = '<i class="fa-regular fa-circle-pause"></i>';
            await window.api.resumeTimer();
        }
    };

    // Listen to backend ticks to update timer display
    if (window.api.onGameTick) {
        window.api.onGameTick((data) => {
            const timerValue = document.getElementById('sessionTimerValue');
            if (timerValue && data.elapsed !== undefined) {
                timerValue.innerText = formatTime(data.elapsed);
            }
        });
    } else {
        console.warn('[FRONTEND] onGameTick not available');
    }

    // Read More button
    const readMoreBtn = document.getElementById('readMoreBtn');
    if (readMoreBtn) {
        readMoreBtn.onclick = function () {
            const wrapper = document.getElementById('descWrapper');
            const isExpanded = wrapper.classList.toggle('expanded');
            this.classList.toggle('active');
            this.querySelector('span').innerText = isExpanded
                ? (userSettings.lang === 'ar' ? 'عرض أقل' : 'Show Less')
                : (userSettings.lang === 'ar' ? 'إقرأ المزيد' : 'Read More');
        };
    }
}