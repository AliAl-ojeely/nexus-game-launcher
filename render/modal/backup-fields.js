import { t } from './helpers.js';
import { userSettings } from '../state.js';
import { showSavePathStatus } from './backup-status.js';

export async function populateBackupFields(game) {
    const originInput = document.getElementById('editGameOriginPath');
    const backupInput = document.getElementById('editGameBackupPath');
    const statusEl = document.getElementById('savePathStatus');

    if (!originInput) return;
    if (statusEl) statusEl.style.display = 'none';

    // Already cleared in edit.js, but fetch again to be safe
    originInput.value = '';
    originInput.placeholder = t('backup_auto_discover_failed', userSettings.lang === 'ar' ? 'جاري البحث...' : 'Discovering...');

    const bInfo = await window.api.backup.getInfo(game.name);
    let config = bInfo?.config || {};

    // Set backup path field
    if (config.backupPath) {
        backupInput.value = config.backupPath;
    } else {
        backupInput.value = '';
        const globalPath = await window.api.backup.getGlobalPath();
        if (globalPath) {
            backupInput.placeholder = userSettings.lang === 'ar'
                ? `${t('backup_global_default', 'المسار العام')}: ${globalPath}`
                : `${t('backup_global_default', 'Global default')}: ${globalPath}`;
        }
    }

    // If no origin path saved, try to auto-discover
    if (!config.originPath) {
        console.log(`[Modal] Origin empty for ${game.name}, attempting discovery...`);
        const discovery = await window.api.backup.discoverPath(game.name, game.path);
        if (discovery.found) {
            config.originPath = discovery.path;
            await window.api.backup.updateConfig(game.name, {
                originPath: discovery.path,
                backupPath: config.backupPath || (await window.api.backup.getGlobalPath()) || ''
            });
        }
    }

    // Final update of origin input
    if (config.originPath) {
        originInput.value = config.originPath;
        showSavePathStatus('found', config.originPath);
    } else {
        originInput.value = '';
        showSavePathStatus('notfound');
        originInput.placeholder = t('backup_auto_discover_failed', userSettings.lang === 'ar' ? 'لم يتم العثور على المسار تلقائياً' : 'Could not find save path automatically');
    }
}