const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectGame: () => ipcRenderer.invoke('dialog:selectGame'),
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'),
    getGames: () => ipcRenderer.invoke('db:getGames'),
    saveGame: (game) => ipcRenderer.invoke('db:saveGame', game),
    saveGameDetails: (id, details) => ipcRenderer.invoke('save-game-details', id, details),
    updateGame: (game) => ipcRenderer.invoke('db:updateGame', game),
    deleteGame: (id) => ipcRenderer.invoke('db:deleteGame', id),
    launchGame: (path, showFPS) => ipcRenderer.send('game:launch', path, showFPS),
    fetchGameInfo: (name) => ipcRenderer.invoke('api:fetchGameInfo', name),
    fetchGameDetails: (name) => ipcRenderer.invoke('api:fetchGameDetails', name),
    openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
    onGameError: (callback) => ipcRenderer.on('game:error', (event, data) => callback(data)),
    removeGameErrorListener: () => ipcRenderer.removeAllListeners('game:error'),
    openFolder: (path) => ipcRenderer.send('shell:openFolder', path),
});