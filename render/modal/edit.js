import { state, userSettings } from '../state.js';
import { populateBackupFields } from './backup-fields.js';

export async function openEditModal(game) {
    state.editingGameId = game.id;
    state.tempGamePath = game.path;

    document.getElementById('gameNameInput').value = game.name;
    document.getElementById('gamePathInput').value = game.path;
    document.getElementById('launchArgsInput').value = game.arguments || '';

    // Reset custom asset fields
    document.getElementById('customPosterInput').value = game.assets?.poster?.startsWith('file:///')
        ? game.assets.poster.replace('file:///', '').replace(/\//g, '\\') : '';
    document.getElementById('customLogoInput').value = game.assets?.logo?.startsWith('file:///')
        ? game.assets.logo.replace('file:///', '').replace(/\//g, '\\') : '';
    document.getElementById('customBgInput').value = game.assets?.background?.startsWith('file:///')
        ? game.assets.background.replace('file:///', '').replace(/\//g, '\\') : '';
    document.getElementById('customIconInput').value = game.assets?.icon?.startsWith('file:///')
        ? game.assets.icon.replace('file:///', '').replace(/\//g, '\\') : '';

    // 🔥 CRITICAL: Clear origin path before loading
    const originInput = document.getElementById('editGameOriginPath');
    originInput.value = '';
    originInput.placeholder = userSettings.lang === 'ar' ? 'جاري التحميل...' : 'Loading...';

    const backupInput = document.getElementById('editGameBackupPath');
    backupInput.value = '';
    const globalPath = await window.api.backup.getGlobalPath();
    backupInput.placeholder = globalPath
        ? (userSettings.lang === 'ar' ? `المسار العام: ${globalPath}` : `Global default: ${globalPath}`)
        : (userSettings.lang === 'ar' ? 'اتركه فارغاً للمسار العام' : 'Leave empty for global default');

    document.getElementById('saveGameModalBtn').innerHTML =
        `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;

    document.getElementById('editModal').style.display = 'flex';

    await populateBackupFields(game);
}