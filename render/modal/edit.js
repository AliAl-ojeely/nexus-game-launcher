import { state, userSettings } from '../state.js';
import { populateBackupFields } from './backup-fields.js';

export async function openEditModal(game) {
    state.editingGameId = game.id;
    state.tempGamePath = game.path;

    // Game name and path
    document.getElementById('gameNameInput').value = game.name;
    document.getElementById('gamePathInput').value = game.path;
    document.getElementById('launchArgsInput').value = game.arguments || '';
    const installedInput = document.getElementById('gameInstalledInput');
    if (installedInput) installedInput.checked = game.isInstalled !== false;

    // ── Clear all custom asset inputs first ──
    document.getElementById('customPosterInput').value = '';
    document.getElementById('customLogoInput').value = '';
    document.getElementById('customBgInput').value = '';
    document.getElementById('customIconInput').value = '';

    // Empty means keep existing artwork; only a new selection changes it.


    document.getElementById('saveGameModalBtn').innerHTML =
        `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;

    document.getElementById('editModal').style.display = 'flex';

    await populateBackupFields(game);
}