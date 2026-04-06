import { state, userSettings } from '../state.js';
import { populateBackupFields } from './backup-fields.js';

export async function openEditModal(game) {
    state.editingGameId = game.id;
    state.tempGamePath = game.path;

    // Game name and path
    document.getElementById('gameNameInput').value = game.name;
    document.getElementById('gamePathInput').value = game.path;
    document.getElementById('launchArgsInput').value = game.arguments || '';

    // ── Clear all custom asset inputs first ──
    document.getElementById('customPosterInput').value = '';
    document.getElementById('customLogoInput').value = '';
    document.getElementById('customBgInput').value = '';
    document.getElementById('customIconInput').value = '';

    // ── Then set from the current game ──
    if (game.assets?.poster?.startsWith('file:///')) {
        document.getElementById('customPosterInput').value = game.assets.poster.replace('file:///', '').replace(/\//g, '\\');
    }
    if (game.assets?.logo?.startsWith('file:///')) {
        document.getElementById('customLogoInput').value = game.assets.logo.replace('file:///', '').replace(/\//g, '\\');
    }
    if (game.assets?.background?.startsWith('file:///')) {
        document.getElementById('customBgInput').value = game.assets.background.replace('file:///', '').replace(/\//g, '\\');
    }
    if (game.assets?.icon?.startsWith('file:///')) {
        document.getElementById('customIconInput').value = game.assets.icon.replace('file:///', '').replace(/\//g, '\\');
    }

    document.getElementById('saveGameModalBtn').innerHTML =
        `<i class="fa-solid fa-check"></i> ${userSettings.lang === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}`;

    document.getElementById('editModal').style.display = 'flex';

    await populateBackupFields(game);
}