// import { state, userSettings } from './state.js';
// import { openLightbox } from './shortcuts.js';
// import { toSafeUrl, formatTime, formatPlaytime, isValid } from './details-utils.js';
// import { showToast, updateBackupSidebarUI, pulseBackupSuccess, setupTrailerButton } from './details-components.js';

// // Helper for translations
// function t(key, fallback = '') {
//     const lang = userSettings.lang;
//     return (dictionary[lang] && dictionary[lang][key]) || fallback;
// }

// // ─── Session State ────────────────────────────────────────────────────────────
// let sessionStartTime = 0;
// let sessionTimerInterval = null;
// let isHandlingStop = false;

// // ─────────────────────────────────────────────────────────────────────────────
// // HANDLE GAME STOP
// // ─────────────────────────────────────────────────────────────────────────────
// async function handleGameStop(gameName) {
//     if (isHandlingStop) {
//         console.log(`[FRONTEND] ⚠️ handleGameStop already running for: ${gameName} — skipping`);
//         return;
//     }

//     if (!state.isGameRunning || sessionStartTime === 0) {
//         console.log(`[FRONTEND] ⚠️ handleGameStop called but no active session — skipping`);
//         return;
//     }

//     isHandlingStop = true;
//     console.log(`[FRONTEND] ⏹️ Session ended for: ${gameName}`);

//     clearInterval(sessionTimerInterval);
//     sessionTimerInterval = null;

//     const playBtn = document.getElementById('detailsPlayBtn');
//     if (playBtn) {
//         playBtn.disabled = true;
//         playBtn.classList.remove('play-btn-running', 'play-btn-stopping');
//         playBtn.classList.add('play-btn-securing');
//         playBtn.style.cssText += `
//             background: linear-gradient(135deg, #f59e0b, #d97706) !important;
//             border-color: #f59e0b !important;
//             color: #fff !important;
//             cursor: not-allowed !important;
//         `;
//         const securingLabel = t('backup_securing_short', userSettings.lang === 'ar' ? 'جاري التأمين...' : 'Securing Save...');
//         playBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up fa-spin"></i> ${securingLabel}`;
//     }

//     const savingLabel = userSettings.lang === 'ar'
//         ? `${t('backup_securing', 'جاري تأمين نسخة لـ')} "${gameName}"...`
//         : `${t('backup_securing', 'Securing save for')} "${gameName}"...`;
//     const savingToast = showToast('saving', savingLabel, '', 0);

//     const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
//     const elapsedMinutes = Math.floor(elapsedSeconds / 60);
//     console.log(`[FRONTEND] ⏱️ Session: ${elapsedSeconds}s = ${elapsedMinutes}min`);

//     const newTotalPlaytime = await window.api.addPlaytime(gameName, elapsedMinutes, elapsedSeconds);
//     if (newTotalPlaytime !== false && newTotalPlaytime !== undefined) {
//         const playtimeDisplay = document.getElementById('totalPlaytimeValue');
//         const currentGame = state.allGamesData.find(g => g.name === gameName);
//         if (playtimeDisplay && currentGame && state.currentGameExePath === currentGame.path) {
//             playtimeDisplay.innerText = formatPlaytime(newTotalPlaytime, userSettings.lang);
//         }
//     }

//     let backupResult = { success: false };
//     try {
//         const currentGame = state.allGamesData.find(g => g.name === gameName);
//         const bInfo = await window.api.backup.getInfo(gameName);
//         const backupDir = bInfo.config?.backupPath || '';

//         if (backupDir) {
//             backupResult = await window.api.backup.now(
//                 gameName, backupDir, currentGame?.path || null
//             );
//         } else {
//             const freshInfo = await window.api.backup.getInfo(gameName);
//             backupResult.success = (freshInfo?.backupCounter || 0) > 0;
//         }
//     } catch (err) {
//         console.warn('[FRONTEND] Backup check error:', err.message);
//     }

//     if (savingToast) {
//         savingToast.style.opacity = '0';
//         savingToast.style.transform = 'translateX(20px)';
//         setTimeout(() => savingToast.remove(), 280);
//     }

//     if (backupResult.success) {
//         if (playBtn) {
//             playBtn.style.cssText += `
//                 background: linear-gradient(135deg, #10b981, #059669) !important;
//                 border-color: #10b981 !important;
//                 cursor: not-allowed !important;
//             `;
//             const savedLabel = t('backup_saved', userSettings.lang === 'ar' ? 'تم الحفظ! ✓' : 'Saved! ✓');
//             playBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${savedLabel}`;
//         }

