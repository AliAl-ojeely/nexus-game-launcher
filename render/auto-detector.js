import { showToast } from './details-components.js';
import { renderGames } from './library.js';
import { userSettings } from './state.js';

// Helper: escape HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// Storage helpers
function markFolderAdded(folderPath) {
    let added = JSON.parse(localStorage.getItem('addedGameFolders') || '[]');
    if (!added.includes(folderPath)) {
        added.push(folderPath);
        localStorage.setItem('addedGameFolders', JSON.stringify(added));
    }
}

function markFolderSkipped(folderPath) {
    let skipped = JSON.parse(localStorage.getItem('skippedFolders') || '[]');
    if (!skipped.includes(folderPath)) {
        skipped.push(folderPath);
        localStorage.setItem('skippedFolders', JSON.stringify(skipped));
    }
}

function isFolderAdded(folderPath) {
    let added = JSON.parse(localStorage.getItem('addedGameFolders') || '[]');
    return added.includes(folderPath);
}

async function folderHasGame(folderPath) {
    return await window.api.gameExistsInFolder(folderPath);
}

// Shared modal and addition logic
async function processDetectedGames(games) {
    const isAr = userSettings.lang === 'ar';
    for (let i = 0; i < games.length; i++) {
        const game = games[i];
        const userChoice = await showGameDetectionModal(game, isAr);
        console.log('[Process] User choice:', userChoice, 'for', game.folderPath);
        if (userChoice === 'skip') {
            markFolderSkipped(game.folderPath);
            continue;
        }
        if (userChoice === 'skipAll') {
            for (let j = i; j < games.length; j++) {
                markFolderSkipped(games[j].folderPath);
            }
            break;
        }
        if (userChoice === 'add') {
            await addGameFromDetection(game);
            markFolderAdded(game.folderPath);
        }
        if (userChoice === 'addAll') {
            await addGameFromDetection(game);
            markFolderAdded(game.folderPath);
            for (let j = i + 1; j < games.length; j++) {
                await addGameFromDetection(games[j]);
                markFolderAdded(games[j].folderPath);
            }
            break;
        }
    }
}

