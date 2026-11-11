/* Shared overlay settings. CommonJS for Electron, global for the two HTML renderers. */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') window.NexusOverlayConfig = api;
})(this, function () {
    'use strict';
    const DEFAULTS = Object.freeze({
        enabled: false,
        shortcut: 'Ctrl+Shift+O',
        sizeMode: 'full',
        metrics: Object.freeze({ session: true, total: true, clock: false, fps: false }),
        buttons: Object.freeze({ resume: true, timer: true, test: true }),
        appearance: Object.freeze({ style: 'glassy', background: '#000000', accent: '#78abf8', opacity: 45 })
    });
    function plain(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    function bool(value, fallback) { return typeof value === 'boolean' ? value : fallback; }
    function color(value, fallback) { return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback; }
    // Match the supported Windows RegisterHotKey subset; never persist a reserved combo.
    function normalizeShortcut(raw) {
        if (typeof raw !== 'string' || raw.length > 40) return null;
        const parts = raw.split('+').map(part => part.trim().toUpperCase());
        if (parts.some(part => !part) || new Set(parts).size !== parts.length) return null;
        const modifiers = ['CTRL', 'ALT', 'SHIFT'];
        const bases = parts.filter(part => !modifiers.includes(part));
        if (bases.length !== 1) return null;
        const base = bases[0];
        if (!/^[A-Z0-9]$/.test(base) && !/^F(?:[1-9]|1[01])$/.test(base)) return null;
        const hasCtrl = parts.includes('CTRL'), hasAlt = parts.includes('ALT'), hasShift = parts.includes('SHIFT');
        if (!hasCtrl && !hasAlt && (!/^F(?:[6-9]|1[01])$/.test(base) || hasShift)) return null;
        if (hasAlt && !hasCtrl && base === 'F4') return null;
        if (hasCtrl && !hasAlt && !hasShift && ['S', 'R', 'F', 'P', 'W', 'Q'].includes(base)) return null;
        return [...(hasCtrl ? ['Ctrl'] : []), ...(hasAlt ? ['Alt'] : []),
            ...(hasShift ? ['Shift'] : []), base].join('+');
    }
    function normalize(value) {
        const source = plain(value);
        const metrics = plain(source.metrics), buttons = plain(source.buttons), look = plain(source.appearance);
        const requestedOpacity = Number(look.opacity);
        return {
            enabled: bool(source.enabled, DEFAULTS.enabled),
            shortcut: normalizeShortcut(source.shortcut) || DEFAULTS.shortcut,
            sizeMode: ['full', 'medium', 'minimal'].includes(source.sizeMode) ? source.sizeMode : DEFAULTS.sizeMode,
            metrics: {
                session: bool(metrics.session, DEFAULTS.metrics.session),
                total: bool(metrics.total, DEFAULTS.metrics.total),
                clock: bool(metrics.clock, DEFAULTS.metrics.clock),
                fps: bool(metrics.fps, DEFAULTS.metrics.fps),
            },
            buttons: {
                resume: bool(buttons.resume, DEFAULTS.buttons.resume),
                timer: bool(buttons.timer, DEFAULTS.buttons.timer),
                test: bool(buttons.test, DEFAULTS.buttons.test),
            },
            appearance: {
                style: ['glassy', 'solid', 'minimal'].includes(look.style) ? look.style : DEFAULTS.appearance.style,
                background: color(look.background, DEFAULTS.appearance.background),
                accent: color(look.accent, DEFAULTS.appearance.accent),
                opacity: Number.isFinite(requestedOpacity) ? Math.min(100, Math.max(45, Math.round(requestedOpacity))) : DEFAULTS.appearance.opacity,
            }
        };
    }
    return Object.freeze({ DEFAULTS, normalize, normalizeShortcut });
});
