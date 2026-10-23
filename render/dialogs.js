/**
 * Nexus Global Dialogs — renderer-only visual layer.
 * All caller-provided strings are rendered via textContent (never innerHTML).
 * Confirmations are fail-closed; queued requests are resolved serially.
 * Native file/folder pickers are intentionally unaffected.
 */
import { userSettings } from './state.js';

const requests = [];
let active = null;
const MAX_TEXT = 12000;

const ICONS = Object.freeze({
    question: 'fa-circle-question', warning: 'fa-triangle-exclamation',
    danger: 'fa-trash-can', info: 'fa-circle-info',
    error: 'fa-circle-xmark', success: 'fa-circle-check',
});

const TEXT = {
    ar: {
        question: 'تأكيد الإجراء', warning: 'تنبيه قبل المتابعة',
        danger: 'تأكيد إجراء حساس', info: 'معلومات',
        error: 'حدث خطأ', success: 'اكتملت العملية',
        yes: 'نعم، متابعة', no: 'إلغاء', ok: 'حسنًا',
        detail: 'التفاصيل التقنية', unexpected: 'تعذر عرض نافذة التأكيد.',
        logFailure: 'تعذر تسجيل الخطأ في سجل التطبيق',
        reference: 'الرقم المرجعي',
    },
    en: {
        question: 'Confirm action', warning: 'Before you continue',
        danger: 'Confirm sensitive action', info: 'Information',
        error: 'An error occurred', success: 'Completed',
        yes: 'Yes, continue', no: 'Cancel', ok: 'OK',
        detail: 'Technical details', unexpected: 'Unable to display the confirmation dialog.',
        logFailure: 'Could not write the error to the application log',
        reference: 'Reference ID',
    },
};

function getLanguage() {
    return userSettings.lang === 'ar' ? 'ar' : 'en';
}

function text(value) {
    return String(value ?? '').slice(0, MAX_TEXT);
}

function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = text(content);
    return element;
}

function failVisibly(error, request) {
    console.error('[Nexus Dialog] Rendering failure:', error);
    // If rendering failed after mounting, never leave a blocking overlay behind.
    document.getElementById('nexus-global-dialog')?.remove();
    // Do not fall back to an unsafe "yes" on any failure.
    const labels = TEXT[getLanguage()];
    try {
        window.alert(`${labels.unexpected}\n${error?.message || String(error)}`);
    } catch (fallbackError) {
        console.error('[Nexus Dialog] Emergency notification also failed:', fallbackError);
    }
    request.resolve(request.mode === 'confirm' ? false : undefined);
    active = null;
    queueMicrotask(showNext);
}

function showNext() {
    if (active || requests.length === 0) return;
    const request = requests.shift();
    active = request;
    try {
        render(request);
    } catch (error) {
        failVisibly(error, request);
    }
}

function enqueue(mode, options = {}) {
    return new Promise(resolve => {
        requests.push({ mode, options, resolve });
        showNext();
    });
}

