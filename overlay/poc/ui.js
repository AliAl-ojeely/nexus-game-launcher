'use strict';
(() => {
    const buttons = [...document.querySelectorAll('.action')];
    const previewMode = window.NEXUS_PREVIEW === true || (typeof window.location?.search === 'string' && window.location.search.includes('preview=1'));
    const $ = id => document.getElementById(id);
    const lastInput = $('last-input');
    const countElement = $('input-count');
    const pauseButton = buttons.find(button => button.dataset.action === 'timer');
    const mouseCursor = $('nexus-mouse-cursor');
    let pressedButton = null;
    let selected = 0;
    let count = 0;
    let session = { connected: false, status: 'Unavailable', canControlTimer: false };
    let submitting = false;
    let currentConfig = null;
    const visibleButtons = () => buttons.filter(button => !button.hidden);
    function applyCustomization(value) {
        const parser = window.NexusOverlayConfig;
        if (!parser) return;
        const config = parser.normalize(value);
        currentConfig = config;
        const metrics = document.querySelectorAll?.('[data-metric]') || [];
        for (const metric of metrics) {
            const name = metric.dataset?.metric;
            if (name in config.metrics) metric.hidden = !config.metrics[name];
        }
        const isMinimal = config.sizeMode === 'minimal';
        for (const button of buttons) {
            const name = button.dataset.action;
            if (name in config.buttons) {
                button.hidden = isMinimal ? name === 'test' : !config.buttons[name];
            }
        }
        const hotkeyLabel = $('overlay-hotkey');
        if (hotkeyLabel) {
            hotkeyLabel.textContent = `${config.shortcut.replace(/\+/g, ' + ')} · Toggle`;
            hotkeyLabel.hidden = !isMinimal;
        }
        if (!isMinimal) lastInput.textContent = `${config.shortcut.replace(/\+/g, ' + ')} · Toggle`;
        const widget = document.querySelector?.('.widget');
        const metricCount = Object.values(config.metrics).filter(Boolean).length;
        if (widget) {
            widget.dataset.overlayDense = String(metricCount > 2);
            widget.dataset.overlaySize = config.sizeMode;
            widget.dataset.overlayMetricCount = String(metricCount);
            widget.dataset.overlayStyle = config.appearance.style;
            const hex = config.appearance.background;
            const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
            widget.style?.setProperty('--nx-base-rgb', channels.join(','));
            widget.style?.setProperty('--nx-opacity', String(config.appearance.opacity / 100));
            widget.style?.setProperty('--nx-accent', config.appearance.accent);
        }
        updateSelection();
        renderSession(session);
    }
    function updateClock() {
        const clock = $('local-clock');
        if (clock) clock.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', hour12:false });
    }
    function displayFPS(data) {
        const el = $('game-fps');
        if (el) el.textContent = typeof data?.gameFPS === 'number' && Number.isFinite(data.gameFPS) && data.gameFPS >= 0
            ? String(Math.round(data.gameFPS)) : 'N/A';
    }


    function updateSelection() {
        const active = visibleButtons();
        if (selected >= active.length) selected = Math.max(0, active.length - 1);
        buttons.forEach(element => element.classList.toggle('selected', element === active[selected]));
    }
    function formatSeconds(raw) {
        const seconds = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        const secs = seconds % 60;
        return [hours, minutes, secs].map(n => String(n).padStart(2, '0')).join(':');
    }
    function renderSession(state) {
        session = state || { connected: false, status: 'Unavailable', canControlTimer: false };
        const online = session.connected === true;
        $('game-name').textContent = online ? session.gameName : (session.gameName || 'Waiting for Nexus');
        $('session-time').textContent = online ? formatSeconds(session.elapsedSeconds) : '--:--:--';
        $('total-time').textContent = online ? formatSeconds(session.estimatedTotalSeconds) : '--:--:--';
        const paused = online && session.status === 'Paused';
        $('session-state').textContent = previewMode ? 'PREVIEW' : online ? (paused ? 'PAUSED' : 'RUNNING') : 'OFFLINE';
        $('status-badge').className = !online ? 'status' : paused ? 'status paused' : 'status running';
        if (!submitting) $('sync-state').textContent = previewMode ? 'Preview - no game connection' : !online ? 'No matching live Nexus session' :
            (paused ? 'Session timer paused in Nexus' : 'Synced with Nexus session engine');
        pauseButton.disabled = submitting || !online || !session.canControlTimer;
        $('timer-action-label').textContent = paused ? 'Resume Timer' : 'Pause Timer';
        $('timer-action-icon').textContent = paused ? '▶' : 'Ⅱ';
        displayFPS(session);
    }
    async function toggleTimer() {
        if (pauseButton.disabled || submitting || !session.connected || !session.canControlTimer) return;
        if (previewMode) {
            // Simulate a timer interaction only inside the isolated preview.
            renderSession({ ...session, status: session.status === 'Paused' ? 'Running' : 'Paused' });
            return;
        }
        submitting = true;
        pauseButton.disabled = true;
        $('sync-state').textContent = 'Sending timer command to Nexus…';
        try {
            const response = await window.nexusBridge.setTimerPaused(session.status !== 'Paused');
            if (!response || !response.ok) {
                $('sync-state').textContent = response?.error || 'Nexus did not change the timer';
                lastInput.textContent = 'Timer command not applied';
            } else {
                $('sync-state').textContent = 'Timer updated · syncing';
                lastInput.textContent = response.paused ? 'Timer paused in Nexus' : 'Timer resumed in Nexus';
            }
        } catch (error) {
            $('sync-state').textContent = 'Nexus timer connection unavailable';
            lastInput.textContent = 'Timer command failed';
        } finally {
            submitting = false;
            pauseButton.disabled = !session.connected || !session.canControlTimer;
        }
    }
    function activate() {
        const button = visibleButtons()[selected];
        if (!button || button.disabled) return;
        const action = button.dataset.action;
        if (action === 'resume' && !previewMode) window.nexusBridge?.hide(); // Does not change timer state.
        else if (action === 'timer') void toggleTimer();
        else if (action === 'test') {
            count += 1;
            countElement.textContent = String(count);
        }
    }
    buttons.forEach((button, index) => button.addEventListener('click', () => {
        selected = visibleButtons().indexOf(button);
        updateSelection();
        activate();
    }));
    // Mouse events arrive through the same authenticated control pipe as the
    // keyboard. The BrowserWindow is hidden/offscreen, so programmatically
    // activate only the three known buttons; never eval or arbitrary selectors.
    window.nexusBridge?.onPointer?.((pointer) => {
        if (!pointer || !['move','down','up','cancel'].includes(pointer.type)) return;
        if (pointer.type === 'cancel') {
            pressedButton = null;
            mouseCursor?.classList?.remove('visible');
            return;
        }
        const { x, y } = pointer;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 560 || y < 0 || y >= 338) return;
        if (pointer.native) {
            // Cursor is rendered by D3D11 in game coordinates, not clipped by
            // the Electron widget or its rounded/overflow-hidden container.
            mouseCursor?.classList?.remove('visible');
        } else if (mouseCursor?.style) {
            mouseCursor.style.left = `${x}px`;
            mouseCursor.style.top = `${y}px`;
            mouseCursor.classList?.add('visible');
        }
        const element = document.elementFromPoint?.(x, y);
        const button = element?.closest?.('button.action');
        const index = visibleButtons().indexOf(button);
        if (index !== -1 && !button.disabled) {
            selected = index;
            updateSelection();
        }
        if (pointer.type === 'down') {
            pressedButton = index !== -1 && !button.disabled ? button : null;
            pressedButton?.classList?.add('mouse-down');
        } else if (pointer.type === 'up') {
            const prior = pressedButton;
            pressedButton = null;
            prior?.classList?.remove('mouse-down');
            if (prior && prior === button && !prior.disabled) prior.click();
        }
    });
    window.nexusBridge?.onNavigation(({ key, source }) => {
        mouseCursor?.classList?.remove('visible');
        if (key === 'back') { window.nexusBridge.hide(); return; }
        const length = visibleButtons().length;
        if (length && (key === 'left' || key === 'up')) selected = (selected + length - 1) % length;
        if (length && (key === 'right' || key === 'down')) selected = (selected + 1) % length;
        if (key === 'confirm') activate();
        updateSelection();
        lastInput.textContent = `${source || 'keyboard'}: ${key}`;
    });
    window.nexusBridge?.onState(({ visible }) => {
        if (!visible) {
            pressedButton?.classList?.remove('mouse-down');
            pressedButton = null;
            mouseCursor?.classList?.remove('visible');
        }
        if (visible) {
            selected = 0;
            lastInput.textContent = 'Overlay active';
            updateSelection();
        }
    });
    window.nexusBridge?.onSession?.(renderSession);
    window.nexusBridge?.onConfig?.(applyCustomization);
    if (previewMode) {
        // Preview only: identical HTML/CSS renderer, without any timer or game commands.
        applyCustomization(null);
        renderSession({ connected:true, gameName:'Nexus Preview', elapsedSeconds:754,
            estimatedTotalSeconds:48260, status:'Running', canControlTimer:true });
        window.addEventListener?.('message', event => {
            if (event.source === window.parent && event.data?.type === 'nexus-overlay-preview-config')
                applyCustomization(event.data.config);
        });
        const syncMode = document.querySelector?.('.sync-mode');
        if (syncMode) syncMode.textContent = 'PREVIEW';
        window.parent?.postMessage?.({ type:'nexus-overlay-preview-ready' }, '*');
    } else if (window.NexusOverlayConfig) {
        applyCustomization(null);
    }
    updateClock();
    if (typeof setInterval === 'function') setInterval(updateClock, 1000);
})();
