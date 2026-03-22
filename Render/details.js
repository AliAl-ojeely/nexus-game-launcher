import { state, userSettings } from './state.js';
import { openLightbox } from './shortcuts.js';

export async function openGameDetailsPage(game) {
    document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');
    document.getElementById('gameDetailsArea').scrollTop = 0;

    const banner = document.getElementById('detailsBanner');
    const logoImg = document.getElementById('detailsLogo');
    const screenshotsGrid = document.getElementById('detailsScreenshotsGrid');

    document.getElementById('detailsGameTitle').innerText = game.name;
    state.currentGameExePath = game.path;

    const isCached = game.metadata && game.metadata.description && game.metadata.description !== "";

    if (!isCached) {
        document.getElementById('detailsDescription').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching details...';
        try {
            const freshData = await window.api.fetchGameDetails(game.name);
            if (freshData && freshData.assets && freshData.metadata) {
                game.assets = freshData.assets;
                game.metadata = freshData.metadata;
                await window.api.saveGameDetails(game.id, freshData);
            }
        } catch (err) {
            console.error("Fetch failed:", err);
            document.getElementById('detailsDescription').innerText = "Failed to load details.";
        }
    }

    const assets = game.assets || {};
    const meta = game.metadata || {};
    const bgUrl = assets.background || assets.poster || "";

    banner.style.backgroundImage = `url('${bgUrl}')`;

    if (assets.logo && logoImg) {
        logoImg.src = assets.logo;
        logoImg.style.display = 'block';
    } else if (logoImg) {
        logoImg.style.display = 'none';
    }

    document.getElementById('detailsDescription').innerHTML = meta.description || "No description available.";
    document.getElementById('detailsDev').innerText = meta.developer || "N/A";
    document.getElementById('detailsPub').innerText = meta.publisher || "N/A";
    document.getElementById('detailsRelease').innerText = meta.releaseDate || "N/A";

    if (screenshotsGrid) {
        screenshotsGrid.innerHTML = '';
        if (meta.media?.screenshots && meta.media.screenshots.length > 0) {
            state.currentScreenshotsList = meta.media.screenshots;
            meta.media.screenshots.forEach((imgUrl, index) => {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.className = 'screenshot-item';
                img.loading = 'lazy';
                img.onclick = () => openLightbox(index);
                screenshotsGrid.appendChild(img);
            });
        }
    }

    if (document.getElementById('reqMin')) document.getElementById('reqMin').innerHTML = meta.systemRequirements?.minimum || "N/A";
    if (document.getElementById('reqRec')) document.getElementById('reqRec').innerHTML = meta.systemRequirements?.recommended || "N/A";
}

export function initDetails() {
    document.getElementById('detailsPlayBtn').addEventListener('click', () => {
        if (state.isGameRunning) return;

        if (state.currentGameExePath) {
            const showFPS = localStorage.getItem('showFPS') === 'true';
            const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);

            if (currentGame) {
                state.isGameRunning = true;
                const playBtn = document.getElementById('detailsPlayBtn');
                playBtn.disabled = true;
                playBtn.style.opacity = "0.6";
                playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${userSettings.lang === 'ar' ? 'جاري التشغيل...' : 'Running...'}`;

                window.api.launchGame(currentGame.path, showFPS, currentGame.arguments || "", currentGame.id);
            }
        }
    });

    document.getElementById('detailsFolderBtn').addEventListener('click', () => {
        if (!state.currentGameExePath) return;
        const folderBtn = document.getElementById('detailsFolderBtn');
        folderBtn.disabled = true;
        folderBtn.style.opacity = "0.7";
        folderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...'}`;

        window.api.openFolder(state.currentGameExePath);

        setTimeout(() => {
            folderBtn.disabled = false;
            folderBtn.style.opacity = "1";
            folderBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> <span data-i18n="btn_folder">${userSettings.lang === 'ar' ? 'مجلد اللعبة' : 'Game Folder'}</span>`;
        }, 1200);
    });
}