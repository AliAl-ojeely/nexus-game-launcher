const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    selectGame: () => ipcRenderer.invoke('dialog:selectGame'),
    selectImage: () => ipcRenderer.invoke('dialog:selectImage'),
    getGames: () => ipcRenderer.invoke('db:getGames'),
    saveGame: (game) => ipcRenderer.invoke('db:saveGame', game),
    updateGame: (game) => ipcRenderer.invoke('db:updateGame', game),
    deleteGame: (id) => ipcRenderer.invoke('db:deleteGame', id),
    launchGame: (path) => ipcRenderer.send('game:launch', path),
    fetchGameInfo: (name) => ipcRenderer.invoke('api:fetchGameInfo', name)
});