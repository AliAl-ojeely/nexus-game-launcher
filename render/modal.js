// import { state, userSettings } from './state.js';
// import { renderGames } from './library.js';

// // Helper to get translation
// function t(key, fallback = '') {
//     const lang = userSettings.lang;
//     return (dictionary[lang] && dictionary[lang][key]) || fallback;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // BACKUP PATH STATUS INDICATOR
// // ─────────────────────────────────────────────────────────────────────────────

// function showSavePathStatus(statusState, foundPath = '') {
//     const statusEl = document.getElementById('savePathStatus');
//     if (!statusEl) return;

//     const configs = {
//         found: {
//             color: '#10b981',
//             bg: 'rgba(16,185,129,0.08)',
//             border: 'rgba(16,185,129,0.25)',
//             icon: 'fa-circle-check',
//             text: t('backup_path_found', userSettings.lang === 'ar' ? 'مسار الحفظ محدد' : 'Save path configured'),
//         },
//         notfound: {
//             color: '#f59e0b',
//             bg: 'rgba(245,158,11,0.08)',
//             border: 'rgba(245,158,11,0.25)',
//             icon: 'fa-triangle-exclamation',
//             text: t('backup_path_not_found', userSettings.lang === 'ar' ? 'غير محدد — أضفه يدوياً في gamesBackSave.json' : 'Not set — add manually in gamesBackSave.json'),
//         },
//     };

//     const cfg = configs[statusState] || configs.notfound;
//     const shortPath = foundPath.length > 52 ? '…' + foundPath.slice(-49) : foundPath;

//     statusEl.style.cssText = `
//         display: flex;
//         align-items: center;
//         gap: 6px;
//         padding: 5px 10px;
//         border-radius: 6px;
//         background: ${cfg.bg};
//         border: 1px solid ${cfg.border};
//         font-size: 11px;
//         color: ${cfg.color};
//         margin-top: 4px;
//     `;
//     statusEl.innerHTML = `
//         <i class="fa-solid ${cfg.icon}" style="flex-shrink:0;"></i>
//         <span>${cfg.text}</span>
//         ${foundPath ? `<span style="opacity:0.65; word-break:break-all;">${shortPath}</span>` : ''}
//     `;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // POPULATE BACKUP FIELDS
// // ─────────────────────────────────────────────────────────────────────────────

// async function populateBackupFields(game) {
//     const originInput = document.getElementById('editGameOriginPath');
//     const backupInput = document.getElementById('editGameBackupPath');
//     const statusEl = document.getElementById('savePathStatus');

//     if (!originInput) return;
//     if (statusEl) statusEl.style.display = 'none';

//     const bInfo = await window.api.backup.getInfo(game.name);
//     let config = bInfo?.config || {};

//     if (config.backupPath) {
//         backupInput.value = config.backupPath;
//     } else {
//         backupInput.value = '';
//         const globalPath = await window.api.backup.getGlobalPath();
//         if (globalPath) {
//             backupInput.placeholder = userSettings.lang === 'ar'
//                 ? `${t('backup_global_default', 'المسار العام')}: ${globalPath}`
//                 : `${t('backup_global_default', 'Global default')}: ${globalPath}`;
//         }
//     }

//     if (!config.originPath) {
//         console.log(`[Modal] Origin empty for ${game.name}, attempting discovery...`);
//         const discovery = await window.api.backup.discoverPath(game.name, game.path);
//         if (discovery.found) {
//             config.originPath = discovery.path;
//             await window.api.backup.updateConfig(game.name, {
//                 originPath: discovery.path,
//                 backupPath: config.backupPath || (await window.api.backup.getGlobalPath()) || ''
//             });
//         }
//     }

//     if (config.originPath) {
//         originInput.value = config.originPath;
//         showSavePathStatus('found', config.originPath);
//     } else {
//         originInput.value = '';
//         showSavePathStatus('notfound');
//         originInput.placeholder = t('backup_auto_discover_failed', userSettings.lang === 'ar' ? 'لم يتم العثور على المسار تلقائياً' : 'Could not find save path automatically');
//     }
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // TRIGGER ADD GAME
// // ─────────────────────────────────────────────────────────────────────────────

