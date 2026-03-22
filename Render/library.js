import { state, userSettings } from './state.js';
import { openGameDetailsPage } from './details.js';

export function createGameCard(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.animationDelay = `${index * 0.03}s`;
    card.setAttribute('data-title', game.name.toLowerCase());

    const isFav = game.isFavorite ? 'active-fav' : '';
    const favIcon = game.isFavorite ? 'fa-solid' : 'fa-regular';
    const posterUrl = game.assets?.poster || 'https://via.placeholder.com/260x390/1e293b/FFFFFF?text=' + encodeURIComponent(game.name);

    card.innerHTML = `
        <div class="game-actions">
            <button class="action-btn fav-btn ${isFav}" title="Favorite"><i class="${favIcon} fa-heart"></i></button>
            <button class="action-btn edit-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete-btn" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
        <img class="game-poster" src="${posterUrl}" alt="${game.name}">
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

export async function renderGames() {
    const gamesContainer = document.getElementById('gamesContainer');
    const favoritesContainer = document.getElementById('favoritesContainer');
    gamesContainer.innerHTML = '';
    favoritesContainer.innerHTML = '';
    try {
        state.allGamesData = await window.api.getGames();
        document.getElementById('gameCountDisplay').innerText = state.allGamesData.length;
        state.allGamesData.forEach((game, index) => {
            gamesContainer.appendChild(createGameCard(game, index));
            if (game.isFavorite) favoritesContainer.appendChild(createGameCard(game, index));
        });
    } catch (error) { console.error("Error loading games:", error); }
}

export function initLibrary() {
    document.getElementById('searchInput').addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.game-card');
        cards.forEach(card => card.style.display = card.getAttribute('data-title').includes(searchTerm) ? 'block' : 'none');
    });
}