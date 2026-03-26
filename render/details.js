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

const isValid = (val) =>
    val != null &&
    val !== 'N/A' &&
    val !== 'Not Available' &&
    val !== 'Loading...' &&
    String(val).trim() !== '';

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
// TRAILER BUTTON
// ─────────────────────────────────────────────────────────────────────────────

function setupTrailerButton(media, gameName) {
    const btn = document.getElementById('watchTrailerBtn');
    if (!btn) return;

    const ytId = media?.trailerYouTubeId;
    const thumb = media?.trailerThumbnail;
    const targetUrl = ytId ? `https://www.youtube.com/watch?v=${ytId}` : media?.trailerSearchUrl;

    const freshBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(freshBtn, btn);

    // إخفاء الزر إذا لم تتوفر صورة أو ID (للتصميم الهادئ)
    if (!ytId || !thumb) {
        freshBtn.style.display = 'none';
        return;
    }

    freshBtn.style.display = 'block';
    const thumbImg = freshBtn.querySelector('#trailerThumbnail');
    if (thumbImg) thumbImg.src = thumb;

    freshBtn.onclick = () => { if (targetUrl) window.api.openExternal(targetUrl); };
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME DETAILS PAGE
// ─────────────────────────────────────────────────────────────────────────────

export async function openGameDetailsPage(game) {
    // 1. إعدادات الواجهة الأساسية
    document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');
    document.getElementById('gameDetailsArea').scrollTop = 0;

    const banner = document.getElementById('detailsBanner');
    const logoImg = document.getElementById('detailsLogo');
    const screenshotsGrid = document.getElementById('detailsScreenshotsGrid');
    const descWrapper = document.getElementById('descWrapper');
    const readMoreBtn = document.getElementById('readMoreBtn');
    const descEl = document.getElementById('detailsDescription');

    document.getElementById('detailsGameTitle').innerText = game.name;
    state.currentGameExePath = game.path;

    // 2. تصفير حالة الوصف (Read More) عند فتح لعبة جديدة
    if (descWrapper) descWrapper.classList.remove('expanded');
    if (readMoreBtn) {
        readMoreBtn.style.display = 'none';
        readMoreBtn.classList.remove('active');
    }

    // 3. حساب ووقت اللعب (Playtime)
    const totalMinutes = await window.api.getPlaytime(game.name);
    const playtimeDisplay = document.getElementById('totalPlaytimeValue');
    if (playtimeDisplay) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        const hLabel = userSettings.lang === 'ar' ? 'س' : 'h';
        const mLabel = userSettings.lang === 'ar' ? 'د' : 'm';
        playtimeDisplay.innerText = `${hours}${hLabel} ${mins}${mLabel}`;
    }

    // 4. حالة زر التشغيل (Play/Stop Button)
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

    // 5. جلب البيانات من الـ API (إذا لم تكن مخزنة)
    const isCached = game.metadata?.description && game.metadata.description !== '';
    if (!isCached) {
        descEl.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching details...';
        try {
            const freshData = await window.api.fetchGameDetails(game.name);
            if (freshData?.assets && freshData?.metadata) {
                game.assets = freshData.assets;
                game.metadata = freshData.metadata;
                await window.api.saveGameDetails(game.id, freshData);
            }
        } catch {
            descEl.innerText = userSettings.lang === 'ar' ? 'فشل تحميل البيانات.' : 'Failed to load details.';
        }
    }

    const assets = game.assets || {};
    const meta = game.metadata || {};

    // 6. الخلفية والشعار (Banner & Logo)
    const bgUrl = assets.background || assets.poster || '';
    banner.style.backgroundImage = `url('${bgUrl}')`;

    if (assets.logo && logoImg) {
        logoImg.src = assets.logo;
        logoImg.style.display = 'block';
    } else if (logoImg) {
        logoImg.style.display = 'none';
    }

    // 7. منطق الوصف و "إقرأ المزيد" (Description Logic)
    if (isValid(meta.description)) {
        descEl.innerHTML = meta.description;
        // فحص الارتفاع لإظهار الزر (بعد تأخير بسيط لضمان الرسم)
        setTimeout(() => {
            if (descEl.scrollHeight > 165) { // 165 بكسل تعادل تقريباً 5 أسطر
                readMoreBtn.style.display = 'flex';
                readMoreBtn.querySelector('span').innerText = userSettings.lang === 'ar' ? 'إقرأ المزيد' : 'Read More';
            } else {
                readMoreBtn.style.display = 'none';
            }
        }, 200);
    } else {
        descEl.innerHTML = `
            <div style="text-align:center; padding:40px; color:var(--text-muted); opacity:0.6;">
                <i class="fa-solid fa-gamepad" style="font-size:48px; margin-bottom:15px; display:block;"></i>
                <p>${userSettings.lang === 'ar' ? 'لا يوجد وصف متاح لهذه اللعبة حالياً.' : 'No detailed description available.'}</p>
            </div>`;
    }

    // 8. تحديث الـ Sidebar (إخفاء الـ N/A تماماً)
    const sidebar = document.querySelector('.details-sidebar');
    const detailsContentContainer = document.querySelector('.details-content');
    let sidebarHasContent = false;

    const updateMeta = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (isValid(value)) {
            el.parentElement.style.display = 'block';
            el.innerText = value;
            sidebarHasContent = true;
        } else {
            el.parentElement.style.display = 'none';
        }
    };

    updateMeta('detailsDev', meta.developer);
    updateMeta('detailsPub', meta.publisher);
    updateMeta('detailsRelease', meta.releaseDate);

    // Metacritic
    const metacriticEl = document.getElementById('detailsMetacritic');
    if (metacriticEl) {
        if (!isValid(meta.metacritic)) {
            metacriticEl.parentElement.style.display = 'none';
        } else {
            metacriticEl.parentElement.style.display = 'block';
            metacriticEl.textContent = meta.metacritic;
            metacriticEl.className = 'metacritic-score'; // reset
            const n = parseInt(meta.metacritic);
            if (n >= 75) metacriticEl.classList.add('high');
            else if (n >= 50) metacriticEl.classList.add('medium');
            else metacriticEl.classList.add('low');
            sidebarHasContent = true;
        }
    }

    // Genres & Tags
    const updateTags = (id, value, tagClass) => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = '';
        if (isValid(value)) {
            value.split(',').map(v => v.trim()).forEach(text => {
                const span = document.createElement('span');
                span.className = tagClass;
                span.textContent = text;
                container.appendChild(span);
            });
            container.parentElement.style.display = 'block';
            sidebarHasContent = true;
        } else {
            container.parentElement.style.display = 'none';
        }
    };

    updateTags('detailsGenres', meta.genres, 'genre-tag');
    updateTags('detailsTags', meta.tags, 'feature-tag');

    // ضبط شكل الصفحة بناءً على محتوى الـ Sidebar
    if (sidebar) {
        sidebar.style.display = sidebarHasContent ? 'block' : 'none';
        if (detailsContentContainer) {
            detailsContentContainer.style.gridTemplateColumns = sidebarHasContent ? '3fr 1fr' : '1fr';
        }
    }

    // 9. التريلر (Trailer)
    setupTrailerButton(meta.media, game.name);

    // 10. الصور وقسم الوسائط (Screenshots & Media)
    const mediaSection = document.querySelector('.details-media-section');
    const hasScreenshots = meta.media?.screenshots?.length > 0;
    const hasTrailer = !!(meta.media?.trailerYouTubeId && meta.media?.trailerThumbnail);

    if (screenshotsGrid) {
        screenshotsGrid.innerHTML = '';
        if (hasScreenshots) {
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

    // إخفاء قسم Media بالكامل إذا كان فارغاً (هادئ)
    if (mediaSection) {
        mediaSection.style.display = (hasScreenshots || hasTrailer) ? 'block' : 'none';
    }

    // 11. متطلبات النظام (System Requirements)
    const reqMin = meta.systemRequirements?.minimum;
    const reqRec = meta.systemRequirements?.recommended;
    const reqMinEl = document.getElementById('reqMin');
    const reqRecEl = document.getElementById('reqRec');
    const fullReqSection = document.getElementById('systemRequirementsSection');
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

        window.api.launchGame(currentGame.path, showFPS, currentGame.arguments || '', currentGame.id);

        sessionStartTime = Date.now();
        const timerContainer = document.getElementById('sessionTimerContainer');
        if (timerContainer) timerContainer.style.display = 'flex';

        sessionTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
            const timerValue = document.getElementById('sessionTimerValue');
            if (timerValue) timerValue.innerText = formatTime(elapsed);
        }, 1000);
    };

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