const { ipcMain } = require('electron');
const { reportDialogIssue } = require('../../modules/dialog-diagnostics');

function registerDialogIPC() {
    ipcMain.handle('dialogs:reportError', (_event, issue) => reportDialogIssue(issue));
}
module.exports = { registerDialogIPC };