// export async function triggerAddGameProcess(triggerElement) {
//     const originalHTML = triggerElement.innerHTML;
//     triggerElement.disabled = true;
//     triggerElement.style.opacity = '0.7';
//     triggerElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>` +
//         (triggerElement.tagName === 'BUTTON'
//             ? ` <span>${userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...'}</span>`
//             : '');

//     try {
//         const selectedPath = await window.api.selectGame();
//         if (selectedPath) {
//             state.editingGameId = null;
//             state.tempGamePath = selectedPath;

//             document.getElementById('gamePathInput').value = selectedPath;

//             const parts = selectedPath.split(/[/\\]/).filter(Boolean);
//             let rawName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
//             rawName = rawName
//                 .replace(/[-_.]/g, ' ')
//                 .replace(/\b(repack|fitgirl|empress|codex|skidrow)\b/gi, '')
//                 .replace(/\s+/g, ' ')
//                 .trim();

//             document.getElementById('gameNameInput').value = rawName;
//             document.getElementById('customLogoInput').value = '';
//             document.getElementById('customPosterInput').value = '';
//             document.getElementById('customBgInput').value = '';
//             document.getElementById('launchArgsInput').value = '';

//             const originInput = document.getElementById('editGameOriginPath');
//             const backupInput = document.getElementById('editGameBackupPath');
//             const statusEl = document.getElementById('savePathStatus');

//             if (originInput) originInput.value = '';
//             if (backupInput) {
//                 backupInput.value = '';
//                 const globalPath = await window.api.backup.getGlobalPath();
//                 backupInput.placeholder = globalPath
//                     ? (userSettings.lang === 'ar' ? `${t('backup_global_default', 'المسار العام')}: ${globalPath}` : `${t('backup_global_default', 'Global default')}: ${globalPath}`)
//                     : t('backup_leave_empty', userSettings.lang === 'ar' ? 'اتركه فارغاً للمسار العام' : 'Leave empty for global default');
//             }
//             if (statusEl) statusEl.style.display = 'none';

//             document.getElementById('saveGameModalBtn').innerHTML =
//                 `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ وبحث' : 'Save & Search'}`;
//             document.getElementById('editModal').style.display = 'flex';
//         }
//     } catch (error) {
//         console.error('Selection error:', error);
//     } finally {
//         triggerElement.disabled = false;
//         triggerElement.style.opacity = '1';
//         triggerElement.innerHTML = originalHTML;
//     }
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // INIT MODAL
// // ─────────────────────────────────────────────────────────────────────────────

// export function initModal() {
//     const editModal = document.getElementById('editModal');
//     const gameNameInput = document.getElementById('gameNameInput');
//     const gamePathInput = document.getElementById('gamePathInput');
//     const customPosterInput = document.getElementById('customPosterInput');
//     const customLogoInput = document.getElementById('customLogoInput');
//     const customBgInput = document.getElementById('customBgInput');

//     const addGameBtn = document.getElementById('addGameBtn');
//     if (addGameBtn) addGameBtn.addEventListener('click', function () { triggerAddGameProcess(this); });

//     document.getElementById('changePathBtn').addEventListener('click', async () => {
//         const btn = document.getElementById('changePathBtn');
//         const orig = btn.innerHTML;
//         btn.disabled = true;
//         btn.style.opacity = '0.7';
//         btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
//         try {
//             const newPath = await window.api.selectGame();
//             if (newPath) {
//                 state.tempGamePath = newPath;
//                 gamePathInput.value = newPath;
//                 if (!gameNameInput.value.trim()) {
//                     const parts = newPath.split(/[/\\]/).filter(Boolean);
//                     gameNameInput.value = parts.length >= 2
//                         ? parts[parts.length - 2]
//                         : parts[0].split('.')[0];
//                 }
//             }
//         } finally {
//             btn.disabled = false;
//             btn.style.opacity = '1';
//             btn.innerHTML = orig;
//         }
//     });