//         const successMsg = userSettings.lang === 'ar'
//             ? `${t('backup_success_msg', 'تم تأمين نسخة احتياطية لـ')} "${gameName}" ✅`
//             : `${t('backup_success_msg', 'Save secured for')} "${gameName}" ✅`;
//         const subMsg = backupResult.zipPath ? backupResult.zipPath.split('\\').pop() : '';
//         showToast('success', successMsg, subMsg, 5000);

//         pulseBackupSuccess();
//         const freshInfo = await window.api.backup.getInfo(gameName);
//         const currentGame = state.allGamesData.find(g => g.name === gameName);
//         if (currentGame && state.currentGameExePath === currentGame.path) {
//             updateBackupSidebarUI(freshInfo, gameName, userSettings.lang);
//         }
//     } else {
//         const warnMsg = userSettings.lang === 'ar'
//             ? `${t('backup_no_backup_created', 'لم يتم إنشاء نسخة احتياطية لـ')} "${gameName}"`
//             : `${t('backup_no_backup_created', 'No backup created for')} "${gameName}"`;
//         const warnSub = t('backup_no_path_hint', userSettings.lang === 'ar' ? 'تأكد من ضبط مسار الخزنة في الإعدادات' : 'Set a backup vault in Settings to enable auto-backup');
//         showToast('info', warnMsg, warnSub, 5000);
//     }

//     state.isGameRunning = false;
//     sessionStartTime = 0;
//     isHandlingStop = false;

//     const timerContainer = document.getElementById('sessionTimerContainer');
//     if (timerContainer) timerContainer.style.display = 'none';
//     const timerValue = document.getElementById('sessionTimerValue');
//     if (timerValue) timerValue.innerText = '00:00:00';

//     setTimeout(() => {
//         if (playBtn) {
//             playBtn.disabled = false;
//             playBtn.style.cssText = '';
//             playBtn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
//             const playLabel = t('btn_play', userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play');
//             playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${playLabel}</span>`;
//         }
//     }, 3000);
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // RENDER PAGE — displays existing game data (including system requirements)
// // ─────────────────────────────────────────────────────────────────────────────
// function renderGameDetails(game) {
//     const assets = game.assets || {};
//     const meta = game.metadata || {};

//     const banner = document.getElementById('detailsBanner');
//     const logoImg = document.getElementById('detailsLogo');
//     const headerIcon = document.getElementById('detailsHeaderIcon');
//     const screenshotsGrid = document.getElementById('detailsScreenshotsGrid');
//     const descEl = document.getElementById('detailsDescription');
//     const readMoreBtn = document.getElementById('readMoreBtn');

//     // Banner
//     const bgUrl = toSafeUrl(assets.background || assets.poster || '');
//     if (banner) banner.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : '';

//     // Logo
//     if (logoImg) {
//         if (assets.logo) {
//             logoImg.src = toSafeUrl(assets.logo);
//             logoImg.style.display = 'block';
//         } else {
//             logoImg.style.display = 'none';
//         }
//     }

//     // Header Icon
//     if (headerIcon) {
//         if (assets.icon) {
//             headerIcon.src = toSafeUrl(assets.icon);
//             headerIcon.style.display = 'block';
//             headerIcon.onerror = () => { headerIcon.style.display = 'none'; };
//         } else {
//             headerIcon.style.display = 'none';
//         }
//     }

//     // Description
//     if (isValid(meta.description)) {
//         descEl.innerHTML = meta.description;
//         setTimeout(() => {
//             if (readMoreBtn && descEl.scrollHeight > 165) {
//                 readMoreBtn.style.display = 'flex';
//                 readMoreBtn.querySelector('span').innerText = t('read_more', userSettings.lang === 'ar' ? 'إقرأ المزيد' : 'Read More');
//             } else if (readMoreBtn) {
//                 readMoreBtn.style.display = 'none';
//             }
//         }, 200);
//     } else {
//         descEl.innerHTML = `<p>${t('fetching_description', userSettings.lang === 'ar' ? 'جاري جلب الوصف...' : 'Fetching description...')}</p>`;
//     }

//     // Sidebar metadata
//     const updateMeta = (id, value) => {
//         const el = document.getElementById(id);
//         if (el && isValid(value)) {
//             el.parentElement.style.display = 'block';
//             el.innerText = value;
//         } else if (el) {
//             el.parentElement.style.display = 'none';
//         }
//     };

