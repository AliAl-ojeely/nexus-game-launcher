import { state, userSettings } from './state.js';
import { openLightbox } from './shortcuts.js';

let sessionStartTime = 0;
let sessionTimerInterval = null;

function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// 🛠️ دالة مشتركة وذكية لإيقاف اللعبة وحفظ الوقت
async function handleGameStop(gameName) {
    if (!state.isGameRunning || sessionStartTime === 0) return;

    console.log(`\n[FRONTEND LOG] ⏹️ Stopping game session for: ${gameName}`);
    clearInterval(sessionTimerInterval);

    const elapsedMinutes = Math.round((Date.now() - sessionStartTime) / 60000);

    const newTotalPlaytime = await window.api.addPlaytime(gameName, elapsedMinutes);

    if (newTotalPlaytime !== false) {
        const playtimeDisplay = document.getElementById('totalPlaytimeValue');
        const currentGame = state.allGamesData.find(g => g.name === gameName);

        if (playtimeDisplay && currentGame && state.currentGameExePath === currentGame.path) {
            const hours = Math.floor(newTotalPlaytime / 60);
            const mins = newTotalPlaytime % 60;

            const hLabel = userSettings.lang === 'ar' ? 'س' : 'h';
            const mLabel = userSettings.lang === 'ar' ? 'د' : 'm';
            playtimeDisplay.innerText = `${hours}${hLabel} ${mins}${mLabel}`;
        }
    }

    const timerContainer = document.getElementById('sessionTimerContainer');
    if (timerContainer) timerContainer.style.display = 'none';

    const playBtn = document.getElementById('detailsPlayBtn');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.classList.remove('play-btn-running');
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
    }

    state.isGameRunning = false;
    sessionStartTime = 0;
    console.log(`[FRONTEND LOG] ✅ Play session cycle completed. Total time: ${newTotalPlaytime} mins.`);
}


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

    const totalMinutes = await window.api.getPlaytime(game.name);
    const playtimeDisplay = document.getElementById('totalPlaytimeValue');

    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;

    const hLabel = userSettings.lang === 'ar' ? 'س' : 'h';
    const mLabel = userSettings.lang === 'ar' ? 'د' : 'm';
    if (playtimeDisplay) playtimeDisplay.innerText = `${hours}${hLabel} ${mins}${mLabel}`;

    const playBtn = document.getElementById('detailsPlayBtn');
    const timerContainer = document.getElementById('sessionTimerContainer');

    if (state.isGameRunning && state.currentGameExePath === game.path) {
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.add('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
        }
        if (timerContainer) timerContainer.style.display = 'flex';
    } else {
        if (timerContainer) timerContainer.style.display = 'none';
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.remove('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
        }
    }

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

    // 🌟 دالة مساعدة لإخفاء العنصر بالكامل إذا كانت البيانات غير متوفرة
    const setMetaText = (id, value) => {
        const el = document.getElementById(id);
        if (el) {
            if (!value || value === "N/A") {
                el.parentElement.style.display = 'none';
            } else {
                el.parentElement.style.display = 'block';
                el.innerText = value;
            }
        }
    };

    setMetaText('detailsDev', meta.developer);
    setMetaText('detailsPub', meta.publisher);
    setMetaText('detailsRelease', meta.releaseDate);

    // 🌟 إخفاء Metacritic بذكاء إذا لم يتوفر
    const metacriticEl = document.getElementById('detailsMetacritic');
    if (metacriticEl) {
        const score = meta.metacritic || "N/A";
        if (score === "N/A" || score === "") {
            metacriticEl.parentElement.style.display = 'none';
        } else {
            metacriticEl.parentElement.style.display = 'block';
            metacriticEl.textContent = score;
            metacriticEl.classList.remove('high', 'medium', 'low');
            const numScore = parseInt(score);
            if (numScore >= 75) metacriticEl.classList.add('high');
            else if (numScore >= 50) metacriticEl.classList.add('medium');
            else metacriticEl.classList.add('low');
        }
    }

    // 🌟 إخفاء الأقسام الفارغة لـ Genres و Tags
    const genresContainer = document.getElementById('detailsGenres');
    if (genresContainer) {
        genresContainer.innerHTML = '';
        const genresStr = meta.genres || "N/A";
        if (genresStr === "N/A" || genresStr === "") {
            genresContainer.parentElement.style.display = 'none';
        } else {
            genresContainer.parentElement.style.display = 'block';
            const genresArray = genresStr.split(',').map(g => g.trim());
            genresArray.forEach(genre => {
                const tag = document.createElement('span');
                tag.className = 'genre-tag';
                tag.textContent = genre;
                genresContainer.appendChild(tag);
            });
        }
    }

    const tagsContainer = document.getElementById('detailsTags');
    if (tagsContainer) {
        tagsContainer.innerHTML = '';
        const tagsStr = meta.tags || "N/A";
        if (tagsStr === "N/A" || tagsStr === "") {
            tagsContainer.parentElement.style.display = 'none';
        } else {
            tagsContainer.parentElement.style.display = 'block';
            const tagsArray = tagsStr.split(',').map(t => t.trim());
            tagsArray.forEach(tagText => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'feature-tag';
                tagSpan.textContent = tagText;
                tagsContainer.appendChild(tagSpan);
            });
        }
    }

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
    document.getElementById('detailsPlayBtn').onclick = async () => {
        if (state.isGameRunning) {
            const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);
            if (currentGame) {
                if (window.api.forceStopGame) {
                    window.api.forceStopGame(currentGame.id);
                }
                await handleGameStop(currentGame.name);
            }
            return;
        }

        if (state.currentGameExePath) {
            const showFPS = localStorage.getItem('showFPS') === 'true';
            const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);

            if (currentGame) {
                console.log(`[FRONTEND LOG] ▶️ Play button clicked for: ${currentGame.name}`);
                state.isGameRunning = true;

                const playBtn = document.getElementById('detailsPlayBtn');
                if (playBtn) {
                    playBtn.classList.add('play-btn-running');
                    playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
                }

                window.api.launchGame(currentGame.path, showFPS, currentGame.arguments || "", currentGame.id);

                sessionStartTime = Date.now();
                const timerContainer = document.getElementById('sessionTimerContainer');
                if (timerContainer) timerContainer.style.display = 'flex';

                sessionTimerInterval = setInterval(() => {
                    const elapsedSeconds = Math.floor((Date.now() - sessionStartTime) / 1000);
                    const timerValue = document.getElementById('sessionTimerValue');
                    if (timerValue) timerValue.innerText = formatTime(elapsedSeconds);
                }, 1000);
            }
        }
    };

    if (window.api.removeGameStoppedListener) {
        window.api.removeGameStoppedListener();
    }

    window.api.onGameStopped(async (data) => {
        const currentGame = state.allGamesData.find(g => String(g.id) === String(data.gameId));
        if (currentGame) {
            await handleGameStop(currentGame.name);
        }
    });

    if (window.api.removeGameErrorListener) {
        window.api.removeGameErrorListener();
    }

    window.api.onGameError((data) => {
        console.error(`\n[FRONTEND LOG] ❌ Launch Error: ${data.message}`);
        const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);
        if (currentGame) {
            handleGameStop(currentGame.name);
        }
    });

    document.getElementById('detailsFolderBtn').onclick = () => {
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
    };
}