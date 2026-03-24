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

    document.addEventListener('keydown', (event) => {

        // 1. معالجة زر Esc بشكل منفصل ليعمل حتى لو كان المؤشر داخل حقل نصي
        if (event.key === 'Escape') {
            const searchInput = document.getElementById('searchInput');
            if (document.activeElement === searchInput) {
                searchInput.blur();
                return;
            }

            // إغلاق المودال إذا كان مفتوحاً
            const editModal = document.getElementById('editModal');
            if (editModal && editModal.style.display === 'flex') {
                editModal.style.display = 'none';
                return;
            }

            // إغلاق عارض الصور
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) {
                document.getElementById('closeLightbox').click();
                return;
            }

            // إذا لم يكن المؤشر داخل حقل نصي، قم بالرجوع للخلف
            if (event.target.tagName !== 'INPUT' && event.target.tagName !== 'TEXTAREA') {
                handleGoBack();
            }
            return;
        }

        // 2. إيقاف باقي الاختصارات إذا كان المستخدم يكتب نصاً (تجنباً للتداخل)
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
            case '+':
            case '=': {
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

    document.addEventListener('mouseup', (event) => {
        if (event.button === 3) {
            event.preventDefault();
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.classList.contains('show')) document.getElementById('closeLightbox').click();
            else handleGoBack();
        }
    });

    document.addEventListener('wheel', (event) => {
        const lightbox = document.getElementById('imageLightbox');
        if (lightbox && lightbox.classList.contains('show')) {
            if (event.deltaY > 0) document.getElementById('nextLightbox').click();
            else if (event.deltaY < 0) document.getElementById('prevLightbox').click();
        }
    });
}