const { ipcMain } = require("electron");
const fs = require("fs");
const path = require("node:path");

const backups = require("../../modules/backup");
// Console-only diagnostics also cover automatic backups called from game-launcher.
const backupTerminal = require("../../modules/backup-terminal-diagnostics-v073.cjs");
const deepSaveGuard = require("../../modules/backup-deep-scan-safety-v074.cjs");
backupTerminal.instrumentBackups(backups);
const launcher = require("../../modules/game-launcher");
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
const saveCoverage = require("../../modules/backup-save-discovery-v060");
const discoveryEngine = require("../../modules/backup-discovery-engine-v070");
const { Worker } = require("node:worker_threads");

async function coveredPreview(game, options = {}) {
  const initial = previewDiscovery(game, { manifestPath: resolveManifestPath() });
  const extra = saveCoverage.candidatesFor(game, {
    indexPath: path.join(USER_DATA, saveCoverage.INDEX_FILE),
  });
  const legacyV070 = discoveryEngine.legacyCandidates(game, {
    manifestPath: resolveManifestPath(),
  });
  extra.candidates.push(...legacyV070.candidates);
  extra.warnings.push(...legacyV070.warnings);
  let mode = 'fast';
  let scanRoot = '';
  if (options && options.deep === true) {
    mode = 'deep';
    const supplied = typeof options.extraRoot === 'string' ? options.extraRoot : '';
    if (supplied && supplied.length < 1024 && path.isAbsolute(supplied)) {
      try {
        if (fs.lstatSync(supplied).isDirectory()) scanRoot = supplied;
      } catch { /* Invalid optional directory */ }
    }
    try {
      const detailed = await saveCoverage.scanDeepInWorker(game, { extraRoot: scanRoot });
      extra.candidates.push(...detailed.candidates);
      extra.warnings.push(...detailed.warnings);
      extra.scannedDirectories = detailed.scannedDirectories;
      extra.blockedInstallRoots = detailed.blockedInstallRoots || 0;
    } catch (err) {
      extra.warnings.push({ code: 'DEEP_SCAN_FAILED', message: String(err.message || err) });
    }
  }
  const observed = discoveryEngine.getObservedCandidates(game);
  const enhanced = saveCoverage.mergePreview(initial, {
    ...extra, candidates: [...extra.candidates, ...observed],
  }, mode);
  enhanced.identityV070 = legacyV070.identity;
  enhanced.observation = discoveryEngine.getObservation(game);
  const combined = enhanced;
  // Never surface an executable-containing installation folder as a save source,
  // even when older Manifest rules or scan workers happen to return that path.
  const totalBefore = combined.candidates.length;
  combined.candidates = combined.candidates.filter(candidate =>
    !deepSaveGuard.exclusionReason(game, candidate.path, candidate.source));
  const suppressedUnsafe = totalBefore - combined.candidates.length;
  combined.skipped = (extra.blockedInstallRoots || 0) + suppressedUnsafe;
  if (suppressedUnsafe > 0 && !(combined.warnings || []).some(w => w.code === 'INSTALL_ROOT_SKIPPED'))
    combined.warnings.push({ code: 'INSTALL_ROOT_SKIPPED', message: 'Excluded an installation directory: it is not a save-only location' });
  combined.scanRoot = scanRoot;
  if (mode === 'deep') combined.scannedDirectories = extra.scannedDirectories || 0;
  return combined;
}

function updateManifestWorker() {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../../modules/backup-save-manifest-worker-v060.cjs'), {
      workerData: { outputPath: path.join(USER_DATA, saveCoverage.INDEX_FILE) },
    });
    let done = false;
    const timer = setTimeout(() => finish(new Error('MANIFEST_WORKER_TIMEOUT')), 65000);
    function finish(error, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error); else resolve(value);
    }
    worker.on('message', msg => msg?.ok ? finish(null, msg.value) : finish(new Error(msg?.error || 'MANIFEST_UPDATE_FAILED')));
    worker.on('error', finish);
    worker.on('exit', code => { if (code !== 0 && !done) finish(new Error('MANIFEST_WORKER_EXIT')); });
  });
}



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

