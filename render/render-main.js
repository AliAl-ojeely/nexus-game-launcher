import { state, userSettings } from './state.js';
import { initUI } from './ui.js';
import { initLibrary, renderGames } from './library.js';
import { initDetails } from './details.js';
import { initModal } from './modal.js';
import { initShortcuts } from './shortcuts.js';
import { initReorderButton } from './library.js';
import { showToast } from './details-components.js';
import { handleCanIRunItCheck } from './details/handlers.js';
import { initStatsPage } from './stats.js';

function parseMarkdown(text) {
    if (!text) return '';
    let html = text;
    html = html.replace(/.*Full Changelog.*https:\/\/github\.com.*/gim, '');
    html = html.replace(/\r\n/g, '\n');
    html = html.replace(/\n{2,}/g, '\n');
    html = html.replace(/^### (.*$)/gim, '<h3 style="color: var(--accent); margin: 15px 0 5px 0; font-size: 15px;">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 style="color: var(--text-main); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin: 0 0 12px 0; font-size: 18px;">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 style="margin: 0 0 12px 0;">$1</h1>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong style="color: var(--text-main);">$1</strong>');
    html = html.replace(/^\- (.*$)/gim, '<li style="margin-inline-start: 20px; margin-bottom: 6px; list-style-type: disc;">$1</li>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/<br><h/g, '<h');
    html = html.replace(/<\/h2><br>/g, '</h2>');
    html = html.replace(/<\/h3><br>/g, '</h3>');
    html = html.replace(/<br><li/g, '<li');
    html = html.replace(/<\/li><br>/g, '</li>');
    return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    initUI();
    initLibrary();
    initDetails();
    initModal();
    initShortcuts();

    await initSettingsPage();

    renderGames();
    initReorderButton();
    initStatsPage();

    const runItBtn = document.getElementById('runItCheckBtn');
    if (runItBtn) runItBtn.addEventListener('click', handleCanIRunItCheck);

    // Listen for auto-update available event
    if (window.api.onAutoUpdateAvailable) {
        window.api.onAutoUpdateAvailable(async (result) => {
            // Reuse existing update modal
            const updateModal = document.getElementById('updateModal');
            if (!updateModal) return;

            // Fill modal with release data
            document.getElementById('newVersionTag').innerText = result.latestVersion;
            document.getElementById('currentVersionTag').innerText = result.currentVersion;
            const releaseNotesDiv = document.getElementById('releaseNotesText');
            if (releaseNotesDiv) {
                releaseNotesDiv.innerHTML = parseMarkdown(result.releaseNotes || 'No release notes provided.');
            }

            // Show modal
            updateModal.classList.add('active');

            // Optional: auto-focus download button
            const downloadBtn = document.getElementById('downloadUpdateBtn');
            if (downloadBtn) downloadBtn.focus();
        });
    }

    const autoUpdateEnabled = localStorage.getItem('autoUpdate') === 'true';
    if (autoUpdateEnabled) {
        const checkBtn = document.getElementById('checkForUpdatesBtn');
        if (checkBtn) {
            // Small delay to let UI fully initialise
            setTimeout(() => checkBtn.click(), 500);
        }
    }

    // Random game picker
    const randomGameBtn = document.getElementById('randomGameBtn');
    if (randomGameBtn) {
        randomGameBtn.addEventListener('click', () => {
            const games = state.allGamesData;
            if (!games || games.length === 0) {
                showToast('info', 'No games in your library', '', 2000);
                return;
            }
            const randomIndex = Math.floor(Math.random() * games.length);
            const randomGame = games[randomIndex];
            // Open game details page
            import('./details.js').then(({ openGameDetailsPage }) => {
                openGameDetailsPage(randomGame);
            });
            showToast('success', `Random pick: ${randomGame.name}`, '', 3000);
        });
    }

    // Export library to CSV
    const exportLibraryBtn = document.getElementById('exportLibraryCsvBtn');
    if (exportLibraryBtn) {
        exportLibraryBtn.addEventListener('click', async () => {
            const isAr = userSettings.lang === 'ar';
            try {
                const games = await window.api.getGames();
                const playtimeMap = await window.api.getAllPlaytime();

                if (!games || games.length === 0) {
                    showToast('info', isAr ? 'لا توجد ألعاب للتصدير' : 'No games to export', '', 2000);
                    return;
                }

                // Prepare CSV headers
                const headers = [
                    'ID', 'Name', 'Executable Path', 'Arguments', 'Favorite',
                    'Total Playtime (minutes)', 'Total Playtime (seconds)',
                    'Last Played', 'Notes', 'Poster URL', 'Logo URL', 'Background URL', 'Icon URL'
                ];

                // Build rows
                const rows = games.map(game => {
                    const pt = playtimeMap[game.name] || { minutes: 0, seconds: 0, lastPlayed: null };
                    return [
                        game.id,
                        `"${game.name.replace(/"/g, '""')}"`,
                        `"${(game.path || '').replace(/"/g, '""')}"`,
                        `"${(game.arguments || '').replace(/"/g, '""')}"`,
                        game.isFavorite ? 'Yes' : 'No',
                        pt.minutes || 0,
                        pt.seconds || 0,
                        pt.lastPlayed ? new Date(pt.lastPlayed).toISOString() : '',
                        `"${(game.notes || '').replace(/"/g, '""')}"`,
                        game.assets?.poster || '',
                        game.assets?.logo || '',
                        game.assets?.background || '',
                        game.assets?.icon || ''
                    ];
                });

                const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
                const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `nexus_library_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
                a.click();
                URL.revokeObjectURL(url);

                showToast('success', isAr ? 'تم تصدير المكتبة بنجاح' : 'Library exported successfully', '', 3000);
            } catch (err) {
                console.error('[Export] Failed:', err);
                showToast('error', isAr ? 'فشل التصدير' : 'Export failed', err.message, 4000);
            }
        });
    }

    // Backup all user data
    const backupUserDataBtn = document.getElementById('backupUserDataBtn');
    if (backupUserDataBtn) {
        backupUserDataBtn.addEventListener('click', async () => {
            const originalHTML = backupUserDataBtn.innerHTML;
            const isAr = userSettings.lang === 'ar';
            const creatingText = isAr ? 'جاري إنشاء النسخ الاحتياطي...' : 'Creating backup...';

            try {
                const result = await window.api.selectFolder();
                if (!result) return;

                const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
                const backupPath = `${result}/nexus_launcher_backup_${timestamp}.zip`;

                backupUserDataBtn.disabled = true;
                backupUserDataBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${creatingText}</span>`;

                await window.api.backupUserData(backupPath);

                showToast('success', isAr ? 'تم إنشاء النسخ الاحتياطي بنجاح!' : 'Backup created successfully!', `Saved to: ${backupPath}`, 5000);
            } catch (err) {
                console.error('[Backup] Failed:', err);
                showToast('error', isAr ? 'فشل النسخ الاحتياطي' : 'Backup failed', err.message, 4000);
            } finally {
                backupUserDataBtn.disabled = false;
                backupUserDataBtn.innerHTML = originalHTML;
            }
        });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS PAGE
// ─────────────────────────────────────────────────────────────────────────────

async function initSettingsPage() {

    // ── Load saved global backup path into the input ──────────────────────────
    const globalBackupInput = document.getElementById('globalBackupPath');
    if (globalBackupInput) {
        const savedPath = await window.api.backup.getGlobalPath();
        if (savedPath) globalBackupInput.value = savedPath;
    }

    // ── Linux compatibility settings ──────────────────────────────────────
    if (window.api.platform === 'linux') {
        const linuxSection = document.getElementById('linuxSettingsSection');
        if (linuxSection) linuxSection.style.display = 'block';

        const toolSelect = document.getElementById('linuxToolSelect');
        if (toolSelect) {
            const tools = await window.api.linux.getAvailableTools();
            toolSelect.innerHTML = tools.map(t => `<option value="${t.name}">${t.name} (${t.type})</option>`).join('');
            const settings = await window.api.linux.getSettings();
            if (settings.selectedTool && tools.some(t => t.name === settings.selectedTool)) {
                toolSelect.value = settings.selectedTool;
            }
            document.getElementById('linuxEnvVars').value = settings.envVars || '';
            document.getElementById('linuxDllOverrides').value = settings.dllOverrides || '';
        }

        // Proton download UI (optional)
        const versionSelect = document.getElementById('protonVersionToDownload');
        const downloadBtn = document.getElementById('downloadProtonBtn');
        if (versionSelect && downloadBtn) {
            versionSelect.innerHTML = '<option>Loading versions...</option>';
            downloadBtn.disabled = true;
            const releases = await window.api.linux.getProtonReleases();
            if (releases.length) {
                versionSelect.innerHTML = releases.map(r => `<option value="${r.tag}" data-url="${r.url}">${r.tag}</option>`).join('');
                downloadBtn.disabled = false;
            } else {
                versionSelect.innerHTML = '<option>Failed to load releases</option>';
                downloadBtn.disabled = true;
            }

            downloadBtn.onclick = async () => {
                const selectedOption = versionSelect.options[versionSelect.selectedIndex];
                const versionTag = selectedOption.value;
                const downloadUrl = selectedOption.dataset.url;
                if (!versionTag || !downloadUrl) return;

                downloadBtn.disabled = true;
                downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Downloading...';
                const result = await window.api.linux.downloadProton(versionTag, downloadUrl);
                if (result.success) {
                    const tools = await window.api.linux.getAvailableTools();
                    toolSelect.innerHTML = tools.map(t => `<option value="${t.name}">${t.name} (${t.type})</option>`).join('');
                    const newTool = tools.find(t => t.name.includes(versionTag));
                    if (newTool) toolSelect.value = newTool.name;
                    alert(`✅ ${versionTag} installed successfully!`);
                } else {
                    alert(`❌ Installation failed: ${result.error}`);
                }
                downloadBtn.disabled = false;
                downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Download';
            };
        }
    }

    // ── Auto backup toggle (load setting) ────────────────────────────────────
    const autoBackupToggle = document.getElementById('autoBackupToggle');
    if (autoBackupToggle) {
        const autoBackup = await window.api.backup.getAutoBackup();
        autoBackupToggle.checked = autoBackup;
    }

    // ── Select Global Backup Folder button ───────────────────────────────────
    const selectGlobalBackupBtn = document.getElementById('selectGlobalBackupBtn');
    if (selectGlobalBackupBtn) {
        selectGlobalBackupBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder && globalBackupInput) globalBackupInput.value = folder;
        });
    }

    // ── Window size inputs (load current size) ───────────────────────────────
    const widthInput = document.getElementById('windowWidthInput');
    const heightInput = document.getElementById('windowHeightInput');
    if (widthInput && heightInput) {
        const currentSize = await window.api.getWindowSize();
        widthInput.value = currentSize.width;
        heightInput.value = currentSize.height;
    }

    // ── Open AppData folder button ───────────────────────────────────────────
    const openAppDataBtn = document.getElementById('openAppDataBtn');
    if (openAppDataBtn) {
        openAppDataBtn.addEventListener('click', async () => {
            const userDataPath = await window.api.getUserDataPath();
            window.api.openFolder(userDataPath);
        });
    }

    // ── Save Settings button ─────────────────────────────────────────────────
    const saveSettingsBtn = document.getElementById('saveGeneralSettings');
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            // ── Existing settings (theme, lang, grid, fps, app name) ──────────
            const appName = document.getElementById('appNameSetting')?.value?.trim() || 'Nexus Launcher';
            const theme = document.getElementById('themeSetting')?.value || 'dark';
            const lang = document.getElementById('langSetting')?.value || 'en';
            const gridSize = document.getElementById('gridSizeSetting')?.value || '260px';
            const showFPS = document.getElementById('fpsToggle')?.checked || false;

            localStorage.setItem('appName', appName);
            localStorage.setItem('theme', theme);
            localStorage.setItem('lang', lang);
            localStorage.setItem('gridSize', gridSize);
            localStorage.setItem('showFPS', showFPS);

            document.getElementById('sidebarLogoName').innerText = appName;
            document.documentElement.setAttribute('data-theme', theme);

            // ── Save global backup path ───────────────────────────────────────
            const globalPath = globalBackupInput?.value?.trim() || '';
            if (globalPath) {
                const result = await window.api.backup.setGlobalPath(globalPath);
                if (result.success) {
                    console.log('[SETTINGS] Global backup path saved:', globalPath);
                }
            }

            // ── Save auto backup setting ──────────────────────────────────────
            if (autoBackupToggle) {
                await window.api.backup.setAutoBackup(autoBackupToggle.checked);
            }

            // ── Save Linux settings ───────────────────────────────────────────
            if (window.api.platform === 'linux') {
                await window.api.linux.setSettings({
                    selectedTool: document.getElementById('linuxToolSelect').value,
                    envVars: document.getElementById('linuxEnvVars').value,
                    dllOverrides: document.getElementById('linuxDllOverrides').value
                });
            }

            // ── Save window size (apply live) ─────────────────────────────────
            if (widthInput && heightInput) {
                const newWidth = parseInt(widthInput.value, 10);
                const newHeight = parseInt(heightInput.value, 10);
                if (!isNaN(newWidth) && !isNaN(newHeight) && newWidth >= 800 && newHeight >= 600) {
                    await window.api.setWindowSize(newWidth, newHeight);
                }
            }

            console.log('[SETTINGS] Settings saved');
            // Removed showToast to prevent duplicate messages
        });
    }

    // ── Scan Vault button ──────────────────────────────────────────────────────
    const scanVaultBtn = document.getElementById('scanVaultBtn');
    const scanResultEl = document.getElementById('scanVaultResult');

    if (scanVaultBtn) {
        scanVaultBtn.addEventListener('click', async () => {
            const vaultPath = globalBackupInput?.value?.trim()
                || await window.api.backup.getGlobalPath();

            if (!vaultPath) {
                if (scanResultEl) {
                    scanResultEl.style.display = 'block';
                    scanResultEl.innerHTML = `<small style="color:#f59e0b;">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        ${userSettings.lang === 'ar' ? 'حدد مسار الخزنة أولاً' : 'Set the vault path first'}
                    </small>`;
                }
                return;
            }

            scanVaultBtn.disabled = true;
            scanVaultBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>
                <span>${userSettings.lang === 'ar' ? 'جاري المسح...' : 'Scanning...'}</span>`;

            const result = await window.api.backup.scanVault(vaultPath);

            scanVaultBtn.disabled = false;
            scanVaultBtn.innerHTML = `<i class="fa-solid fa-magnifying-glass-chart"></i>
                <span data-i18n="btn_scan_vault">${userSettings.lang === 'ar' ? 'مسح الخزنة وإعادة الربط' : 'Scan Vault & Re-link'}</span>`;

            if (scanResultEl) {
                scanResultEl.style.display = 'block';
                if (result.linked > 0) {
                    scanResultEl.innerHTML = `
                        <div style="padding:8px 12px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:6px; font-size:12px; color:#10b981;">
                            <i class="fa-solid fa-circle-check"></i>
                            ${userSettings.lang === 'ar'
                            ? `تم ربط <strong>${result.linked}</strong> لعبة`
                            : `Re-linked <strong>${result.linked}</strong> game(s)`}
                            ${result.skipped > 0
                            ? `<span style="opacity:0.6; margin-right:6px;">(${result.skipped} ${userSettings.lang === 'ar' ? 'غير مطابق' : 'unmatched'})</span>`
                            : ''}
                        </div>`;
                } else {
                    scanResultEl.innerHTML = `
                        <small style="color:var(--text-muted); opacity:0.6;">
                            <i class="fa-solid fa-circle-info"></i>
                            ${userSettings.lang === 'ar' ? 'لم يتم العثور على نسخ موجودة' : 'No existing backups found'}
                        </small>`;
                }
            }
        });
    }

    // ── Ctrl+S shortcut to save settings ─────────────────────────────────────
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            if (saveSettingsBtn) saveSettingsBtn.click();
        }
    });
}