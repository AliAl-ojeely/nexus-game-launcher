import { state, userSettings } from '../state.js';
import { renderGames } from '../library.js';
import { t } from './helpers.js';
import { showSavePathStatus } from './backup-status.js';
import { triggerAddGameProcess } from './add-game.js';
import { showToast } from '../details-components.js';


export function initModal() {
    const editModal = document.getElementById('editModal');
    const gameNameInput = document.getElementById('gameNameInput');
    const gamePathInput = document.getElementById('gamePathInput');
    const customPosterInput = document.getElementById('customPosterInput');
    const customLogoInput = document.getElementById('customLogoInput');
    const customBgInput = document.getElementById('customBgInput');
    const customIconInput = document.getElementById('customIconInput');

    // ── Icon picker listeners ─────────────────────────────────────────────
    const customIconBtn = document.getElementById('customIconBtn');
    const removeIconBtn = document.getElementById('removeIconBtn');
    if (customIconBtn) {
        customIconBtn.addEventListener('click', async () => {
            const img = await window.api.selectImage();
            if (img) customIconInput.value = img;
        });
    }
    if (removeIconBtn) {
        removeIconBtn.addEventListener('click', () => customIconInput.value = '');
    }

    const addGameBtn = document.getElementById('addGameBtn');
    if (addGameBtn) addGameBtn.addEventListener('click', function () { triggerAddGameProcess(this); });

    document.getElementById('changePathBtn').addEventListener('click', async () => {
        const btn = document.getElementById('changePathBtn');
        const orig = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = '0.7';
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
        try {
            const newPath = await window.api.selectGame();
            if (newPath) {
                state.tempGamePath = newPath;
                gamePathInput.value = newPath;
                if (!gameNameInput.value.trim()) {
                    const parts = newPath.split(/[/\\]/).filter(Boolean);
                    gameNameInput.value = parts.length >= 2
                        ? parts[parts.length - 2]
                        : parts[0].split('.')[0];
                }
            }
        } finally {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.innerHTML = orig;
        }
    });

    const selectCustomBackupBtn = document.getElementById('selectCustomBackupBtn');
    if (selectCustomBackupBtn) {
        selectCustomBackupBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder) document.getElementById('editGameBackupPath').value = folder;
        });
    }

    const browseOriginPathBtn = document.getElementById('browseOriginPathBtn');
    if (browseOriginPathBtn) {
        browseOriginPathBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder) {
                document.getElementById('editGameOriginPath').value = folder;
                const originInput = document.getElementById('editGameOriginPath');
                if (originInput.value) {
                    showSavePathStatus('found', originInput.value);
                } else {
                    showSavePathStatus('notfound');
                }
            }
        });
    }

    document.getElementById('customImageBtn').addEventListener('click', async () => {
        const img = await window.api.selectImage();
        if (img) customPosterInput.value = img;
    });
    document.getElementById('customLogoBtn').addEventListener('click', async () => {
        const img = await window.api.selectImage();
        if (img) customLogoInput.value = img;
    });
    document.getElementById('customBgBtn').addEventListener('click', async () => {
        const img = await window.api.selectImage();
        if (img) customBgInput.value = img;
    });

    document.getElementById('removePosterBtn').addEventListener('click', () => customPosterInput.value = '');
    document.getElementById('removeLogoBtn').addEventListener('click', () => customLogoInput.value = '');
    document.getElementById('removeBgBtn').addEventListener('click', () => customBgInput.value = '');

    document.getElementById('cancelModalBtn').addEventListener('click', () => {
        editModal.style.display = 'none';
        document.getElementById('editGameOriginPath').value = '';
        document.getElementById('customPosterInput').value = '';
        document.getElementById('customLogoInput').value = '';
        document.getElementById('customBgInput').value = '';
        document.getElementById('customIconInput').value = '';
    });

    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.style.display = 'none';
            document.getElementById('editGameOriginPath').value = '';
            document.getElementById('customPosterInput').value = '';
            document.getElementById('customLogoInput').value = '';
            document.getElementById('customBgInput').value = '';
            document.getElementById('customIconInput').value = '';
        }
    });
    
    editModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const saveBtn = document.getElementById('saveGameModalBtn');
            if (!saveBtn.disabled) saveBtn.click();
        }
    });

    // ── Save button ──────────────────────────────────────────────────────────
    document.getElementById('saveGameModalBtn').addEventListener('click', async () => {
        const finalName = gameNameInput.value.trim();
        if (!finalName) {
            gameNameInput.classList.add('input-error');
            gameNameInput.placeholder = userSettings.lang === 'ar'
                ? 'الرجاء إدخال اسم اللعبة!'
                : 'Please enter a game name!';
            gameNameInput.addEventListener('focus', function () {
                this.classList.remove('input-error');
                this.placeholder = 'e.g. Resident Evil 4 2023';
            }, { once: true });
            return;
        }

        if (!state.tempGamePath) return;

        const btn = document.getElementById('saveGameModalBtn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            const launchArgs = document.getElementById('launchArgsInput').value.trim();
            const customImage = customPosterInput.value.trim();
            const customLogo = customLogoInput.value.trim();
            const customBg = customBgInput.value.trim();
            const customIcon = customIconInput.value.trim();

            const existingGame = state.editingGameId
                ? state.allGamesData.find(g => g.id === state.editingGameId)
                : null;

            // Determine if we need to fetch fresh metadata
            const needsFetch = !existingGame
                || existingGame.name !== finalName
                // If any custom field is empty AND the game currently has that asset (any)
                || (customImage === '' && existingGame.assets?.poster)
                || (customLogo === '' && existingGame.assets?.logo)
                || (customBg === '' && existingGame.assets?.background)
                || (customIcon === '' && existingGame.assets?.icon);

            let freshDetails = null;
            if (needsFetch) {
                freshDetails = await window.api.fetchGameDetails(finalName);
            }

            // Build final assets from scratch – no copying from existingGame
            const finalAssets = { poster: '', background: '', logo: '', icon: '' };

            // Poster
            if (customImage !== '') {
                finalAssets.poster = customImage.startsWith('file:///') ? customImage : 'file:///' + customImage.replace(/\\/g, '/');
            } else if (freshDetails?.assets?.poster) {
                finalAssets.poster = freshDetails.assets.poster;
            }

            // Logo
            if (customLogo !== '') {
                finalAssets.logo = customLogo.startsWith('file:///') ? customLogo : 'file:///' + customLogo.replace(/\\/g, '/');
            } else if (freshDetails?.assets?.logo) {
                finalAssets.logo = freshDetails.assets.logo;
            }

            // Background
            if (customBg !== '') {
                finalAssets.background = customBg.startsWith('file:///') ? customBg : 'file:///' + customBg.replace(/\\/g, '/');
            } else if (freshDetails?.assets?.background) {
                finalAssets.background = freshDetails.assets.background;
            }

            // Icon
            if (customIcon !== '') {
                finalAssets.icon = customIcon.startsWith('file:///') ? customIcon : 'file:///' + customIcon.replace(/\\/g, '/');
            } else if (freshDetails?.assets?.icon) {
                finalAssets.icon = freshDetails.assets.icon;
            }

            // Metadata
            let finalMetadata = existingGame ? { ...existingGame.metadata } : {};
            if (freshDetails?.metadata) finalMetadata = freshDetails.metadata;
            else if (!existingGame || existingGame.name !== finalName) finalMetadata = {};

            const gameData = {
                id: state.editingGameId || Date.now(),
                name: finalName,
                path: state.tempGamePath,
                arguments: launchArgs,
                isFavorite: existingGame ? existingGame.isFavorite : false,
                assets: finalAssets,
                metadata: finalMetadata,
            };

            if (state.editingGameId) await window.api.updateGame(gameData);
            else await window.api.saveGame(gameData);

            // Save backup config
            const originPath = document.getElementById('editGameOriginPath')?.value?.trim() || '';
            const backupPath = document.getElementById('editGameBackupPath')?.value?.trim() || '';
            const finalBackupPath = backupPath || (await window.api.backup.getGlobalPath()) || '';

            await window.api.backup.updateConfig(finalName, {
                originPath,
                backupPath: finalBackupPath,
            });

            editModal.style.display = 'none';
            await renderGames();

        } catch (error) {
            console.error('Save Error:', error);
            alert(userSettings.lang === 'ar' ? 'فشل الحفظ' : 'Save failed');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;
        }
    });

    // Random Game Button inside Game Details Page
    const detailsRandomBtn = document.getElementById('detailsRandomBtn');
    if (detailsRandomBtn) {
        detailsRandomBtn.addEventListener('click', () => {
            const games = state.allGamesData;

            // 1. Check if library is empty
            if (!games || games.length === 0) {
                const msg = userSettings.lang === 'ar' ? 'لا توجد ألعاب في مكتبتك' : 'No games in your library';
                if (typeof showToast === 'function') showToast('info', msg, '', 2000);
                return;
            }

            // 2. Filter out the currently opened game so it doesn't pick it again
            let availableGames = games.filter(g => g.id !== state.currentGameId);

            // Fallback in case the user only has exactly 1 game in the entire library
            if (availableGames.length === 0) {
                availableGames = games;
            }

            // 3. Pick a random game from the filtered list
            const randomIndex = Math.floor(Math.random() * availableGames.length);
            const randomGame = availableGames[randomIndex];

            // 4. Animate the button for visual feedback
            const iconEl = detailsRandomBtn.querySelector('i');
            if (iconEl) {
                iconEl.classList.add('fa-spin');
                setTimeout(() => iconEl.classList.remove('fa-spin'), 500);
            }

            // 5. Open the newly selected game details (FIXED PATH: added ../)
            import('../details.js').then(({ openGameDetailsPage }) => {
                openGameDetailsPage(randomGame);
            }).catch(err => {
                console.error('[FRONTEND] Failed to load details module for Randomizer:', err);
            });

            // 6. Show success toast
            const toastMsg = userSettings.lang === 'ar' ? `لعبة عشوائية: ${randomGame.name}` : `Random pick: ${randomGame.name}`;
            if (typeof showToast === 'function') {
                showToast('success', toastMsg, '', 3000);
            }
        });
    }

    // (Refresh Button and Edit Button inside the Game's Page)
    const detailsRefreshBtn = document.getElementById('detailsRefreshBtn');
    if (detailsRefreshBtn) {
        detailsRefreshBtn.addEventListener('click', async () => {
            if (!state.currentGameId) return;

            // 1. Initial Network Check (Hardware level)
            if (!navigator.onLine) {
                const errorTitle = userSettings.lang === 'ar' ? 'لا يوجد اتصال بالإنترنت!' : 'No internet connection!';
                const errorMsg = userSettings.lang === 'ar' ? 'الرجاء التحقق من الشبكة.' : 'Please check your network.';
                try { showToast('error', errorTitle, errorMsg, 4000); } catch (err) { alert(errorTitle + "\n" + errorMsg); }
                return;
            }

            const game = state.allGamesData.find(g => g.id === state.currentGameId);
            if (!game) return;

            // 2. Create a secure backup of existing data before fetching
            const oldAssets = JSON.parse(JSON.stringify(game.assets || {}));
            const oldMetadata = JSON.parse(JSON.stringify(game.metadata || {}));

            // 3. Update UI to loading state
            const iconEl = detailsRefreshBtn.querySelector('i');
            if (iconEl) iconEl.className = 'fa-solid fa-spinner fa-spin';
            detailsRefreshBtn.disabled = true;

            try {
                // 4. Fetch new details from the API
                const freshDetails = await window.api.fetchGameDetails(game.name);

                // 5. [CRITICAL FIX] Strict Data Validation
                // We check if the fetched data actually contains real URLs or descriptions
                // If it's just an empty object due to a dead connection, isValidFetch will be false
                const hasAssets = freshDetails?.assets && (freshDetails.assets.poster || freshDetails.assets.banner || freshDetails.assets.logo);
                const hasMetadata = freshDetails?.metadata && (freshDetails.metadata.description || freshDetails.metadata.releaseDate);

                const isValidFetch = hasAssets || hasMetadata;

                if (!isValidFetch) {
                    // Force the process to stop and jump to the catch block
                    throw new Error('API returned empty or invalid data due to network/server issues.');
                }

                // 6. Data is 100% valid, proceed to save safely
                game.assets = freshDetails.assets;
                game.metadata = freshDetails.metadata;

                await window.api.saveGameDetails(game.id, {
                    name: game.name,
                    assets: freshDetails.assets,
                    metadata: freshDetails.metadata,
                });

                // 7. Update UI smoothly
                if (typeof renderGames === 'function') {
                    await renderGames();
                }

                const gameCard = document.querySelector(`.game-card[data-id="${game.id}"]`) ||
                    document.querySelector(`.game-card[data-name="${game.name}"]`);
                if (gameCard) {
                    gameCard.click();
                }

                try {
                    showToast('success', userSettings.lang === 'ar' ? 'تم تحديث صور وبيانات اللعبة' : 'Game assets refreshed', '', 2000);
                } catch (e) { }

            } catch (error) {
                console.error('[FRONTEND] Refresh aborted to protect data:', error);

                // 8. [ROLLBACK] Restore the original data immediately if anything fails
                game.assets = oldAssets;
                game.metadata = oldMetadata;

                try {
                    const failMsg = userSettings.lang === 'ar' ? 'فشل التحديث - لا يوجد إنترنت أو الخادم لا يستجيب' : 'Refresh failed - Network or Server Error';
                    showToast('error', failMsg, '', 3000);
                } catch (e) { }
            } finally {
                // 9. Restore the icon
                if (iconEl) iconEl.className = 'fa-solid fa-arrows-rotate';
                detailsRefreshBtn.disabled = false;
            }
        });
    }

    const detailsEditBtn = document.getElementById('detailsEditBtn');
    if(detailsEditBtn) {
        detailsEditBtn.addEventListener('click', () => {
            if(!state.currentGameId) return;
            const game = state.allGamesData.find(g=> g.id === state.currentGameId);

            if(game) {
                import('./edit.js').then(module => {
                    if(module.openEditModal) module.openEditModal(game);
                });
            }
        });
    }
}