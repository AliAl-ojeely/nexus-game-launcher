const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("node:path");

const backups = require("../../modules/backup");
const db = require("../../modules/database");

const {
  readSettings,
  writeSettings,
  BACKUP_CONFIG,
  USER_DATA,
  USER_DB_PATH,
} = require("../../modules/app-settings");
const { createBackupLogger } = require("../../modules/backup-diagnostics");
const { previewDiscovery } = require("../../modules/backup-discovery");

const logger = createBackupLogger(USER_DATA);
const SAVE_PATHS_MANIFEST = path.join(USER_DATA, "gameSavePaths.json");

function resolveManifestPath() {
  if (fs.existsSync(SAVE_PATHS_MANIFEST)) return SAVE_PATHS_MANIFEST;
  return USER_DB_PATH;
}

function issue(code, message, operation, game = "") {
  const log = logger.emit("error", code, message, { operation, game });
  return {
    success: false,
    ok: false,
    code,
    error: String(message),
    diagnosticId: log.eventId,
    logged: log.logged,
    ...(log.logged ? {} : { logError: log.logError }),
  };
}

function getLibraryGame(id) {
  return db.getGames().find((g) => String(g.id) === String(id));
}

function registerBackupIPC() {
  ipcMain.handle("backup:getInfo", (_e, n) => backups.getGameBackupInfo(n));

  ipcMain.handle("backup:updateConfig", (_e, n, c) => {
    try {
      const result = backups.updateBackupConfig(n, c);
      if (result !== true) {
        logger.emit(
          "error",
          "BACKUP_CONFIG_SAVE_FAILED",
          "Backup config was not saved",
          { operation: "updateConfig", game: n },
        );
      }
      return result;
    } catch (err) {
      logger.emit("error", "BACKUP_CONFIG_EXCEPTION", err.message, {
        operation: "updateConfig",
        game: n,
      });
      throw err;
    }
  });

  // Read-only preview. No write to gamesBackSave.json.
  ipcMain.handle("backup:previewDiscovery", (_e, gameId) => {
    const game = getLibraryGame(gameId);
    if (!game)
      return issue(
        "GAME_NOT_FOUND",
        "Game not found in library",
        "previewDiscovery",
      );
    try {
      const result = previewDiscovery(game, {
        manifestPath: resolveManifestPath(),
      });
      for (const warning of result.warnings) {
        const log = logger.emit("warning", warning.code, warning.message, {
          operation: "previewDiscovery",
          game: game.name,
        });
        warning.diagnosticId = log.eventId;
        warning.logged = log.logged;
        if (!log.logged) warning.logError = log.logError;
      }
      return result;
    } catch (err) {
      return issue(
        err.code || "DISCOVERY_FAILED",
        err.message,
        "previewDiscovery",
        game.name,
      );
    }
  });

  // Explicit user approval: save one server-verified candidate, never an arbitrary renderer path.
  ipcMain.handle("backup:confirmCandidate", (_e, gameId, selectedPath) => {
    const game = getLibraryGame(gameId);
    if (!game)
      return issue(
        "GAME_NOT_FOUND",
        "Game not found in library",
        "confirmCandidate",
      );
    try {
      const preview = previewDiscovery(game, {
        manifestPath: resolveManifestPath(),
      });
      const selected = preview.candidates.find(
        (c) =>
          path.normalize(c.path).toLowerCase() ===
          path.normalize(String(selectedPath || "")).toLowerCase(),
      );
      if (!selected) {
        return issue(
          "INVALID_CANDIDATE",
          "Selected path was not a verified discovery candidate",
          "confirmCandidate",
          game.name,
        );
      }
      const result = backups.updateBackupConfig(game.name, {
        originPath: selected.path,
      });
      if (result !== true) {
        return issue(
          "BACKUP_CONFIG_SAVE_FAILED",
          "Failed to persist selected save location",
          "confirmCandidate",
          game.name,
        );
      }
      const log = logger.emit(
        "info",
        "SAVE_LOCATION_CONFIRMED",
        "Save location confirmed by user",
        { operation: "confirmCandidate", game: game.name },
      );
      return {
        success: true,
        gameId: game.id,
        game: game.name,
        path: selected.path,
        diagnosticId: log.eventId,
        logged: log.logged,
        ...(log.logged ? {} : { logError: log.logError }),
      };
    } catch (err) {
      return issue(
        "CONFIRM_FAILED",
        err.message,
        "confirmCandidate",
        game.name,
      );
    }
  });

  ipcMain.handle("backup:reportClientIssue", (_e, code, message, game) =>
    logger.emit(
      "error",
      String(code || "RENDERER_ERROR").slice(0, 80),
      String(message || "Unknown error").slice(0, 1500),
      { operation: "renderer", game: String(game || "") },
    ),
  );

  // Read-only candidate discovery (persist = false); never writes to gamesBackSave.json automatically
  ipcMain.handle("backup:discoverPath", (_e, gameName, installPath) => {
    const found = backups.autoDiscoverSavePath(
      gameName,
      installPath || null,
      false,
    );
    return found ? { found: true, path: found } : { found: false };
  });

  ipcMain.handle("backup:rescanOrigin", (_e, gameName, installPath) => {
    const found = backups.autoDiscoverSavePath(
      gameName,
      installPath || null,
      false,
    );
    console.log(
      `[Backup] rescanOrigin (preview only) "${gameName}": ${found || "not found"}`,
    );
    return found ? { found: true, path: found } : { found: false };
  });

  ipcMain.handle("backup:now", async (_e, gameName, backupDir, installPath) => {
    try {
      const dir = backupDir || readSettings().globalBackupPath || "";
      if (!dir)
        return issue(
          "NO_BACKUP_PATH",
          "No backup path configured",
          "backupNow",
          gameName,
        );
      const result = await backups.backupGame(
        { name: gameName, path: installPath },
        dir,
        null,
        installPath,
      );
      if (!result?.success)
        return issue(
          result?.code || "BACKUP_FAILED",
          result?.error || "Backup did not complete",
          "backupNow",
          gameName,
        );
      return result;
    } catch (err) {
      return issue("BACKUP_EXCEPTION", err.message, "backupNow", gameName);
    }
  });

  ipcMain.handle("backup:restore", async (_e, zipPath, gameName) => {
    try {
      const result = await backups.restoreBackup(zipPath, gameName);
      if (!result?.success)
        return issue(
          result?.code || "RESTORE_FAILED",
          result?.error || "Restore did not complete",
          "restoreBackup",
          gameName,
        );
      return result;
    } catch (err) {
      return issue("RESTORE_EXCEPTION", err.message, "restoreBackup", gameName);
    }
  });

  ipcMain.handle("backup:deleteBackup", async (_e, gameName, zipPath) => {
    try {
      const result = await backups.deleteBackup(gameName, zipPath);
      if (!result?.success)
        return issue(
          result?.code || "BACKUP_DELETE_FAILED",
          result?.error || "Delete did not complete",
          "deleteBackup",
          gameName,
        );
      return result;
    } catch (err) {
      return issue(
        "BACKUP_DELETE_EXCEPTION",
        err.message,
        "deleteBackup",
        gameName,
      );
    }
  });

  ipcMain.handle("backup:setGlobalPath", (_e, folderPath) => {
    try {
      const settings = readSettings();
      settings.globalBackupPath = folderPath;
      writeSettings(settings);

      if (fs.existsSync(BACKUP_CONFIG)) {
        const data = JSON.parse(fs.readFileSync(BACKUP_CONFIG, "utf-8"));
        let updated = 0;
        for (const config of Object.values(data)) {
          if (!config.backupPath) {
            config.backupPath = folderPath;
            config.updatedAt = new Date().toISOString();
            updated++;
          }
        }
        if (updated > 0) {
          fs.writeFileSync(
            BACKUP_CONFIG,
            JSON.stringify(data, null, 2),
            "utf-8",
          );
        }
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle(
    "backup:getGlobalPath",
    () => readSettings().globalBackupPath || "",
  );

  ipcMain.handle("backup:scanVault", (_e, vaultPath) => {
    const gameNames = db.getGames().map((g) => g.name);
    return backups.scanVaultForExistingBackups(vaultPath, gameNames);
  });

  ipcMain.handle("backup:getAutoBackup", () => {
    const settings = readSettings();
    return settings.autoBackup !== undefined ? settings.autoBackup : true;
  });

  ipcMain.handle("backup:setAutoBackup", (_, value) => {
    const settings = readSettings();
    settings.autoBackup = value;
    writeSettings(settings);
    return true;
  });
}

module.exports = { registerBackupIPC };
