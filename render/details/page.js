import { state, userSettings } from "../state.js";
import { renderGameDetails } from "./render.js";
import { updateBackupSidebarUI } from "../details-components.js";
import { formatPlaytime } from "../details-utils.js";
import { clearBackupDiscoveryPanel } from "../backup-discovery-ui.js";
import { t } from "./helpers.js";

function getMainGameFolder(exePath) {
  const subfolderPatterns = [
    // Common binary/executable folders
    "bin",
    "binaries",
    "x64",
    "x86",
    "win32",
    "win64",
    "win",
    "windows",
    "winmd",
    "winrt",
    "uwp",
    "windowsnoeditor",
    "windowsclient",
    "windowsserver",
    "macnoeditor",
    "linuxnoeditor",
    "shipping",
    "development",
    "release",
    "debug",
    "retail",

    // Engine / framework folders
    "engine",
    "content",
    "plugins",
    "intermediate",
    "saved",
    "config",
    "logs",
    "crashes",
    "data",
    "assets",
    "resources",
    "streamingassets",
    "managed",
    "mono",
    "dotnet",
    "scripts",
    "dll",
    "lib",
    "library",
    "shared",
    "common",
    "redist",
    "runtimes",
    "support",
    "tools",
    "utilities",
    "launcher",
    "patcher",
    "update",
    "installer",
    "cache",
    "temp",
    "tmp",
    "download",
    "downloads",
    "packages",

    // Game-specific content folders (not root)
    "bbq",
    "cooked",
    "pak",
    "paks",
    "patch",
    "dlc",
    "mods",
    "overrides",
    "localization",
    "movies",
    "sound",
    "music",
    "video",
    "cinematics",
    "ui",
    "fonts",
    "shaders",
    "configs",
    "settings",
    "userdata",
    "profile",
    "saves",
    "backup",
    "savegames",
    "savedata",
    "profiles",
    "logs",
    "crashreports",

    // Platform / store folders
    "steam",
    "epic",
    "gog",
    "origin",
    "uwp",
    "windowsapps",
    "xboxlive",
    "ps4",
    "ps5",
    "switch",
    "android",
    "ios",
  ];
  // Get directory of the executable
  const lastSlash = Math.max(
    exePath.lastIndexOf("\\"),
    exePath.lastIndexOf("/"),
  );
  let folder = lastSlash !== -1 ? exePath.substring(0, lastSlash) : "";
  let parts = folder.split(/[\\\/]/);

  while (parts.length > 0) {
    const lastPart = parts[parts.length - 1].toLowerCase();
    if (subfolderPatterns.includes(lastPart)) {
      parts.pop();
    } else {
      break;
    }
  }
  const candidate = parts.join("/");
  // Never scan a drive root if placeholder path is D:\\Downloads or similar.
  if (!candidate || /^[a-zA-Z]:\/?$/.test(candidate) || candidate === "/")
    return "";
  return candidate;
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function openGameDetailsPage(game) {
  if (!game || !game.name) return;

  // Switch UI immediately
  document
    .querySelectorAll(".page-area")
    .forEach((p) => p.classList.remove("active"));
  document.getElementById("mainTopbar").style.display = "none";
  document.getElementById("gameDetailsArea").classList.add("active");
  document.getElementById("gameDetailsArea").scrollTop = 0;

  document.getElementById("detailsGameTitle").innerText = game.name;
  state.currentGameExePath = game.path;
  state.currentGameId = game.id;
  state.currentGame = game;

  // Immediately clear and hide any discovery results from a previous game
  clearBackupDiscoveryPanel(game.id);

  const headerName = document.getElementById("detailsHeaderName");
  if (headerName) headerName.textContent = game.name;

  // Reset description wrapper
  const descWrapper = document.getElementById("descWrapper");
  const readMoreBtn = document.getElementById("readMoreBtn");
  if (descWrapper) descWrapper.classList.remove("expanded");
  if (readMoreBtn) {
    readMoreBtn.style.display = "none";
    readMoreBtn.classList.remove("active");
  }

  // Render existing data instantly
  renderGameDetails(game);

  // Favorite indicator in header (always fresh from current game)
  function updateHeaderHeart(targetGame) {
    const favIconContainer = document.getElementById("detailsHeaderFavIcon");
    if (!favIconContainer) return;
    const isFav = !!targetGame.isFavorite;
    const icon = favIconContainer.querySelector("i");
    if (icon) {
      icon.className = isFav ? "fa-solid fa-heart" : "fa-regular fa-heart";
      favIconContainer.classList.toggle("active", isFav);
    }
    favIconContainer.style.display = "flex";
  }
  updateHeaderHeart(game);

  // Play button state
  const playBtn = document.getElementById("detailsPlayBtn");
  const timerContainer = document.getElementById("sessionTimerContainer");
  if (state.isGameRunning && state.currentGameExePath === game.path) {
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.classList.add("play-btn-running");
      playBtn.innerHTML = `<i class="fa-solid fa-stop"></i> ${userSettings.lang === "ar" ? "إيقاف" : "Stop"}`;
    }
    if (timerContainer) timerContainer.style.display = "flex";
  } else {
    if (timerContainer) timerContainer.style.display = "none";
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.classList.remove(
        "play-btn-running",
        "play-btn-stopping",
        "play-btn-securing",
      );
      playBtn.style.cssText = "";
      playBtn.innerHTML = `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${userSettings.lang === "ar" ? "إلعب الآن" : "Play"}</span>`;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NOTES SECTION – load and set up edit/save handlers
  // ─────────────────────────────────────────────────────────────────────────
  const notesText = document.getElementById("notesText");
  const notesInput = document.getElementById("notesInput");
  const notesDisplay = document.getElementById("notesDisplay");
  const notesEditArea = document.getElementById("notesEditArea");
  const editNotesBtn = document.getElementById("editNotesBtn");
  const saveNotesBtn = document.getElementById("saveNotesBtn");
  const cancelNotesBtn = document.getElementById("cancelNotesBtn");

  if (notesDisplay && notesEditArea) {
    notesDisplay.style.display = "flex";
    notesEditArea.style.display = "none";
  }

  if (notesText) {
    notesText.innerText = game.notes && game.notes.trim() ? game.notes : "—";
  }

  if (editNotesBtn && notesDisplay && notesEditArea) {
    editNotesBtn.onclick = () => {
      if (String(state.currentGameId) !== String(game.id)) return;
      notesInput.value = game.notes || "";
      notesDisplay.style.display = "none";
      notesEditArea.style.display = "block";
    };
  }

  if (cancelNotesBtn && notesDisplay && notesEditArea) {
    cancelNotesBtn.onclick = () => {
      notesDisplay.style.display = "flex";
      notesEditArea.style.display = "none";
    };
  }

  if (saveNotesBtn && notesDisplay && notesEditArea) {
    saveNotesBtn.onclick = async () => {
      if (String(state.currentGameId) !== String(game.id)) return;
      const newNotes = notesInput.value.trim();
      const updatedGame = { ...game, notes: newNotes };
      await window.api.updateGame(updatedGame);
      if (String(state.currentGameId) !== String(game.id)) return;
      game.notes = newNotes;
      notesText.innerText = newNotes || "—";
      notesDisplay.style.display = "flex";
      notesEditArea.style.display = "none";
      if (window.showToast) {
        window.showToast(
          "success",
          userSettings.lang === "ar" ? "تم حفظ الملاحظات" : "Notes saved",
          "",
          2000,
        );
      }
    };
  }

  // Playtime and backup info (guarded against game switching)
  const totalMinutes = await window.api.getPlaytime(game.name);
  if (String(state.currentGameId) !== String(game.id)) return;

  const playtimeDisplay = document.getElementById("totalPlaytimeValue");
  if (playtimeDisplay)
    playtimeDisplay.innerText = formatPlaytime(
      totalMinutes || 0,
      userSettings.lang,
    );

  const lastPlayedContainer = document.getElementById("lastPlayedContainer");
  const lastPlayedValueSpan = document.getElementById("lastPlayedValue");
  if (lastPlayedContainer && lastPlayedValueSpan) {
    const playtimeInfo = await window.api.getPlaytimeInfo(game.name);
    if (String(state.currentGameId) !== String(game.id)) return;

    if (playtimeInfo.lastPlayed) {
      const date = new Date(playtimeInfo.lastPlayed);
      const formatted = date.toLocaleString(
        userSettings.lang === "ar" ? "ar-EG" : "en-US",
        {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        },
      );
      lastPlayedValueSpan.innerText = formatted;
      lastPlayedContainer.style.display = "flex";
    } else {
      lastPlayedContainer.style.display = "none";
    }
  }

  const bInfo = await window.api.backup.getInfo(game.name);
  if (String(state.currentGameId) !== String(game.id)) return;
  updateBackupSidebarUI(bInfo, game.name, userSettings.lang);

  // Background fetch if data not cached
  const isCached = !!(
    game.metadata?.steamAppId ||
    game.metadata?.description?.trim() ||
    game.assets?.poster?.startsWith("local-resource://")
  );

  if (!isCached) {
    console.log(`[FRONTEND] ⚡ Background fetch for: ${game.name}`);
    window.api
      .fetchGameDetails(game.name)
      .then(async (freshData) => {
        if (freshData?.assets && freshData?.metadata) {
          console.log(
            `[FRONTEND] ✅ Background fetch complete for: ${game.name}`,
          );
          game.assets = {
            ...game.assets,
            ...Object.fromEntries(
              Object.entries(freshData.assets).filter(([, value]) =>
                Boolean(value),
              ),
            ),
          };
          game.metadata = {
            ...game.metadata,
            ...freshData.metadata,
            media: {
              ...game.metadata?.media,
              ...freshData.metadata?.media,
            },
          };
          if (String(state.currentGameId) === String(game.id)) {
            renderGameDetails(game);
          }
          await window.api.saveGameDetails(game.id, {
            name: game.name,
            assets: freshData.assets,
            metadata: freshData.metadata,
          });
        }
      })
      .catch((err) =>
        console.error("[FRONTEND] Background fetch failed:", err),
      );
  }

  // Adjust sidebar visibility
  const sidebar = document.querySelector(".details-sidebar");
  const detailsContent = document.querySelector(".details-content");
  if (sidebar && bInfo?.lastBackupDate) {
    sidebar.style.display = "block";
    if (detailsContent) detailsContent.style.gridTemplateColumns = "3fr 1fr";
  }

  // FolderInfo is strictly opt-in for installed games. Never scan a placeholder EXE.
  const folderContainer = document.getElementById("folderDetailsContainer");
  if (folderContainer) {
    const folderGrid = folderContainer.querySelector(".folder-details-grid");
    let unavailable = folderContainer.querySelector(
      "[data-folder-unavailable]",
    );
    if (!unavailable) {
      unavailable = document.createElement("p");
      unavailable.setAttribute("data-folder-unavailable", "");
      unavailable.style.color = "var(--text-muted, #94a3b8)";
      unavailable.style.lineHeight = "1.7";
      unavailable.style.margin = "12px 0 0";
      folderContainer.appendChild(unavailable);
    }

    const showUnavailable = () => {
      if (folderGrid) folderGrid.style.display = "none";
      unavailable.textContent =
        userSettings.lang === "ar"
          ? "بيانات المجلد غير متوفرة."
          : "Folder information is not available.";
      unavailable.style.display = "block";
      folderContainer.style.display = "block";
    };

    // Reset UI when navigating between games: never show the previous game's folder.
    folderContainer.style.display = "none";
    unavailable.style.display = "none";
    if (folderGrid) folderGrid.style.display = "";

    if (game.isInstalled === false || !game.path) {
      showUnavailable();
    } else {
      const mainFolder = getMainGameFolder(game.path);
      const folderInfo = mainFolder
        ? await window.api.getFolderInfo(mainFolder)
        : null;
      if (String(state.currentGameId) === String(game.id)) {
        if (folderInfo) {
          document.getElementById("folderName").innerText =
            folderInfo.folderName;
          document.getElementById("folderType").innerText = folderInfo.type;
          document.getElementById("folderLocation").innerText =
            folderInfo.location;
          document.getElementById("folderSize").innerText = formatFileSize(
            folderInfo.sizeBytes,
          );
          document.getElementById("folderSizeOnDisk").innerText =
            formatFileSize(folderInfo.sizeOnDiskBytes);
          document.getElementById("folderContains").innerText =
            folderInfo.contains;
          document.getElementById("folderCreated").innerText =
            folderInfo.created;
          folderContainer.style.display = "block";
        } else {
          showUnavailable();
        }
      }
    }
  }
}