// Keep native IPC behavior and return values unchanged; trace the request lifecycle only.
const backupTraceHandle = (channel, handler) => ipcMain.handle(channel, backupTerminal.wrapIpc(channel, handler));

function registerBackupIPC() {
  backupTraceHandle("backup:getInfo", (_e, n) => backups.getGameBackupInfo(n));

  backupTraceHandle("backup:updateConfig", (_e, n, c) => {
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
  backupTraceHandle("backup:previewDiscovery", async (_e, gameId, options = {}) => {
    const game = getLibraryGame(gameId);
    if (!game) return issue("GAME_NOT_FOUND", "Game not found in library", "previewDiscovery");
    try {
      const result = await coveredPreview(game, options);
      for (const warning of result.warnings) {
        const log = logger.emit("warning", warning.code, warning.message, {
          operation: "previewDiscovery", game: game.name,
        });
        warning.diagnosticId = log.eventId;
        warning.logged = log.logged;
        if (!log.logged) warning.logError = log.logError;
      }
      return result;
    } catch (err) {
      return issue(err.code || "DISCOVERY_FAILED", err.message, "previewDiscovery", game.name);
    }
  });

  // A native folder picker owns custom observation scope; renderer cannot supply arbitrary paths.
  backupTraceHandle("backup:armSaveObservation", async (event, gameId, chooseFolder = false) => {
    const game = getLibraryGame(gameId);
    if (!game) return issue('GAME_NOT_FOUND', 'Game not in library', 'armSaveObservation');
    if (launcher.isGameRunningByName(game.name))
      return issue('GAME_RUNNING', 'Arm observation before launching the game from Nexus', 'armSaveObservation', game.name);
    let extraRoot = '';
    if (chooseFolder === true) {
      const { dialog, BrowserWindow } = require('electron');
      const owner = BrowserWindow.fromWebContents(event.sender);
      const options = { properties: ['openDirectory'], title: 'Choose save observation folder (read-only)' };
      const selected = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
      if (selected.canceled || !selected.filePaths?.length) return { ok: false, code: 'CANCELLED' };
      extraRoot = selected.filePaths[0];
    }
    let confirmedPath = '';
    try { confirmedPath = backups.getGameBackupInfo(game.name)?.config?.originPath || ''; }
    catch { /* Missing legacy configuration is not an observation failure. */ }
    return discoveryEngine.armObservation(game, {
      extraRoot, confirmedPath, manifestPath: resolveManifestPath(),
      indexPath: path.join(USER_DATA, saveCoverage.INDEX_FILE),
    });
  });
  backupTraceHandle("backup:cancelSaveObservation", (_event, gameId) => {
    const game = getLibraryGame(gameId);
    if (!game) return issue('GAME_NOT_FOUND', 'Game not in library', 'cancelSaveObservation');
    return discoveryEngine.cancelObservation(game);
  });

  backupTraceHandle("backup:updateSaveManifest", async () => {
    try {
      return { success: true, ...(await updateManifestWorker()) };
    } catch (err) {
      return issue("MANIFEST_UPDATE_FAILED", err.message, "updateSaveManifest");
    }
  });

  // Explicit user approval: save one server-verified candidate, never an arbitrary renderer path.
  // Explicit user approval. Re-run the same read-only scan before accepting the path.
  backupTraceHandle("backup:confirmCandidate", async (_e, gameId, selectedPath, options = {}) => {
    const game = getLibraryGame(gameId);
    if (!game) return issue("GAME_NOT_FOUND", "Game not found in library", "confirmCandidate");
    try {
      const preview = await coveredPreview(game, options);
      const selected = preview.candidates.find(c =>
        path.normalize(c.path).toLowerCase() === path.normalize(String(selectedPath || "")).toLowerCase());
      if (deepSaveGuard.exclusionReason(game, String(selectedPath || ''), 'deep-scan-match'))
        return issue('INSTALL_ROOT_NOT_SAVE', 'Game executable or installation root cannot be confirmed as a save directory', 'confirmCandidate', game.name);
      if (!selected) return issue("INVALID_CANDIDATE", "Selected path is no longer a verified discovery candidate", "confirmCandidate", game.name);
      // Observation-only changes are NOT game-save proof and can never be confirmed via IPC.
      if (selected.source === 'diff-changed-v070' || selected.observationOnly === true ||
          selected.tags?.includes('observation-review-only'))
        return issue('OBSERVATION_NOT_VERIFIED', 'An observed file change is not a verified save path; use a known rule or review the folder manually', 'confirmCandidate', game.name);
      // Never let a bad rule convert the launcher's own userData into a game save.
      const destination = path.resolve(selected.path);
      const appDataRoot = path.resolve(USER_DATA);
      const relativeToApp = path.relative(appDataRoot, destination);
      if (!relativeToApp || (relativeToApp !== '..' && !relativeToApp.startsWith('..' + path.sep) && !path.isAbsolute(relativeToApp)))
        return issue('PROTECTED_APP_DATA', 'Launcher application data cannot be a game save source', 'confirmCandidate', game.name);
      const success = backups.updateBackupConfig(game.name, { originPath: selected.path });
      if (success !== true) return issue("BACKUP_CONFIG_SAVE_FAILED", "Could not persist confirmed save location", "confirmCandidate", game.name);
      const log = logger.emit("info", "SAVE_LOCATION_CONFIRMED", "Save location confirmed by user", {
        operation: "confirmCandidate", game: game.name,
      });
      return { success: true, gameId: game.id, game: game.name, path: selected.path,
        diagnosticId: log.eventId, logged: log.logged,
        ...(log.logged ? {} : { logError: log.logError }) };
    } catch (err) {
      return issue("CONFIRM_FAILED", err.message, "confirmCandidate", game.name);
    }
  });

  backupTraceHandle("backup:reportClientIssue", (_e, code, message, game) =>
    logger.emit(
      "error",
      String(code || "RENDERER_ERROR").slice(0, 80),
      String(message || "Unknown error").slice(0, 1500),
      { operation: "renderer", game: String(game || "") },
    ),
  );

  // Read-only candidate discovery (persist = false); never writes to gamesBackSave.json automatically
  backupTraceHandle("backup:discoverPath", (_e, gameName, installPath) => {
    const found = backups.autoDiscoverSavePath(
      gameName,
      installPath || null,
      false,
    );
    return found ? { found: true, path: found } : { found: false };
  });

  backupTraceHandle("backup:rescanOrigin", (_e, gameName, installPath) => {
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

  backupTraceHandle("backup:now", async (_e, gameName, backupDir, installPath) => {
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

  backupTraceHandle("backup:restore", async (_e, zipPath, gameName) => {
    try {
    if (launcher.isGameRunningByName(gameName)) {
      return issue(
        "GAME_RUNNING",
        "Close the game in Nexus before restoring its save files",
        "restoreBackup",
        gameName,
      );
    }
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

  backupTraceHandle("backup:deleteBackup", async (_e, gameName, zipPath) => {
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

  backupTraceHandle("backup:setGlobalPath", (_e, folderPath) => {
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

  backupTraceHandle(
    "backup:getGlobalPath",
    () => readSettings().globalBackupPath || "",
  );

  backupTraceHandle("backup:scanVault", (_e, vaultPath) => {
    const gameNames = db.getGames().map((g) => g.name);
    return backups.scanVaultForExistingBackups(vaultPath, gameNames);
  });

  backupTraceHandle("backup:getAutoBackup", () => {
    const settings = readSettings();
    return settings.autoBackup !== undefined ? settings.autoBackup : true;
  });

  backupTraceHandle("backup:setAutoBackup", (_, value) => {
    const settings = readSettings();
    settings.autoBackup = value;
    writeSettings(settings);
    return true;
  });
}

module.exports = { registerBackupIPC };
