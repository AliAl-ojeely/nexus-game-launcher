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
  if (raw === "upstream-manifest") return i18n(lang, "قاعدة Ludusavi المحدّثة", "Updated Ludusavi database");
  if (raw === "steam-cloud-remote") return i18n(lang, "حفظ Steam Cloud المحلي", "Local Steam Cloud saves");
  if (raw === "unity-locallow") return i18n(lang, "مجلد Unity في LocalLow", "Unity LocalLow location");
  if (raw === "name-convention") return i18n(lang, "مجلد باسم اللعبة", "Game-name folder");
  if (raw === "deep-scan-match") return i18n(lang, "مجلد اكتشفه البحث الموسع", "Extended scan match");
  if (raw === "manifest-winpath-v070") return i18n(lang, "مسار Windows من قاعدة Manifest", "Windows manifest save rule");
  if (raw === "steam-id-save-v070") return i18n(lang, "حفظ مرتبط بمعرّف Steam", "Steam AppID save location");
  if (raw === "diff-changed-v070") return i18n(lang, "ملفات تغيرت أثناء جلسة اللعب (تحتاج مراجعة)", "Files changed during game session (review required)");
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
    UPSTREAM_MANIFEST_NOT_READY: "قاعدة بيانات Ludusavi الحديثة غير محمّلة. اضغط تحديث قاعدة مواقع الحفظ.",
    UPSTREAM_TITLE_AMBIGUOUS: "توجد عدة ألعاب متشابهة في قاعدة Ludusavi؛ لن نختار بينها تلقائيًا.",
    MULTIPLE_SAVE_LOCATIONS: "عُثر على أكثر من موقع حفظ. Nexus يدعم اعتماد موقع واحد حاليًا؛ تحقق من المواقع جميعها.",
    DEEP_SCAN_PARTIAL: "انتهت حدود البحث الموسع قبل فحص جميع المجلدات؛ النتيجة جزئية.",
    INSTALL_ROOT_SKIPPED: "استُبعد مجلد تثبيت اللعبة من النتائج؛ ليس مكانًا مخصصًا لملفات الحفظ.",
    INSTALL_ROOT_NOT_SAVE: "لا يمكن اعتماد مجلد تثبيت اللعبة بالكامل كمصدر حفظ. اختر مجلد Saves أو ملف حفظ محددًا.",
    DEEP_SCAN_FAILED: "تعذر إكمال البحث الموسع؛ لم تتغير إعدادات الحفظ.",
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

  // Read-only observation is armed before the next Nexus-launched game session.
  const observation = result.observation || { status: 'idle' };
  const obsStatus = observation.status || 'idle';
  const obsMsg = {
    armed: i18n(activeLang, 'المراقبة جاهزة. شغّل اللعبة من Nexus ثم أغلقها لعرض التغييرات.',
      'Observation armed. Launch and close the game through Nexus to inspect changes.'),
    observing: i18n(activeLang, 'اللعبة تعمل الآن؛ ستتم مقارنة الملفات بعد تأكيد خروجها.',
      'Game running; files will be compared after verified exit.'),
    comparing: i18n(activeLang, 'جارٍ مقارنة تغيرات الملفات بعد إغلاق اللعبة...',
      'Comparing file changes after game exit...'),
    complete: i18n(activeLang, `المراقبة اكتملت: ${observation.changedFiles || 0} ملف متغير، و${observation.candidateFolders || 0} موقع محتمل. راجع النتائج قبل اعتماد أي مسار.`,
      `Observation complete: ${observation.changedFiles || 0} changed files, ${observation.candidateFolders || 0} candidate folders. Review before confirming.`),
    'complete-limited': i18n(activeLang,
      `اكتملت مقارنة ${observation.completedRoots || 0} نطاقات؛ توجد ${observation.limitedRoots || 0} نطاقات غير مكتملة. النتائج من النطاقات المكتملة فقط وتحتاج مراجعتك.`,
      `Compared ${observation.completedRoots || 0} complete scopes; ${observation.limitedRoots || 0} scopes were limited. Only fully scanned scope results are shown for your review.`),
    incomplete: i18n(activeLang, 'المراقبة غير مكتملة. جرّب تحديد مجلد أصغر؛ لم تُعتمد أي نتائج تلقائيًا.',
      'Observation was incomplete. Choose a smaller scope; no paths were automatically confirmed.'),
    error: i18n(activeLang, 'تعذرت المراقبة؛ لم تتغير ملفات حفظ الألعاب.',
      'Observation failed; no game saves were modified.'),
    arming: i18n(activeLang, 'جارٍ تجهيز خط الأساس قبل تشغيل اللعبة...', 'Capturing pre-launch file metadata...'),
  }[obsStatus];
  if (obsMsg) addText(root, 'backup-discovery-note', obsMsg);
  if (observation.limitedRoots > 0) addText(root, 'backup-discovery-warning',
    i18n(activeLang,
      `حدود البحث: ${observation.completedRoots || 0} نطاقات مكتملة، ${observation.limitedRoots} نطاقات غير مكتملة. لم تُستخدم ملفات النطاقات غير المكتملة كدليل.`,
      `Coverage limits: ${observation.completedRoots || 0} complete scopes, ${observation.limitedRoots} incomplete scopes. Incomplete scopes never contribute evidence.`));
  if (observation.suppressedUnrelated > 0) addText(root, 'backup-discovery-warning',
    i18n(activeLang,
      `تم استبعاد ${observation.suppressedUnrelated} مجلدًا تغيّر أثناء اللعب لكنه غير مرتبط بهوية اللعبة. التغير الزمني ليس دليل ملكية.`,
      `Excluded ${observation.suppressedUnrelated} changed folders unrelated to this game's identity. Timing alone does not prove ownership.`));
  if (observation.depthLimited) addText(root, 'backup-discovery-warning',
    i18n(activeLang, 'المراقبة محدودة بعمق المجلدات؛ لا تُعتبر فحصًا شاملًا للكمبيوتر.',
      'Observation uses a bounded directory depth; this is not a full-computer scan.'));
  if (['idle', 'complete', 'complete-limited', 'incomplete', 'error'].includes(obsStatus)) {
    const arm = element('button', 'backup-discovery-use',
      i18n(activeLang, 'راقب ملفات الحفظ في جلسة اللعب القادمة', 'Observe next game session'));
    arm.type = 'button';
    arm.addEventListener('click', async () => {
      if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
      arm.disabled = true;
      try {
        const reply = await window.api.backup.armSaveObservation(game.id, false);
        if (!reply?.ok && reply?.code !== 'BASELINE_SCAN_PARTIAL' && reply?.code !== 'BASELINE_NO_FILES')
          await showBackupError(reply || { code: 'OBSERVATION_FAILED' }, game.name, activeLang, game.id);
        if (token === activeDiscoveryToken && isSameActiveGame(game.id)) await runBackupDiscovery(game, activeLang);
      } finally { arm.disabled = false; }
    });
    root.appendChild(arm);
    const custom = element('button', 'backup-discovery-use',
      i18n(activeLang, 'راقب مجلدًا محددًا فقط (فحص أدق)', 'Observe only a chosen folder'));
    custom.type = 'button';
    custom.addEventListener('click', async () => {
      if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
      custom.disabled = true;
      try {
        const reply = await window.api.backup.armSaveObservation(game.id, true);
        if (!reply?.ok && reply?.code !== 'CANCELLED' && reply?.code !== 'BASELINE_SCAN_PARTIAL' && reply?.code !== 'BASELINE_NO_FILES')
          await showBackupError(reply || { code: 'OBSERVATION_FAILED' }, game.name, activeLang, game.id);
        if (token === activeDiscoveryToken && isSameActiveGame(game.id)) await runBackupDiscovery(game, activeLang);
      } finally { custom.disabled = false; }
    });
    root.appendChild(custom);
  }
  if (['armed', 'observing', 'comparing', 'arming'].includes(obsStatus)) {
    const cancel = element('button', 'backup-discovery-use',
      i18n(activeLang, 'إلغاء مراقبة الحفظ', 'Cancel save observation'));
    cancel.type = 'button';
    cancel.addEventListener('click', async () => {
      if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
      await window.api.backup.cancelSaveObservation(game.id);
      if (token === activeDiscoveryToken && isSameActiveGame(game.id)) await runBackupDiscovery(game, activeLang);
    });
    root.appendChild(cancel);
  }
  if (obsStatus !== 'idle') {
    const refresh = element('button', 'backup-discovery-use',
      i18n(activeLang, 'تحديث نتيجة المراقبة', 'Refresh observation result'));
    refresh.type = 'button';
    refresh.addEventListener('click', async () => {
      if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
      await runBackupDiscovery(game, activeLang);
    });
    root.appendChild(refresh);
  }

  // Candidate search remains read-only until the user confirms a specific path.
  const update = element("button", "backup-discovery-use",
    i18n(activeLang, "تحديث قاعدة مواقع الحفظ", "Update save locations database"));
  update.type = "button";
  update.addEventListener("click", async () => {
    if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
    update.disabled = true;
    try {
      const response = await window.api.backup.updateSaveManifest();
      if (!response?.success) {
        await showBackupError(response || { code: "MANIFEST_UPDATE_FAILED" }, game.name, activeLang, game.id);
        return;
      }
      if (token === activeDiscoveryToken && isSameActiveGame(game.id))
        await runBackupDiscovery(game, activeLang);
    } catch (err) {
      await showBackupError({ code: "MANIFEST_UPDATE_FAILED", error: String(err.message || err) }, game.name, activeLang, game.id);
    } finally { update.disabled = false; }
  });
  root.appendChild(update);

  const deep = element("button", "backup-discovery-use",
    i18n(activeLang, "بحث موسّع عن الحفظ", "Extended save search"));
  deep.type = "button";
  deep.disabled = result.scanMode === "deep";
  deep.addEventListener("click", async () => {
    if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
    await runBackupDiscovery(game, activeLang, { deep: true });
  });
  root.appendChild(deep);

  const extra = element("button", "backup-discovery-use",
    i18n(activeLang, "البحث داخل مجلد أو قرص محدد", "Scan a chosen folder or drive"));
  extra.type = "button";
  extra.addEventListener("click", async () => {
    if (token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
    const folder = await window.api.selectFolder();
    if (!folder || token !== activeDiscoveryToken || !isSameActiveGame(game.id)) return;
    await runBackupDiscovery(game, activeLang, { deep: true, extraRoot: folder });
  });
  root.appendChild(extra);
  if (result.scanMode === "deep") addText(root, "backup-discovery-note",
    i18n(activeLang, `تم فحص ${result.scannedDirectories || 0} مجلدًا (بحث محدود)`,
      `${result.scannedDirectories || 0} directories inspected (bounded search)`));

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
    if (candidate.partial) card.appendChild(element("div", "backup-discovery-note",
      i18n(activeLang,
        "عدد الملفات المعروض تقديري من فحص جزئي؛ قد تشمل النسخة الاحتياطية ملفات إضافية داخل المجلد.",
        "File count is a partial preview; a verified backup may contain additional deeper files.")));

    // Differential observations are diagnostic only. No confirmation button is rendered.
    if (candidate.source === 'diff-changed-v070' || candidate.observationOnly === true) {
      addText(card, 'backup-discovery-warning', i18n(activeLang,
        'تغيّر هذا الموقع أثناء اللعب، لكن ذلك لا يثبت أنه يحتوي على حفظ اللعبة. لا يمكن اعتماده مباشرة؛ راجعه وحدد مسار الحفظ الصحيح من تعديل اللعبة.',
        'Changes were observed, but ownership of this folder is unverified. This result cannot be confirmed as a save location; inspect it and set the actual save path in Edit Game.'));
      root.appendChild(card);
      continue;
    }

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
          { deep: result.scanMode === "deep", extraRoot: result.scanRoot || "" },
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

export async function runBackupDiscovery(game, lang, options = {}) {
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

  const result = await window.api.backup.previewDiscovery(game.id, options);

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

// Refresh only the active game's result when its opt-in session observation completes.
if (typeof window.api?.backup?.onSaveObservationUpdated === 'function') {
  window.api.backup.onSaveObservationUpdated(data => {
    const snapshot = lastDiscoverySnapshot;
    if (snapshot?.type !== 'result' || !data || String(data.gameId) !== String(snapshot.game?.id)) return;
    if (!isSameActiveGame(data.gameId)) return;
    void runBackupDiscovery(snapshot.game, resolveLang(userSettings.lang));
  });
}

