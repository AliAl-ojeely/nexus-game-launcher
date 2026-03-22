import { state, userSettings } from './state.js';
import { initUI } from './ui.js';
import { initLibrary, renderGames } from './library.js';
import { initDetails } from './details.js';
import { initModal } from './modal.js';
import { initShortcuts } from './shortcuts.js';

// تهيئة جميع الملفات والأزرار بمجرد تحميل الصفحة
document.addEventListener('DOMContentLoaded', () => {
    initUI();
    initLibrary();
    initDetails();
    initModal();
    initShortcuts();

    // طباعة الألعاب عند فتح البرنامج
    renderGames();
});

// الاستماع لأحداث Electron
window.api.onGameError((data) => {
    console.error("Game Launch Error:", data);
    const errorModal = document.createElement('div');
    errorModal.className = 'custom-error-modal';
    errorModal.innerHTML = `
        <div class="error-content">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h3>Game Execution Error</h3>
            <p>${data.message}</p>
            <small>Exit Code: ${data.code || 'Unknown'}</small>
            <button onclick="this.parentElement.parentElement.remove()">Dismiss</button>
        </div>
    `;
    document.body.appendChild(errorModal);
});

window.api.onGameStopped((data) => {
    state.isGameRunning = false;
    const playBtn = document.getElementById('detailsPlayBtn');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.opacity = "1";
        const btnText = userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play';
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i> ${btnText}`;
    }
});