function showGameDetectionModal(game, isAr) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 550px;">
                <h2><i class="fa-solid fa-gamepad"></i> ${isAr ? 'تم اكتشاف مجلد لعبة جديد' : 'New Game Folder Detected'}</h2>
                <div id="detectErrorMsg" style="display: none; color: #ef4444; margin-bottom: 10px; font-size: 13px;"></div>
                <div class="form-group">
                    <label>${isAr ? 'اسم اللعبة:' : 'Game Name:'}</label>
                    <input type="text" id="detectGameName" class="custom-input" value="${escapeHtml(game.suggestedName)}">
                </div>
                <div class="form-group">
                    <label>${isAr ? 'مسار الملف التنفيذي:' : 'Executable Path:'}</label>
                    <div class="input-with-btn">
                        <input type="text" id="detectGamePath" class="custom-input" value="${game.executablePath ? escapeHtml(game.executablePath) : ''}" placeholder="${isAr ? 'اختر ملف التشغيل...' : 'Select executable...'}">
                        <button id="detectBrowseBtn" class="folder-btn-blue" title="${isAr ? 'اختر ملف التشغيل' : 'Select executable'}">
                            <i class="fa-solid fa-folder-open"></i>
                        </button>
                    </div>
                    <small>${isAr ? 'إذا لم يتم اكتشاف الملف تلقائياً، يمكنك تحديده يدوياً.' : 'If no executable was auto‑detected, you can select it manually.'}</small>
                </div>
                <div class="modal-buttons" style="justify-content: space-between; flex-wrap: wrap;">
                    <button id="detectSkipBtn" class="cancel-btn">${isAr ? 'تخطي' : 'Skip'}</button>
                    <button id="detectAddBtn" class="save-btn">${isAr ? 'إضافة' : 'Add'}</button>
                    <button id="detectAddAllBtn" class="folder-btn-blue">${isAr ? 'إضافة الكل' : 'Add All'}</button>
                    <button id="detectSkipAllBtn" class="cancel-btn" style="background: #ef4444; color: white;">${isAr ? 'تخطي الكل' : 'Skip All'}</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const nameInput = modal.querySelector('#detectGameName');
        const pathInput = modal.querySelector('#detectGamePath');
        const browseBtn = modal.querySelector('#detectBrowseBtn');
        const skipBtn = modal.querySelector('#detectSkipBtn');
        const addBtn = modal.querySelector('#detectAddBtn');
        const addAllBtn = modal.querySelector('#detectAddAllBtn');
        const skipAllBtn = modal.querySelector('#detectSkipAllBtn');
        const errorMsgDiv = modal.querySelector('#detectErrorMsg');

        function clearError() {
            errorMsgDiv.style.display = 'none';
            errorMsgDiv.innerText = '';
        }

        function showError(msg) {
            errorMsgDiv.innerText = msg;
            errorMsgDiv.style.display = 'block';
        }

        browseBtn.onclick = async () => {
            const selected = await window.api.selectGame();
            if (selected) {
                pathInput.value = selected;
                clearError();
                if (nameInput.value === game.suggestedName && !game.executablePath) {
                    const fileName = selected.split(/[\\/]/).pop().replace(/\.(exe|bat)$/i, '');
                    nameInput.value = fileName;
                }
            }
        };

        skipBtn.onclick = () => { modal.remove(); resolve('skip'); };

        addBtn.onclick = () => {
            const finalPath = pathInput.value.trim();
            if (!finalPath) {
                const msg = isAr ? 'الرجاء تحديد ملف التشغيل' : 'Please select an executable';
                showError(msg);
                return;
            }
            game.suggestedName = nameInput.value.trim();
            game.executablePath = finalPath;
            modal.remove();
            resolve('add');
        };

        addAllBtn.onclick = () => {
            const finalPath = pathInput.value.trim();
            if (!finalPath) {
                const msg = isAr ? 'الرجاء تحديد ملف التشغيل' : 'Please select an executable';
                showError(msg);
                return;
            }
            game.suggestedName = nameInput.value.trim();
            game.executablePath = finalPath;
            modal.remove();
            resolve('addAll');
        };

        skipAllBtn.onclick = () => {
            modal.remove();
            resolve('skipAll');
        };
    });
}

async function addGameFromDetection(game) {
    const isAr = userSettings.lang === 'ar';
    let loadingToast = null;
    try {
        const gameName = game.suggestedName;
        const gamePath = game.executablePath;
        const tempId = Date.now();

        const newGame = {
            id: tempId,
            name: gameName,
            path: gamePath,
            arguments: '',
            isFavorite: false,
            assets: {},
            metadata: {},
            notes: ''
        };
        await window.api.saveGame(newGame);

        loadingToast = showToast('info', isAr ? 'جاري تحميل بيانات اللعبة...' : 'Fetching game details...', '', 0);

        let details = null;
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 15000));
        try {
            const fetchPromise = window.api.fetchGameDetails(gameName);
            details = await Promise.race([fetchPromise, timeoutPromise]);
            if (!(details && (details.assets?.poster || details.metadata?.description))) details = null;
        } catch (fetchErr) {
            console.warn('[Fetch] Failed or timeout:', fetchErr);
        }

        if (loadingToast && loadingToast.remove) loadingToast.remove();

        if (details && (details.assets || details.metadata)) {
            const updatedGame = { ...newGame, assets: details.assets || {}, metadata: details.metadata || {} };
            await window.api.saveGameDetails(tempId, updatedGame);
            showToast('success', isAr ? `تمت إضافة "${gameName}" مع جميع البيانات` : `Added "${gameName}" with full details`, '', 3000);
        } else {
            showToast('warning', isAr ? `تمت إضافة "${gameName}" لكن لم يتم العثور على بيانات إضافية` : `Added "${gameName}" but no additional data found`, '', 4000);
        }
        renderGames();
    } catch (err) {
        if (loadingToast && loadingToast.remove) loadingToast.remove();
        console.error('[Add] Failed:', err);
        showToast('error', isAr ? 'فشلت إضافة اللعبة' : 'Failed to add game', err.message, 4000);
    }
}

