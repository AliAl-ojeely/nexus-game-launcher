import { state, userSettings } from './state.js';
import { openGameDetailsPage } from './details.js';
import { loadOrder, applyOrder, toggleReorderMode, resetOrder } from './reorder.js';
import { showToast } from './details-components.js';

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — convert backslashes to forward slashes for browser URLs
// ─────────────────────────────────────────────────────────────────────────────

function toSafeUrl(url) {
    if (!url) return '';
    return url.replace(/\\/g, '/');
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — resolves best displayable icon for a game (used by details.js)
// ─────────────────────────────────────────────────────────────────────────────

function resolveDisplayIcon(assets) {
    const icon = assets?.icon || '';
    const poster = assets?.poster || '';
    const logo = assets?.logo || '';
    const background = assets?.background || '';
    if (icon) return toSafeUrl(icon);
    if (poster) return toSafeUrl(poster);
    if (logo) return toSafeUrl(logo);
    if (background) return toSafeUrl(background);
    return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE GAME CARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a game card.
 * @param {Object} game - Game object
 * @param {number} index - Animation index
 * @param {boolean} hideActions - If true, shows only a remove-from-recent button (for recently played)
 * @param {boolean} hideEdit - If true, hides the edit button
 * @param {boolean} hideDelete - If true, hides the delete button
 */
export function createGameCard(game, index, hideActions = false, hideEdit = false, hideDelete = false) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.animationDelay = `${index * 0.03}s`;
    card.setAttribute('data-title', game.name.toLowerCase());
    card.setAttribute('data-game-id', game.id);

    const posterUrl = toSafeUrl(game.assets?.poster || '');

    let actionsHtml = '';
    if (hideActions) {
        // Recently played – only remove button (trash can)
        actionsHtml = `
            <div class="game-actions">
                <button class="action-btn delete-btn" title="${userSettings.lang === 'ar' ? 'إزالة من الحديث' : 'Remove from recent'}">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>
        `;
    } else {
        // Normal card (library / favorites)
        const isFav = game.isFavorite ? 'active-fav' : '';
        const favIcon = game.isFavorite ? 'fa-solid' : 'fa-regular';
        const editButton = !hideEdit ? `<button class="action-btn edit-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>` : '';
        const deleteButton = !hideDelete ? `<button class="action-btn delete-btn" title="Delete"><i class="fa-solid fa-trash"></i></button>` : '';
        actionsHtml = `
            <div class="game-actions">
                <button class="action-btn fav-btn ${isFav}" title="Favorite">
                    <i class="${favIcon} fa-heart"></i>
                </button>
                ${editButton}
                ${deleteButton}
            </div>
        `;
    }

    card.innerHTML = `
        ${actionsHtml}
        <img class="game-poster" src="${posterUrl}" alt="${game.name}" 
             onerror="this.style.background='#1e293b'; this.removeAttribute('src');">
        <div class="game-info">
            <div class="game-title">${escapeHtml(game.name)}</div>
        </div>
    `;

    // Click handler – open details (ignore buttons)
    card.addEventListener('click', (e) => {
        if (!e.target.closest('.action-btn')) {
            openGameDetailsPage(game);
        }
    });

    // ── Attach button handlers ─────────────────────────────────────────────
    if (hideActions) {
        // Remove from recent
        const removeBtn = card.querySelector('.delete-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmMsg = userSettings.lang === 'ar'
                    ? `هل تريد إزالة "${game.name}" من قائمة الألعاب الحديثة؟`
                    : `Remove "${game.name}" from recently played list?`;
                if (confirm(confirmMsg)) {
                    await window.api.clearLastPlayed(game.name);
                    renderGames();
                }
            });
        }
    } else {
        // Delete button (full game deletion)
        if (!hideDelete) {
            const deleteBtn = card.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const confirmMsg = userSettings.lang === 'ar'
                        ? `حذف "${game.name}"؟`
                        : `Delete "${game.name}"?`;
                    if (confirm(confirmMsg)) {
                        await window.api.deleteGame(game.id);
                        renderGames();
                    }
                });
            }
        }

        // Edit button
        if (!hideEdit) {
            const editBtn = card.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    state.editingGameId = game.id;
                    state.tempGamePath = game.path;

                    document.getElementById('gameNameInput').value = game.name;
                    document.getElementById('gamePathInput').value = game.path;

                    const currentPoster = game.assets?.poster || '';
                    document.getElementById('customPosterInput').value = currentPoster.startsWith('file:///')
                        ? decodeURIComponent(currentPoster.replace('file:///', ''))
                        : '';

                    const currentLogo = game.assets?.logo || '';
                    document.getElementById('customLogoInput').value = currentLogo.startsWith('file:///')
                        ? decodeURIComponent(currentLogo.replace('file:///', ''))
                        : '';

                    const currentBg = game.assets?.background || '';
                    document.getElementById('customBgInput').value = currentBg.startsWith('file:///')
                        ? decodeURIComponent(currentBg.replace('file:///', ''))
                        : '';

                    const currentIcon = game.assets?.icon || '';
                    document.getElementById('customIconInput').value = currentIcon.startsWith('file:///')
                        ? decodeURIComponent(currentIcon.replace('file:///', ''))
                        : '';

                    document.getElementById('launchArgsInput').value = game.arguments || '';
                    document.getElementById('saveGameModalBtn').innerText = userSettings.lang === 'ar'
                        ? 'حفظ التعديلات'
                        : 'Save Changes';

                    document.getElementById('editModal').style.display = 'flex';
                });
            }
        }

        // Favorite button (always present)
        const favBtn = card.querySelector('.fav-btn');
        if (favBtn) {
            favBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                game.isFavorite = !game.isFavorite;
                await window.api.updateGame(game);

                // Update the header heart icon if the game details page is open and showing this game
                if (state.currentGameId === game.id) {
                    const favIconContainer = document.getElementById('detailsHeaderFavIcon');
                    if (favIconContainer) {
                        const icon = favIconContainer.querySelector('i');
                        if (icon) {
                            if (game.isFavorite) {
                                icon.className = 'fa-solid fa-heart';
                                favIconContainer.classList.add('active');
                            }
                            else {
                                icon.className = 'fa-regular fa-heart';
                                favIconContainer.classList.remove('active');
                            }
                        }
                    }
                }

                // Show toast message
                const isAr = userSettings.lang === 'ar';
                const msg = game.isFavorite
                    ? (isAr ? 'تمت الإضافة إلى المفضلة' : 'Added to favorites')
                    : (isAr ? 'تمت الإزالة من المفضلة' : 'Removed from favorites');
                showToast('success', msg, '', 1500);

                // Refresh the library grid to update the card's heart icon
                renderGames();
            });
        }

    }
    return card;
}

