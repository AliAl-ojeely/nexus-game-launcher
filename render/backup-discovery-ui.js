import { confirmDialog } from "./dialogs.js";
import { showToast, updateBackupSidebarUI } from "./details-components.js";
import { state, userSettings } from "./state.js";

let activeDiscoveryToken = 0;
let lastDiscoverySnapshot = null;

function resolveLang(lang) {
  if (lang === "ar" || lang === "en") return lang;
  if (userSettings?.lang === "ar" || userSettings?.lang === "en")
    return userSettings.lang;
  const stored = localStorage.getItem("lang");
  if (stored === "ar" || stored === "en") return stored;
  return document.getElementById("htmlRoot")?.dir === "rtl" ? "ar" : "en";
}

const i18n = (lang, ar, en) => (resolveLang(lang) === "ar" ? ar : en);
const panel = () => document.getElementById("backupDiscoveryPanel");

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}

function displayPanel(gameId = "") {
  const root = panel();
  if (root) {
    root.hidden = false;
    root.dataset.gameId =
      gameId !== undefined && gameId !== null ? String(gameId) : "";
    root.dir = resolveLang() === "ar" ? "rtl" : "ltr";
    root.replaceChildren();
  }
  return root;
}

function addText(root, cls, message) {
  if (root) root.appendChild(element("p", cls, message));
}

function isSameActiveGame(gameId) {
  if (
    gameId === undefined ||
    gameId === null ||
    state.currentGameId === null ||
    state.currentGameId === undefined
  ) {
    return false;
  }
  return String(state.currentGameId) === String(gameId);
}

function translateEngine(engine, lang) {
  const e = String(engine || "unknown").toLowerCase();
  const map = {
    unknown: i18n(lang, "غير معروف", "unknown"),
    unity: "Unity",
    unreal: "Unreal Engine",
    gamemaker: "GameMaker",
    renpy: "Ren'Py",
    godot: "Godot",
    rpgmaker: "RPG Maker",
  };
  return map[e] || engine || i18n(lang, "غير معروف", "unknown");
}

function translateSource(source, lang) {
  const raw = String(source || "");
  if (raw === "known-rule")
    return i18n(lang, "قاعدة حفظ معروفة", "Known save rule");
  if (raw.startsWith("Ludusavi:")) {
    const title = raw.slice("Ludusavi:".length).trim();
    return i18n(lang, `قاعدة Ludusavi: ${title}`, `Ludusavi: ${title}`);
  }
  if (raw === "installation-folder")
    return i18n(lang, "مجلد تثبيت اللعبة", "Game installation folder");
  if (raw === "unreal-convention")
    return i18n(
      lang,
      "مسار محرك Unreal القياسي",
      "Unreal Engine standard path",
    );
  if (raw === "godot-convention")
    return i18n(lang, "مسار محرك Godot القياسي", "Godot standard path");
  return i18n(lang, "اقتراح حسب بنية اللعبة", "Game structure suggestion");
}

function translateIssueMessage(code, rawMessage, lang) {
  if (resolveLang(lang) !== "ar") return rawMessage || "Unknown backup failure";
  const arMessages = {
    GAME_NOT_FOUND: "لم يتم العثور على اللعبة في المكتبة.",
    INVALID_GAME: "بيانات تعريف اللعبة غير مكتملة (المعرّف أو الاسم مفقود).",
    INVALID_CANDIDATE:
      "المسار المحدد ليس ضمن المسارات المكتشفة والموثقة لهذه اللعبة.",
    BACKUP_CONFIG_SAVE_FAILED:
      "تعذر حفظ مسار النسخ الاحتياطي في ملف الإعدادات.",
    NO_BACKUP_PATH: "لم يتم تحديد مجلد النسخ الاحتياطي العام أو الخاص باللعبة.",
    NO_SAVE_PATH_CONFIGURED:
      "لم يتم اعتماد مسار حفظ لهذه اللعبة بعد. يرجى اكتشاف المسار واعتماده أولاً.",
    GAME_CONTEXT_MISMATCH:
      "تغيرت صفحة اللعبة الحالية أثناء الفحص؛ تم إيقاف العملية لمنع خلط المسارات.",
    MANIFEST_UNAVAILABLE:
      "تعذر قراءة قاعدة بيانات مسارات الحفظ (gameSavePaths.json).",
    NAME_AMBIGUOUS: "يوجد أكثر من سجل مطابق لاسم هذه اللعبة في قاعدة البيانات.",
    EMPTY_RESPONSE: "لم ترد استجابة من خدمة فحص المسارات.",
  };
  return (
    arMessages[code] ||
    rawMessage ||
    "حدث خطأ غير متوقع في نظام النسخ الاحتياطي."
  );
}

