import { state, userSettings } from './state.js';
import { renderGames } from './library.js';

export async function triggerAddGameProcess(triggerElement) {
    const originalHTML = triggerElement.innerHTML;
    triggerElement.disabled = true;
    triggerElement.style.opacity = "0.7";
    triggerElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="font-size: ${triggerElement.tagName === 'BUTTON' ? 'inherit' : '50px'};"></i>` +
        (triggerElement.tagName === 'BUTTON' ? ` <span data-i18n="btn_opening">${userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...'}</span>` : '');

    try {
        const selectedPath = await window.api.selectGame();
        if (selectedPath) {
            state.editingGameId = null;
            state.tempGamePath = selectedPath;
            document.getElementById('gamePathInput').value = selectedPath;

            const pathParts = selectedPath.split(/[/\\]/).filter(Boolean);
            let rawName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0];

            rawName = rawName.replace(/[-_.]/g, ' ').replace(/\b(repack|fitgirl|empress|codex|skidrow)\b/gi, '').replace(/\s+/g, ' ').trim();

            document.getElementById('gameNameInput').value = rawName;
            document.getElementById('customLogoInput').value = "";
            document.getElementById('customPosterInput').value = "";

            document.getElementById('saveGameModalBtn').innerHTML = `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? "حفظ التعديلات" : "Save Changes"}`;
            document.getElementById('editModal').style.display = 'flex';
        }
    } catch (error) {
        console.error("Selection error:", error);
    } finally {
        triggerElement.disabled = false;
        triggerElement.style.opacity = "1";
        triggerElement.innerHTML = originalHTML;
    }
}

export function initModal() {
    const editModal = document.getElementById('editModal');
    const gameNameInput = document.getElementById('gameNameInput');
    const gamePathInput = document.getElementById('gamePathInput');
    const customPosterInput = document.getElementById('customPosterInput');
    const customLogoInput = document.getElementById('customLogoInput');
    const customBgInput = document.getElementById('customBgInput');

    const addGameBtn = document.getElementById('addGameBtn');
    if (addGameBtn) addGameBtn.addEventListener('click', function () { triggerAddGameProcess(this); });

    document.getElementById('changePathBtn').addEventListener('click', async () => {
        const btn = document.getElementById('changePathBtn');
        const originalHTML = btn.innerHTML;
        btn.disabled = true;
        btn.style.opacity = "0.7";
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;

        try {
            const newPath = await window.api.selectGame();
            if (newPath) {
                state.tempGamePath = newPath;
                gamePathInput.value = newPath;
                if (!gameNameInput.value.trim()) {
                    const pathParts = newPath.split(/[/\\]/).filter(Boolean);
                    gameNameInput.value = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0].split('.')[0];
                }
            }
        } finally {
            btn.disabled = false;
            btn.style.opacity = "1";
            btn.innerHTML = originalHTML;
        }
    });

    document.getElementById('customImageBtn').addEventListener('click', async () => {
        const imagePath = await window.api.selectImage();
        if (imagePath) customPosterInput.value = imagePath;
    });

    document.getElementById('customLogoBtn').addEventListener('click', async () => {
        const imagePath = await window.api.selectImage();
        if (imagePath) customLogoInput.value = imagePath;
    });

    document.getElementById('customBgBtn').addEventListener('click', async () => {
        const imagePath = await window.api.selectImage();
        if (imagePath) customBgInput.value = imagePath;
    });

    document.getElementById('removePosterBtn').addEventListener('click', () => customPosterInput.value = "");
    document.getElementById('removeLogoBtn').addEventListener('click', () => customLogoInput.value = "");
    document.getElementById('removeBgBtn').addEventListener('click', () => customBgInput.value = "");

    document.getElementById('cancelModalBtn').addEventListener('click', () => editModal.style.display = 'none');
    editModal.addEventListener('click', (e) => { if (e.target === editModal) editModal.style.display = 'none'; });

    editModal.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const saveBtn = document.getElementById('saveGameModalBtn');
            if (!saveBtn.disabled) saveBtn.click();
        }
    });

    document.getElementById('saveGameModalBtn').addEventListener('click', async () => {
        const finalName = gameNameInput.value.trim();
        if (!finalName) {
            gameNameInput.classList.add('input-error');
            gameNameInput.placeholder = userSettings.lang === 'ar' ? "الرجاء إدخال اسم اللعبة!" : "Please enter a game name!";
            gameNameInput.addEventListener('focus', function () {
                this.classList.remove('input-error');
                this.placeholder = "e.g. Resident Evil 4 2023";
            }, { once: true });
            return;
        }

        if (!state.tempGamePath) return;

        const btn = document.getElementById('saveGameModalBtn');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        try {
            let customImage = customPosterInput.value.trim();
            let customLogo = customLogoInput.value.trim();
            let customBg = customBgInput.value.trim();
            const launchArgs = document.getElementById('launchArgsInput').value.trim();

            const existingGame = state.editingGameId ? state.allGamesData.find(g => g.id === state.editingGameId) : null;
            let finalAssets = existingGame ? { ...existingGame.assets } : { poster: "", background: "", logo: "" };
            let finalMetadata = existingGame ? { ...existingGame.metadata } : {};

            let needsFetch = false;
            if (!existingGame) needsFetch = true;
            else if (existingGame.name !== finalName) needsFetch = true;
            else if (customImage === "" && existingGame.assets.poster.startsWith('file:///')) needsFetch = true;
            else if (customLogo === "" && existingGame.assets.logo.startsWith('file:///')) needsFetch = true;
            else if (customBg === "" && existingGame.assets.background.startsWith('file:///')) needsFetch = true;

            let freshDetails = null;
            if (needsFetch) freshDetails = await window.api.fetchGameDetails(finalName);

            if (customImage !== "") finalAssets.poster = customImage.startsWith('file:///') ? customImage : "file:///" + customImage.replace(/\\/g, '/');
            else if (freshDetails && freshDetails.assets?.poster) finalAssets.poster = freshDetails.assets.poster;

            if (customLogo !== "") finalAssets.logo = customLogo.startsWith('file:///') ? customLogo : "file:///" + customLogo.replace(/\\/g, '/');
            else if (freshDetails && freshDetails.assets?.logo) finalAssets.logo = freshDetails.assets.logo;
            else if (needsFetch && freshDetails) finalAssets.logo = "";

            if (customBg !== "") finalAssets.background = customBg.startsWith('file:///') ? customBg : "file:///" + customBg.replace(/\\/g, '/');
            else if (freshDetails && freshDetails.assets?.background) finalAssets.background = freshDetails.assets.background;

            if (freshDetails && freshDetails.metadata) finalMetadata = freshDetails.metadata;
            else if (!existingGame || existingGame.name !== finalName) finalMetadata = {};

            const gameData = {
                id: state.editingGameId || Date.now(),
                name: finalName,
                path: state.tempGamePath,
                arguments: launchArgs,
                isFavorite: existingGame ? existingGame.isFavorite : false,
                assets: finalAssets,
                metadata: finalMetadata
            };

            if (state.editingGameId) await window.api.updateGame(gameData);
            else await window.api.saveGame(gameData);

            editModal.style.display = 'none';
            await renderGames();

        } catch (error) {
            console.error("Critical Save Error:", error);
            alert(userSettings.lang === 'ar' ? "فشل الحفظ، تحقق من الاتصال" : "Save failed, check your connection");
        } finally {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? "حفظ التعديلات" : "Save Changes"}`;
        }
    });
}