//     updateMeta('detailsDev', meta.developer);
//     updateMeta('detailsPub', meta.publisher);
//     updateMeta('detailsRelease', meta.releaseDate);

//     // Metacritic
//     const metacriticEl = document.getElementById('detailsMetacritic');
//     if (metacriticEl) {
//         if (!isValid(meta.metacritic)) {
//             metacriticEl.parentElement.style.display = 'none';
//         } else {
//             metacriticEl.parentElement.style.display = 'block';
//             metacriticEl.textContent = meta.metacritic;
//             metacriticEl.className = 'metacritic-score';
//             const n = parseInt(meta.metacritic);
//             if (n >= 75) metacriticEl.classList.add('high');
//             else if (n >= 50) metacriticEl.classList.add('medium');
//             else metacriticEl.classList.add('low');
//         }
//     }

//     // Genres & Tags
//     const updateTags = (id, value, tagClass) => {
//         const container = document.getElementById(id);
//         if (!container) return;
//         container.innerHTML = '';
//         if (isValid(value)) {
//             value.split(',').map(v => v.trim()).filter(Boolean).forEach(text => {
//                 const span = document.createElement('span');
//                 span.className = tagClass;
//                 span.textContent = text;
//                 container.appendChild(span);
//             });
//             container.parentElement.style.display = 'block';
//         } else {
//             container.parentElement.style.display = 'none';
//         }
//     };
//     updateTags('detailsGenres', meta.genres, 'genre-tag');
//     updateTags('detailsTags', meta.tags, 'feature-tag');

//     // ── System Requirements ───────────────────────────────────────────────────
//     const reqMinEl = document.getElementById('reqMin');
//     const reqRecEl = document.getElementById('reqRec');
//     const fullReqSection = document.getElementById('systemRequirementsSection');
//     let hasAnyReq = false;
//     const sysReqs = meta.systemRequirements || null;

//     if (reqMinEl) {
//         if (sysReqs && isValid(sysReqs.minimum)) {
//             reqMinEl.innerHTML = sysReqs.minimum;
//             reqMinEl.parentElement.style.display = 'block';
//             hasAnyReq = true;
//         } else {
//             reqMinEl.parentElement.style.display = 'none';
//         }
//     }
//     if (reqRecEl) {
//         if (sysReqs && isValid(sysReqs.recommended)) {
//             reqRecEl.innerHTML = sysReqs.recommended;
//             reqRecEl.parentElement.style.display = 'block';
//             hasAnyReq = true;
//         } else {
//             reqRecEl.parentElement.style.display = 'none';
//         }
//     }
//     if (fullReqSection) fullReqSection.style.display = hasAnyReq ? 'block' : 'none';

//     // Screenshots
//     if (screenshotsGrid) {
//         screenshotsGrid.innerHTML = '';
//         if (meta.media?.screenshots?.length > 0) {
//             state.currentScreenshotsList = meta.media.screenshots;
//             meta.media.screenshots.forEach((imgUrl, index) => {
//                 const img = document.createElement('img');
//                 img.src = toSafeUrl(imgUrl);
//                 img.className = 'screenshot-item';
//                 img.loading = 'lazy';
//                 img.onclick = () => openLightbox(index);
//                 screenshotsGrid.appendChild(img);
//             });
//         }
//     }

//     // Trailer button
//     setupTrailerButton(meta.media, game.name);
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // OPEN GAME DETAILS PAGE (with background fetch)
// // ─────────────────────────────────────────────────────────────────────────────
// export async function openGameDetailsPage(game) {
//     if (!game || !game.name) return;

//     // 1. Switch UI immediately
//     document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
//     document.getElementById('mainTopbar').style.display = 'none';
//     document.getElementById('gameDetailsArea').classList.add('active');
//     document.getElementById('gameDetailsArea').scrollTop = 0;

//     document.getElementById('detailsGameTitle').innerText = game.name;

//     state.currentGameExePath = game.path;
//     state.currentGameId = game.id; 

//     const headerName = document.getElementById('detailsHeaderName');
//     if (headerName) headerName.textContent = game.name;

//     // Reset description wrapper
//     const descWrapper = document.getElementById('descWrapper');
//     const readMoreBtn = document.getElementById('readMoreBtn');
//     if (descWrapper) descWrapper.classList.remove('expanded');
//     if (readMoreBtn) { readMoreBtn.style.display = 'none'; readMoreBtn.classList.remove('active'); }

