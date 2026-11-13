import { userSettings } from './state.js';
import { confirmDialog } from './dialogs.js';

const OPTION_IDS = Object.freeze({
    'metrics.session': 'overlaySession',
    'metrics.total': 'overlayTotal',
    'metrics.clock': 'overlayClock',
    'metrics.fps': 'overlayFPS',
    'buttons.resume': 'overlayResume',
    'buttons.timer': 'overlayTimer',
    'buttons.test': 'overlayTest',
});

export async function initOverlayEditor() {
    const editor = document.getElementById('overlayEditor');
    const master = document.getElementById('overlayEnabled');
    const schema = window.NexusOverlayConfig;
    if (!editor || !master || !schema) return;

    const field = id => document.getElementById(id);
    const frame = field('overlayPreviewFrame');
    const stage = field('overlayPreviewStage');
    const indicator = field('overlayUnsaved');
    const failure = field('overlayPreviewError');
    const save = field('saveGeneralSettings');
    const shortcutCapture = field('overlayShortcutCapture');
    const shortcutStatus = field('overlayShortcutStatus');
    const shortcutReset = field('overlayShortcutReset');
    const sizeRadios = [...editor.querySelectorAll('input[name="overlaySizeMode"]')];
    let capturing = false;
    let config = schema.normalize(null);
    let saved = JSON.stringify(config);
    let ready = false;
    let saving = false;
    let previewLoading = null;
    let previewLoaded = false;

    function populate(value) {
        master.checked = value.enabled;
        for (const radio of sizeRadios) radio.checked = radio.value === value.sizeMode;
        if (shortcutCapture) shortcutCapture.textContent = value.shortcut.replace(/\+/g, ' + ');
        for (const [key, id] of Object.entries(OPTION_IDS)) {
            const [group, option] = key.split('.');
            field(id).checked = value[group][option];
        }
        field('overlayBgStyle').value = value.appearance.style;
        field('overlayBgColor').value = value.appearance.background;
        field('overlayAccent').value = value.appearance.accent;
        field('overlayOpacity').value = value.appearance.opacity;
        field('overlayOpacityValue').textContent = `${value.appearance.opacity}%`;
    }

    function collect() {
        const next = { enabled: master.checked, shortcut: config.shortcut,
            sizeMode: sizeRadios.find(radio => radio.checked)?.value || 'full', metrics: {}, buttons: {}, appearance: {} };
        for (const [key, id] of Object.entries(OPTION_IDS)) {
            const [group, option] = key.split('.');
            // Minimal locks button visuals; preserve the user's full-mode choices.
            next[group][option] = group === 'buttons' &&
                (next.sizeMode === 'minimal' || config.sizeMode === 'minimal')
                ? config.buttons[option] : field(id).checked;
        }
        next.appearance = {
            style: field('overlayBgStyle').value,
            background: field('overlayBgColor').value,
            accent: field('overlayAccent').value,
            opacity: Number(field('overlayOpacity').value),
        };
        return schema.normalize(next);
    }

    function scaleFrame() {
        if (!stage || !frame || editor.hidden) return;
        const width = Math.max(1, stage.clientWidth - 16);
        const scale = Math.min(1.42, width / 560);
        stage.style.height = `${Math.ceil(338 * scale + 16)}px`;
        stage.style.setProperty('--nx-preview-scale', String(scale));
        stage.style.setProperty('--nx-preview-left', `${Math.max(0, (stage.clientWidth - 560 * scale) / 2)}px`);
    }

    function paintPreview() {
        if (!previewLoaded || !frame?.contentWindow) return;
        frame.contentWindow.postMessage({ type: 'nexus-overlay-preview-config', config }, '*');
    }

    async function loadPreview() {
        if (previewLoading) return previewLoading;
        previewLoading = (async () => {
            try {
                if (!window.api?.overlayGetPreviewHtml) throw new Error('Preview renderer unavailable');
                const markup = await window.api.overlayGetPreviewHtml();
                if (typeof markup !== 'string' || !markup.includes('class="widget"') || markup.length > 262144)
                    throw new Error('Invalid preview document');
                // All CSS, UI code, and default values are drawn from overlay/poc.
                // srcdoc works with the file:// Electron launcher and stays sandboxed.
                frame.srcdoc = markup;
            } catch (error) {
                console.error('[NEXUS OVERLAY] Preview unavailable:', error.message);
                if (failure) {
                    failure.textContent = userSettings.lang === 'ar' ? 'تعذّر عرض المعاينة' : 'Preview unavailable';
                    failure.hidden = false;
                }
            }
        })();
        return previewLoading;
    }

    function updateModeLocks() {
        const minimal = config.sizeMode === 'minimal';
        for (const id of ['overlayResume', 'overlayTimer', 'overlayTest']) {
            const control = field(id);
            if (!control) continue;
            control.disabled = minimal;
            control.closest('label')?.setAttribute('data-mode-locked', String(minimal));
            if (minimal) control.checked = id !== 'overlayTest';
        }
        if (!minimal) {
            field('overlayResume').checked = config.buttons.resume;
            field('overlayTimer').checked = config.buttons.timer;
            field('overlayTest').checked = config.buttons.test;
        }
    }
    function refresh() {
        if (!ready) return;
        editor.hidden = !config.enabled;
        updateModeLocks();
        indicator.hidden = JSON.stringify(config) === saved;
        field('overlayOpacityValue').textContent = `${config.appearance.opacity}%`;
        if (config.enabled) {
            scaleFrame();
            void loadPreview();
            paintPreview();
        }
    }

    const shortcutText = () => config.shortcut.replace(/\+/g, ' + ');
    function stopCapture() {
        capturing = false;
        shortcutCapture?.setAttribute('aria-pressed', 'false');
        if (shortcutCapture) shortcutCapture.textContent = shortcutText();
    }
    shortcutCapture?.addEventListener('click', () => {
        if (!ready || !config.enabled) return;
        capturing = true;
        shortcutCapture.setAttribute('aria-pressed', 'true');
        shortcutCapture.textContent = userSettings.lang === 'ar' ? 'اضغط الاختصار...' : 'Press shortcut...';
        shortcutStatus.dataset.error = 'false';
        shortcutStatus.textContent = userSettings.lang === 'ar' ? 'Esc للإلغاء' : 'Esc to cancel';
        shortcutCapture.focus();
    });
    shortcutReset?.addEventListener('click', () => {
        if (!ready) return;
        stopCapture();
        config = schema.normalize({ ...config, shortcut: schema.DEFAULTS.shortcut });
        shortcutStatus.textContent = '';
        refresh();
    });
    document.addEventListener('keydown', event => {
        if (!capturing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === 'Escape') {
            stopCapture();
            shortcutStatus.textContent = '';
            return;
        }
        if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return;
        const code = event.code || '';
        const key = /^Key[A-Z]$/.test(code) ? code.slice(3) :
            /^Digit[0-9]$/.test(code) ? code.slice(5) :
            /^F(?:[1-9]|1[0-2])$/.test(code) ? code : null;
        const candidate = key && [...(event.ctrlKey ? ['Ctrl'] : []),
            ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
        const accepted = candidate ? schema.normalizeShortcut(candidate) : null;
        if (!accepted || event.metaKey) {
            shortcutStatus.dataset.error = 'true';
            shortcutStatus.textContent = userSettings.lang === 'ar'
                ? 'اختصار غير متاح. اختر Ctrl أو Alt مع مفتاح، أو F6–F11.'
                : 'Unsupported shortcut. Use Ctrl/Alt with a key, or F6–F11.';
            return;
        }
        config = schema.normalize({ ...config, shortcut: accepted });
        stopCapture();
        shortcutStatus.dataset.error = 'false';
        shortcutStatus.textContent = userSettings.lang === 'ar'
            ? 'يسري الاختصار عند تشغيل اللعبة من جديد.'
            : 'Shortcut applies on next game launch.';
        refresh();
    }, true);
    master.addEventListener('change', async () => {
        if (!ready) return;
        if (master.checked && !schema.normalize(JSON.parse(saved)).enabled) {
            const ar = userSettings.lang === 'ar';
            const accepted = await confirmDialog({
                variant: 'warning',
                title: ar ? 'تفعيل Modal Overlay' : 'Enable Modal Overlay',
                message: ar
                    ? 'استخدم المودال مع الألعاب التي تملكها والخالية من أنظمة مكافحة الغش فقط. لن يُفعّل دعم DirectX 12 التجريبي.'
                    : 'Use the overlay only with games you own that have no anti-cheat. Experimental DirectX 12 remains blocked.',
                confirmText: ar ? 'تفعيل' : 'Enable',
                cancelText: ar ? 'إلغاء' : 'Cancel',
            });
            if (!accepted) { master.checked = false; return; }
        }
        config = collect();
        refresh();
    });
    editor.addEventListener('input', () => {
        if (!ready) return;
        config = collect();
        refresh();
    });
    editor.addEventListener('change', () => {
        if (!ready) return;
        config = collect();
        refresh();
    });
    field('overlayReset')?.addEventListener('click', () => {
        if (!ready) return;
        // Restore element/appearance defaults, but don't silently disable the master.
        config = schema.normalize({ ...schema.DEFAULTS, enabled: config.enabled });
        populate(config);
        refresh();
    });
    frame?.addEventListener('load', () => {
        previewLoaded = true;
        paintPreview();
    });
    window.addEventListener('message', event => {
        if (event.source === frame?.contentWindow && event.data?.type === 'nexus-overlay-preview-ready') {
            previewLoaded = true;
            paintPreview();
        }
    });
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(scaleFrame).observe(stage);
    else window.addEventListener('resize', scaleFrame);

    save?.addEventListener('click', async () => {
        if (!ready || saving || !window.api?.overlaySaveConfig) return;
        saving = true;
        try {
            const result = await window.api.overlaySaveConfig(config);
            if (!result?.ok) throw new Error(result?.error || 'Settings not saved');
            config = schema.normalize(result.config);
            saved = JSON.stringify(config);
            populate(config);
            refresh();
        } catch (error) {
            console.error('[NEXUS OVERLAY] Save failed:', error.message);
        } finally {
            saving = false;
        }
    });

    try {
        if (window.api?.overlayGetConfig) config = schema.normalize(await window.api.overlayGetConfig());
    } catch (error) {
        console.warn('[NEXUS OVERLAY] Using default settings:', error.message);
    }
    saved = JSON.stringify(config);
    ready = true;
    populate(config);
    refresh();
}