//     const selectCustomBackupBtn = document.getElementById('selectCustomBackupBtn');
//     if (selectCustomBackupBtn) {
//         selectCustomBackupBtn.addEventListener('click', async () => {
//             const folder = await window.api.selectFolder();
//             if (folder) document.getElementById('editGameBackupPath').value = folder;
//         });
//     }

//     const browseOriginPathBtn = document.getElementById('browseOriginPathBtn');
//     if (browseOriginPathBtn) {
//         browseOriginPathBtn.addEventListener('click', async () => {
//             const folder = await window.api.selectFolder();
//             if (folder) {
//                 document.getElementById('editGameOriginPath').value = folder;
//                 // Optional: re‑evaluate the status indicator
//                 const originInput = document.getElementById('editGameOriginPath');
//                 if (originInput.value) {
//                     showSavePathStatus('found', originInput.value);
//                 } else {
//                     showSavePathStatus('notfound');
//                 }
//             }
//         });
//     }

//     document.getElementById('customImageBtn').addEventListener('click', async () => {
//         const img = await window.api.selectImage();
//         if (img) customPosterInput.value = img;
//     });
//     document.getElementById('customLogoBtn').addEventListener('click', async () => {
//         const img = await window.api.selectImage();
//         if (img) customLogoInput.value = img;
//     });
//     document.getElementById('customBgBtn').addEventListener('click', async () => {
//         const img = await window.api.selectImage();
//         if (img) customBgInput.value = img;
//     });

//     document.getElementById('removePosterBtn').addEventListener('click', () => customPosterInput.value = '');
//     document.getElementById('removeLogoBtn').addEventListener('click', () => customLogoInput.value = '');
//     document.getElementById('removeBgBtn').addEventListener('click', () => customBgInput.value = '');

//     document.getElementById('cancelModalBtn').addEventListener('click', () => editModal.style.display = 'none');
//     editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });
//     editModal.addEventListener('keydown', (e) => {
//         if (e.key === 'Enter') {
//             e.preventDefault();
//             const saveBtn = document.getElementById('saveGameModalBtn');
//             if (!saveBtn.disabled) saveBtn.click();
//         }
//     });

//     // ── Save ──────────────────────────────────────────────────────────────────
//     document.getElementById('saveGameModalBtn').addEventListener('click', async () => {
//         const finalName = gameNameInput.value.trim();
//         if (!finalName) {
//             gameNameInput.classList.add('input-error');
//             gameNameInput.placeholder = userSettings.lang === 'ar'
//                 ? 'الرجاء إدخال اسم اللعبة!'
//                 : 'Please enter a game name!';
//             gameNameInput.addEventListener('focus', function () {
//                 this.classList.remove('input-error');
//                 this.placeholder = 'e.g. Resident Evil 4 2023';
//             }, { once: true });
//             return;
//         }

//         if (!state.tempGamePath) return;

//         const btn = document.getElementById('saveGameModalBtn');
//         btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
//         btn.disabled = true;

//         try {
//             const launchArgs = document.getElementById('launchArgsInput').value.trim();
//             const customImage = customPosterInput.value.trim();
//             const customLogo = customLogoInput.value.trim();
//             const customBg = customBgInput.value.trim();

//             const existingGame = state.editingGameId
//                 ? state.allGamesData.find(g => g.id === state.editingGameId)
//                 : null;

//             let finalAssets = existingGame ? { ...existingGame.assets } : { poster: '', background: '', logo: '' };
//             let finalMetadata = existingGame ? { ...existingGame.metadata } : {};

//             const needsFetch = !existingGame
//                 || existingGame.name !== finalName
//                 || (customImage === '' && existingGame.assets?.poster?.startsWith('file:///'))
//                 || (customLogo === '' && existingGame.assets?.logo?.startsWith('file:///'))
//                 || (customBg === '' && existingGame.assets?.background?.startsWith('file:///'));

//             let freshDetails = null;
//             if (needsFetch) {
//                 freshDetails = await window.api.fetchGameDetails(finalName);
//             }

