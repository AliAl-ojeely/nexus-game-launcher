import { state, userSettings } from './state.js';
import { initUI } from './ui.js';
import { initLibrary, renderGames } from './library.js';
import { initDetails } from './details.js';
import { initModal } from './modal.js';
import { initShortcuts } from './shortcuts.js';
import { initReorderButton } from './library.js';

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

    // ── Select Global Backup Folder button ───────────────────────────────────
    const selectGlobalBackupBtn = document.getElementById('selectGlobalBackupBtn');
    if (selectGlobalBackupBtn) {
        selectGlobalBackupBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder && globalBackupInput) globalBackupInput.value = folder;
        });
    }

    // ── Save Settings button — includes global backup path ───────────────────
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
                    // Show confirmation toast if available
                    if (typeof window._showToast === 'function') {
                        window._showToast('success',
                            lang === 'ar' ? 'تم حفظ الإعدادات' : 'Settings saved',
                            globalPath,
                            3000
                        );
                    }
                }
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