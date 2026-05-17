const { dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

async function selectGame() {
    const result = await dialog.showOpenDialog({
        title: 'Select Game Executable',
        filters: [{ name: 'Executables', extensions: ['exe', 'bat', 'lnk', 'sh', 'AppImage', 'bin'] }],
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
}

async function selectImage() {
    const result = await dialog.showOpenDialog({
        title: 'Select Cover Image',
        filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp', 'ico'] }],
        properties: ['openFile']
    });
    return result.canceled ? null : result.filePaths[0];
}

async function selectFolder() {
    const result = await dialog.showOpenDialog({
        title: 'Select Folder',
        properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
}

function openFolder(event, pathOrFile) {
    if (!pathOrFile) return;
    let folderPath;
    // Check if the path looks like a file (has an extension like .exe, .lnk, .bat, etc.)
    const isFile = /\.(exe|lnk|bat|sh|AppImage)$/i.test(pathOrFile);
    if (isFile) {
        folderPath = path.dirname(pathOrFile);
    } else {
        folderPath = pathOrFile;
    }
    if (fs.existsSync(folderPath)) {
        shell.openPath(folderPath);
    } else {
        if (event && !event.sender.isDestroyed()) {
            event.sender.send('game:error', {
                message: `The folder does not exist.\nPath: ${folderPath}`,
                code: 'FOLDER_NOT_FOUND'
            });
        }
    }
}

function openExternal(url) {
    if (url) shell.openExternal(url);
}

module.exports = { selectGame, selectImage, openFolder, openExternal, selectFolder };