export function clearBackupDiscoveryPanel(nextGameId = null) {
  activeDiscoveryToken++;
  lastDiscoverySnapshot = null;
  const root = panel();
  if (root) {
    root.hidden = true;
    root.replaceChildren();
    root.dataset.gameId =
      nextGameId !== null && nextGameId !== undefined ? String(nextGameId) : "";
  }
}

export function refreshBackupDiscoveryLanguage(newLang) {
  const lang = resolveLang(newLang);
  const root = panel();
  if (!root || root.hidden || !lastDiscoverySnapshot) return;
  if (!isSameActiveGame(lastDiscoverySnapshot.game?.id)) {
    clearBackupDiscoveryPanel(state.currentGameId);
    return;
  }
  if (lastDiscoverySnapshot.type === "result") {
    renderDiscoveryResult(
      lastDiscoverySnapshot.game,
      lastDiscoverySnapshot.result,
      lang,
      lastDiscoverySnapshot.token,
      lastDiscoverySnapshot.confirmedPath,
    );
  } else if (lastDiscoverySnapshot.type === "loading") {
    renderLoadingState(lastDiscoverySnapshot.game, lang);
  } else if (lastDiscoverySnapshot.type === "error") {
    renderErrorPanel(lastDiscoverySnapshot.errorData, lang);
  }
}

function renderLoadingState(game, lang) {
  const root = displayPanel(game?.id);
  if (!root) return null;
  root.appendChild(
    element(
      "div",
      "backup-discovery-head",
      i18n(lang, "اكتشاف ملفات الحفظ", "Discover save files"),
    ),
  );
  addText(
    root,
    "backup-discovery-note",
    i18n(
      lang,
      "جارٍ فحص المسارات المتاحة دون تعديل الملفات…",
      "Checking possible locations without changing files…",
    ),
  );
  return root;
}

function renderErrorPanel(errorData, lang) {
  const { code, message, diagnosticId, logged, logError, gameId } = errorData;
  const root = displayPanel(gameId);
  if (!root) return;
  root.appendChild(
    element(
      "div",
      "backup-discovery-head",
      i18n(lang, "فشل نظام النسخ الاحتياطي", "Backup system error"),
    ),
  );
  addText(
    root,
    "backup-discovery-error",
    translateIssueMessage(code, message, lang),
  );
  addText(
    root,
    "backup-discovery-note",
    `${code}${diagnosticId ? " · " + diagnosticId : ""}`,
  );
  if (!logged) {
    addText(
      root,
      "backup-discovery-error",
      i18n(
        lang,
        "تعذر كتابة سجل التشخيص: ",
        "Failed to write diagnostic log: ",
      ) + (logError || "unknown"),
    );
  }
}

export async function showBackupError(
  error,
  gameName,
  lang,
  gameId = state.currentGameId,
) {
  const activeLang = resolveLang(lang);
  const code = String(error?.code || "BACKUP_UNEXPECTED_ERROR");
  const message = String(
    error?.error || error?.message || "Unknown backup failure",
  );
  let diagnosticId = error?.diagnosticId || "";
  let logged = error?.logged === true;
  let logError = error?.logError || "";

  if (!diagnosticId) {
    try {
      const outcome = await window.api.backup.reportClientIssue(
        code,
        message,
        gameName,
      );
      diagnosticId = outcome?.eventId || "";
      logged = outcome?.logged === true;
      logError = outcome?.logError || "";
    } catch (logFailure) {
      logged = false;
      logError = logFailure.message;
      console.error("[Nexus Backup] Could not submit error log", logFailure);
    }
  }

  console.error("[Nexus Backup]", code, message, { diagnosticId, logged });
  const errorData = { code, message, diagnosticId, logged, logError, gameId };
  lastDiscoverySnapshot = {
    type: "error",
    game: { id: gameId, name: gameName },
    errorData,
    token: activeDiscoveryToken,
  };

  renderErrorPanel(errorData, activeLang);

  try {
    showToast(
      "error",
      i18n(activeLang, "خطأ في النسخ الاحتياطي", "Backup error"),
      `${translateIssueMessage(code, message, activeLang)} (${code})`,
      6500,
    );
  } catch (toastFailure) {
    console.error("[Nexus Backup] Toast UI failed", toastFailure);
  }
}

