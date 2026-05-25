import { state, userSettings } from './state.js';
import { openGameDetailsPage } from './details.js';
import { loadOrder, applyOrder, toggleReorderMode, resetOrder } from './reorder.js';

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

export function createGameCard(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.animationDelay = `${index * 0.03}s`;
    card.setAttribute('data-title', game.name.toLowerCase());
    card.setAttribute('data-game-id', game.id);          // ← for reordering

    const isFav = game.isFavorite ? 'active-fav' : '';
    const favIcon = game.isFavorite ? 'fa-solid' : 'fa-regular';
    const posterUrl = toSafeUrl(game.assets?.poster || '');

    card.innerHTML = `
        <div class="game-actions">
            <button class="action-btn fav-btn ${isFav}" title="Favorite"><i class="${favIcon} fa-heart"></i></button>
            <button class="action-btn edit-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete-btn" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
        <img class="game-poster" src="${posterUrl}" alt="${game.name}" onerror="this.style.background='#1e293b'; this.removeAttribute('src');">
        <div class="game-info"><div class="game-title">${game.name}</div></div>
    `;

    card.addEventListener('click', (e) => {
        if (!e.target.closest('.action-btn')) openGameDetailsPage(game);
    });

    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(userSettings.lang === 'ar' ? `حذف "${game.name}"؟` : `Delete "${game.name}"?`)) {
            await window.api.deleteGame(game.id);
            renderGames();
        }
    });

    card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        state.editingGameId = game.id;
        state.tempGamePath = game.path;

        document.getElementById('gameNameInput').value = game.name;
        document.getElementById('gamePathInput').value = game.path;

        const currentPos = game.assets?.poster || "";
        document.getElementById('customPosterInput').value = currentPos.startsWith('file:///') ? decodeURIComponent(currentPos.replace('file:///', '')) : "";

        const currentLogo = game.assets?.logo || "";
        document.getElementById('customLogoInput').value = currentLogo.startsWith('file:///') ? decodeURIComponent(currentLogo.replace('file:///', '')) : "";

        const currentBg = game.assets?.background || "";
        document.getElementById('customBgInput').value = currentBg.startsWith('file:///') ? decodeURIComponent(currentBg.replace('file:///', '')) : "";

        document.getElementById('saveGameModalBtn').innerText = userSettings.lang === 'ar' ? "حفظ التعديلات" : "Save Changes";
        document.getElementById('launchArgsInput').value = game.arguments || "";

        document.getElementById('editModal').style.display = 'flex';
    });

    card.querySelector('.fav-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        game.isFavorite = !game.isFavorite;
        await window.api.updateGame(game);
        renderGames();
    });

    return card;
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
        state.allGamesData = await window.api.getGames();

        const countDisplay = document.getElementById('gameCountDisplay');
        if (countDisplay) {
            countDisplay.innerText = state.allGamesData.length;
        }

        // 1. Process Recently Played Games
        if (recentlyPlayedContainer) {
            // Filter games that have been played, then sort by most recent
            const recentGames = [...state.allGamesData]
                .filter(g => g.lastPlayed || (g.playtime && g.playtime > 0))
                .sort((a, b) => {
                    const dateA = a.lastPlayed ? new Date(a.lastPlayed).getTime() : 0;
                    const dateB = b.lastPlayed ? new Date(b.lastPlayed).getTime() : 0;
                    return dateB - dateA;
                })
                .slice(0, 10);

            if (recentGames.length > 0) {
                recentGames.forEach((game, index) => {
                    recentlyPlayedContainer.appendChild(createGameCard(game, index));
                });
            } else {
                // Show a placeholder message if no games have been played yet
                recentlyPlayedContainer.innerHTML = `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
                        <i class="fa-solid fa-ghost" style="font-size: 48px; margin-bottom: 16px; opacity: 0.3;"></i>
                        <p style="margin: 0; font-size: 16px; font-weight: 500;">No recently played games found.</p>
                        <small style="opacity: 0.7;">Launch a game from your library to see it here!</small>
                    </div>
                `;
            }
        }

        // 2. Process Main Library
        if (gamesContainer) {
            const savedOrder = await loadOrder('main');
            const orderedGames = applyOrder(state.allGamesData, savedOrder);
            orderedGames.forEach((game, index) => {
                gamesContainer.appendChild(createGameCard(game, index));
            });
        }

        // 3. Process Favorites
        if (favoritesContainer) {
            const favGames = state.allGamesData.filter(g => g.isFavorite);
            const savedFavOrder = await loadOrder('favorites');
            const orderedFavGames = applyOrder(favGames, savedFavOrder);
            orderedFavGames.forEach((game, index) => {
                favoritesContainer.appendChild(createGameCard(game, index));
            });
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

    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const addBtn = document.getElementById('addGameBtn');
    if (!shortcutsBtn || !addBtn) {
        console.error('[Reorder] shortcutsBtn or addGameBtn not found');
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
    if (!gamesContainer) {
        console.error('[Reorder] gamesContainer not found');
        return;
    }

    reorderBtn.onclick = () => {
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