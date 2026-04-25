import { state, userSettings } from '../state.js';
import { openLightbox } from '../shortcuts.js';
import { toSafeUrl, isValid } from '../details-utils.js';
import { setupTrailerButton } from '../details-components.js';
import { t } from './helpers.js';

export function renderGameDetails(game) {
    const assets = game.assets || {};
    const meta = game.metadata || {};

    const banner = document.getElementById('detailsBanner');
    const logoImg = document.getElementById('detailsLogo');
    const headerIcon = document.getElementById('detailsHeaderIcon');
    const screenshotsGrid = document.getElementById('detailsScreenshotsGrid');
    const descEl = document.getElementById('detailsDescription');
    const readMoreBtn = document.getElementById('readMoreBtn');
    const descriptionArea = document.getElementById('descriptionArea');

    // Banner
    const bgUrl = toSafeUrl(assets.background || assets.poster || '');
    if (banner) banner.style.backgroundImage = bgUrl ? `url("${bgUrl}")` : '';

    // Logo
    if (logoImg) {
        if (assets.logo) {
            logoImg.src = toSafeUrl(assets.logo);
            logoImg.style.display = 'block';
        } else {
            logoImg.style.display = 'none';
        }
    }

    // Header Icon
    if (headerIcon) {
        if (assets.icon) {
            headerIcon.src = toSafeUrl(assets.icon);
            headerIcon.style.display = 'block';
            headerIcon.onerror = () => { headerIcon.style.display = 'none'; };
        } else {
            headerIcon.style.display = 'none';
        }
    }

    // Description section – hide entirely if no description
    if (isValid(meta.description) && meta.description.trim() !== '') {
        if (descriptionArea) descriptionArea.style.display = 'block';
        descEl.innerHTML = meta.description;
        setTimeout(() => {
            const wrapper = document.getElementById('descWrapper');
            if (readMoreBtn && descEl.scrollHeight > 165) {
                readMoreBtn.style.display = 'flex';
                wrapper.classList.remove('no-shadow'); // show shadow for long text
                readMoreBtn.querySelector('span').innerText = t('read_more', userSettings.lang === 'ar' ? 'إقرأ المزيد' : 'Read More');
            } else if (readMoreBtn) {
                readMoreBtn.style.display = 'none';
                if (wrapper) wrapper.classList.add('no-shadow'); // hide shadow for short text
            }
        }, 200);
    } else {
        if (descriptionArea) descriptionArea.style.display = 'none';
        if (readMoreBtn) readMoreBtn.style.display = 'none';
    }

    // Sidebar metadata
    const updateMeta = (id, value) => {
        const el = document.getElementById(id);
        if (el && isValid(value)) {
            el.parentElement.style.display = 'block';
            el.innerText = value;
        } else if (el) {
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
            metacriticEl.className = 'metacritic-score';
            const n = parseInt(meta.metacritic);
            if (n >= 75) metacriticEl.classList.add('high');
            else if (n >= 50) metacriticEl.classList.add('medium');
            else metacriticEl.classList.add('low');
        }
    }

    // Genres & Tags
    const updateTags = (id, value, tagClass) => {
        const container = document.getElementById(id);
        if (!container) return;
        container.innerHTML = '';
        if (isValid(value)) {
            value.split(',').map(v => v.trim()).filter(Boolean).forEach(text => {
                const span = document.createElement('span');
                span.className = tagClass;
                span.textContent = text;
                container.appendChild(span);
            });
            container.parentElement.style.display = 'block';
        } else {
            container.parentElement.style.display = 'none';
        }
    };
    updateTags('detailsGenres', meta.genres, 'genre-tag');
    updateTags('detailsTags', meta.tags, 'feature-tag');

    // Achievements link (Steam only)
    const achievementsContainer = document.getElementById('detailsAchievements');
    if (achievementsContainer) {
        const steamId = meta.steamAppId;
        if (steamId && steamId !== '') {
            const link = `https://steamcommunity.com/stats/${steamId}/achievements`;
            achievementsContainer.innerHTML = `
            <div class="meta-item">
                <span data-i18n="achievements_title">Achievements</span>
                <button class="achievements-link-btn" data-url="${link}">
                    <i class="fa-solid fa-trophy"></i> ${userSettings.lang === 'ar' ? 'عرض الإنجازات' : 'View Achievements'}
                </button>
            </div>
        `;
            achievementsContainer.style.display = 'block';

            // Attach click event to open in external browser
            const btn = achievementsContainer.querySelector('.achievements-link-btn');
            btn.addEventListener('click', () => {
                window.api.openExternal(link);
            });
        } else {
            achievementsContainer.style.display = 'none';
        }
    }

    // System Requirements
    const reqMinEl = document.getElementById('reqMin');
    const reqRecEl = document.getElementById('reqRec');
    const fullReqSection = document.getElementById('systemRequirementsSection');
    let hasAnyReq = false;
    const sysReqs = meta.systemRequirements || null;

    if (reqMinEl) {
        if (sysReqs && isValid(sysReqs.minimum)) {
            reqMinEl.innerHTML = sysReqs.minimum;
            reqMinEl.parentElement.style.display = 'block';
            hasAnyReq = true;
        } else {
            reqMinEl.parentElement.style.display = 'none';
        }
    }
    if (reqRecEl) {
        if (sysReqs && isValid(sysReqs.recommended)) {
            reqRecEl.innerHTML = sysReqs.recommended;
            reqRecEl.parentElement.style.display = 'block';
            hasAnyReq = true;
        } else {
            reqRecEl.parentElement.style.display = 'none';
        }
    }
    if (fullReqSection) fullReqSection.style.display = hasAnyReq ? 'block' : 'none';

    // Screenshots
    if (screenshotsGrid) {
        screenshotsGrid.innerHTML = '';
        if (meta.media?.screenshots?.length > 0) {
            state.currentScreenshotsList = meta.media.screenshots;
            meta.media.screenshots.forEach((imgUrl, index) => {
                const img = document.createElement('img');
                img.src = toSafeUrl(imgUrl);
                img.className = 'screenshot-item';
                img.loading = 'lazy';
                img.onclick = () => openLightbox(index);
                screenshotsGrid.appendChild(img);
            });
        }
    }

    // Trailer button
    setupTrailerButton(meta.media, game.name);
}