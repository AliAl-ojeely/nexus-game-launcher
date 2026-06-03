import { state, userSettings } from './state.js';
import { showToast } from './details-components.js';
import { renderGames } from './library.js'; 

// Parse GitHub Markdown release notes to standard HTML
function parseMarkdown(text) {
    if (!text) return '';

    let html = text;

    // Remove the auto-generated GitHub "Full Changelog" line
    html = html.replace(/.*Full Changelog.*https:\/\/github\.com.*/gim, '');

    // Standardize line breaks and remove extra empty lines
    html = html.replace(/\r\n/g, '\n');
    html = html.replace(/\n{2,}/g, '\n');

    // Convert headings with precise margins
    html = html.replace(/^### (.*$)/gim, '<h3 style="color: var(--accent); margin: 15px 0 5px 0; font-size: 15px;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin: 0 0 12px 0; font-size: 18px;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="margin: 0 0 12px 0;">$1</h1>');

    // Convert bold text
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong style="color: var(--text-main);">$1</strong>');

    // Convert list items with bullet points
    html = html.replace(/^\- (.*$)/gim, '<li style="margin-inline-start: 20px; margin-bottom: 6px; list-style-type: disc;">$1</li>');

    // Convert remaining line breaks to <br> and clean up gaps
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br><h/g, '<h');
    html = html.replace(/<\/h2><br>/g, '</h2>');
    html = html.replace(/<\/h3><br>/g, '</h3>');
    html = html.replace(/<br><li/g, '<li');
    html = html.replace(/<\/li><br>/g, '</li>');

    return html;
}

function t(key, fallback = '') {
    const lang = userSettings.lang;
    return (dictionary[lang] && dictionary[lang][key]) || fallback;
}

