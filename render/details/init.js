import { state, userSettings } from "../state.js";
import { handleGameStop } from "./handlers.js";
import {
  showToast,
  updateBackupSidebarUI,
  pulseBackupSuccess,
} from "../details-components.js";
import { formatTime } from "../details-utils.js";
import { runBackupDiscovery, showBackupError } from "../backup-discovery-ui.js";
import { toggleGameFavorite } from "../library.js";
import { t } from "./helpers.js";
import { liveSessions } from "./live-sessions.mjs";
import { paintDetailsSession } from "./session-presentation.mjs";

// Helper to get base filename from a full path (works without Node's 'path' module)
function getBasename(filePath) {
  if (!filePath) return "";
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1].toLowerCase();
}

function refreshVisibleSession() {
  state.isGameRunning = paintDetailsSession(document, liveSessions, state.currentGameId, userSettings.lang);
}

export function initDetails() {
  // Header Favorite Heart toggle inside Game Details page
  const headerFavBtn = document.getElementById("detailsHeaderFavIcon");
  if (headerFavBtn) {
    headerFavBtn.style.cursor = "pointer";
    headerFavBtn.onclick = async (e) => {
      e.stopPropagation();
      if (state.currentGameId === null || state.currentGameId === undefined)
        return;
      await toggleGameFavorite(state.currentGameId);
    };
  }

  // Play and Stop are always scoped to the game shown in this details page.
  document.getElementById("detailsPlayBtn").onclick = () => {
    const selectedId = state.currentGameId;
    const currentGame = state.allGamesData.find(g => String(g.id) === String(selectedId));
    if (!currentGame) return;
    const live = liveSessions.get(selectedId);
    if (live) {
      if (live.phase !== 'running') return;
      const btn = document.getElementById("detailsPlayBtn");
      if (btn) {
        btn.disabled = true;
        btn.classList.add('play-btn-stopping');
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t("stopping", userSettings.lang === "ar" ? "جاري الإيقاف..." : "Stopping...")}`;
      }
      window.api.forceStopGame(currentGame.id);
      return;
    }
    if (!state.currentGameExePath || !liveSessions.launch(selectedId)) return;
    refreshVisibleSession();
    const showFPS = localStorage.getItem("showFPS") === "true";
    window.api.launchGame(currentGame.path, showFPS, currentGame.arguments || "", currentGame.id, currentGame.name);
  };

  // Backend events carry gameId + sessionId. Never change another game's UI
  // or timer, even when the user opens a different details page mid-session.
  if (window.api.removeGameStoppedListener) window.api.removeGameStoppedListener();
  if (window.api.removeGameErrorListener) window.api.removeGameErrorListener();

  window.api.onGameStopped(async data => {
    const finished = liveSessions.stop(data);
    if (!finished) return; // Duplicate or delayed stop from a stale session.
    refreshVisibleSession();
    const game = state.allGamesData.find(g => String(g.id) === String(data.gameId));
    if (!game) return;
    try {
      await handleGameStop(game.name, data.elapsed, data.gameId, data.sessionId);
    } catch (error) {
      console.error('[FRONTEND] Session finalization failed:', error);
    }
  });

  window.api.onGameError(data => {
    liveSessions.failed(data); // Never clears an established running session.
    refreshVisibleSession();
    if (String(data?.gameId) !== String(state.currentGameId)) return;
    showToast('error', data.message || 'Launch failed', '', 7000);
  });

  // Folder button
  document.getElementById("detailsFolderBtn").onclick = () => {
    if (!state.currentGameExePath) return;
    const folderBtn = document.getElementById("detailsFolderBtn");
    folderBtn.disabled = true;
    folderBtn.style.opacity = "0.7";
    folderBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${t("opening", userSettings.lang === "ar" ? "جاري الفتح..." : "Opening...")}`;
    window.api.openFolder(state.currentGameExePath);
    setTimeout(() => {
      folderBtn.disabled = false;
      folderBtn.style.opacity = "1";
      folderBtn.innerHTML = `<i class="fa-solid fa-folder-open"></i> <span data-i18n="btn_folder">${t("btn_folder", userSettings.lang === "ar" ? "مجلد اللعبة" : "Game Folder")}</span>`;
    }, 1200);
  };

  // Read-only discovery + explicit confirmation, using the existing details sidebar.
  const backupDiscoverBtn = document.getElementById("backupDiscoverBtn");
  if (backupDiscoverBtn)
    backupDiscoverBtn.onclick = async () => {
      const currentGame = state.allGamesData.find(
        (g) => String(g.id) === String(state.currentGameId),
      );
      if (!currentGame) {
        await showBackupError(
          { code: "GAME_NOT_FOUND", error: "No active game selected" },
          "",
          userSettings.lang,
        );
        return;
      }
      backupDiscoverBtn.disabled = true;
      try {
        await runBackupDiscovery(currentGame, userSettings.lang);
      } catch (err) {
        await showBackupError(err, currentGame.name, userSettings.lang);
      } finally {
        backupDiscoverBtn.disabled = false;
      }
    };

  // Backup Now button
  const backupNowBtn = document.getElementById("backupNowBtn");
  if (backupNowBtn) {
    backupNowBtn.onclick = async () => {
      const currentGame = state.allGamesData.find(
        (g) => g.id === state.currentGameId,
      );
      if (!currentGame) return;

      backupNowBtn.disabled = true;
      backupNowBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>${t("backing_up", userSettings.lang === "ar" ? "جاري الحفظ..." : "Backing up...")}</span>`;

      try {
        const result = await window.api.backup.now(
          currentGame.name,
          "",
          currentGame.path,
        );
        if (!result?.success) {
          await showBackupError(
            result || {
              error: "Empty backup response",
              code: "EMPTY_RESPONSE",
            },
            currentGame.name,
            userSettings.lang,
          );
          return;
        }
        showToast(
          "success",
          t(
            "backup_created",
            userSettings.lang === "ar"
              ? "تم الحفظ بنجاح ✅"
              : "Backup created ✅",
          ),
          result.zipPath ? result.zipPath.split("\\").pop() : "",
          5000,
        );
        pulseBackupSuccess();
        const freshInfo = await window.api.backup.getInfo(currentGame.name);
        updateBackupSidebarUI(freshInfo, currentGame.name, userSettings.lang);
      } catch (err) {
        await showBackupError(err, currentGame.name, userSettings.lang);
      } finally {
        backupNowBtn.disabled = false;
        backupNowBtn.innerHTML = `<i class="fa-solid fa-shield-halved"></i> <span data-i18n="btn_backup_now">${t("btn_backup_now", userSettings.lang === "ar" ? "حفظ الآن" : "Backup Now")}</span>`;
      }
    };
  }

  // A single source of truth for all running games: the backend's
  // per-game Map, mirrored here by gameId and immutable session identity.
  const pauseBtn = document.getElementById('pauseTimerBtn');
  window.api.onGameStarted(data => {
    if (liveSessions.started(data)) refreshVisibleSession();
  });
  window.api.onTimerState?.(data => {
    if (liveSessions.timerState(data) && String(data.gameId) === String(state.currentGameId)) refreshVisibleSession();
  });
  if (pauseBtn) pauseBtn.onclick = async () => {
    const targetId = state.currentGameId;
    const current = liveSessions.get(targetId);
    if (!current || current.phase !== 'running') return;
    pauseBtn.disabled = true;
    try {
      if (current.paused) await window.api.resumeTimer(targetId);
      else await window.api.pauseTimer(targetId);
    } finally {
      // A pending timer IPC request must not re-enable a different game's UI.
      if (String(targetId) === String(state.currentGameId)) refreshVisibleSession();
    }
  };
  if (window.api.onGameTick) {
    window.api.onGameTick(data => {
      if (liveSessions.tick(data) && String(data.gameId) === String(state.currentGameId)) refreshVisibleSession();
    });
  }
  // Recover already-running games after renderer reload without launching them
  // again. A late snapshot may add missing sessions but never overwrites a
  // newer in-memory session identity.
  if (typeof window.api.getRunningGameSessions === 'function') {
    void window.api.getRunningGameSessions().then(rows => {
      liveSessions.reconcile(rows);
      refreshVisibleSession();
    }).catch(error => console.warn('[FRONTEND] Active sessions unavailable:', error.message));
  }

  // Read More button
  const readMoreBtn = document.getElementById("readMoreBtn");
  if (readMoreBtn) {
    readMoreBtn.onclick = function () {
      const wrapper = document.getElementById("descWrapper");
      const isExpanded = wrapper.classList.toggle("expanded");
      this.classList.toggle("active");
      this.querySelector("span").innerText = isExpanded
        ? userSettings.lang === "ar"
          ? "عرض أقل"
          : "Show Less"
        : userSettings.lang === "ar"
          ? "إقرأ المزيد"
          : "Read More";
    };
  }
}
