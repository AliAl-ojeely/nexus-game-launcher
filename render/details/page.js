import { state, userSettings } from '../state.js';
import { renderGameDetails } from './render.js';
import { updateBackupSidebarUI } from '../details-components.js';
import { formatPlaytime } from '../details-utils.js';
import { t } from './helpers.js';

function getMainGameFolder(exePath) {
    const subfolderPatterns = [
        // Common binary/executable folders
        'bin', 'binaries', 'x64', 'x86', 'win32', 'win64', 'win', 'windows',
        'winmd', 'winrt', 'uwp', 'windowsnoeditor', 'windowsclient', 'windowsserver',
        'macnoeditor', 'linuxnoeditor', 'shipping', 'development', 'release', 'debug',
        'retail',

        // Engine / framework folders
        'engine', 'content', 'plugins', 'intermediate', 'saved', 'config', 'logs',
        'crashes', 'data', 'assets', 'resources', 'streamingassets', 'managed', 'mono',
        'dotnet', 'scripts', 'dll', 'lib', 'library', 'shared', 'common', 'redist',
        'runtimes', 'support', 'tools', 'utilities', 'launcher', 'patcher', 'update',
        'installer', 'cache', 'temp', 'tmp', 'download', 'downloads', 'packages',

        // Game-specific content folders (not root)
        'bbq', 'cooked', 'pak', 'paks', 'patch', 'dlc', 'mods', 'overrides',
        'localization', 'movies', 'sound', 'music', 'video', 'cinematics', 'ui',
        'fonts', 'shaders', 'configs', 'settings', 'userdata', 'profile', 'saves',
        'backup', 'savegames', 'savedata', 'profiles', 'logs', 'crashreports',

        // Platform / store folders
        'steam', 'epic', 'gog', 'origin', 'uwp', 'windowsapps', 'xboxlive',
        'ps4', 'ps5', 'switch', 'android', 'ios'
    ];
    // Get directory of the executable
    const lastSlash = Math.max(exePath.lastIndexOf('\\'), exePath.lastIndexOf('/'));
    let folder = lastSlash !== -1 ? exePath.substring(0, lastSlash) : '';
    let parts = folder.split(/[\\\/]/);

    while (parts.length > 0) {
        const lastPart = parts[parts.length - 1].toLowerCase();
        if (subfolderPatterns.includes(lastPart)) {
            parts.pop();
        } else {
            break;
        }
    }
    return parts.join('/');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export async function openGameDetailsPage(game) {
    if (!game || !game.name) return;

    // Switch UI immediately
    document.querySelectorAll('.page-area').forEach(p => p.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');
    document.getElementById('gameDetailsArea').scrollTop = 0;

    document.getElementById('detailsGameTitle').innerText = game.name;
    state.currentGameExePath = game.path;
    state.currentGameId = game.id;

    const headerName = document.getElementById('detailsHeaderName');
    if (headerName) headerName.textContent = game.name;

    // Reset description wrapper
    const descWrapper = document.getElementById('descWrapper');
    const readMoreBtn = document.getElementById('readMoreBtn');
    if (descWrapper) descWrapper.classList.remove('expanded');
    if (readMoreBtn) { readMoreBtn.style.display = 'none'; readMoreBtn.classList.remove('active'); }

    // Render existing data instantly
    renderGameDetails(game);

    // Playtime and backup info
    const totalMinutes = await window.api.getPlaytime(game.name);
    const playtimeDisplay = document.getElementById('totalPlaytimeValue');
    if (playtimeDisplay) playtimeDisplay.innerText = formatPlaytime(totalMinutes || 0, userSettings.lang);

    // Last Played (below playtime container)
    const lastPlayedContainer = document.getElementById('lastPlayedContainer');
    const lastPlayedValueSpan = document.getElementById('lastPlayedValue');
    if (lastPlayedContainer && lastPlayedValueSpan) {
        const playtimeInfo = await window.api.getPlaytimeInfo(game.name);
        if (playtimeInfo.lastPlayed) {
            const date = new Date(playtimeInfo.lastPlayed);
            const formatted = date.toLocaleString(userSettings.lang === 'ar' ? 'ar-EG' : 'en-US', {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
            lastPlayedValueSpan.innerText = formatted;
            lastPlayedContainer.style.display = 'flex';
        } else {
            lastPlayedContainer.style.display = 'none';
        }
    }

    const bInfo = await window.api.backup.getInfo(game.name);
    updateBackupSidebarUI(bInfo, game.name, userSettings.lang);

    // Play button state
    const playBtn = document.getElementById('detailsPlayBtn');
    const timerContainer = document.getElementById('sessionTimerContainer');
    if (state.isGameRunning && state.currentGameExePath === game.path) {
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.add('play-btn-running');
            playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === 'ar' ? 'إيقاف' : 'Stop'}`;
        }
        if (timerContainer) timerContainer.style.display = 'flex';
    } else {
        if (timerContainer) timerContainer.style.display = 'none';
        if (playBtn) {
            playBtn.disabled = false;
            playBtn.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
            playBtn.style.cssText = '';
            playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play'}</span>`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NOTES SECTION – load and set up edit/save handlers
    // ─────────────────────────────────────────────────────────────────────────
    const notesText = document.getElementById('notesText');
    const notesInput = document.getElementById('notesInput');
    const notesDisplay = document.getElementById('notesDisplay');
    const notesEditArea = document.getElementById('notesEditArea');
    const editNotesBtn = document.getElementById('editNotesBtn');
    const saveNotesBtn = document.getElementById('saveNotesBtn');
    const cancelNotesBtn = document.getElementById('cancelNotesBtn');

    // Load existing notes into display
    if (notesText) {
        notesText.innerText = game.notes && game.notes.trim() ? game.notes : '—';
    }

    // Edit button – switch to edit mode
    if (editNotesBtn && notesDisplay && notesEditArea) {
        editNotesBtn.onclick = () => {
            notesInput.value = game.notes || '';
            notesDisplay.style.display = 'none';
            notesEditArea.style.display = 'block';
        };
    }

    // Cancel button – switch back to display mode
    if (cancelNotesBtn && notesDisplay && notesEditArea) {
        cancelNotesBtn.onclick = () => {
            notesDisplay.style.display = 'flex';
            notesEditArea.style.display = 'none';
        };
    }

    // Save button – update notes and persist
    if (saveNotesBtn && notesDisplay && notesEditArea) {
        saveNotesBtn.onclick = async () => {
            const newNotes = notesInput.value.trim();
            const updatedGame = { ...game, notes: newNotes };
            await window.api.updateGame(updatedGame);
            // Update local game reference
            game.notes = newNotes;
            // Update displayed text
            notesText.innerText = newNotes || '—';
            // Switch back to display mode
            notesDisplay.style.display = 'flex';
            notesEditArea.style.display = 'none';
            // Show success toast
            if (window.showToast) {
                window.showToast('success', userSettings.lang === 'ar' ? 'تم حفظ الملاحظات' : 'Notes saved', '', 2000);
            }
        };
    }

    // Background fetch if data not cached
    const isCached = !!(
        game.metadata?.description &&
        game.metadata.description.trim() !== '' &&
        game.assets?.poster?.startsWith('local-resource://')
    );

    if (!isCached) {
        console.log(`[FRONTEND] ⚡ Background fetch for: ${game.name}`);
        window.api.fetchGameDetails(game.name).then(async (freshData) => {
            if (freshData?.assets && freshData?.metadata) {
                console.log(`[FRONTEND] ✅ Background fetch complete for: ${game.name}`);
                game.assets = freshData.assets;
                game.metadata = freshData.metadata;
                renderGameDetails(game);
                await window.api.saveGameDetails(game.id, {
                    name: game.name,
                    assets: freshData.assets,
                    metadata: freshData.metadata,
                });
            }
        }).catch(err => console.error('[FRONTEND] Background fetch failed:', err));
    }

    // Adjust sidebar visibility
    const sidebar = document.querySelector('.details-sidebar');
    const detailsContent = document.querySelector('.details-content');
    if (sidebar && bInfo?.lastBackupDate) {
        sidebar.style.display = 'block';
        if (detailsContent) detailsContent.style.gridTemplateColumns = '3fr 1fr';
    }

    // Load folder details
    const folderContainer = document.getElementById('folderDetailsContainer');
    if (folderContainer && game.path) {
        const mainFolder = getMainGameFolder(game.path);
        if (mainFolder) {
            const folderInfo = await window.api.getFolderInfo(mainFolder);
            if (folderInfo) {
                document.getElementById('folderName').innerText = folderInfo.folderName;
                document.getElementById('folderType').innerText = folderInfo.type;
                document.getElementById('folderLocation').innerText = folderInfo.location;
                document.getElementById('folderSize').innerText = formatFileSize(folderInfo.sizeBytes);
                document.getElementById('folderSizeOnDisk').innerText = formatFileSize(folderInfo.sizeOnDiskBytes);
                document.getElementById('folderContains').innerText = folderInfo.contains;
                document.getElementById('folderCreated').innerText = folderInfo.created;
                folderContainer.style.display = 'block';
            } else {
                folderContainer.style.display = 'none';
            }
        } else {
            folderContainer.style.display = 'none';
        }
    }

    // Favorite button in header
    const favBtn = document.getElementById('detailsHeaderFavBtn');
    if (favBtn) {
        const isFav = game.isFavorite || false;
        const favIcon = favBtn.querySelector('i');
        if (isFav) {
            favIcon.className = 'fa-solid fa-heart';
            favBtn.classList.add('active');
        } else {
            favIcon.className = 'fa-regular fa-heart';
            favBtn.classList.remove('active');
        }
        favBtn.style.display = 'flex';
        favBtn.onclick = async (e) => {
            e.stopPropagation();
            game.isFavorite = !game.isFavorite;
            await window.api.updateGame(game);
            // Update button icon
            const newIcon = game.isFavorite ? 'fa-solid fa-heart' : 'fa-regular fa-heart';
            favIcon.className = newIcon;
            favBtn.classList.toggle('active', game.isFavorite);
            // Show toast feedback
            const isAr = userSettings.lang === 'ar';
            const msg = game.isFavorite
                ? (isAr ? 'تمت الإضافة إلى المفضلة' : 'Added to favorites')
                : (isAr ? 'تمت الإزالة من المفضلة' : 'Removed from favorites');
            showToast('success', msg, '', 1500);
            // Also update the library card heart? The card will refresh when user returns.
        };
    }
}