function renderDiscoveryResult(game, result, lang, token, confirmedPath = "") {
  if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;

  const activeLang = resolveLang(lang);
  const root = displayPanel(game.id);
  if (!root) return;

  root.appendChild(
    element(
      "div",
      "backup-discovery-head",
      i18n(activeLang, "مسارات الحفظ المكتشفة", "Detected save locations"),
    ),
  );
  addText(
    root,
    "backup-discovery-note",
    i18n(activeLang, "محرك اللعبة: ", "Game engine: ") +
      translateEngine(result.engine, activeLang),
  );
  addText(
    root,
    "backup-discovery-note",
    i18n(
      activeLang,
      "هذه المسارات مقترحة فقط؛ وجودها لا يثبت ملكيتها للعبة. لن يُحفظ أي مسار دون موافقتك.",
      "These are suggestions, not proof of ownership. Nothing is saved without your approval.",
    ),
  );

  for (const warning of result.warnings || []) {
    const warningText = translateIssueMessage(
      warning.code,
      warning.message,
      activeLang,
    );
    addText(
      root,
      "backup-discovery-warning",
      `⚠ ${warning.code}: ${warningText}`,
    );
    if (!warning.logged) {
      addText(
        root,
        "backup-discovery-error",
        i18n(
          activeLang,
          "تعذر حفظ التحذير في السجل: ",
          "Warning could not be logged: ",
        ) + (warning.logError || "unknown"),
      );
    }
  }

  if (!result.candidates?.length) {
    addText(
      root,
      "backup-discovery-note",
      i18n(
        activeLang,
        "لم يُعثر على مسار حفظ مؤكد لهذه اللعبة. يمكنك تحديده يدويًا من نافذة تعديل اللعبة.",
        "No verified save location found for this game. You can set one manually from Edit Game.",
      ),
    );
    const edit = element(
      "button",
      "backup-discovery-use",
      i18n(activeLang, "فتح تعديل اللعبة", "Open Edit Game"),
    );
    edit.type = "button";
    edit.addEventListener("click", () => {
      if (!isSameActiveGame(game.id)) return;
      document.getElementById("detailsEditBtn")?.click();
    });
    root.appendChild(edit);
    return;
  }

  const savedButtons = [];
  for (const candidate of result.candidates) {
    const card = element("div", "backup-discovery-item");
    const label = translateSource(candidate.source, activeLang);
    card.appendChild(element("div", "backup-discovery-name", label));

    const pathCode = element("code", "backup-discovery-path", candidate.path);
    pathCode.dir = "ltr";
    card.appendChild(pathCode);

    const sizeMiB = (candidate.bytes / 1048576).toFixed(2);
    const statsText =
      resolveLang(activeLang) === "ar"
        ? `${candidate.files} ملفات · ${sizeMiB} ميجابايت${candidate.partial ? " · فحص جزئي" : ""}`
        : `${candidate.files} files · ${sizeMiB} MiB${candidate.partial ? " · partial scan" : ""}`;
    card.appendChild(element("div", "backup-discovery-note", statsText));

    const use = element(
      "button",
      "backup-discovery-use",
      i18n(activeLang, "اعتماد هذا المسار", "Use this location"),
    );
    use.type = "button";
    use.dataset.gameId = String(game.id);
    savedButtons.push(use);

    use.addEventListener("click", async () => {
      const clickLang = resolveLang();
      if (
        token !== activeDiscoveryToken ||
        !isSameActiveGame(game.id) ||
        root.dataset.gameId !== String(game.id)
      ) {
        await showBackupError(
          {
            code: "GAME_CONTEXT_MISMATCH",
            error: translateIssueMessage(
              "GAME_CONTEXT_MISMATCH",
              "Active game changed before confirmation",
              clickLang,
            ),
          },
          game.name,
          clickLang,
          state.currentGameId,
        );
        return;
      }

      const confirmed = await confirmDialog({
        variant: "warning",
        title: i18n(
          clickLang,
          "تأكيد مسار حفظ اللعبة",
          "Confirm save location",
        ),
        message: i18n(
          clickLang,
          `هل تحققت من أن هذا المسار يخص ملفات حفظ لعبة ${game.name}؟\n${candidate.path}`,
          `Have you verified this location contains ${game.name} save files?\n${candidate.path}`,
        ),
        confirmText: i18n(clickLang, "اعتماد المسار", "Use location"),
        cancelText: i18n(clickLang, "إلغاء", "Cancel"),
      });
      if (!confirmed) return;

      if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) {
        await showBackupError(
          {
            code: "GAME_CONTEXT_MISMATCH",
            error: translateIssueMessage(
              "GAME_CONTEXT_MISMATCH",
              "Active game changed during confirmation",
              clickLang,
            ),
          },
          game.name,
          clickLang,
          state.currentGameId,
        );
        return;
      }

      savedButtons.forEach((btn) => {
        btn.disabled = true;
      });
      try {
        const response = await window.api.backup.confirmCandidate(
          game.id,
          candidate.path,
        );
        if (token !== activeDiscoveryToken || !isSameActiveGame(game.id))
          return;

        if (!response?.success) {
          await showBackupError(
            response || {
              code: "EMPTY_RESPONSE",
              error: "No response from confirmation",
            },
            game.name,
            clickLang,
            game.id,
          );
          return;
        }

        if (lastDiscoverySnapshot && lastDiscoverySnapshot.token === token) {
          lastDiscoverySnapshot.confirmedPath = candidate.path;
        }

        addText(
          root,
          "backup-discovery-success",
          i18n(
            clickLang,
            "تم اعتماد مسار الحفظ لهذه اللعبة بنجاح. لم يتم إنشاء أرشيف نسخ احتياطي بعد.",
            "Save location confirmed for this game. No backup archive was created yet.",
          ),
        );

        if (!response.logged) {
          addText(
            root,
            "backup-discovery-error",
            i18n(
              clickLang,
              "تعذر تسجيل العملية في السجل: ",
              "The action could not be logged: ",
            ) + (response.logError || "unknown"),
          );
        }

        const updatedInfo = await window.api.backup.getInfo(game.name);
        if (isSameActiveGame(game.id)) {
          updateBackupSidebarUI(updatedInfo, game.name, clickLang);
        }
      } catch (error) {
        await showBackupError(error, game.name, clickLang, game.id);
      } finally {
        savedButtons.forEach((btn) => {
          btn.disabled = false;
        });
      }
    });

    card.appendChild(use);
    root.appendChild(card);
  }

  if (confirmedPath) {
    addText(
      root,
      "backup-discovery-success",
      i18n(
        activeLang,
        "تم اعتماد مسار الحفظ لهذه اللعبة بنجاح. لم يتم إنشاء أرشيف نسخ احتياطي بعد.",
        "Save location confirmed for this game. No backup archive was created yet.",
      ),
    );
  }
}

