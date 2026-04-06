import { t } from './helpers.js';
import { userSettings } from '../state.js';

export function showSavePathStatus(statusState, foundPath = '') {
    const statusEl = document.getElementById('savePathStatus');
    if (!statusEl) return;

    const configs = {
        found: {
            color: '#10b981',
            bg: 'rgba(16,185,129,0.08)',
            border: 'rgba(16,185,129,0.25)',
            icon: 'fa-circle-check',
            text: t('backup_path_found', userSettings.lang === 'ar' ? 'مسار الحفظ محدد' : 'Save path configured'),
        },
        notfound: {
            color: '#f59e0b',
            bg: 'rgba(245,158,11,0.08)',
            border: 'rgba(245,158,11,0.25)',
            icon: 'fa-triangle-exclamation',
            text: t('backup_path_not_found', userSettings.lang === 'ar' ? 'غير محدد — أضفه يدوياً في gamesBackSave.json' : 'Not set — add manually in gamesBackSave.json'),
        },
    };

    const cfg = configs[statusState] || configs.notfound;
    const shortPath = foundPath.length > 52 ? '…' + foundPath.slice(-49) : foundPath;

    statusEl.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 6px;
        background: ${cfg.bg};
        border: 1px solid ${cfg.border};
        font-size: 11px;
        color: ${cfg.color};
        margin-top: 4px;
    `;
    statusEl.innerHTML = `
        <i class="fa-solid ${cfg.icon}" style="flex-shrink:0;"></i>
        <span>${cfg.text}</span>
        ${foundPath ? `<span style="opacity:0.65; word-break:break-all;">${shortPath}</span>` : ''}
    `;
}