//     // 2. Render existing data instantly
//     renderGameDetails(game);

//     // 3. Playtime and backup info (quick local operations)
//     const totalMinutes = await window.api.getPlaytime(game.name);
//     const playtimeDisplay = document.getElementById('totalPlaytimeValue');
//     if (playtimeDisplay) playtimeDisplay.innerText = formatPlaytime(totalMinutes || 0, userSettings.lang);

//     const bInfo = await window.api.backup.getInfo(game.name);
//     updateBackupSidebarUI(bInfo, game.name, userSettings.lang);

//     // 4. Play button state
//     const playBtn = document.getElementById('detailsPlayBtn');
//     const timerContainer = document.getElementById('sessionTimerContainer');
//     if (state.isGameRunning && state.currentGameExePath === game.path) {
//         if (playBtn) {
//             playBtn.disabled = false;
//             playBtn.classList.add('play-btn-running');
//             playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
//         }
//         if (timerContainer) timerContainer.style.display = 'flex';
//     } else {
//         if (timerContainer) timerContainer.style.display = 'none';
//         if (playBtn) {
//             playBtn.disabled = false;
//             playBtn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
//             playBtn.style.cssText = '';
//             playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
//         }
//     }

//     // 5. Background fetch if data is not cached
//     const isCached = !!(
//         game.metadata?.description &&
//         game.metadata.description.trim() !== '' &&
//         game.assets?.poster?.startsWith('local-resource://')
//     );

//     if (!isCached) {
//         console.log(`[FRONTEND] ⚡ Background fetch for: ${game.name}`);
//         window.api.fetchGameDetails(game.name).then(async (freshData) => {
//             if (freshData?.assets && freshData?.metadata) {
//                 console.log(`[FRONTEND] ✅ Background fetch complete for: ${game.name}`);
//                 game.assets = freshData.assets;
//                 game.metadata = freshData.metadata;
//                 renderGameDetails(game);
//                 await window.api.saveGameDetails(game.id, {
//                     name: game.name,
//                     assets: freshData.assets,
//                     metadata: freshData.metadata,
//                 });
//             }
//         }).catch(err => console.error('[FRONTEND] Background fetch failed:', err));
//     }

//     // Adjust sidebar visibility after backup info loads
//     const sidebar = document.querySelector('.details-sidebar');
//     const detailsContent = document.querySelector('.details-content');
//     if (sidebar && bInfo?.lastBackupDate) {
//         sidebar.style.display = 'block';
//         if (detailsContent) detailsContent.style.gridTemplateColumns = '3fr 1fr';
//     }
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // INIT DETAILS (event listeners)
// // ─────────────────────────────────────────────────────────────────────────────
// export function initDetails() {
//     // Play / Stop button
//     document.getElementById('detailsPlayBtn').onclick = async () => {
//         if (state.isGameRunning) {
//             const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
//             console.log('[DEBUG] currentGameExePath:', state.currentGameExePath);
//             console.log('[DEBUG] currentGame:', currentGame);
//             if (!currentGame) return;
//             const playBtn = document.getElementById('detailsPlayBtn');
//             if (playBtn) {
//                 playBtn.disabled = true;
//                 playBtn.classList.add('play-btn-stopping');
//                 playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('stopping', userSettings.lang === 'ar' ? 'جاري الإيقاف...' : 'Stopping...')}`;
//             }
//             window.api.forceStopGame(currentGame.id);
//             return;
//         }

//         if (!state.currentGameExePath) return;
//         const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
//         if (!currentGame) return;

//         console.log(`[FRONTEND] ▶️ Launching: ${currentGame.name}`);
//         sessionStartTime = Date.now();
//         state.isGameRunning = true;
//         isHandlingStop = false;

//         const playBtn = document.getElementById('detailsPlayBtn');
//         if (playBtn) {
//             playBtn.classList.add('play-btn-running');
//             playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
//         }

//         const showFPS = localStorage.getItem('showFPS') === 'true';
//         window.api.launchGame(
//             currentGame.path, showFPS, currentGame.arguments || '',
//             currentGame.id, currentGame.name
//         );

//         const timerContainer = document.getElementById('sessionTimerContainer');
//         if (timerContainer) timerContainer.style.display = 'flex';