export async function runBackupDiscovery(game, lang) {
  const activeLang = resolveLang(lang);
  const token = ++activeDiscoveryToken;

  if (!game || !game.id || !game.name) {
    await showBackupError(
      {
        code: "INVALID_GAME",
        error: translateIssueMessage(
          "INVALID_GAME",
          "Game ID or name is missing",
          activeLang,
        ),
      },
      game?.name || "",
      activeLang,
      game?.id,
    );
    return;
  }

  if (
    state.currentGameId !== null &&
    state.currentGameId !== undefined &&
    String(state.currentGameId) !== String(game.id)
  ) {
    await showBackupError(
      {
        code: "GAME_CONTEXT_MISMATCH",
        error: translateIssueMessage(
          "GAME_CONTEXT_MISMATCH",
          "Requested game does not match active details page",
          activeLang,
        ),
      },
      game.name,
      activeLang,
      state.currentGameId,
    );
    return;
  }

  const root = renderLoadingState(game, activeLang);
  if (!root) throw new Error("Discovery panel not found in page");

  lastDiscoverySnapshot = {
    type: "loading",
    game: { id: game.id, name: game.name },
    token,
  };

  const result = await window.api.backup.previewDiscovery(game.id);

  if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) {
    return;
  }

  if (!result?.ok || String(result.gameId) !== String(game.id)) {
    await showBackupError(
      result || { code: "EMPTY_RESPONSE", error: "No response from discovery" },
      game.name,
      activeLang,
      game.id,
    );
    return;
  }

  lastDiscoverySnapshot = {
    type: "result",
    game: { id: game.id, name: game.name },
    result,
    token,
    confirmedPath: "",
  };

  renderDiscoveryResult(game, result, activeLang, token);
}
