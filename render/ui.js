// render/ui.js
import { state, userSettings } from './state.js';

function t(key, fallback = '') {
    const lang = userSettings.lang;
    return (dictionary[lang] && dictionary[lang][key]) || fallback;
}

export function applyLanguage(lang) {
    document.getElementById('htmlRoot').dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.body.style.fontFamily = lang === 'ar' ? "'Cairo', sans-serif" : "'Poppins', sans-serif";

    if (typeof dictionary !== 'undefined') {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dictionary[lang] && dictionary[lang][key]) el.innerText = dictionary[lang][key];
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (dictionary[lang] && dictionary[lang][key]) el.placeholder = dictionary[lang][key];
        });
    }
}

export function handleGoBack() {
    const detailsArea = document.getElementById('gameDetailsArea');
    if (detailsArea && detailsArea.classList.contains('active')) {
        document.getElementById('backToLibraryBtn').click();
    }
}

function applyThemeClass(theme) {
    document.body.classList.remove('light-mode', 'darker-mode');
    if (theme === 'light') {
        document.body.classList.add('light-mode');
    } else if (theme === 'darker') {
        document.body.classList.add('darker-mode');
    }
}

/**
 * Initializes all UI components and event listeners.
 * Updated to support Global Backup Vault and restore Developer Modal functionality.
 */
export function initUI() {
    // Load initial settings into UI fields
    document.getElementById('fpsToggle').checked = localStorage.getItem('showFPS') === 'true';
    document.getElementById('sidebarLogoName').innerText = userSettings.appName;
    document.getElementById('appNameSetting').value = userSettings.appName;

    // 🟢 Load saved backup vault path into input field
    if (document.getElementById('globalBackupPath')) {
        document.getElementById('globalBackupPath').value = userSettings.globalBackupVault;
    }

    document.getElementById('themeSetting').value = userSettings.theme;
    applyThemeClass(userSettings.theme);

    document.getElementById('langSetting').value = userSettings.lang;
    applyLanguage(userSettings.lang);

    document.getElementById('gridSizeSetting').value = userSettings.gridSize;
    document.documentElement.style.setProperty('--grid-size', userSettings.gridSize);

    // Save General Settings
    document.getElementById('saveGeneralSettings').addEventListener('click', () => {
        const newName = document.getElementById('appNameSetting').value;
        const newTheme = document.getElementById('themeSetting').value;
        const newLang = document.getElementById('langSetting').value;
        const newGrid = document.getElementById('gridSizeSetting').value;
        // 🟢 Get backup path from input
        const newVault = document.getElementById('globalBackupPath').value;

        userSettings.lang = newLang;
        userSettings.appName = newName;
        userSettings.theme = newTheme;
        userSettings.gridSize = newGrid;
        userSettings.globalBackupVault = newVault;

        localStorage.setItem('showFPS', document.getElementById('fpsToggle').checked);
        localStorage.setItem('appName', newName);
        localStorage.setItem('theme', newTheme);
        localStorage.setItem('lang', newLang);
        localStorage.setItem('gridSize', newGrid);
        // 🟢 Store backup vault path
        localStorage.setItem('globalBackupVault', newVault);

        document.getElementById('sidebarLogoName').innerText = newName;
        applyThemeClass(newTheme);
        document.documentElement.style.setProperty('--grid-size', newGrid);
        applyLanguage(newLang);

        alert(newLang === 'ar' ? t('settings_saved', 'تم حفظ الإعدادات بنجاح!') : t('settings_saved', 'Settings saved successfully!'));
    });

    // Navigation logic
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function () {
            document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');
            document.querySelectorAll('.page-area').forEach(page => page.classList.remove('active'));
            const targetArea = this.getAttribute('data-target');
            document.getElementById(targetArea).classList.add('active');
            state.currentTab = targetArea;
            document.getElementById('mainTopbar').style.display = targetArea === 'settingsArea' ? 'none' : 'flex';
        });
    });

    document.getElementById('backToLibraryBtn').addEventListener('click', () => {
        document.getElementById('gameDetailsArea').classList.remove('active');
        document.getElementById(state.currentTab).classList.add('active');
        if (state.currentTab !== 'settingsArea') document.getElementById('mainTopbar').style.display = 'flex';
    });

    // 🟢 Restored: Developer Modal logic (clicking the logo)
    const logoContainer = document.querySelector('.sidebar .logo');
    const devModal = document.getElementById('devModal');
    if (logoContainer && devModal) {
        logoContainer.style.cursor = 'pointer'; // Visual hint
        logoContainer.addEventListener('click', () => {
            devModal.classList.add('active'); // Changed from 'show' to 'active' to match global standard
        });

        devModal.addEventListener('click', (e) => {
            if (e.target === devModal) devModal.classList.remove('active');
        });
    }

    document.querySelectorAll('#devModal a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.api && window.api.openExternal) window.api.openExternal(e.currentTarget.href);
        });
    });
}