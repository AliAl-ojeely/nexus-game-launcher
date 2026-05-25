// render/ui.js
import { state, userSettings } from './state.js';
import { showToast } from './details-components.js';

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

export function initUI() {
    document.getElementById('fpsToggle').checked = localStorage.getItem('showFPS') === 'true';
    document.getElementById('sidebarLogoName').innerText = userSettings.appName;
    document.getElementById('appNameSetting').value = userSettings.appName;

    if (document.getElementById('globalBackupPath')) {
        document.getElementById('globalBackupPath').value = userSettings.globalBackupVault;
    }

    document.getElementById('themeSetting').value = userSettings.theme;
    applyThemeClass(userSettings.theme);

    document.getElementById('langSetting').value = userSettings.lang;
    applyLanguage(userSettings.lang);

    document.getElementById('gridSizeSetting').value = userSettings.gridSize;
    document.documentElement.style.setProperty('--grid-size', userSettings.gridSize);

    // Apply and set the Accent Color
    document.documentElement.style.setProperty('--accent', userSettings.accentColor);
    const accentInput = document.getElementById('accentColorSetting');
    if (accentInput) {
        accentInput.value = userSettings.accentColor;
    }

    const showTitlesToggle = document.getElementById('showTitlesToggle');
    let showTitles = true;
    if (showTitlesToggle) {
        showTitles = localStorage.getItem('showTitles') !== 'false';
        showTitlesToggle.checked = showTitles;
    }

    const gamesGrids = document.querySelectorAll('.games-grid');
    function updateTitleVisibility(gridSize) {
        gamesGrids.forEach(grid => {
            if (gridSize === '150px') {
                grid.classList.add('force-hide-titles');
                grid.classList.remove('hide-titles');
            } else {
                grid.classList.remove('force-hide-titles');
                if (showTitlesToggle && !showTitlesToggle.checked) {
                    grid.classList.add('hide-titles');
                } else {
                    grid.classList.remove('hide-titles');
                }
            }
        });
    }
    updateTitleVisibility(userSettings.gridSize);

    document.getElementById('saveGeneralSettings').addEventListener('click', () => {
        const newName = document.getElementById('appNameSetting').value;
        const newTheme = document.getElementById('themeSetting').value;
        const newLang = document.getElementById('langSetting').value;
        const newGrid = document.getElementById('gridSizeSetting').value;
        const newVault = document.getElementById('globalBackupPath').value;

        // Fetch new accent color
        const newAccent = accentInput ? accentInput.value : userSettings.accentColor;

        userSettings.lang = newLang;
        userSettings.appName = newName;
        userSettings.theme = newTheme;
        userSettings.gridSize = newGrid;
        userSettings.globalBackupVault = newVault;
        userSettings.accentColor = newAccent;

        localStorage.setItem('showFPS', document.getElementById('fpsToggle').checked);
        localStorage.setItem('appName', newName);
        localStorage.setItem('theme', newTheme);
        localStorage.setItem('lang', newLang);
        localStorage.setItem('gridSize', newGrid);
        localStorage.setItem('globalBackupVault', newVault);
        localStorage.setItem('accentColor', newAccent);

        if (showTitlesToggle) {
            localStorage.setItem('showTitles', showTitlesToggle.checked);
        }

        document.getElementById('sidebarLogoName').innerText = newName;
        applyThemeClass(newTheme);
        document.documentElement.style.setProperty('--grid-size', newGrid);
        document.documentElement.style.setProperty('--accent', newAccent);
        updateTitleVisibility(newGrid);
        applyLanguage(newLang);

        showToast('success', newLang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved', '', 3000);
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

    // Developer Modal logic
    const logoContainer = document.querySelector('.sidebar .logo');
    const devModal = document.getElementById('devModal');
    if (logoContainer && devModal) {
        logoContainer.style.cursor = 'pointer';
        logoContainer.addEventListener('click', () => {
            devModal.classList.add('active');
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

    // ─────────────────────────────────────────────────────────────────────────
    // Check For Updates Logic
    // ─────────────────────────────────────────────────────────────────────────
    const checkUpdatesBtn = document.getElementById('checkForUpdatesBtn');
    const updateModal = document.getElementById('updateModal');

    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', async () => {
            const originalHtml = checkUpdatesBtn.innerHTML;
            checkUpdatesBtn.disabled = true;
            checkUpdatesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Checking...</span>`;

            try {
                const result = await window.api.checkForUpdates();

                if (result.error) {
                    showToast('error', userSettings.lang === 'ar' ? 'فشل التحقق من التحديثات' : 'Update check failed', result.error, 4000);
                } else if (result.hasUpdate) {
                    // تعبئة النافذة ببيانات الإصدار
                    document.getElementById('newVersionTag').innerText = result.latestVersion;
                    document.getElementById('currentVersionTag').innerText = result.currentVersion;
                    document.getElementById('releaseNotesText').innerText = result.releaseNotes || 'No release notes provided.';

                    const downloadBtn = document.getElementById('downloadUpdateBtn');
                    downloadBtn.onclick = () => window.api.openExternal(result.downloadUrl);

                    updateModal.classList.add('active');
                } else {
                    const msg = userSettings.lang === 'ar' ? `أنت تستخدم أحدث إصدار (${result.currentVersion})` : `You are running the latest version (${result.currentVersion})`;
                    showToast('success', userSettings.lang === 'ar' ? 'التطبيق محدث!' : 'Up to date!', msg, 3000);
                }
            } catch (err) {
                showToast('error', 'Error', 'Could not communicate with background process', 3000);
            } finally {
                checkUpdatesBtn.disabled = false;
                checkUpdatesBtn.innerHTML = originalHtml;
            }
        });
    }

    if (updateModal) {
        document.getElementById('closeUpdateModalBtn').addEventListener('click', () => {
            updateModal.classList.remove('active');
        });
        updateModal.addEventListener('click', (e) => {
            if (e.target === updateModal) updateModal.classList.remove('active');
        });
    }
}