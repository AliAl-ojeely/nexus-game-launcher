import { state } from './state.js';
import { handleGoBack } from './ui.js';
import { renderGames } from './library.js';
import { showToast } from './details-components.js';

let slideshowInterval = null;
let isSlideshowRunning = false;

// --- Pan & zoom state ---
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };
let currentScale = 1;
const ZOOM_SCALE = 2;

function updateLightboxImage(newIndex) {
    state.currentScreenshotIndex = newIndex;
    const img = document.getElementById('lightboxImage');
    if (!img) return;
    img.style.opacity = '0';
    setTimeout(() => {
        img.src = state.currentScreenshotsList[state.currentScreenshotIndex];
        img.style.opacity = '1';
        resetPanAndZoom();
    }, 300);
}

function resetPanAndZoom() {
    const img = document.getElementById('lightboxImage');
    if (!img) return;
    img.classList.remove('zoomed');
    panOffset = { x: 0, y: 0 };
    currentScale = 1;
    img.style.transform = '';
    if (img.style.cursor) img.style.cursor = 'zoom-in';
}

function applyTransform(img) {
    if (currentScale === 1) {
        img.style.transform = '';
    } else {
        img.style.transform = `scale(${currentScale}) translate(${panOffset.x}px, ${panOffset.y}px)`;
    }
}

function toggleZoom(e) {
    const img = document.getElementById('lightboxImage');
    if (!img) return;
    e.stopPropagation();
    if (currentScale === 1) {
        currentScale = ZOOM_SCALE;
        img.classList.add('zoomed');
    } else {
        currentScale = 1;
        img.classList.remove('zoomed');
        panOffset = { x: 0, y: 0 };
    }
    applyTransform(img);
    img.style.cursor = currentScale === 1 ? 'zoom-in' : 'grab';
}

function startPan(e) {
    const img = document.getElementById('lightboxImage');
    if (!img || currentScale === 1) return;
    e.preventDefault();
    isPanning = true;
    panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    img.style.cursor = 'grabbing';
}

function onPan(e) {
    if (!isPanning || currentScale === 1) return;
    e.preventDefault();
    panOffset = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
    applyTransform(document.getElementById('lightboxImage'));
}

function stopPan() {
    const img = document.getElementById('lightboxImage');
    if (!img) return;
    isPanning = false;
    img.style.cursor = currentScale === 1 ? 'zoom-in' : 'grab';
}

export function toggleSlideshow() {
    const btn = document.getElementById('slideshowBtn');
    if (!btn) return;
    if (isSlideshowRunning) {
        clearInterval(slideshowInterval);
        btn.innerHTML = '<i class="fa-solid fa-play"></i>';
        isSlideshowRunning = false;
    } else {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i>';
        isSlideshowRunning = true;
        slideshowInterval = setInterval(() => {
            const nextIndex = (state.currentScreenshotIndex < state.currentScreenshotsList.length - 1)
                ? state.currentScreenshotIndex + 1
                : 0;
            updateLightboxImage(nextIndex);
        }, 3000);
    }
}

function initLightboxEvents() {
    const img = document.getElementById('lightboxImage');
    if (!img) return;
    img.removeEventListener('dblclick', toggleZoom);
    img.removeEventListener('mousedown', startPan);
    window.removeEventListener('mousemove', onPan);
    window.removeEventListener('mouseup', stopPan);
    img.addEventListener('dblclick', toggleZoom);
    img.addEventListener('mousedown', startPan);
    window.addEventListener('mousemove', onPan);
    window.addEventListener('mouseup', stopPan);
}

export function openLightbox(index) {
    state.currentScreenshotIndex = index;
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImage');
    if (!lightbox || !lightboxImg) return;
    lightboxImg.src = state.currentScreenshotsList[state.currentScreenshotIndex];
    lightbox.classList.add('show');
    currentScale = 1;
    panOffset = { x: 0, y: 0 };
    lightboxImg.classList.remove('zoomed');
    lightboxImg.style.transform = '';
    lightboxImg.style.cursor = 'zoom-in';
    initLightboxEvents();
}

function resetLightboxState() {
    if (isSlideshowRunning) toggleSlideshow();
    const img = document.getElementById('lightboxImage');
    if (img) {
        currentScale = 1;
        panOffset = { x: 0, y: 0 };
        img.classList.remove('zoomed');
        img.style.transform = '';
        img.style.cursor = 'zoom-in';
    }
    document.getElementById('imageLightbox').classList.remove('show');
}

