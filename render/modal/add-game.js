import { state, userSettings } from '../state.js';
import { t } from './helpers.js';

export async function triggerAddGameProcess(triggerElement) {
    const originalHTML = triggerElement.innerHTML;
    triggerElement.disabled = true;
    triggerElement.style.opacity = '0.7';
    triggerElement.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>` +
        (triggerElement.tagName === 'BUTTON'
            ? ` <span>${userSettings.lang === 'ar' ? 'جاري الفتح...' : 'Opening...'}</span>`
            : '');

    try {
        const selectedPath = await window.api.selectGame();
        if (selectedPath) {
            state.editingGameId = null;
            state.tempGamePath = selectedPath;

            document.getElementById('gamePathInput').value = selectedPath;

            const parts = selectedPath.split(/[/\\]/).filter(Boolean);
            let rawName = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
            rawName = rawName
                .replace(/[-_.]/g, ' ')
                .replace(/\b(repack|fitgirl|empress|codex|skidrow)\b/gi, '')
                .replace(/\s+/g, ' ')
                .trim();

            document.getElementById('gameNameInput').value = rawName;
            document.getElementById('customLogoInput').value = '';
            document.getElementById('customPosterInput').value = '';
            document.getElementById('customBgInput').value = '';
            document.getElementById('customIconInput').value = '';
            document.getElementById('launchArgsInput').value = '';

            const originInput = document.getElementById('editGameOriginPath');
            const backupInput = document.getElementById('editGameBackupPath');
            const statusEl = document.getElementById('savePathStatus');

            if (originInput) originInput.value = '';
            if (backupInput) {
                backupInput.value = '';
                const globalPath = await window.api.backup.getGlobalPath();
                backupInput.placeholder = globalPath
                    ? (userSettings.lang === 'ar' ? `${t('backup_global_default', 'المسار العام')}: ${globalPath}` : `${t('backup_global_default', 'Global default')}: ${globalPath}`)
                    : t('backup_leave_empty', userSettings.lang === 'ar' ? 'اتركه فارغاً للمسار العام' : 'Leave empty for global default');
            }
            if (statusEl) statusEl.style.display = 'none';

            document.getElementById('saveGameModalBtn').innerHTML =
                `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ وبحث' : 'Save & Search'}`;
            document.getElementById('editModal').style.display = 'flex';
        }
    } catch (error) {
        console.error('Selection error:', error);
    } finally {
        triggerElement.disabled = false;
        triggerElement.style.opacity = '1';
        triggerElement.innerHTML = originalHTML;
    }
}