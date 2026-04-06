import { state } from './state.js';
import { handleGoBack } from './ui.js';

export function openLightbox(index) {
    state.currentScreenshotIndex = index;
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImage');
    lightboxImg.src = state.currentScreenshotsList[state.currentScreenshotIndex];
    lightbox.classList.add('show');
}

export function initShortcuts() {
    // Lightbox close
    document.getElementById('closeLightbox').addEventListener('click', () => document.getElementById('imageLightbox').classList.remove('show'));

    document.getElementById('prevLightbox').addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentScreenshotIndex = (state.currentScreenshotIndex > 0) ? state.currentScreenshotIndex - 1 : state.currentScreenshotsList.length - 1;
        document.getElementById('lightboxImage').src = state.currentScreenshotsList[state.currentScreenshotIndex];
    });

    document.getElementById('nextLightbox').addEventListener('click', (e) => {
        e.stopPropagation();
        state.currentScreenshotIndex = (state.currentScreenshotIndex < state.currentScreenshotsList.length - 1) ? state.currentScreenshotIndex + 1 : 0;
        document.getElementById('lightboxImage').src = state.currentScreenshotsList[state.currentScreenshotIndex];
    });

    document.getElementById('imageLightbox').addEventListener('click', (e) => {
        if (e.target.id === 'imageLightbox') document.getElementById('imageLightbox').classList.remove('show');
    });

    // Global keydown handlers
    document.addEventListener('keydown', (event) => {
        // Ignore if Ctrl or Alt is pressed (allow browser shortcuts like zoom)
        if (event.ctrlKey || event.altKey) return;

        if (event.key === 'Escape') {
            const searchInput = document.getElementById('searchInput');
            if (document.activeElement === searchInput) {
                searchInput.blur();
                return;
            }
            const editModal = document.getElementById('editModal');
            if (editModal && editModal.style.display === 'flex') {
                editModal.style.display = 'none';
                return;
            }
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) {
                document.getElementById('closeLightbox').click();
                return;
            }
            // Close shortcuts modal if open
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

        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        const lightbox = document.getElementById('imageLightbox');
        const isImageViewerOpen = lightbox && lightbox.classList.contains('show');

        switch (event.key) {
            case 'ArrowRight': if (isImageViewerOpen) document.getElementById('nextLightbox').click(); break;
            case 'ArrowLeft': if (isImageViewerOpen) document.getElementById('prevLightbox').click(); break;
            case 'Backspace': if (!isImageViewerOpen) handleGoBack(); break;
            case 'Enter': {
                const detailsArea = document.getElementById('gameDetailsArea');
                if (detailsArea && detailsArea.classList.contains('active') && !isImageViewerOpen) document.getElementById('detailsPlayBtn').click();
                break;
            }
            case '+': {
                event.preventDefault();
                const addBtn = document.getElementById('addGameBtn');
                if (addBtn) addBtn.click();
                break;
            }
            case 's':
            case 'S': {
                event.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.focus();
                break;
            }
        }
    });

    // Mouse back button
    document.addEventListener('mouseup', (event) => {
        if (event.button === 3) {
            event.preventDefault();
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) document.getElementById('closeLightbox').click();
            else handleGoBack();
        }
    });

    // Wheel for lightbox
    document.addEventListener('wheel', (event) => {
        const lightbox = document.getElementById('imageLightbox');
        if (lightbox && lightbox.classList.contains('show')) {
            if (event.deltaY > 0) document.getElementById('nextLightbox').click();
            else if (event.deltaY < 0) document.getElementById('prevLightbox').click();
        }
    });

    // ── Shortcuts Info Modal ─────────────────────────────────────────────
    const shortcutsBtn = document.getElementById('shortcutsBtn');
    const shortcutsModal = document.getElementById('shortcutsModal');
    const closeShortcutsBtn = document.querySelector('.close-shortcuts-btn');

    if (shortcutsBtn && shortcutsModal) {
        shortcutsBtn.addEventListener('click', () => {
            shortcutsModal.classList.add('active');
        });

        const closeModal = () => shortcutsModal.classList.remove('active');
        if (closeShortcutsBtn) closeShortcutsBtn.addEventListener('click', closeModal);
        shortcutsModal.addEventListener('click', (e) => {
            if (e.target === shortcutsModal) closeModal();
        });
    }
}