//         sessionTimerInterval = setInterval(() => {
//             if (!state.isGameRunning) { clearInterval(sessionTimerInterval); return; }
//             const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
//             const timerValue = document.getElementById('sessionTimerValue');
//             if (timerValue) timerValue.innerText = formatTime(elapsed);
//         }, 1000);
//     };

//     // Game events
//     if (window.api.removeGameStoppedListener) window.api.removeGameStoppedListener();
//     if (window.api.removeGameErrorListener) window.api.removeGameErrorListener();

//     window.api.onGameStopped(async (data) => {
//         console.log(`[FRONTEND] 🛑 game:stopped → gameId: ${data.gameId}`);
//         const currentGame = state.allGamesData.find(g => String(g.id) === String(data.gameId));
//         if (currentGame) await handleGameStop(currentGame.name);
//     });

//     window.api.onGameError((data) => {
//         console.error(`[FRONTEND] ❌ Launch error: ${data.message}`);
//         showToast('error', data.message || 'Launch failed', '', 5000);
//         const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
//         if (currentGame && state.isGameRunning) handleGameStop(currentGame.name);
//     });

//     // Folder button
//     document.getElementById('detailsFolderBtn').onclick = () => {
//         if (!state.currentGameExePath) return;
//         const folderBtn = document.getElementById('detailsFolderBtn');
//         folderBtn.disabled = true;
//         folderBtn.style.opacity = '0.7';
//         folderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t('opening', userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...')}`;
//         window.api.openFolder(state.currentGameExePath);
//         setTimeout(() => {
//             folderBtn.disabled = false;
//             folderBtn.style.opacity = '1';
//             folderBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> <span data-i18n="btn_folder">${t('btn_folder', userSettings.lang === 'ar' ? 'مجلد اللعبة' : 'Game Folder')}</span>`;
//         }, 1200);
//     };

//     // Backup Now button
//     const backupNowBtn = document.getElementById('backupNowBtn');
//     if (backupNowBtn) {
//         backupNowBtn.onclick = async () => {
//             const currentGame = state.allGamesData.find(g => g.id === state.currentGameId);
//             if (!currentGame) return;

//             backupNowBtn.disabled = true;
//             backupNowBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${t('backing_up', userSettings.lang === 'ar' ? 'جاري الحفظ...' : 'Backing up...')}</span>`;

//             const result = await window.api.backup.now(currentGame.name, '', currentGame.path);

//             if (result.success) {
//                 showToast('success',
//                     t('backup_created', userSettings.lang === 'ar' ? 'تم الحفظ بنجاح ✅' : 'Backup created ✅'),
//                     result.zipPath ? result.zipPath.split('\\').pop() : '',
//                     5000
//                 );
//                 pulseBackupSuccess();
//                 const freshInfo = await window.api.backup.getInfo(currentGame.name);
//                 updateBackupSidebarUI(freshInfo, currentGame.name, userSettings.lang);
//             } else {
//                 let errorMsg = result.error || '';
//                 if (errorMsg === 'No backup path configured') {
//                     showToast('info',
//                         t('backup_no_path', userSettings.lang === 'ar' ? 'لم يتم تحديد مسار النسخ الاحتياطي' : 'No backup path set'),
//                         t('backup_no_path_hint', userSettings.lang === 'ar' ? 'حدد المسار في الإعدادات أو في نافذة تعديل اللعبة' : 'Set a path in Settings or in the game edit modal'),
//                         5000
//                     );
//                 } else {
//                     showToast('error', t('backup_failed', 'Backup failed'), errorMsg, 5000);
//                 }
//             }

//             backupNowBtn.disabled = false;
//             backupNowBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span data-i18n="btn_backup_now">${t('btn_backup_now', userSettings.lang === 'ar' ? 'حفظ الآن' : 'Backup Now')}</span>`;
//         };
//     }

//     // Read More button
//     const readMoreBtn = document.getElementById('readMoreBtn');
//     if (readMoreBtn) {
//         readMoreBtn.onclick = function () {
//             const wrapper = document.getElementById('descWrapper');
//             const isExpanded = wrapper.classList.toggle('expanded');
//             this.classList.toggle('active');
//             this.querySelector('span').innerText = isExpanded
//                 ? (userSettings.lang === 'ar' ? 'عرض أقل' : 'Show Less')
//                 : (userSettings.lang === 'ar' ? 'إقرأ المزيد' : 'Read More');
//         };
//     }
// }

export { openGameDetailsPage, initDetails } from './details/index.js';