// Exported initialisation function
export async function initAutoDetector() {
    const autoDetectorToggle = document.getElementById('autoDetectorToggle');
    const autoDetectSettings = document.getElementById('autoDetectSettings');
    const autoWatchToggle = document.getElementById('autoWatchToggle');
    const scanForGamesBtn = document.getElementById('scanForGamesBtn');
    const autoDetectPathInput = document.getElementById('autoDetectPath');
    const selectAutoDetectPathBtn = document.getElementById('selectAutoDetectPathBtn');

    let currentScanPath = null;
    let watcherActive = false;

    // Load UI state
    if (autoDetectorToggle) {
        const saved = localStorage.getItem('autoDetectorEnabled') === 'true';
        autoDetectorToggle.checked = saved;
        autoDetectSettings.style.display = saved ? 'block' : 'none';

        autoDetectorToggle.addEventListener('change', async (e) => {
            const enabled = e.target.checked;
            localStorage.setItem('autoDetectorEnabled', enabled);
            autoDetectSettings.style.display = enabled ? 'block' : 'none';
            if (!enabled) {
                if (watcherActive) await window.api.stopFolderWatcher();
                watcherActive = false;
            } else {
                const path = autoDetectPathInput?.value;
                if (path && autoWatchToggle?.checked) {
                    await window.api.startFolderWatcher(path);
                    watcherActive = true;
                }
                performInitialScan();
            }
        });
    }

    if (autoDetectPathInput) {
        const savedPath = localStorage.getItem('autoDetectPath') || '';
        autoDetectPathInput.value = savedPath;
        currentScanPath = savedPath;
    }

    // Fix double browse: clone button
    if (selectAutoDetectPathBtn && autoDetectPathInput) {
        const newBtn = selectAutoDetectPathBtn.cloneNode(true);
        selectAutoDetectPathBtn.parentNode.replaceChild(newBtn, selectAutoDetectPathBtn);
        newBtn.addEventListener('click', async () => {
            const folder = await window.api.selectFolder();
            if (folder) {
                autoDetectPathInput.value = folder;
                localStorage.setItem('autoDetectPath', folder);
                currentScanPath = folder;
                if (autoWatchToggle?.checked && autoDetectorToggle?.checked) {
                    if (watcherActive) await window.api.stopFolderWatcher();
                    await window.api.startFolderWatcher(folder);
                    watcherActive = true;
                }
                performInitialScan();
            }
        });
    }

    if (autoWatchToggle) {
        const saved = localStorage.getItem('autoWatchEnabled') === 'true';
        autoWatchToggle.checked = saved;
        autoWatchToggle.addEventListener('change', async () => {
            const enabled = autoWatchToggle.checked;
            localStorage.setItem('autoWatchEnabled', enabled);
            if (enabled && autoDetectorToggle?.checked && currentScanPath) {
                await window.api.startFolderWatcher(currentScanPath);
                watcherActive = true;
            } else if (watcherActive) {
                await window.api.stopFolderWatcher();
                watcherActive = false;
            }
        });
    }

    if (scanForGamesBtn && autoDetectPathInput) {
        scanForGamesBtn.addEventListener('click', async () => {
            const folderPath = autoDetectPathInput.value;
            if (!folderPath) {
                showToast('info', userSettings.lang === 'ar' ? 'الرجاء تحديد مجلد الألعاب أولاً' : 'Please select a games folder first', '', 3000);
                return;
            }
            const isAr = userSettings.lang === 'ar';
            scanForGamesBtn.disabled = true;
            const originalHtml = scanForGamesBtn.innerHTML;
            scanForGamesBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${isAr ? 'جاري المسح...' : 'Scanning...'}`;
            try {
                const subfolders = await window.api.getImmediateSubfolders(folderPath);
                const addedFolders = JSON.parse(localStorage.getItem('addedGameFolders') || '[]');
                const candidates = subfolders.filter(sub => !addedFolders.includes(sub));
                const newFolders = [];
                for (const sub of candidates) {
                    const hasGame = await folderHasGame(sub);
                    if (!hasGame) newFolders.push(sub);
                    else markFolderAdded(sub);
                }
                if (newFolders.length === 0) {
                    showToast('info', isAr ? 'لا توجد مجلدات جديدة لاكتشافها' : 'No new folders to detect', '', 3000);
                    return;
                }
                const games = newFolders.map(folder => ({
                    folderPath: folder,
                    suggestedName: folder.split(/[\\/]/).pop(),
                    executablePath: null
                }));
                await processDetectedGames(games);
            } catch (err) {
                console.error('[Scan] Error:', err);
                showToast('error', isAr ? 'فشل المسح' : 'Scan failed', err.message, 4000);
            } finally {
                scanForGamesBtn.disabled = false;
                scanForGamesBtn.innerHTML = originalHtml;
            }
        });
    }

    // Initial scan
    async function performInitialScan() {
        if (!autoDetectorToggle?.checked) return;
        const disableInitial = localStorage.getItem('disableInitialScan') === 'true';
        console.log('[AutoDetector] disableInitial =', disableInitial);
        if (disableInitial) return;
        const folderPath = autoDetectPathInput?.value;
        if (!folderPath) return;
        const addedFolders = JSON.parse(localStorage.getItem('addedGameFolders') || '[]');
        try {
            const subfolders = await window.api.getImmediateSubfolders(folderPath);
            const candidates = subfolders.filter(sub => !addedFolders.includes(sub));
            const newFolders = [];
            for (const sub of candidates) {
                const hasGame = await folderHasGame(sub);
                if (!hasGame) newFolders.push(sub);
                else markFolderAdded(sub);
            }
            if (newFolders.length === 0) return;
            const games = newFolders.map(folder => ({
                folderPath: folder,
                suggestedName: folder.split(/[\\/]/).pop(),
                executablePath: null
            }));
            await processDetectedGames(games);
        } catch (err) {
            console.error('[InitialScan] Error:', err);
        }
    }

    // Watcher
    if (window.api.onFolderCreated) {
        window.api.onFolderCreated(async (data) => {
            if (!autoDetectorToggle?.checked || !autoWatchToggle?.checked) return;
            const added = JSON.parse(localStorage.getItem('addedGameFolders') || '[]');
            if (added.includes(data.folderPath)) return;
            const hasGame = await folderHasGame(data.folderPath);
            if (hasGame) {
                markFolderAdded(data.folderPath);
                return;
            }
            const isAr = userSettings.lang === 'ar';
            const game = {
                folderPath: data.folderPath,
                suggestedName: data.folderName,
                executablePath: null
            };
            const userChoice = await showGameDetectionModal(game, isAr);
            if (userChoice === 'add' || userChoice === 'addAll') {
                await addGameFromDetection(game);
                markFolderAdded(data.folderPath);
            } else if (userChoice === 'skip') {
                markFolderSkipped(data.folderPath);
            }
        });
    }

    // Run initial scan and start watcher after a delay
    setTimeout(performInitialScan, 1500);
    setTimeout(async () => {
        if (autoWatchToggle?.checked && autoDetectorToggle?.checked && currentScanPath) {
            await window.api.startFolderWatcher(currentScanPath);
            watcherActive = true;
        }
    }, 2000);
}