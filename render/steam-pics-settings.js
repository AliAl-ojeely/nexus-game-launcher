// Standalone Settings panel addition; never alters existing tabs or save logic.
function language() {
    const stored = localStorage.getItem('lang');
    return stored === 'ar' || stored === 'en' ? stored :
        (document.documentElement.lang === 'ar' ? 'ar' : 'en');
}

function applyLabels(card, selectedLanguage = language()) {
    const t = (ar, en) => selectedLanguage === 'ar' ? ar : en;
    const labels = {
        title: t('شعارات SteamKit2 / PICS', 'SteamKit2 / PICS Logos'),
        subtitle: t('مصدر احتياطي للشعارات عند فشل المصادر الأخرى فقط. يتحقق من هوية اللعبة ورقم Steam قبل التنزيل.',
            'Logo fallback only when existing sources fail. Steam AppID and game identity must be independently verified.'),
        switch: t('تفعيل استرجاع الشعارات تلقائيًا', 'Automatically retrieve missing verified logos'),
        helper: t('تم العثور على ملفات مساعد SteamKit2 (يلزم اختبار التشغيل).',
            'SteamKit2 helper files found (runtime validation still required).'),
        missing: t('مساعد SteamKit2 غير جاهز. احتفظ بالخيار معطّلًا حتى يكتمل تثبيته.',
            'SteamKit2 helper is not ready. Keep disabled until its runtime is installed.'),
        save: t('حفظ خيار الشعارات', 'Save logo option'),
        saving: t('جارٍ الحفظ...', 'Saving...'),
        saved: t('تم الحفظ. سيطبق الخيار على طلبات الصور الجديدة.',
            'Saved. The option applies to new artwork requests.'),
        failed: t('تعذّر حفظ الإعداد. لم يتغير الخيار.',
            'Could not save the setting. No changes were applied.'),
        loading: t('جارٍ قراءة إعدادات SteamKit2...', 'Loading SteamKit2 settings...'),
        pending: t('هناك تغيير غير محفوظ.', 'Unsaved change.'),
        privacy: t('لا يحتاج إلى كلمة مرور Steam. لا يستبدل الصور الموجودة أو اليدوية. يتطلب Installer العام تجهيزًا مستقلًا.',
            'No Steam password required. Existing and manual images are preserved. Public installer packaging remains separate.'),
    };
    for (const [key, value] of Object.entries(labels)) {
        const element = card.querySelector(`[data-pics-label="${key}"]`);
        if (element) element.textContent = value;
    }
    return labels;
}

export async function initSteamPicsSettings(page) {
    const content = page.querySelector('#settings-general-panel .section-content');
    if (!content || document.getElementById('nexusSteamPicsSettings')) return;

    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = 'css/steam-pics-settings.css';
    document.head.appendChild(sheet);

    const card = document.createElement('section');
    card.id = 'nexusSteamPicsSettings';
    card.className = 'form-group nexus-pics-settings';
    card.innerHTML = `
      <h3 data-pics-label="title"></h3>
      <p data-pics-label="subtitle"></p>
      <div class="toggle-container">
        <input class="custom-toggle" type="checkbox" id="nexusSteamPicsEnabled" disabled>
        <label class="toggle-label" for="nexusSteamPicsEnabled" data-pics-label="switch"></label>
      </div>
      <p id="nexusSteamPicsHelper" role="status" aria-live="polite"></p>
      <p data-pics-label="privacy" class="nexus-pics-hint"></p>
      <button id="nexusSteamPicsSave" class="folder-btn-blue" type="button" disabled data-pics-label="save"></button>
      <p id="nexusSteamPicsFeedback" role="status" aria-live="polite"></p>`;
    content.appendChild(card);

    const enabled = card.querySelector('#nexusSteamPicsEnabled');
    const save = card.querySelector('#nexusSteamPicsSave');
    const feedback = card.querySelector('#nexusSteamPicsFeedback');
    const helper = card.querySelector('#nexusSteamPicsHelper');
    let labels = applyLabels(card);
    feedback.textContent = labels.loading;
    let persisted = false;
    let ready = false;
    try {
        if (!window.api?.steamPicsGetStatus || !window.api?.steamPicsSetEnabled)
            throw new Error('preload_bridge_unavailable');
        const status = await window.api.steamPicsGetStatus();
        if (typeof status?.enabled !== 'boolean') throw new Error('invalid_ipc_status');
        persisted = status.enabled;
        ready = status.helperFilesPresent === true;
        enabled.checked = persisted;
        enabled.disabled = !ready && !persisted;
        helper.textContent = ready ? labels.helper : labels.missing;
        feedback.textContent = '';
    } catch {
        feedback.textContent = labels.failed;
        return;
    }
    const updateDirty = () => {
        save.disabled = enabled.checked === persisted || (!ready && enabled.checked);
        feedback.textContent = save.disabled ? '' : labels.pending;
    };
    enabled.addEventListener('change', updateDirty);
    save.addEventListener('click', async () => {
        if (save.disabled) return;
        const next = enabled.checked;
        save.disabled = true;
        enabled.disabled = true;
        feedback.textContent = labels.saving;
        try {
            const result = await window.api.steamPicsSetEnabled(next);
            if (result?.enabled !== next) throw new Error('setting_unconfirmed');
            persisted = next;
            feedback.textContent = labels.saved;
        } catch {
            enabled.checked = persisted;
            feedback.textContent = labels.failed;
        } finally {
            enabled.disabled = !ready && !persisted;
            updateDirty();
            if (enabled.checked === persisted && feedback.textContent !== labels.failed)
                feedback.textContent = labels.saved;
        }
    });
    // Settings uses a central language switch; refresh only this card on demand.
    const langSelect = document.getElementById('langSetting');
    langSelect?.addEventListener('change', () => {
        labels = applyLabels(card, langSelect.value);
        helper.textContent = ready ? labels.helper : labels.missing;
        updateDirty();
    });
}