function escapeHtml(str) {
    return str.replace(/[&<>]/g, function (m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER GAMES (applies saved order)
// ─────────────────────────────────────────────────────────────────────────────

export async function renderGames() {
    const gamesContainer = document.getElementById('gamesContainer');
    const favoritesContainer = document.getElementById('favoritesContainer');
    const recentlyPlayedContainer = document.getElementById('recentlyPlayedContainer');

    if (gamesContainer) gamesContainer.innerHTML = '';
    if (favoritesContainer) favoritesContainer.innerHTML = '';
    if (recentlyPlayedContainer) recentlyPlayedContainer.innerHTML = '';

    try {
        // Load games and playtime data in parallel
        const [games, playtimeMap] = await Promise.all([
            window.api.getGames(),
            window.api.getAllPlaytime()
        ]);

        state.allGamesData = games;

        const countDisplay = document.getElementById('gameCountDisplay');
        if (countDisplay) countDisplay.innerText = games.length;

        // ─────────────────────────────────────────────────────────────────────
        // 1. RECENTLY PLAYED (merged with playtimeMap)
        // ─────────────────────────────────────────────────────────────────────
        if (recentlyPlayedContainer) {
            const recentLimit = parseInt(localStorage.getItem('recentLimit') || '10');
            const gamesWithLastPlayed = games.map(game => {
                const pt = playtimeMap[game.name];
                return {
                    ...game,
                    lastPlayed: pt?.lastPlayed || null
                };
            });

            const recentPlayedGames = gamesWithLastPlayed
                .filter(g => g.lastPlayed && typeof g.lastPlayed === 'string')
                .sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed))
                .slice(0, recentLimit);

            if (recentPlayedGames.length > 0) {
                const recentFragment = document.createDocumentFragment();
                recentPlayedGames.forEach((game, idx) => {
                    recentFragment.appendChild(createGameCard(game, idx, true));
                });
                recentlyPlayedContainer.appendChild(recentFragment);
            } else {
                const isAr = userSettings.lang === 'ar';
                recentlyPlayedContainer.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                <i class="fa-solid fa-ghost" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                <p style="margin: 0; font-size: 16px; font-weight: 500;">
                    ${isAr ? 'لا توجد ألعاب تم تشغيلها مؤخراً' : 'No recently played games found.'}
                </p>
                <small style="opacity: 0.7;">
                    ${isAr ? 'قم بتشغيل أي لعبة من مكتبتك لتظهر هنا!' : 'Launch a game from your library to see it here!'}
                </small>
            </div>
        `;
            }
        }

        // ─────────────────────────────────────────────────────────────────────────────
        // 2. MAIN LIBRARY – apply sorting (does NOT overwrite manual order)
        // ─────────────────────────────────────────────────────────────────────────────
        if (gamesContainer) {
            const sortSelect = document.getElementById('sortGamesSelect');
            let sortedGames = [...games];
            const sortValue = sortSelect ? sortSelect.value : 'default';

            switch (sortValue) {
                case 'name_asc':
                    sortedGames.sort((a, b) => a.name.localeCompare(b.name));
                    break;
                case 'name_desc':
                    sortedGames.sort((a, b) => b.name.localeCompare(a.name));
                    break;
                case 'playtime_desc':
                    sortedGames.sort((a, b) => {
                        const ptA = playtimeMap[a.name]?.minutes || 0;
                        const ptB = playtimeMap[b.name]?.minutes || 0;
                        return ptB - ptA;
                    });
                    break;
                case 'recent_desc':
                    sortedGames.sort((a, b) => {
                        const dateA = playtimeMap[a.name]?.lastPlayed ? new Date(playtimeMap[a.name].lastPlayed) : 0;
                        const dateB = playtimeMap[b.name]?.lastPlayed ? new Date(playtimeMap[b.name].lastPlayed) : 0;
                        return dateB - dateA;
                    });
                    break;
                case 'added_desc':
                    sortedGames.sort((a, b) => b.id - a.id);
                    break;
                default:
                    const savedOrder = await loadOrder('main');
                    sortedGames = applyOrder(sortedGames, savedOrder);
            }

            const mainFragment = document.createDocumentFragment();
            sortedGames.forEach((game, index) => {
                mainFragment.appendChild(createGameCard(game, index, false, false, false));
            });
            gamesContainer.appendChild(mainFragment);
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. FAVORITES (only favorite button – no edit, no delete)
        // ─────────────────────────────────────────────────────────────────────
        if (favoritesContainer) {
            const favGames = games.filter(g => g.isFavorite);
            const savedFavOrder = await loadOrder('favorites');
            const orderedFavGames = applyOrder(favGames, savedFavOrder);

            const favFragment = document.createDocumentFragment();
            orderedFavGames.forEach((game, index) => {
                favFragment.appendChild(createGameCard(game, index, false, true, true));
            });
            favoritesContainer.appendChild(favFragment);
        }

    } catch (error) {
        console.error("Error loading games:", error);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISE REORDER BUTTONS (call after renderGames)
// ─────────────────────────────────────────────────────────────────────────────

export function initReorderButton() {
    console.log('[Reorder] initReorderButton called');
    const topbarActions = document.querySelector('.topbar-actions');
    if (!topbarActions) {
        console.error('[Reorder] .topbar-actions not found');
        return;
    }

    const addBtn = document.getElementById('addGameBtn');
    if (!addBtn) {
        console.error('[Reorder] addGameBtn not found');
        return;
    }

    console.log('[Reorder] Creating reorder button');

    const reorderBtn = document.createElement('button');
    reorderBtn.id = 'reorderModeBtn';
    reorderBtn.className = 'reorder-btn';
    reorderBtn.innerHTML = '<i class="fa-solid fa-arrows-up-down-left-right"></i>';
    reorderBtn.title = userSettings.lang === 'ar' ? 'ترتيب الألعاب' : 'Reorder games';

    const resetBtn = document.createElement('button');
    resetBtn.id = 'resetOrderBtn';
    resetBtn.className = 'reset-order-btn';
    resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i>';
    resetBtn.title = userSettings.lang === 'ar' ? 'إعادة الترتيب الافتراضي' : 'Reset to default order';
    resetBtn.style.display = 'none';

    topbarActions.insertBefore(reorderBtn, addBtn);
    topbarActions.insertBefore(resetBtn, addBtn);

    const gamesContainer = document.getElementById('gamesContainer');
    const favoritesContainer = document.getElementById('favoritesContainer');
    if (!gamesContainer) {
        console.error('[Reorder] gamesContainer not found');
        return;
    }

    reorderBtn.onclick = () => {
        // Disable reorder button on Recently Played page
        if (state.currentTab === 'recentArea') {
            const isAr = userSettings.lang === 'ar';
            const msg = isAr ? 'لا يمكن إعادة ترتيب الألعاب في صفحة الألعاب الحديثة' : 'Cannot reorder games on Recently Played page';
            if (window.showToast) window.showToast('warning', msg, '', 2000);
            return;
        }
        const isActive = toggleReorderMode(gamesContainer, favoritesContainer, (newOrder, type) => {
            console.log(`Order saved for ${type}:`, newOrder);
        });
        resetBtn.style.display = isActive ? 'inline-flex' : 'none';
        reorderBtn.classList.toggle('active', isActive);
    };

    resetBtn.onclick = async () => {
        await resetOrder(state.allGamesData, gamesContainer, favoritesContainer);
        await renderGames();
        if (window.showToast) {
            window.showToast('info', userSettings.lang === 'ar' ? 'تم إعادة الترتيب' : 'Order reset', '', 2000);
        }
    };

    console.log('[Reorder] Buttons added and event handlers attached');
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALISE SEARCH
// ─────────────────────────────────────────────────────────────────────────────

let searchTimeout;
export function initLibrary() {
    const input = document.getElementById('searchInput');
    input.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const searchTerm = e.target.value.toLowerCase();
            const cards = document.querySelectorAll('.game-card');
            cards.forEach(card => {
                card.style.display = card.getAttribute('data-title').includes(searchTerm) ? 'block' : 'none';
            });
        }, 150);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTED HELPERS (used by details.js)
// ─────────────────────────────────────────────────────────────────────────────

export { resolveDisplayIcon, toSafeUrl };