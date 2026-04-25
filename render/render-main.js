import { state, userSettings } from './state.js';
import { initUI } from './ui.js';
import { initLibrary, renderGames } from './library.js';
import { initDetails } from './details.js';
import { initModal } from './modal.js';
import { initShortcuts } from './shortcuts.js';
import { initReorderButton } from './library.js';
import { showToast } from './details-components.js';

// ─────────────────────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    initUI();
    initLibrary();
    initDetails();   // registers game:stopped + game:error listeners internally
    initModal();
    initShortcuts();

    await initSettingsPage();

    renderGames();
    initReorderButton();
});

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: game:stopped and game:error are handled ONLY in details.js (initDetails).
//
// The old listeners that were here caused a double-call bug:
//   1. details.js → handleGameStop() → saves playtime + runs backup
//   2. render-main.js → reset play button (overwrote the "Securing Save..." state)
//
// Solution: remove them from here entirely. details.js owns all game event logic.
// ─────────────────────────────────────────────────────────────────────────────

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

    // ── Save Settings button — includes global backup path and auto backup ───
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

            // Apply theme
            document.documentElement.setAttribute('data-theme', theme);

            // ── Save global backup path ───────────────────────────────────────
            const globalPath = globalBackupInput?.value?.trim() || '';
            if (globalPath) {
                const result = await window.api.backup.setGlobalPath(globalPath);
                if (result.success) {
                    console.log('[SETTINGS] Global backup path saved:', globalPath);
                    if (typeof window._showToast === 'function') {
                        window._showToast('success',
                            lang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved',
                            globalPath,
                            3000
                        );
                    }
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

            console.log('[SETTINGS] Settings saved');
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
}