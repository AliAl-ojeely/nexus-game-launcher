let sortableMain = null;
let sortableFav = null;
let isReorderMode = false;

export async function loadOrder(type = 'main') {
    const key = type === 'main' ? 'getGameOrder' : 'getFavoritesOrder';
    const result = await window.api[key]();
    return result || [];
}

export async function saveOrder(orderArray, type = 'main') {
    const key = type === 'main' ? 'saveGameOrder' : 'saveFavoritesOrder';
    await window.api[key](orderArray);
}

export function applyOrder(games, savedOrder) {
    if (!savedOrder || !savedOrder.length) return games;
    const ordered = [...games];
    ordered.sort((a, b) => {
        const indexA = savedOrder.indexOf(a.id);
        const indexB = savedOrder.indexOf(b.id);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });
    return ordered;
}

export function enableReorderMode(mainContainer, favContainer, onOrderChange) {
    if (isReorderMode) return;
    if (typeof Sortable === 'undefined') {
        console.error('[Reorder] Sortable library not loaded!');
        return;
    }
    isReorderMode = true;

    document.body.classList.add('reorder-mode');

    if (mainContainer) {
        mainContainer.querySelectorAll('.game-card').forEach(card => {
            card.classList.add('shake-animation');
        });
    }

    if (favContainer) {
        favContainer.querySelectorAll('.game-card').forEach(card => {
            card.classList.add('shake-animation');
        });
    }

    if (sortableMain) sortableMain.destroy();
    if (sortableFav) sortableFav.destroy();

    if (mainContainer) {
    sortableMain = new Sortable(mainContainer, {
        animation: 300,
        handle: '.game-card',
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const newOrder = Array.from(mainContainer.querySelectorAll('.game-card')).map(card => parseInt(card.getAttribute('data-game-id')));
            await saveOrder(newOrder, 'main');
            if (onOrderChange) onOrderChange(newOrder, 'main');
        }
    });
    }

    if (favContainer && favContainer.querySelectorAll('.game-card').length > 0) {
        sortableFav = new Sortable(favContainer, {
            animation: 300,
            handle: '.game-card',
            ghostClass: 'sortable-ghost',
            onEnd: async () => {
                const newOrder = Array.from(favContainer.querySelectorAll('.game-card')).map(card => parseInt(card.getAttribute('data-game-id')));
                await saveOrder(newOrder, 'favorites');
                if (onOrderChange) onOrderChange(newOrder, 'favorites');
            }
        });
    }
}

export function disableReorderMode() {
    if (!isReorderMode) return;
    isReorderMode = false;

    document.body.classList.remove('reorder-mode');
    document.querySelectorAll('.game-card').forEach(card => {
        card.classList.remove('shake-animation');
    });

    if (sortableMain) {
        sortableMain.destroy();
        sortableMain = null;
    }
    if (sortableFav) {
        sortableFav.destroy();
        sortableFav = null;
    }
}

export function toggleReorderMode(mainContainer, favContainer, onOrderChange) {
    if (isReorderMode) {
        disableReorderMode();
        return false; // now inactive
    } else {
        enableReorderMode(mainContainer, favContainer, onOrderChange);
        return true; // now active
    }
}

// Reset only the requested grid; never discard the other grid's saved order.
export async function resetOrder(games, mainContainer, favContainer, scope = "both") {
    if (isReorderMode) disableReorderMode();
    if (scope === "both" || scope === "main") {
        const defaultOrder = games.map(game => game.id);
        await saveOrder(defaultOrder, 'main');
    }
    if (scope === "both" || scope === "favorites") {
        await saveOrder([], 'favorites');
    }
}
