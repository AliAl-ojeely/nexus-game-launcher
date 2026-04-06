const { ipcMain } = require('electron');
const fs = require('fs');

const backups = require('../../modules/backup');
const db = require('../../modules/database');

const { readSettings, writeSettings, BACKUP_CONFIG } = require('../../modules/app-settings');

function registerBackupIPC() {

    ipcMain.handle('backup:getInfo', (_e, n, c) => backups.getGameBackupInfo(n));
    ipcMain.handle('backup:updateConfig', (_e, n, c) => backups.updateBackupConfig(n, c));

    ipcMain.handle('backup:discoverPath', (_e, gameName, installPath) => {
        const found = backups.autoDiscoverSavePath(gameName, installPath || null, true);
        return found ? { found: true, path: found } : { found: false };
    });

    ipcMain.handle('backup:rescanOrigin', (_e, gameName, installPath) => {
        const found = backups.autoDiscoverSavePath(gameName, installPath || null, true);
        console.log(`[Backup] rescanOrigin "${gameName}": ${found || 'not found'}`);
        return found ? { found: true, path: found } : { found: false };
    });

    ipcMain.handle('backup:now', async (_e, gameName, backupDir, installPath) => {
        const dir = backupDir || readSettings().globalBackupPath || '';
        if (!dir) return { success: false, error: 'No backup path configured' };
        return await backups.backupGame({ name: gameName, path: installPath }, dir, null, installPath);
    });

    ipcMain.handle('backup:restore', async (_e, zipPath, gameName) =>
        await backups.restoreBackup(zipPath, gameName)
    );

    ipcMain.handle('backup:deleteBackup', async (_e, gameName, zipPath) => {
        return await backups.deleteBackup(gameName, zipPath);
    });

    ipcMain.handle('backup:setGlobalPath', (_e, folderPath) => {
        try {
            const settings = readSettings();
            settings.globalBackupPath = folderPath;
            writeSettings(settings);
            console.log(`[Backup] Global path saved: ${folderPath}`);

            if (fs.existsSync(BACKUP_CONFIG)) {
                const data = JSON.parse(fs.readFileSync(BACKUP_CONFIG, 'utf-8'));
                let updated = 0;
                for (const config of Object.values(data)) {
                    if (!config.backupPath) {
                        config.backupPath = folderPath;
                        config.updatedAt = new Date().toISOString();
                        updated++;
                    }
                }
                if (updated > 0) {
                    fs.writeFileSync(BACKUP_CONFIG, JSON.stringify(data, null, 2), 'utf-8');
                    console.log(`[Backup] Applied to ${updated} game(s)`);
                }
            }
            return { success: true };
        } catch (err) {
            console.error(`[Backup] setGlobalPath error:`, err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('backup:getGlobalPath', () =>
        readSettings().globalBackupPath || ''
    );

    ipcMain.handle('backup:scanVault', (_e, vaultPath) => {
        const gameNames = db.getGames().map(g => g.name);
        return backups.scanVaultForExistingBackups(vaultPath, gameNames);
    });

    ipcMain.on('game:stopped', async (event, { gameId, gameName, gamePath }) => {
        console.log(`[Backup] "${gameName}" stopped — auto-backup...`);
        const globalPath = readSettings().globalBackupPath || '';
        const result = await backups.backupGame({ name: gameName, path: gamePath }, globalPath);
        if (result.success) event.reply('backup:auto-completed', { success: true, gameName });
    });
}

module.exports = { registerBackupIPC };