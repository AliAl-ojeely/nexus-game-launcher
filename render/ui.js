import { state, userSettings } from './state.js';
import { showToast } from './details-components.js';

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
    const downloadBtn = document.getElementById('downloadUpdateBtn');
    const progressContainer = document.getElementById('updateProgressContainer');
    const progressBar = document.getElementById('updateProgressBar');
    const progressPercent = document.getElementById('updateProgressPercent');
    const progressText = document.getElementById('updateProgressText');
    const updateModalButtons = document.getElementById('updateModalButtons');
    const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

    let isDownloadingUpdate = false;

    // Helper to reset the update UI to its default state
    function resetUpdateUI() {
        isDownloadingUpdate = false;
        if (updateModalButtons && progressContainer) {
            updateModalButtons.style.display = 'flex';
            progressContainer.style.display = 'none';
            progressBar.style.width = '0%';
            progressPercent.innerText = '0%';
            progressText.innerText = 'Downloading Update...';
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

            // تطبيق نص التحقق
            checkUpdatesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${txtChecking}</span>`;

            try {
                const result = await window.api.checkForUpdates();

                if (result.error) {
                    showToast('error', isAr ? 'فشل التحقق من التحديثات' : 'Update check failed', result.error, 4000);
                } else if (result.hasUpdate) {

                    // Fill the modal with release data
                    document.getElementById('newVersionTag').innerText = result.latestVersion;
                    document.getElementById('currentVersionTag').innerText = result.currentVersion;

                    // Pass the release notes through the Markdown parser and use innerHTML
                    const notes = result.releaseNotes || 'No release notes provided.';
                    document.getElementById('releaseNotesText').innerHTML = parseMarkdown(notes);

                    downloadBtn.onclick = async () => {
                        const asset = result.assets && result.assets.find(a => a.name.endsWith('.exe'));
                        if (!asset) {
                            window.api.openExternal(result.downloadUrl);
                            return;
                        }

                        // Lock the UI and start download
                        isDownloadingUpdate = true;
                        updateModalButtons.style.display = 'none';
                        progressContainer.style.display = 'block';

                        progressText.innerText = txtDownloading;

                        // Setup the cancel button
                        if (cancelDownloadBtn) {
                            cancelDownloadBtn.innerHTML = `<i class="fa-solid fa-xmark"></i> ${txtCancel}`;
                            cancelDownloadBtn.onclick = () => {
                                window.api.cancelDownload(); // Send abort signal to main process
                                resetUpdateUI();
                                showToast('info', txtCancelled, txtCancelMsg, 3000);
                            };
                        }

                        window.api.onUpdateProgress((data) => {
                            const percent = Math.floor(data.percent);
                            progressBar.style.width = `${percent}%`;
                            progressPercent.innerText = `${percent}%`;
                        });

                        const downloadResult = await window.api.downloadUpdate(asset.browser_download_url, asset.name);

                        if (downloadResult.success && isDownloadingUpdate) {
                            progressText.innerText = txtInstalling;
                            progressPercent.innerText = '100%';
                            setTimeout(() => {
                                window.api.installUpdate(downloadResult.path);
                            }, 1500);
                        } else if (isDownloadingUpdate) {
                            // Handle failure not caused by manual cancellation
                            showToast('error', txtFailed, downloadResult.error, 4000);
                            resetUpdateUI();
                        }
                    };

                    updateModal.classList.add('active');
                } else {
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

    // Modal Close Logic (Registered only ONCE to prevent bugs)
    if (updateModal) {
        document.getElementById('closeUpdateModalBtn').addEventListener('click', () => {
            if (isDownloadingUpdate) return; // Explicitly block closing during download
            updateModal.classList.remove('active');
            resetUpdateUI();
        });

        updateModal.addEventListener('click', (e) => {
            if (isDownloadingUpdate) return; // Explicitly block overlay click during download

            if (e.target === updateModal) {
                updateModal.classList.remove('active');
                resetUpdateUI();
            }
        });
    }
}