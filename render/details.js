import { state, userSettings } from './state.js';
import { openLightbox } from './shortcuts.js';

let sessionStartTime = 0;
let sessionTimerInterval = null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// تحقق موحد من صحة أي قيمة نصية قبل عرضها
const isValid = (val) =>
    val != null &&
    val !== 'N/A' &&
    val !== 'Not Available' &&
    val !== 'Loading...' &&
    String(val).trim() !== '';

/**
 * المصدر الوحيد لإنهاء الجلسة وحفظ الوقت وإعادة الـ UI.
 * يُستدعى دائماً من حدث game:stopped — لا من زر Stop مباشرة.
 */
async function handleGameStop(gameName) {
    if (!state.isGameRunning || sessionStartTime === 0) return;

    console.log(`[FRONTEND] ⏹️ Session ended for: ${gameName}`);

    clearInterval(sessionTimerInterval);
    sessionTimerInterval = null;

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

    state.isGameRunning = false;
    sessionStartTime = 0;

    const timerContainer = document.getElementById('sessionTimerContainer');
    if (timerContainer) timerContainer.style.display = 'none';

    const timerValue = document.getElementById('sessionTimerValue');
    if (timerValue) timerValue.innerText = '00:00:00';

    const playBtn = document.getElementById('detailsPlayBtn');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.classList.remove('play-btn-running', 'play-btn-stopping');
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
    }

    console.log(`[FRONTEND] ✅ Session saved. Total: ${newTotalPlaytime} mins.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME DETAILS PAGE
// ─────────────────────────────────────────────────────────────────────────────

export async function openGameDetailsPage(game) {
    document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');
    document.getElementById('gameDetailsArea').scrollTop = 0;

    const banner = document.getElementById('detailsBanner');
    const logoImg = document.getElementById('detailsLogo');
    const screenshotsGrid = document.getElementById('detailsScreenshotsGrid');

    // عناصر التحكم في السايد بار والتخطيط
    const sidebar = document.querySelector('.details-sidebar');
    const detailsContentContainer = document.querySelector('.details-content');
    let sidebarHasContent = false;

    document.getElementById('detailsGameTitle').innerText = game.name;
    state.currentGameExePath = game.path;

    // ── دالة التحقق من صحة البيانات ──────────────────────────────────────────
    const isValid = (val) => val && val !== 'N/A' && val !== 'Not Available' && val.trim() !== '' && val !== 'Loading...';

    // ── وقت اللعب ─────────────────────────────────────────────────────────────
    const totalMinutes = await window.api.getPlaytime(game.name);
    const playtimeDisplay = document.getElementById('totalPlaytimeValue');
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const hLabel = userSettings.lang === 'ar' ? 'س' : 'h';
    const mLabel = userSettings.lang === 'ar' ? 'د' : 'm';
    if (playtimeDisplay) playtimeDisplay.innerText = `${hours}${hLabel} ${mins}${mLabel}`;

    // ── حالة زر التشغيل ───────────────────────────────────────────────────────
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
            playBtn.classList.remove('play-btn-running', 'play-btn-stopping');
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
        }
    }

    // ── جلب البيانات (Metadata) ───────────────────────────────────────────────
    const isCached = game.metadata?.description && game.metadata.description !== '';
    if (!isCached) {
        document.getElementById('detailsDescription').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching details...';
        try {
            const freshData = await window.api.fetchGameDetails(game.name);
            if (freshData?.assets && freshData?.metadata) {
                game.assets = freshData.assets;
                game.metadata = freshData.metadata;
                await window.api.saveGameDetails(game.id, freshData);
            }
        } catch {
            document.getElementById('detailsDescription').innerText = 'Failed to load details.';
        }
    }

    const assets = game.assets || {};
    const meta = game.metadata || {};

    // ── البانر واللوجو ────────────────────────────────────────────────────────
    const bgUrl = assets.background || assets.poster || '';
    banner.style.backgroundImage = `url('${bgUrl}')`;

    if (assets.logo && logoImg) {
        logoImg.src = assets.logo;
        logoImg.style.display = 'block';
    } else if (logoImg) {
        logoImg.style.display = 'none';
    }

    // ── الوصف (مع حالة الـ Placeholder) ───────────────────────────────────────
    const descEl = document.getElementById('detailsDescription');
    if (descEl) {
        if (isValid(meta.description)) {
            descEl.innerHTML = meta.description;
            descEl.classList.remove('description-placeholder');
            descEl.parentElement.style.display = 'block';
        } else {
            // تصميم Empty State في حال عدم وجود وصف
            descEl.classList.add('description-placeholder');
            descEl.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted); opacity: 0.6;">
                    <i class="fa-solid fa-gamepad" style="font-size: 48px; margin-bottom: 15px; display: block;"></i>
                    <p>${userSettings.lang === 'ar' ? 'لا يوجد وصف متاح لهذه اللعبة حالياً.' : 'No detailed description available for this game yet.'}</p>
                </div>
            `;
            descEl.parentElement.style.display = 'block';
        }
    }

    // ── السايد بار (المطور، الناشر، التاريخ) ───────────────────────────────────
    const setMetaTextWithTrack = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isValid(value)) {
            el.parentElement.style.display = 'block';
            el.innerText = value;
            sidebarHasContent = true; // وجدنا بيانات للسايد بار
        } else {
            el.parentElement.style.display = 'none';
        }
    };

    setMetaTextWithTrack('detailsDev', meta.developer);
    setMetaTextWithTrack('detailsPub', meta.publisher);
    setMetaTextWithTrack('detailsRelease', meta.releaseDate);

    // ── Metacritic ────────────────────────────────────────────────────────────
    const metacriticEl = document.getElementById('detailsMetacritic');
    if (metacriticEl) {
        const score = meta.metacritic?.toString();
        if (!isValid(score)) {
            metacriticEl.parentElement.style.display = 'none';
        } else {
            metacriticEl.parentElement.style.display = 'block';
            metacriticEl.textContent = meta.metacritic;
            metacriticEl.classList.remove('high', 'medium', 'low');
            const n = parseInt(meta.metacritic);
            if (n >= 75) metacriticEl.classList.add('high');
            else if (n >= 50) metacriticEl.classList.add('medium');
            else metacriticEl.classList.add('low');
            sidebarHasContent = true;
        }
    }

    // ── Genres ────────────────────────────────────────────────────────────────
    const genresContainer = document.getElementById('detailsGenres');
    if (genresContainer) {
        genresContainer.innerHTML = '';
        if (!isValid(meta.genres)) {
            genresContainer.parentElement.style.display = 'none';
        } else {
            genresContainer.parentElement.style.display = 'block';
            meta.genres.split(',').map(g => g.trim()).forEach(genre => {
                const tag = document.createElement('span');
                tag.className = 'genre-tag';
                tag.textContent = genre;
                genresContainer.appendChild(tag);
            });
            sidebarHasContent = true;
        }
    }

    // ── Tags ──────────────────────────────────────────────────────────────────
    const tagsContainer = document.getElementById('detailsTags');
    if (tagsContainer) {
        tagsContainer.innerHTML = '';
        if (!isValid(meta.tags)) {
            tagsContainer.parentElement.style.display = 'none';
        } else {
            tagsContainer.parentElement.style.display = 'block';
            meta.tags.split(',').map(t => t.trim()).forEach(tagText => {
                const tagSpan = document.createElement('span');
                tagSpan.className = 'feature-tag';
                tagSpan.textContent = tagText;
                tagsContainer.appendChild(tagSpan);
            });
            sidebarHasContent = true;
        }
    }

    // ── ضبط تخطيط السايد بار والوصف ───────────────────────────────────────────
    if (sidebar) {
        if (sidebarHasContent) {
            sidebar.style.display = 'block';
            if (detailsContentContainer) detailsContentContainer.style.gridTemplateColumns = '3fr 1fr';
        } else {
            sidebar.style.display = 'none';
            // جعل الوصف يملأ عرض الصفحة بالكامل 100%
            if (detailsContentContainer) detailsContentContainer.style.gridTemplateColumns = '1fr';
        }
    }

    // ── الميديا (Screenshots) ──────────────────────────────────────────────────
    const mediaSection = document.querySelector('.details-media-section');
    if (screenshotsGrid) {
        screenshotsGrid.innerHTML = '';
        if (meta.media?.screenshots?.length > 0) {
            if (mediaSection) mediaSection.style.display = 'block';
            state.currentScreenshotsList = meta.media.screenshots;
            meta.media.screenshots.forEach((imgUrl, index) => {
                const img = document.createElement('img');
                img.src = imgUrl;
                img.className = 'screenshot-item';
                img.loading = 'lazy';
                img.onclick = () => openLightbox(index);
                screenshotsGrid.appendChild(img);
            });
        } else {
            if (mediaSection) mediaSection.style.display = 'none';
        }
    }

    // ── متطلبات النظام ─────────────────────────────────────────────────────────
    const reqMin = meta.systemRequirements?.minimum;
    const reqRec = meta.systemRequirements?.recommended;
    const reqMinEl = document.getElementById('reqMin');
    const reqRecEl = document.getElementById('reqRec');
    const fullReqSection = document.getElementById('systemRequirementsSection')
        || reqMinEl?.closest('.details-req-section, section, [class*="req"]');

    let hasAnyReq = false;
    if (reqMinEl) {
        if (isValid(reqMin)) {
            reqMinEl.innerHTML = reqMin;
            reqMinEl.parentElement.style.display = 'block';
            hasAnyReq = true;
        } else {
            reqMinEl.parentElement.style.display = 'none';
        }
    }
    if (reqRecEl) {
        if (isValid(reqRec)) {
            reqRecEl.innerHTML = reqRec;
            reqRecEl.parentElement.style.display = 'block';
            hasAnyReq = true;
        } else {
            reqRecEl.parentElement.style.display = 'none';
        }
    }
    if (fullReqSection) {
        fullReqSection.style.display = hasAnyReq ? 'block' : 'none';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────

export function initDetails() {

    // ── Play / Stop button ────────────────────────────────────────────────────
    document.getElementById('detailsPlayBtn').onclick = async () => {

        if (state.isGameRunning) {
            const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);
            if (!currentGame) return;

            const playBtn = document.getElementById('detailsPlayBtn');
            if (playBtn) {
                playBtn.disabled = true;
                playBtn.classList.add('play-btn-stopping');
                playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${userSettings.lang === 'ar' ? 'جاري الإيقاف...' : 'Stopping...'}`;
            }

            // أمر الإيقاف فقط — الـ UI يُعاد من game:stopped
            window.api.forceStopGame(currentGame.id);
            return;
        }

        if (!state.currentGameExePath) return;

        const showFPS = localStorage.getItem('showFPS') === 'true';
        const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);
        if (!currentGame) return;

        console.log(`[FRONTEND] ▶️ Launching: ${currentGame.name}`);
        state.isGameRunning = true;

        const playBtn = document.getElementById('detailsPlayBtn');
        if (playBtn) {
            playBtn.classList.add('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
        }

        window.api.launchGame(
            currentGame.path,
            showFPS,
            currentGame.arguments || '',
            currentGame.id
        );

        sessionStartTime = Date.now();

        const timerContainer = document.getElementById('sessionTimerContainer');
        if (timerContainer) timerContainer.style.display = 'flex';

        sessionTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
            const timerValue = document.getElementById('sessionTimerValue');
            if (timerValue) timerValue.innerText = formatTime(elapsed);
        }, 1000);
    };

    // ── Backend events ────────────────────────────────────────────────────────
    if (window.api.removeGameStoppedListener) window.api.removeGameStoppedListener();
    if (window.api.removeGameErrorListener) window.api.removeGameErrorListener();

    window.api.onGameStopped(async (data) => {
        const currentGame = state.allGamesData.find(g => String(g.id) === String(data.gameId));
        if (currentGame) await handleGameStop(currentGame.name);
    });

    window.api.onGameError((data) => {
        console.error(`[FRONTEND] ❌ Launch error: ${data.message}`);
        const currentGame = state.allGamesData.find(g => g.path === state.currentGameExePath);
        if (currentGame) handleGameStop(currentGame.name);
    });

    // ── Folder button ─────────────────────────────────────────────────────────
    document.getElementById('detailsFolderBtn').onclick = () => {
        if (!state.currentGameExePath) return;

        const folderBtn = document.getElementById('detailsFolderBtn');
        folderBtn.disabled = true;
        folderBtn.style.opacity = '0.7';
        folderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...'}`;

        window.api.openFolder(state.currentGameExePath);

        setTimeout(() => {
            folderBtn.disabled = false;
            folderBtn.style.opacity = '1';
            folderBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> <span data-i18n="btn_folder">${userSettings.lang === 'ar' ? 'مجلد اللعبة' : 'Game Folder'}</span>`;
        }, 1200);
    };
}