//             // Poster
//             if (customImage !== '') {
//                 finalAssets.poster = customImage.startsWith('file:///') ? customImage : 'file:///' + customImage.replace(/\\/g, '/');
//             } else if (freshDetails?.assets?.poster) {
//                 finalAssets.poster = freshDetails.assets.poster;
//             }

//             // Logo
//             if (customLogo !== '') {
//                 finalAssets.logo = customLogo.startsWith('file:///') ? customLogo : 'file:///' + customLogo.replace(/\\/g, '/');
//             } else if (freshDetails?.assets?.logo) {
//                 finalAssets.logo = freshDetails.assets.logo;
//             } else if (needsFetch && freshDetails) {
//                 finalAssets.logo = '';
//             }

//             // Background
//             if (customBg !== '') {
//                 finalAssets.background = customBg.startsWith('file:///') ? customBg : 'file:///' + customBg.replace(/\\/g, '/');
//             } else if (freshDetails?.assets?.background) {
//                 finalAssets.background = freshDetails.assets.background;
//             }

//             // Icon
//             if (freshDetails?.assets?.icon) {
//                 finalAssets.icon = freshDetails.assets.icon;
//             } else if (existingGame?.assets?.icon) {
//                 finalAssets.icon = existingGame.assets.icon;
//             } else {
//                 finalAssets.icon = '';
//             }

//             if (freshDetails?.metadata) finalMetadata = freshDetails.metadata;
//             else if (!existingGame || existingGame.name !== finalName) finalMetadata = {};

//             const gameData = {
//                 id: state.editingGameId || Date.now(),
//                 name: finalName,
//                 path: state.tempGamePath,
//                 arguments: launchArgs,
//                 isFavorite: existingGame ? existingGame.isFavorite : false,
//                 assets: finalAssets,
//                 metadata: finalMetadata,
//             };

//             if (state.editingGameId) await window.api.updateGame(gameData);
//             else await window.api.saveGame(gameData);

//             // ── Save backup config ────────────────────────────────────────────
//             const originPath = document.getElementById('editGameOriginPath')?.value?.trim() || '';
//             const backupPath = document.getElementById('editGameBackupPath')?.value?.trim() || '';
//             const finalBackupPath = backupPath || (await window.api.backup.getGlobalPath()) || '';

//             await window.api.backup.updateConfig(finalName, {
//                 originPath,
//                 backupPath: finalBackupPath,
//             });

//             editModal.style.display = 'none';
//             await renderGames();

//         } catch (error) {
//             console.error('Save Error:', error);
//             alert(userSettings.lang === 'ar' ? 'فشل الحفظ' : 'Save failed');
//         } finally {
//             btn.disabled = false;
//             btn.innerHTML = `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;
//         }
//     });
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // OPEN EDIT MODAL FOR EXISTING GAME
// // ─────────────────────────────────────────────────────────────────────────────

// export async function openEditModal(game) {
//     state.editingGameId = game.id;
//     state.tempGamePath = game.path;

//     document.getElementById('gameNameInput').value = game.name;
//     document.getElementById('gamePathInput').value = game.path;
//     document.getElementById('launchArgsInput').value = game.arguments || '';

//     document.getElementById('customPosterInput').value = game.assets?.poster?.startsWith('file:///')
//         ? game.assets.poster.replace('file:///', '').replace(/\//g, '\\') : '';
//     document.getElementById('customLogoInput').value = game.assets?.logo?.startsWith('file:///')
//         ? game.assets.logo.replace('file:///', '').replace(/\//g, '\\') : '';
//     document.getElementById('customBgInput').value = game.assets?.background?.startsWith('file:///')
//         ? game.assets.background.replace('file:///', '').replace(/\//g, '\\') : '';

//     document.getElementById('saveGameModalBtn').innerHTML =
//         `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;

//     document.getElementById('editModal').style.display = 'flex';

//     await populateBackupFields(game);
// }

export { initModal, openEditModal, triggerAddGameProcess } from './modal/index.js';