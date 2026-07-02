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

    // ── Your Pc Info (Can I Run IT) ─────────────────────────────────────────────────────────
    getSystemSpecs: () => ipcRenderer.invoke('app:getSystemSpecs'),

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
    onGameStopped: (callback) => {ipcRenderer.on('game:stopped', (event, data) => callback(data));},
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

    pauseTimer: () => ipcRenderer.invoke('timer:pause'),
    resumeTimer: () => ipcRenderer.invoke('timer:resume'),

    onGameStarted: (cb) => ipcRenderer.on('game:started', (_e, data) => cb(data)),

    onGameTick: (cb) => ipcRenderer.on('game:tick', (_e, data) => cb(data)),
    removeGameTickListener: () => ipcRenderer.removeAllListeners('game:tick'),

    getIconDataURL: (path) => ipcRenderer.invoke('get-icon-dataurl', path),

    getAllPlaytime: () => ipcRenderer.invoke('get-all-playtime'),
    clearLastPlayed: (gameName) => ipcRenderer.invoke('clear-last-played', gameName),


    // ── Statics For Games ──────────────────────────────────────────────────────────────
    getGameStats: (gameName, periodDays) => ipcRenderer.invoke('get-game-stats', gameName, periodDays),
    getOverallStats: (periodDays) => ipcRenderer.invoke('get-overall-stats', periodDays),
    getDailyStats: (gameName, periodDays) => ipcRenderer.invoke('get-daily-stats', gameName, periodDays),
    getGameNamesWithSessions: () => ipcRenderer.invoke('get-game-names-with-sessions'),
    getGameList: () => ipcRenderer.invoke('get-game-list'),
    getAllSessions: () => ipcRenderer.invoke('get-all-sessions'),
    getLongestSession: (gameName) => ipcRenderer.invoke('get-longest-session', gameName),
    getShortestSession: (gameName) => ipcRenderer.invoke('get-shortest-session', gameName),
    getPlaytimeByWeekday: () => ipcRenderer.invoke('get-playtime-by-weekday'),
    getPlaytimeByHour: () => ipcRenderer.invoke('get-playtime-by-hour'),
    getLongestStreak: () => ipcRenderer.invoke('get-longest-streak'),
    getTopGames: (limit, periodDays) => ipcRenderer.invoke('get-top-games', limit, periodDays),
    getUniqueGamesCount: () => ipcRenderer.invoke('get-unique-games-count'),
    getFirstPlayedDate: () => ipcRenderer.invoke('get-first-played-date'),
    getMonthlyPlaytime: (months) => ipcRenderer.invoke('get-monthly-playtime', months),
    getDailyPlaytimeForGame: (gameName, periodDays) => ipcRenderer.invoke('get-daily-playtime-for-game', gameName, periodDays),
    getMonthlyStatsForGame: (gameName, months) => ipcRenderer.invoke('get-monthly-stats-for-game', gameName, months),
    getCumulativeStats: (gameName, days) => ipcRenderer.invoke('get-cumulative-stats', gameName, days),
    getLibraryGrowth: () => ipcRenderer.invoke('get-library-growth'),
    getHeatmapData: () => ipcRenderer.invoke('get-heatmap-data'),
    deleteGameSessions: (gameName) => ipcRenderer.invoke('delete-game-sessions', gameName),

    // ── User Path Data ──────────────────────────────────────────────────────────────
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    getFolderInfo: (folderPath) => ipcRenderer.invoke('get-folder-info', folderPath),

    // ── App Taskbar Tray ──────────────────────────────────────────────────────────────
    getTrayStatus: () => ipcRenderer.invoke('tray:getStatus'),
    setTrayStatus: (enabled) => ipcRenderer.invoke('tray:setStatus', enabled),
    updateTrayLanguage: (lang) => ipcRenderer.send('tray:update-language', lang),
    onTrayStatusChanged: (callback) => ipcRenderer.on('tray:status-changed', (_, enabled) => callback(enabled)),
    onTrayOpenGame: (callback) => ipcRenderer.on('tray:open-game', (_, gameName) => callback(gameName)),
    onTrayOpenStats: (callback) => ipcRenderer.on('tray:open-stats', () => callback()),
    onTrayExit: (callback) => ipcRenderer.on('tray:exit-app', () => callback()),
    onTrayOpenPage: (callback) => ipcRenderer.on('tray:open-page', (_, targetId) => callback(targetId)),

    // ── Updates ───────────────────────────────────────────────────────────────
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    downloadUpdate: (url, filename) => ipcRenderer.invoke('app:downloadUpdate', url, filename),
    installUpdate: (filePath) => ipcRenderer.send('app:installUpdate', filePath),
    onUpdateProgress: (callback) => ipcRenderer.on('update:progress', (_event, data) => callback(data)),
    cancelDownload: () => ipcRenderer.send('app:cancelDownload'),
    onAutoUpdateAvailable: (callback) => ipcRenderer.on('auto-update:available', (_, data) => callback(data)),
    backupUserData: (savePath) => ipcRenderer.invoke('backup-user-data', savePath),

    // ── Scan For Games ──────────────────────────────────────────────────────────────
    scanForGames: (folderPath) => ipcRenderer.invoke('scan-for-games', folderPath),
    startFolderWatcher: (folderPath) => ipcRenderer.invoke('start-folder-watcher', folderPath),
    stopFolderWatcher: () => ipcRenderer.invoke('stop-folder-watcher'),
    onFolderCreated: (callback) => ipcRenderer.on('folder-created', (_, data) => callback(data)),
    getImmediateSubfolders: (folderPath) => ipcRenderer.invoke('get-immediate-subfolders', folderPath),
    gameExistsInFolder: (folderPath) => ipcRenderer.invoke('game-exists-in-folder', folderPath),
    toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),

    // ── Window App Size ──────────────────────────────────────────────────────────────
    getWindowSize: () => ipcRenderer.invoke('app:getWindowSize'),
    setWindowSize: (width, height) => ipcRenderer.invoke('app:setWindowSize', width, height),

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