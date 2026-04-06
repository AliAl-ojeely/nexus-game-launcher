import { state, userSettings } from '../state.js';
import { renderGames } from '../library.js';
import { t } from './helpers.js';
import { showSavePathStatus } from './backup-status.js';
import { triggerAddGameProcess } from './add-game.js';

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
        document.getElementById('editGameOriginPath').value = ''; // clear
    });

    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.style.display = 'none';
            document.getElementById('editGameOriginPath').value = ''; // clear
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
}