export function initShortcuts() {
    // Lightbox controls (unchanged)
    const closeBtn = document.getElementById('closeLightbox');
    if (closeBtn) closeBtn.addEventListener('click', resetLightboxState);
    const slideshowBtn = document.getElementById('slideshowBtn');
    if (slideshowBtn) slideshowBtn.addEventListener('click', toggleSlideshow);
    const prevBtn = document.getElementById('prevLightbox');
    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const prevIndex = (state.currentScreenshotIndex > 0)
                ? state.currentScreenshotIndex - 1
                : state.currentScreenshotsList.length - 1;
            updateLightboxImage(prevIndex);
        });
    }
    const nextBtn = document.getElementById('nextLightbox');
    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nextIndex = (state.currentScreenshotIndex < state.currentScreenshotsList.length - 1)
                ? state.currentScreenshotIndex + 1
                : 0;
            updateLightboxImage(nextIndex);
        });
    }
    const lightboxOverlay = document.getElementById('imageLightbox');
    if (lightboxOverlay) {
        lightboxOverlay.addEventListener('click', (e) => {
            if (e.target.id === 'imageLightbox') resetLightboxState();
        });
    }

    // Keyboard navigation
    document.addEventListener('keydown', async (event) => {
        // Disable most shortcuts when reorder mode is active (only allow Escape and M)
        const reorderBtn = document.getElementById('reorderModeBtn');
        const isReorderActive = reorderBtn && reorderBtn.classList.contains('active');
        if (isReorderActive && event.key !== 'Escape' && event.key !== 'm' && event.key !== 'M') {
            event.preventDefault();
            // Optional: show a toast once? Not necessary – just block silently.
            return;
        }

        // 1. Escape handling (blur search, close modals)
        if (event.key === 'Escape') {
            const searchInput = document.getElementById('searchInput');
            if (document.activeElement === searchInput) {
                searchInput.blur();
                return;
            }
            const updateModal = document.getElementById('updateModal');
            if (updateModal && updateModal.classList.contains('active')) {
                const progressContainer = document.getElementById('updateProgressContainer');
                const isDownloading = progressContainer && progressContainer.style.display === 'block';
                if (isDownloading) return;
                else { updateModal.classList.remove('active'); return; }
            }
            const editModal = document.getElementById('editModal');
            if (editModal && editModal.style.display === 'flex') { editModal.style.display = 'none'; return; }
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) { resetLightboxState(); return; }
            const shortcutsModal = document.getElementById('shortcutsModal');
            if (shortcutsModal && shortcutsModal.classList.contains('active')) { shortcutsModal.classList.remove('active'); return; }
            if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') handleGoBack();
            return;
        }

        // 2. Disable all other shortcuts when typing in inputs/textareas
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        // 3. Lightbox left/right arrows – highest priority
        const lightboxOpen = document.getElementById('imageLightbox')?.classList.contains('show') || false;
        if (lightboxOpen && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            if (event.key === 'ArrowLeft') {
                document.getElementById('prevLightbox')?.click();
            } else {
                document.getElementById('nextLightbox')?.click();
            }
            return;
        }

        // No modifier keys for remaining shortcuts
        if (event.ctrlKey || event.altKey) return;

        // Shared variables for page navigation and grid
        const activePage = state.currentTab;
        const gridPages = ['libraryArea', 'recentArea', 'favoritesArea'];

        // 4. F1: shortcuts modal
        if (event.key === 'F1') {
            event.preventDefault();
            const modal = document.getElementById('shortcutsModal');
            if (modal) modal.classList.add('active');
            return;
        }

        // 5. Number keys 1-6
        if (event.key >= '1' && event.key <= '6') {
            event.preventDefault();
            if (event.key === '6') {
                const sidebarBtn = document.getElementById('sidebarCollapseBtn');
                if (sidebarBtn) sidebarBtn.click();
                return;
            }
            const pageMap = {
                '1': 'libraryArea',
                '2': 'recentArea',
                '3': 'favoritesArea',
                '4': 'statsArea',
                '5': 'settingsArea'
            };
            const targetId = pageMap[event.key];
            if (targetId) {
                const navItem = document.querySelector(`.nav-item[data-target="${targetId}"]`);
                if (navItem) navItem.click();
            }
            return;
        }

        // 6. G: random game
        if (event.key === 'g' || event.key === 'G') {
            event.preventDefault();
            const randomBtn = document.getElementById('randomGameBtn');
            if (randomBtn) randomBtn.click();
            return;
        }

        // 7. M: reorder mode (drag & drop)
        if (event.key === 'm' || event.key === 'M') {
            event.preventDefault();
            const activePage = state.currentTab;
            // Block on Recently Played
            if (activePage === 'recentArea') {
                const isAr = localStorage.getItem('lang') === 'ar';
                const msg = isAr ? 'لا يمكن تفعيل وضع إعادة الترتيب في صفحة الألعاب الحديثة' : 'Reorder mode is not available on Recently Played page';
                showToast('warning', msg, '', 2000);
                return;
            }
            // Also block on game details page
            const detailsArea = document.getElementById('gameDetailsArea');
            if (detailsArea && detailsArea.classList.contains('active')) {
                const isAr = localStorage.getItem('lang') === 'ar';
                const msg = isAr ? 'لا يمكن تفعيل وضع إعادة الترتيب في صفحة تفاصيل اللعبة' : 'Cannot enable reorder mode on game details page';
                showToast('warning', msg, '', 2000);
                return;
            }
            const reorderBtn = document.getElementById('reorderModeBtn');
            if (reorderBtn) reorderBtn.click();
            return;
        }

        // 8. F11: fullscreen
        if (event.key === 'F11') {
            event.preventDefault();
            if (window.api && window.api.toggleFullscreen) window.api.toggleFullscreen();
            return;
        }

        // 9. Other keys (backspace, enter, +, s, r, arrows for scrolling/grid)
        // Backspace
        if (event.key === 'Backspace') {
            event.preventDefault();
            const lightboxNow = document.getElementById('imageLightbox')?.classList.contains('show');
            if (!lightboxNow) handleGoBack();
            return;
        }

        // Enter
        if (event.key === 'Enter') {
            event.preventDefault();
            const detailsArea = document.getElementById('gameDetailsArea');
            if (detailsArea && detailsArea.classList.contains('active')) {
                const playBtn = document.getElementById('detailsPlayBtn');
                if (playBtn) playBtn.click();
                return;
            }
            const isGrid = gridPages.includes(activePage);
            if (isGrid) {
                const container = document.getElementById(activePage);
                if (container) {
                    let selectedCard = container.querySelector('.game-card.selected');
                    if (!selectedCard) {
                        const firstCard = container.querySelector('.game-card');
                        if (firstCard) {
                            firstCard.classList.add('selected');
                            selectedCard = firstCard;
                        }
                    }
                    if (selectedCard) selectedCard.click();
                }
            }
            return;
        }

        // P: pause timer
        if (event.key === 'p' || event.key === 'P') {
            event.preventDefault();
            if (state.isGameRunning) {
                const pauseBtn = document.getElementById('pauseTimerBtn');
                if (pauseBtn && pauseBtn.style.display !== 'none') pauseBtn.click();
            }
            return;
        }

        // + : add game
        if (event.key === '+') {
            event.preventDefault();
            document.getElementById('addGameBtn')?.click();
            return;
        }

        // S: focus search
        if (event.key === 's' || event.key === 'S') {
            event.preventDefault();
            document.getElementById('searchInput')?.focus();
            return;
        }

        // F: toggle favorite (only in game details page)
        if (event.key === 'f' || event.key === 'F') {
            event.preventDefault();
            console.log('[Shortcut] F pressed');

            const detailsArea = document.getElementById('gameDetailsArea');
            if (!detailsArea || !detailsArea.classList.contains('active')) {
                console.log('[Shortcut] Game details page not active');
                return;
            }
            console.log('[Shortcut] Game details page active');

            // Try to get game from state.currentGameId
            let game = null;
            if (state.currentGameId) {
                game = state.allGamesData.find(g => g.id === state.currentGameId);
                console.log('[Shortcut] Found by ID:', game ? game.name : 'not found');
            }
            // Fallback: try to find by the game title in the header
            if (!game) {
                const titleElem = document.getElementById('detailsGameTitle');
                if (titleElem) {
                    const gameName = titleElem.innerText;
                    game = state.allGamesData.find(g => g.name === gameName);
                    console.log('[Shortcut] Found by title:', game ? game.name : 'not found');
                }
            }
            if (!game) {
                console.warn('[Shortcut] Could not determine current game');
                return;
            }

            // Toggle favourite
            game.isFavorite = !game.isFavorite;
            await window.api.updateGame(game);
            renderGames(); // refresh library/favorites grids

            // Update the header heart icon (display only)
            const favIconContainer = document.getElementById('detailsHeaderFavIcon');
            if (favIconContainer) {
                const icon = favIconContainer.querySelector('i');
                if (icon) {
                    if (game.isFavorite) {
                        icon.className = 'fa-solid fa-heart';
                        favIconContainer.classList.add('active');
                    } else {
                        icon.className = 'fa-regular fa-heart';
                        favIconContainer.classList.remove('active');
                    }
                }
            }

            const isAr = localStorage.getItem('lang') === 'ar';
            const msg = game.isFavorite
                ? (isAr ? 'تمت الإضافة إلى المفضلة' : 'Added to favorites')
                : (isAr ? 'تمت الإزالة من المفضلة' : 'Removed from favorites');
            showToast('success', msg, '', 1500);

            return;
        }

        // R: refresh library
        if (event.key === 'r' || event.key === 'R') {
            event.preventDefault();
            renderGames();
            if (window.refreshMissingMetadata) window.refreshMissingMetadata();
            const isAr = localStorage.getItem('lang') === 'ar';
            const msg = isAr ? 'تم تحديث المكتبة' : 'Library refreshed';
            showToast('success', msg, '', 1500);
            return;
        }

        // Arrow keys: left/right for grid navigation (only if lightbox is closed)
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            // Lightbox already handled at the top, so we are safe here
            if (gridPages.includes(activePage)) {
                const container = document.getElementById(activePage);
                if (!container) return;
                const grid = container.querySelector('.games-grid');
                if (!grid) return;
                const cards = Array.from(grid.querySelectorAll('.game-card'));
                if (cards.length === 0) return;
                let currentIdx = cards.findIndex(c => c.classList.contains('selected'));
                if (currentIdx === -1) {
                    currentIdx = 0;
                    if (cards[0]) cards[0].classList.add('selected');
                }
                let newIdx = currentIdx;
                if (event.key === 'ArrowRight') {
                    newIdx = currentIdx + 1;
                    if (newIdx >= cards.length) newIdx = 0;
                } else if (event.key === 'ArrowLeft') {
                    newIdx = currentIdx - 1;
                    if (newIdx < 0) newIdx = cards.length - 1;
                }
                if (newIdx !== currentIdx) {
                    cards[currentIdx].classList.remove('selected');
                    cards[newIdx].classList.add('selected');
                    cards[newIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }
            return;
        }

        // Arrow Up/Down for scrolling Settings and Statistics pages only
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            if (activePage === 'settingsArea') {
                const container = document.querySelector('.settings-container');
                if (container) {
                    const delta = event.key === 'ArrowDown' ? 100 : -100;
                    container.scrollBy({ top: delta, behavior: 'smooth' });
                }
                return;
            }
            if (activePage === 'statsArea') {
                const container = document.querySelector('.stats-main');
                if (container) {
                    const delta = event.key === 'ArrowDown' ? 100 : -100;
                    container.scrollBy({ top: delta, behavior: 'smooth' });
                }
                return;
            }
            return;
        }
    });

    // Mouse back button (button 3)
    document.addEventListener('mouseup', (event) => {
        if (event.button === 3) {
            event.preventDefault();
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) resetLightboxState();
            else handleGoBack();
        }
    });

    // Mouse wheel navigation in lightbox
    document.addEventListener('wheel', (event) => {
        const lightbox = document.getElementById('imageLightbox');
        if (lightbox && lightbox.classList.contains('show')) {
            if (event.deltaY > 0) document.getElementById('nextLightbox')?.click();
            else if (event.deltaY < 0) document.getElementById('prevLightbox')?.click();
        }
    });

    // Shortcuts modal button
    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const shortcutsModal = document.getElementById('shortcutsModal');
    if (shortcutsBtn && shortcutsModal) {
        shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.add('active'));
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) shortcutsModal.classList.remove('active');
        });
    }
}