function render(request) {
    if (!document.body) throw new Error('Document body is missing');
    const { mode, options } = request;
    const lang = getLanguage();
    const L = TEXT[lang];
    const variant = Object.hasOwn(ICONS, options.variant) ? options.variant : 'question';
    const previousFocus = document.activeElement;

    const overlay = node('div', 'nexus-dialog-overlay');
    overlay.id = 'nexus-global-dialog';
    overlay.dir = lang === 'ar' ? 'rtl' : 'ltr';
    overlay.dataset.open = 'true';

    const container = node('section', `nexus-dialog-card nexus-dialog-${variant}`);
    container.setAttribute('role', mode === 'message' && variant === 'error' ? 'alertdialog' : 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', 'nexus-dialog-title');
    container.setAttribute('aria-describedby', 'nexus-dialog-description');

    const header = node('div', 'nexus-dialog-header');
    const icon = node('span', 'nexus-dialog-symbol');
    icon.setAttribute('aria-hidden', 'true');
    const glyph = node('i', `fa-solid ${ICONS[variant]}`);
    icon.appendChild(glyph);
    const titles = node('div', 'nexus-dialog-titles');
    const eyebrow = node('span', 'nexus-dialog-eyebrow', options.eyebrow || 'Nexus Game Launcher');
    const title = node('h2', 'nexus-dialog-title', options.title || L[variant]);
    title.id = 'nexus-dialog-title';
    titles.append(eyebrow, title);
    header.append(icon, titles);

    const description = node('p', 'nexus-dialog-description', options.message || '');
    description.id = 'nexus-dialog-description';
    container.append(header, description);

    if (options.detail) {
        const details = node('details', 'nexus-dialog-details');
        const summary = node('summary', '', options.detailLabel || L.detail);
        details.append(summary, node('pre', 'nexus-dialog-detail-text', options.detail));
        container.appendChild(details);
    }

    const footer = node('div', 'nexus-dialog-actions');
    const cancel = mode === 'confirm' ? node('button', 'nexus-dialog-btn nexus-dialog-cancel', options.cancelText || L.no) : null;
    const accept = node('button', 'nexus-dialog-btn nexus-dialog-accept', options.confirmText || (mode === 'message' ? L.ok : L.yes));
    accept.type = 'button';
    if (cancel) {
        cancel.type = 'button';
        footer.appendChild(cancel);
    }
    footer.appendChild(accept);
    container.appendChild(footer);
    overlay.appendChild(container);

    let finished = false;
    function finish(confirmed = false) {
        if (finished) return;
        finished = true;
        overlay.remove();
        if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
            previousFocus.focus({ preventScroll: true });
        }
        request.resolve(mode === 'confirm' ? confirmed : undefined);
        active = null;
        queueMicrotask(showNext);
    }
    if (cancel) cancel.addEventListener('click', () => finish(false));
    accept.addEventListener('click', () => finish(true));

    // Keyboard stays inside the dialog, preventing app-wide shortcuts from firing.
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
            return;
        }
        if (event.key === 'Tab') {
            const focusables = [...overlay.querySelectorAll('button:not(:disabled), summary')];
            if (focusables.length) {
                const first = focusables[0];
                const last = focusables[focusables.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }
        // Do not allow Enter, F, Delete, shortcuts etc. to reach document listeners.
        event.stopPropagation();
    });

    overlay.addEventListener('pointerdown', event => {
        // Prevent the background app from receiving unintended interactions.
        if (event.target === overlay && options.backdropDismiss === true) {
            finish(false);
        }
    });

    document.body.appendChild(overlay);
    // Cancel gets focus even on warning/danger actions. Enter cannot confirm a deletion accidentally.
    (cancel || accept).focus({ preventScroll: true });
}

/** @returns {Promise<boolean>} true ONLY after explicit confirm click. */
export function confirmDialog(options = {}) {
    return enqueue('confirm', options);
}

/** @returns {Promise<void>} */
export function messageDialog(options = {}) {
    return enqueue('message', options);
}

/**
 * Log and show a real operation failure, including failed-to-log conditions.
 * Diagnostics go to userData/logs/dialog-events.jsonl via the restricted preload bridge.
 */
export async function operationError({ code = 'DIALOG_OPERATION_FAILED', title = '', message = '', error = null, context = '' } = {}) {
    const lang = getLanguage();
    const L = TEXT[lang];
    const reason = text(error?.message || error || message || code);
    const safeCode = text(code).slice(0, 80);
    console.error(`[Nexus Dialog] ${safeCode}`, { context, reason, error });

    let result;
    try {
        if (!window.api?.dialogs?.reportError) throw new Error('Dialog diagnostics API unavailable');
        result = await window.api.dialogs.reportError({ code: safeCode, message: reason, context: text(context).slice(0, 160) });
        if (!result || typeof result !== 'object') throw new Error('Empty diagnostics response');
    } catch (logError) {
        console.error('[Nexus Dialog] Failed to record error:', logError);
        result = { logged: false, logError: logError?.message || String(logError) };
    }

    const diagnostic = [safeCode];
    if (result.eventId) diagnostic.push(`${L.reference}: ${result.eventId}`);
    if (!result.logged) diagnostic.push(`${L.logFailure}: ${result.logError || 'Unknown error'}`);
    const visibleMessage = (message || reason) + (!result.logged
        ? `\n${L.logFailure}: ${result.logError || 'Unknown error'}` : '');
    await messageDialog({ variant: 'error', title: title || L.error, message: visibleMessage,
        detail: diagnostic.join('\n') + '\n' + reason });
    return result;
}
