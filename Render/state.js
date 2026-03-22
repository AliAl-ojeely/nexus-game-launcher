export const state = {
    allGamesData: [],
    editingGameId: null,
    tempGamePath: "",
    currentScreenshotsList: [],
    currentScreenshotIndex: 0,
    currentTab: 'libraryArea',
    currentGameExePath: "",
    isGameRunning: false
};

export const userSettings = {
    appName: localStorage.getItem('appName') || 'Nexus Launcher',
    theme: localStorage.getItem('theme') || 'dark',
    lang: localStorage.getItem('lang') || 'ar',
    gridSize: localStorage.getItem('gridSize') || '260px'
};