export function applyLanguage(lang) {
    const htmlRoot = document.getElementById('htmlRoot');
    if (htmlRoot) htmlRoot.dir = lang === 'ar' ? 'rtl' : 'ltr';
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
        const backBtn = document.getElementById('backToLibraryBtn');
        if (backBtn) backBtn.click();
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
    // Helper to safely set text content
    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    const fpsToggle = document.getElementById('fpsToggle');
    if (fpsToggle) fpsToggle.checked = localStorage.getItem('showFPS') === 'true';

    const autoUpdateToggle = document.getElementById('autoUpdateToggle');
    if (autoUpdateToggle) {
        autoUpdateToggle.checked = localStorage.getItem('autoUpdate') === 'true';
        autoUpdateToggle.addEventListener('change', (e) => {
            localStorage.setItem('autoUpdate', e.target.checked);
        });
    }

    setText('sidebarLogoName', userSettings.appName);

    const appNameInput = document.getElementById('appNameSetting');
    if (appNameInput) appNameInput.value = userSettings.appName;

    const globalBackupPath = document.getElementById('globalBackupPath');
    if (globalBackupPath) globalBackupPath.value = userSettings.globalBackupVault;

    const themeSetting = document.getElementById('themeSetting');
    if (themeSetting) themeSetting.value = userSettings.theme;
    applyThemeClass(userSettings.theme);

    const langSetting = document.getElementById('langSetting');
    if (langSetting) langSetting.value = userSettings.lang;
    applyLanguage(userSettings.lang);

    const gridSizeSetting = document.getElementById('gridSizeSetting');
    if (gridSizeSetting) gridSizeSetting.value = userSettings.gridSize;
    document.documentElement.style.setProperty('--grid-size', userSettings.gridSize);

    // Apply and set the Accent Color
    document.documentElement.style.setProperty('--accent', userSettings.accentColor);
    const accentInput = document.getElementById('accentColorSetting');
    if (accentInput) accentInput.value = userSettings.accentColor;

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

    const saveBtn = document.getElementById('saveGeneralSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const newName = document.getElementById('appNameSetting')?.value || 'Nexus Launcher';
            const newTheme = document.getElementById('themeSetting')?.value || 'dark';
            const newLang = document.getElementById('langSetting')?.value || 'en';
            const newGrid = document.getElementById('gridSizeSetting')?.value || '260px';
            const newVault = document.getElementById('globalBackupPath')?.value || '';
            const newAccent = accentInput ? accentInput.value : userSettings.accentColor;

            userSettings.lang = newLang;
            userSettings.appName = newName;
            userSettings.theme = newTheme;
            userSettings.gridSize = newGrid;
            userSettings.globalBackupVault = newVault;
            userSettings.accentColor = newAccent;

            localStorage.setItem('showFPS', document.getElementById('fpsToggle')?.checked || false);
            localStorage.setItem('appName', newName);
            localStorage.setItem('theme', newTheme);
            localStorage.setItem('lang', newLang);
            localStorage.setItem('gridSize', newGrid);
            localStorage.setItem('globalBackupVault', newVault);
            localStorage.setItem('accentColor', newAccent);

            if (showTitlesToggle) {
                localStorage.setItem('showTitles', showTitlesToggle.checked);
            }

            if (recentLimitSelect) {
                localStorage.setItem('recentLimit', recentLimitSelect.value);
            }

            if (autoUpdateToggle) {
                localStorage.setItem('autoUpdate', autoUpdateToggle.checked);
            }

            if (autoDetectToggle) localStorage.setItem('autoDetect', autoDetectToggle.checked);
            if (autoDetectPathInput) localStorage.setItem('autoDetectPath', autoDetectPathInput.value);

            setText('sidebarLogoName', newName);
            applyThemeClass(newTheme);
            document.documentElement.style.setProperty('--grid-size', newGrid);
            document.documentElement.style.setProperty('--accent', newAccent);
            updateTitleVisibility(newGrid);
            applyLanguage(newLang);

            showToast('success', newLang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved', '', 3000);
        });
    }

    // Navigation logic
    const navItems = document.querySelectorAll('.nav-item');
    const hideTopbarPages = ['settingsArea', 'recentArea', 'favoritesArea', 'statsArea'];

    navItems.forEach(item => {
        item.addEventListener('click', function () {
            navItems.forEach(nav => nav.classList.remove('active'));
            this.classList.add('active');

            document.querySelectorAll('.page-area').forEach(page => page.classList.remove('active'));

            const targetArea = this.getAttribute('data-target');
            if (!targetArea) return;

            const targetPage = document.getElementById(targetArea);
            if (targetPage) {
                targetPage.classList.add('active');
                state.currentTab = targetArea;
            } else {
                console.error(`Navigation target "${targetArea}" not found in DOM.`);
                return;
            }

            const topbar = document.getElementById('mainTopbar');
            if (topbar) {
                topbar.style.display = hideTopbarPages.includes(targetArea) ? 'none' : 'flex';
            }
        });
    });

    const backBtn = document.getElementById('backToLibraryBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            const detailsArea = document.getElementById('gameDetailsArea');
            if (detailsArea) detailsArea.classList.remove('active');

            const currentPage = document.getElementById(state.currentTab);
            if (currentPage) currentPage.classList.add('active');

            const topbar = document.getElementById('mainTopbar');
            if (topbar && !hideTopbarPages.includes(state.currentTab)) {
                topbar.style.display = 'flex';
            }
        });
    }

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
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    const progressContainer = document.getElementById('updateProgressContainer');
    const progressBar = document.getElementById('updateProgressBar');
    const progressPercent = document.getElementById('updateProgressPercent');
    const progressText = document.getElementById('updateProgressText');
    const updateModalButtons = document.getElementById('updateModalButtons');
    const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

    let isDownloadingUpdate = false;

    function resetUpdateUI() {
        isDownloadingUpdate = false;
        if (updateModalButtons && progressContainer) {
            updateModalButtons.style.display = 'flex';
            progressContainer.style.display = 'none';
            if (progressBar) progressBar.style.width = '0%';
            if (progressPercent) progressPercent.innerText = '0%';
            if (progressText) progressText.innerText = 'Downloading Update...';
        }
    }

    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', async () => {
            const originalHtml = checkUpdatesBtn.innerHTML;
            checkUpdatesBtn.disabled = true;

            const isAr = userSettings.lang === 'ar';
            const txtChecking = isAr ? 'جاري التحقق...' : 'Checking...';
            const txtDownloading = isAr ? 'جاري التحميل الان...' : 'Downloading Update...';
            const txtInstalling = isAr ? 'جاري التثبيت...' : 'Installing...';
            const txtCancel = isAr ? 'إلغاء التحميل' : 'Cancel Download';
            const txtCancelled = isAr ? 'تم الإلغاء' : 'Cancelled';
            const txtCancelMsg = isAr ? 'تم إلغاء تحميل التحديث.' : 'Update download was cancelled.';
            const txtFailed = isAr ? 'فشل التحميل' : 'Download Failed';
            const txtError = isAr ? 'خطأ' : 'Error';
            const txtErrorMsg = isAr ? 'لا يمكن الاتصال بالخلفية' : 'Could not communicate with background process';

            checkUpdatesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${txtChecking}</span>`;

            try {
                const result = await window.api.checkForUpdates();

                if (result.error) {
                    showToast('error', isAr ? 'فشل التحقق من التحديثات' : 'Update check failed', result.error, 4000);
                } else if (result.hasUpdate && updateModal) {
                    const newVersionSpan = document.getElementById('newVersionTag');
                    const currentVersionSpan = document.getElementById('currentVersionTag');
                    if (newVersionSpan) newVersionSpan.innerText = result.latestVersion;
                    if (currentVersionSpan) currentVersionSpan.innerText = result.currentVersion;

                    const notes = result.releaseNotes || 'No release notes provided.';
                    const releaseNotesDiv = document.getElementById('releaseNotesText');
                    if (releaseNotesDiv) releaseNotesDiv.innerHTML = parseMarkdown(notes);

                    if (downloadBtn) {
                        downloadBtn.onclick = async () => {
                            const asset = result.assets && result.assets.find(a => a.name.endsWith('.exe'));
                            if (!asset) {
                                window.api.openExternal(result.downloadUrl);
                                return;
                            }

                            isDownloadingUpdate = true;
                            if (updateModalButtons) updateModalButtons.style.display = 'none';
                            if (progressContainer) progressContainer.style.display = 'block';
                            if (progressText) progressText.innerText = txtDownloading;

                            if (cancelDownloadBtn) {
                                cancelDownloadBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${txtCancel}`;
                                cancelDownloadBtn.onclick = () => {
                                    window.api.cancelDownload();
                                    resetUpdateUI();
                                    showToast('info', txtCancelled, txtCancelMsg, 3000);
                                };
                            }

                            window.api.onUpdateProgress((data) => {
                                const percent = Math.floor(data.percent);
                                if (progressBar) progressBar.style.width = `${percent}%`;
                                if (progressPercent) progressPercent.innerText = `${percent}%`;
                            });

                            const downloadResult = await window.api.downloadUpdate(asset.browser_download_url, asset.name);
                            if (downloadResult.success && isDownloadingUpdate) {
                                if (progressText) progressText.innerText = txtInstalling;
                                if (progressPercent) progressPercent.innerText = '100%';
                                setTimeout(() => window.api.installUpdate(downloadResult.path), 1500);
                            } else if (isDownloadingUpdate) {
                                showToast('error', txtFailed, downloadResult.error, 4000);
                                resetUpdateUI();
                            }
                        };
                    }

                    updateModal.classList.add('active');
                } else if (!result.hasUpdate) {
                    const msg = isAr ? `أنت تستخدم أحدث إصدار (${result.currentVersion})` : `You are running the latest version (${result.currentVersion})`;
                    showToast('success', isAr ? 'التطبيق محدث!' : 'Up to date!', msg, 3000);
                }
            } catch (err) {
                showToast('error', txtError, txtErrorMsg, 3000);
            } finally {
                checkUpdatesBtn.disabled = false;
                checkUpdatesBtn.innerHTML = originalHtml;
            }
        });
    }

    if (updateModal) {
        const closeModalBtn = document.getElementById('closeUpdateModalBtn');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                if (isDownloadingUpdate) return;
                updateModal.classList.remove('active');
                resetUpdateUI();
            });
        }

        updateModal.addEventListener('click', (e) => {
            if (isDownloadingUpdate) return;
            if (e.target === updateModal) {
                updateModal.classList.remove('active');
                resetUpdateUI();
            }
        });
    }

    // Sidebar collapse toggle
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const sidebar = document.querySelector('.sidebar');

    function setSidebarState(collapsed) {
        if (collapsed) {
            sidebar.classList.add('collapsed');
            localStorage.setItem('sidebarCollapsed', 'true');
        } else {
            sidebar.classList.remove('collapsed');
            localStorage.setItem('sidebarCollapsed', 'false');
        }
    }

    // Load saved state
    const savedState = localStorage.getItem('sidebarCollapsed');
    if (savedState === 'true') setSidebarState(true);
    else setSidebarState(false);

    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            const isCollapsed = sidebar.classList.contains('collapsed');
            setSidebarState(!isCollapsed);
        });
    }

    const sortSelect = document.getElementById('sortGamesSelect');
    if (sortSelect) {
        // Load saved value
        const savedSort = localStorage.getItem('librarySort') || 'name_asc';
        sortSelect.value = savedSort;
        // Add change listener
        sortSelect.addEventListener('change', (e) => {
            const newValue = e.target.value;
            localStorage.setItem('librarySort', newValue);
            console.log('[Sort] Changed to:', newValue);
            renderGames();  // re-render library with new sort
        });
    }

    const recentLimitSelect = document.getElementById('recentLimitSelect');
    if (recentLimitSelect) {
        const savedLimit = localStorage.getItem('recentLimit') || '10';
        recentLimitSelect.value = savedLimit;
        recentLimitSelect.addEventListener('change', () => {
            localStorage.setItem('recentLimit', recentLimitSelect.value);
            renderGames();  // re-render recently played
        });
    }

    const autoDetectToggle = document.getElementById('autoDetectToggle');
    const autoDetectSettings = document.getElementById('autoDetectSettings');
    const autoDetectPathInput = document.getElementById('autoDetectPath');
    const selectAutoDetectPathBtn = document.getElementById('selectAutoDetectPathBtn');
    const scanForGamesBtn = document.getElementById('scanForGamesBtn');

    if (autoDetectToggle) {
        const saved = localStorage.getItem('autoDetect') === 'true';
        autoDetectToggle.checked = saved;
        if (autoDetectSettings) autoDetectSettings.style.display = saved ? 'block' : 'none';
        autoDetectToggle.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            localStorage.setItem('autoDetect', isChecked);
            if (autoDetectSettings) autoDetectSettings.style.display = isChecked ? 'block' : 'none';
        });
    }

    if (selectAutoDetectPathBtn && autoDetectPathInput) {
        const savedPath = localStorage.getItem('autoDetectPath') || '';
        autoDetectPathInput.value = savedPath;
        selectAutoDetectPathBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder) {
                autoDetectPathInput.value = folder;
                localStorage.setItem('autoDetectPath', folder);
            }
        });
    }
}