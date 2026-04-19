const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

    // ── Game Selection & Images ───────────────────────────────────────────────
    selectGame: () => ipcRenderer.invoke('dialog:selectGame'),
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'),
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),

    // ── Database ──────────────────────────────────────────────────────────────
    getGames: () => ipcRenderer.invoke('db:getGames'),
    saveGame: (game) => ipcRenderer.invoke('db:saveGame', game),

    // [FIX] saveGameDetails now routes to 'save-game-details' (not db:updateGame directly)
    // so main.js can resolve the name from DB before calling updateGame.
    saveGameDetails: (id, details) => ipcRenderer.invoke('save-game-details', id, details),

    updateGame: (game) => ipcRenderer.invoke('db:updateGame', game),
    deleteGame: (id) => ipcRenderer.invoke('db:deleteGame', id),

    // ── Game Launcher ─────────────────────────────────────────────────────────
    launchGame: (path, showFPS, args, id, name) => ipcRenderer.send('game:launch', path, showFPS, args, id, name),
    forceStopGame: (id) => ipcRenderer.send('game:force-stop', id),

    // ── External APIs ─────────────────────────────────────────────────────────
    fetchGameInfo: (name) => ipcRenderer.invoke('api:fetchGameInfo', name),
    fetchGameDetails: (name) => ipcRenderer.invoke('api:fetchGameDetails', name),

    // ── Shell ─────────────────────────────────────────────────────────────────
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    openFolder: (path) => ipcRenderer.send('shell:openFolder', path),

    // ── Game Event Listeners ──────────────────────────────────────────────────
    onGameStopped: (cb) => ipcRenderer.on('game:stopped', (_e, data) => cb(data)),
    onGameError: (cb) => ipcRenderer.on('game:error', (_e, data) => cb(data)),
    removeGameStoppedListener: () => ipcRenderer.removeAllListeners('game:stopped'),
    removeGameErrorListener: () => ipcRenderer.removeAllListeners('game:error'),

    // ── Order ──────────────────────────────────────────────────────────────
    getGameOrder: () => ipcRenderer.invoke('db:getGameOrder'),
    saveGameOrder: (order) => ipcRenderer.invoke('db:saveGameOrder', order),
    getFavoritesOrder: () => ipcRenderer.invoke('db:getFavoritesOrder'),
    saveFavoritesOrder: (order) => ipcRenderer.invoke('db:saveFavoritesOrder', order),

    // ── Playtime ──────────────────────────────────────────────────────────────
    getPlaytime: (gameName) => ipcRenderer.invoke('db:getPlaytime', gameName),
    addPlaytime: (gameName, minutes, seconds) => ipcRenderer.invoke('db:addPlaytime', gameName, minutes, seconds || 0),

    getPlaytimeInfo: (gameName) => ipcRenderer.invoke('db:getPlaytimeInfo', gameName),

    getIconDataURL: (path) => ipcRenderer.invoke('get-icon-dataurl', path),
    // ── Backup System ─────────────────────────────────────────────────────────
    backup: {

        getInfo: (name) =>
            ipcRenderer.invoke('backup:getInfo', name),

        updateConfig: (name, config) =>
            ipcRenderer.invoke('backup:updateConfig', name, config),

        discoverPath: (name, installPath) =>
            ipcRenderer.invoke('backup:discoverPath', name, installPath || ''),

        rescanOrigin: (name, installPath) =>
            ipcRenderer.invoke('backup:rescanOrigin', name, installPath || ''),

        now: (name, backupDir, installPath) =>
            ipcRenderer.invoke('backup:now', name, backupDir || '', installPath || ''),

        restore: (zipPath, name) =>
            ipcRenderer.invoke('backup:restore', zipPath, name),

        setGlobalPath: (folderPath) =>
            ipcRenderer.invoke('backup:setGlobalPath', folderPath),

        getGlobalPath: () =>
            ipcRenderer.invoke('backup:getGlobalPath'),

        scanVault: (vaultPath) =>
            ipcRenderer.invoke('backup:scanVault', vaultPath),

        getAutoBackup: () => ipcRenderer.invoke('backup:getAutoBackup'),
        setAutoBackup: (value) => ipcRenderer.invoke('backup:setAutoBackup', value),

        deleteBackup: (gameName, zipPath) => ipcRenderer.invoke('backup:deleteBackup', gameName, zipPath),
    },
});