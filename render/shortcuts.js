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

// Update lightbox image with smooth transition
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
    // Lightbox controls
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
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey || event.altKey) return;

        // Escape handling
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
                else {
                    updateModal.classList.remove('active');
                    return;
                }
            }

            const editModal = document.getElementById('editModal');
            if (editModal && editModal.style.display === 'flex') {
                editModal.style.display = 'none';
                return;
            }
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) {
                resetLightboxState();
                return;
            }
            const shortcutsModal = document.getElementById('shortcutsModal');
            if (shortcutsModal && shortcutsModal.classList.contains('active')) {
                shortcutsModal.classList.remove('active');
                return;
            }
            if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
                handleGoBack();
            }
            return;
        }

        // F1 opens shortcuts modal
        if (event.key === 'F1') {
            event.preventDefault();
            const shortcutsModal = document.getElementById('shortcutsModal');
            if (shortcutsModal) shortcutsModal.classList.add('active');
            return;
        }

        // Number keys 1-6 for page navigation and sidebar toggle
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

        // Ignore if typing in input/textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        const lightbox = document.getElementById('imageLightbox');
        const isImageViewerOpen = lightbox && lightbox.classList.contains('show');

        switch (event.key) {
            case 'ArrowRight':
                if (isImageViewerOpen) document.getElementById('nextLightbox')?.click();
                break;
            case 'ArrowLeft':
                if (isImageViewerOpen) document.getElementById('prevLightbox')?.click();
                break;
            case 'Backspace':
                if (!isImageViewerOpen) handleGoBack();
                break;
            case 'Enter': {
                const detailsArea = document.getElementById('gameDetailsArea');
                if (detailsArea && detailsArea.classList.contains('active') && !isImageViewerOpen) {
                    document.getElementById('detailsPlayBtn')?.click();
                }
                break;
            }
            case 'p':
            case 'P':
                event.preventDefault();
                if (state.isGameRunning) {
                    const pauseBtn = document.getElementById('pauseTimerBtn');
                    if (pauseBtn && pauseBtn.style.display !== 'none') pauseBtn.click();
                }
                break;
            case '+':
                event.preventDefault();
                document.getElementById('addGameBtn')?.click();
                break;
            case 's':
            case 'S':
                event.preventDefault();
                document.getElementById('searchInput')?.focus();
                break;
            case 'r':
            case 'R':
                event.preventDefault();
                renderGames();
                const isAr = localStorage.getItem('lang') === 'ar';
                const msg = isAr ? 'تم تحديث المكتبة' : 'Library refreshed';
                showToast('success', msg, '', 1500);
                break;
            default:
                break;
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

    // Shortcuts modal (button)
    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const shortcutsModal = document.getElementById('shortcutsModal');
    if (shortcutsBtn && shortcutsModal) {
        shortcutsBtn.addEventListener('click', () => shortcutsModal.classList.add('active'));
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) shortcutsModal.classList.remove('active');
        });
    }
}