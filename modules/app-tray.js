const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const sessions = require('./playSessions');

let tray = null;
let mainWindow = null;
let isAr = false;

function getRecentGames(limit = 10) {
    try {
        const allSessions = sessions.getAllSessions();
        const gameMap = new Map();

        for (const s of allSessions) {
            if (!s.endTime) continue;
            const existing = gameMap.get(s.gameName);
            if (!existing || s.endTime > existing.lastPlayed) {
                gameMap.set(s.gameName, { gameName: s.gameName, lastPlayed: s.endTime });
            }
        }

        return Array.from(gameMap.values())
            .sort((a, b) => b.lastPlayed - a.lastPlayed)
            .slice(0, limit)
            .map(g => g.gameName);
    } catch (err) {
        console.error('[Tray] Failed to read sessions:', err);
        return [];
    }
}

function buildTrayMenu() {
    const recentGames = getRecentGames(10);
    const template = [
        {
            label: isAr ? 'فتح التطبيق' : 'Open Launcher',
            click: () => openMainWindow(),
        },
        { type: 'separator' },
        {
            label: isAr ? 'مكتبة الألعاب' : 'Game Library',
            click: () => sendToMainWindow('tray:open-page', 'libraryArea'),
        },
        {
            label: isAr ? 'المفضلة' : 'Favorites',
            click: () => sendToMainWindow('tray:open-page', 'favoritesArea'),
        },
        {
            label: isAr ? 'الإعدادات' : 'Settings',
            click: () => sendToMainWindow('tray:open-page', 'settingsArea'),
        },
        { type: 'separator' },
        {
            label: isAr ? 'الألعاب الحديثة' : 'Recently Played',
            submenu: recentGames.length > 0
                ? recentGames.map(gameName => ({
                    label: gameName,
                    click: () => sendToMainWindow('tray:open-game', gameName),
                }))
                : [{ label: isAr ? 'لا توجد ألعاب' : 'No recent games', enabled: false }],
        },
        { type: 'separator' },
        {
            label: isAr ? 'لوحة الإحصائيات' : 'Statistics Dashboard',
            click: () => sendToMainWindow('tray:open-stats'),
        },
        { type: 'separator' },
        {
            label: isAr ? 'خروج' : 'Exit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            },
        },
    ];

    return Menu.buildFromTemplate(template);
}

// Helper functions to prevent redundant checks
function openMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
    }
}

function sendToMainWindow(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
        openMainWindow();
    }
}

function getTrayIcon() {
    const iconPaths = [
        path.join(__dirname, '../assets/icon-white.png'),
        path.join(__dirname, '../assets/icon.png'),
        path.join(__dirname, '../assets/icon.ico'),
    ];

    for (const iconPath of iconPaths) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
            return icon.resize({ width: 20, height: 20 });
        }
    }

    // Fallback: simple default pixel buffer to avoid canvas dependency
    return nativeImage.createFromBuffer(Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x14,
        0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    ]));
}

function createTray(win, lang = 'en') {
    if (tray) return tray;

    mainWindow = win;
    isAr = lang === 'ar';

    const icon = getTrayIcon().resize({ width: 20, height: 20 });
    tray = new Tray(icon);
    tray.setToolTip('Nexus Game Launcher');

    tray.on('right-click', () => {
        tray.popUpContextMenu(buildTrayMenu());
    });

    tray.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        }
    });

    return tray;
}

function destroyTray(instance) {
    if (instance) {
        instance.destroy();
        if (instance === tray) tray = null;
    } else if (tray) {
        tray.destroy();
        tray = null;
    }
    mainWindow = null;
}

function updateTrayLanguage(lang) {
    isAr = lang === 'ar';
}

function updateTrayMenu() {
    if (tray) {
        tray.popUpContextMenu(buildTrayMenu());
    }
}

module.exports = {
    createTray,
    destroyTray,
    updateTrayLanguage,
    updateTrayMenu,
};