'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Explicit narrow bridge; no unrestricted Node or generic ipcRenderer access in the UI.
contextBridge.exposeInMainWorld('nexusBridge', {
    onState(callback) {
        if (typeof callback === 'function')
            ipcRenderer.on('nexus:state', (_event, state) => callback(state));
    },
    onNavigation(callback) {
        if (typeof callback === 'function')
            ipcRenderer.on('nexus:navigation', (_event, input) => callback(input));
    },
    onPointer(callback) {
        if (typeof callback === 'function')
            ipcRenderer.on('nexus:pointer', (_event, pointer) => callback(pointer));
    },
    onConfig(callback) {
        if (typeof callback === 'function') ipcRenderer.on('nexus:overlay-config', (_event, config) => callback(config));
    },
    onSession(callback) {
        if (typeof callback === 'function')
            ipcRenderer.on('nexus:session', (_event, session) => callback(session));
    },
    hide() { ipcRenderer.send('nexus:ui-command', 'hide'); },
    setTimerPaused(paused) { return ipcRenderer.invoke('nexus:timer-action', paused === true); },
});
