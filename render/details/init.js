import { state, userSettings } from '../state.js';
import { handleGameStop } from './handlers.js';
import { showToast, updateBackupSidebarUI, pulseBackupSuccess } from '../details-components.js';
import { formatTime } from '../details-utils.js';
import { t } from './helpers.js';
import { session, resetSession } from './state.js';

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

        if (session.timerInterval) clearInterval(session.timerInterval);
        session.timerInterval = setInterval(() => {
            if (!state.isGameRunning) { clearInterval(session.timerInterval); return; }
            const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
            const timerValue = document.getElementById('sessionTimerValue');
            if (timerValue) timerValue.innerText = formatTime(elapsed);
        }, 1000);
    };

    // Game events
    if (window.api.removeGameStoppedListener) window.api.removeGameStoppedListener();
    if (window.api.removeGameErrorListener) window.api.removeGameErrorListener();

    window.api.onGameStopped(async (data) => {
        console.log(`[FRONTEND] 🛑 game:stopped → gameId: ${data.gameId}`);
        const currentGame = state.allGamesData.find(g => String(g.id) === String(data.gameId));
        if (currentGame) await handleGameStop(currentGame.name);
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