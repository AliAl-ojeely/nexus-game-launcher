import { toSafeUrl } from './details-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// TOAST NOTIFICATION SYSTEM (with theme support)
// ─────────────────────────────────────────────────────────────────────────────

export function showToast(type, message, sub = '', duration = 4000) {
    let container = document.getElementById('nexus-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'nexus-toast-container';
        container.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            pointer-events: none;
        `;
        document.body.appendChild(container);
    }

    // RTL support
    const isRtl = document.documentElement.getAttribute('dir') === 'rtl';
    if (isRtl) {
        container.style.right = 'auto';
        container.style.left = '24px';
    } else {
        container.style.right = '24px';
        container.style.left = 'auto';
    }

    const icons = {
        success: '<i class="fa-solid fa-shield-check" style="color:#10b981;"></i>',
        error: '<i class="fa-solid fa-circle-xmark" style="color:#ef4444;"></i>',
        info: '<i class="fa-solid fa-circle-info" style="color:#60a5fa;"></i>',
        saving: '<i class="fa-solid fa-cloud-arrow-up fa-spin" style="color:#f59e0b;"></i>',
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
        background: var(--bg-sidebar);
        border: 1px solid var(--border-color);
        border-radius: 10px;
        padding: 12px 16px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
        min-width: 280px;
        max-width: 360px;
        box-shadow: 0 8px 32px var(--shadow-color);
        pointer-events: all;
        opacity: 0;
        transform: translateX(20px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        font-family: inherit;
    `;

    const borderColor = { success: '#10b981', error: '#ef4444', info: '#60a5fa', saving: '#f59e0b' }[type] || '#60a5fa';
    toast.style.borderLeft = `3px solid ${borderColor}`;

    toast.innerHTML = `
        <div style="margin-top:1px; font-size:16px; flex-shrink:0;">${icons[type] || icons.info}</div>
        <div style="flex:1; min-width:0;">
            <div style="font-size:13px; font-weight:600; color:var(--text-main); line-height:1.4;">${message}</div>
            ${sub ? `<div style="font-size:11px; color:var(--text-muted); margin-top:3px; word-break:break-all; line-height:1.4;">${sub}</div>` : ''}
        </div>
        <button onclick="this.parentElement.remove()" style="
            background:none; border:none; cursor:pointer;
            color:var(--text-muted); font-size:14px; padding:0;
            flex-shrink:0; margin-top:1px; opacity:0.7;
            font-family:inherit;
        " title="Dismiss">✕</button>
    `;

    container.appendChild(toast);

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(0)';
        });
    });

    if (duration > 0) {
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(20px)';
            setTimeout(() => toast.remove(), 280);
        }, duration);
    }

    return toast;
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKUP UI UPDATER (with restore buttons)
// ─────────────────────────────────────────────────────────────────────────────

export function updateBackupSidebarUI(bInfo, gameName, lang) {
    const el = document.getElementById('backupStatusValue');
    if (!el) return;

    if (!bInfo?.lastBackupDate) {
        el.innerHTML = `<small style="color:var(--text-muted); opacity:0.5;">
            ${lang === 'ar' ? 'لم يتم الحفظ بعد' : 'Not backed up yet'}
        </small>`;
        return;
    }

    const label = lang === 'ar' ? 'آخر نسخة' : 'Last Backup';
    const countLabel = lang === 'ar' ? 'نسخة' : 'backups';
    const folderTip = lang === 'ar' ? 'افتح مجلد النسخ' : 'Show backup folder';

    const zipFolder = bInfo.config?.backupPath
        ? `${bInfo.config.backupPath}\\NexusBackups\\${gameName.replace(/[<>:"/\\|?*]/g, '_').trim()}`
        : null;

    // Build list of all backups
    const backupsList = bInfo.backups || [];
    let backupsHtml = '';
    if (backupsList.length) {
        backupsHtml = `<div style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 8px;">
            <small style="color:var(--text-muted); display:block; margin-bottom:6px;">${lang === 'ar' ? 'النسخ الاحتياطية' : 'Backups'}</small>
            <div>`;
        backupsList.forEach(backup => {
            const isLatest = backup === backupsList[0];
            const dateLabel = isLatest ? (lang === 'ar' ? ' (الأحدث)' : ' (latest)') : '';
            backupsHtml += `
        <div class="backup-entry" style="
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border-color);
            gap: 8px;
            ">
            <small style="
                font-size: 11px;
                color: var(--text-muted);
                word-break: break-all;
                flex: 1;
                min-width: 120px;
            ">${backup.fileName}${dateLabel}</small>
            <div style="display: flex; gap: 6px; flex-shrink: 0;">
                <button class="restore-backup-btn" data-zip="${backup.filePath}" data-game="${gameName}" style="
                    background: none;
                    border: 1px solid var(--accent);
                    color: var(--accent);
                    border-radius: 4px;
                    padding: 2px 8px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: 0.2s;
                " onmouseover="this.style.background='var(--accent)';this.style.color='#fff';"
                    onmouseout="this.style.background='transparent';this.style.color='var(--accent)';">
                    ${lang === 'ar' ? 'استعادة' : 'Restore'}
                </button>
                <button class="delete-backup-btn" data-zip="${backup.filePath}" data-game="${gameName}" style="
                    background: none;
                    border: 1px solid #ef4444;
                    color: #ef4444;
                    border-radius: 4px;
                    padding: 2px 8px;
                    font-size: 11px;
                    cursor: pointer;
                    transition: 0.2s;
                " onmouseover="this.style.background='#ef4444';this.style.color='#fff';"
                    onmouseout="this.style.background='transparent';this.style.color='#ef4444';">
                    ${lang === 'ar' ? 'حذف' : 'Delete'}
                </button>
            </div>
            </div>
        `;
        });
        backupsHtml += `</div></div>`;
    }

    // 🔥 IMPORTANT: Include backupsHtml in the main HTML
    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <i class="fa-solid fa-circle-check" style="color:#10b981; font-size:12px;"></i>
            <small style="color:var(--text-muted);">
                ${label}: <strong style="color:var(--text-main);">${bInfo.lastBackupDate}</strong>
            </small>
            <small style="color:var(--text-muted); opacity:0.6;">(${bInfo.backupCounter} ${countLabel})</small>
            ${zipFolder ? `
            <button id="openBackupFolderBtn" title="${folderTip}" style="
                background: none;
                border: none;
                cursor: pointer;
                color: var(--text-muted);
                font-size: 12px;
                padding: 2px 4px;
                border-radius: 4px;
                opacity: 0.7;
                transition: opacity 0.15s, color 0.15s;
                font-family: inherit;
            " onmouseover="this.style.opacity='1';this.style.color='var(--accent)';"
               onmouseout="this.style.opacity='0.7';this.style.color='var(--text-muted)';"
               data-folder="${zipFolder}">
                <i class="fa-solid fa-folder-open"></i>
            </button>` : ''}
        </div>
        ${backupsHtml}   <!-- ✅ This was missing -->
    `;

    // Folder button listener (re-attach after innerHTML reset)
    const folderBtn = document.getElementById('openBackupFolderBtn');
    if (folderBtn) {
        folderBtn.onclick = () => {
            const folder = folderBtn.dataset.folder;
            if (folder) window.api.openFolder(folder);
        };
    }

    // Attach restore/delete listeners
    attachRestoreListeners(lang);
}

function attachRestoreListeners(lang) {
    // Fallback if lang is undefined
    const safeLang = (lang === 'ar' || lang === 'en') ? lang : 'en';

    const confirmRestore = safeLang === 'ar'
        ? ' تحذير: استعادة النسخة ستحل محل بيانات الحفظ الحالية.\nيجب إغلاق اللعبة قبل الاستعادة.\n\nهل تريد المتابعة؟'
        : ' Warning: Restoring will overwrite your current save data.\nThe game must be closed before restoring.\n\nDo you want to proceed?';

    const confirmDelete = safeLang === 'ar'
        ? ' هل أنت متأكد من حذف هذه النسخة الاحتياطية؟\nلا يمكن التراجع عن هذا الإجراء.'
        : ' Are you sure you want to delete this backup? This action cannot be undone.';

    // Remove existing listeners to avoid duplicates
    document.querySelectorAll('.restore-backup-btn').forEach(btn => {
        btn.removeEventListener('click', restoreHandler);
        btn.addEventListener('click', restoreHandler);
    });

    document.querySelectorAll('.delete-backup-btn').forEach(btn => {
        btn.removeEventListener('click', deleteHandler);
        btn.addEventListener('click', deleteHandler);
    });

    async function restoreHandler(event) {
        const btn = event.currentTarget;
        const zipPath = btn.dataset.zip;
        const gameName = btn.dataset.game;

        if (!confirm(confirmRestore)) return;

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.style.opacity = '0.7';

        try {
            const result = await window.api.backup.restore(zipPath, gameName);
            if (result.success) {
                showToast('success',
                    safeLang === 'ar' ? 'تم الاستعادة بنجاح ✅' : 'Restored successfully ✅',
                    result.targetPath,
                    5000
                );
                const freshInfo = await window.api.backup.getInfo(gameName);
                updateBackupSidebarUI(freshInfo, gameName, safeLang);
            } else {
                showToast('error',
                    safeLang === 'ar' ? 'فشل الاستعادة' : 'Restore failed',
                    result.error || '',
                    5000
                );
            }
        } catch (err) {
            showToast('error',
                safeLang === 'ar' ? 'خطأ أثناء الاستعادة' : 'Restore error',
                err.message,
                5000
            );
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
    }

    async function deleteHandler(event) {
        const btn = event.currentTarget;
        const zipPath = btn.dataset.zip;
        const gameName = btn.dataset.game;

        if (!confirm(confirmDelete)) return;

        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.style.opacity = '0.7';

        try {
            const result = await window.api.backup.deleteBackup(gameName, zipPath);
            if (result.success) {
                showToast('success',
                    safeLang === 'ar' ? 'تم حذف النسخة ✅' : 'Backup deleted ✅',
                    '',
                    3000
                );
                const freshInfo = await window.api.backup.getInfo(gameName);
                updateBackupSidebarUI(freshInfo, gameName, safeLang);
            } else {
                showToast('error',
                    safeLang === 'ar' ? 'فشل الحذف' : 'Delete failed',
                    result.error || '',
                    5000
                );
            }
        } catch (err) {
            showToast('error',
                safeLang === 'ar' ? 'خطأ أثناء الحذف' : 'Delete error',
                err.message,
                5000
            );
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            btn.style.opacity = '1';
        }
    }
}

export function pulseBackupSuccess() {
    const el = document.getElementById('backupStatusValue');
    if (!el) return;

    el.style.transition = 'background 0.3s ease';
    el.style.background = 'rgba(16,185,129,0.12)';
    el.style.borderRadius = '6px';
    el.style.padding = '4px 6px';

    setTimeout(() => {
        el.style.background = 'transparent';
        el.style.padding = '0';
    }, 2000);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAILER BUTTON
// ─────────────────────────────────────────────────────────────────────────────

export function setupTrailerButton(media, gameName) {
    const btn = document.getElementById('watchTrailerBtn');
    if (!btn) return;

    const ytId = media?.trailerYouTubeId;
    const thumb = media?.trailerThumbnail;
    const targetUrl = ytId
        ? `https://www.youtube.com/watch?v=${ytId}`
        : media?.trailerSearchUrl;

    const freshBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(freshBtn, btn);

    if (!ytId || !thumb) {
        freshBtn.style.display = 'none';
        return;
    }

    freshBtn.style.display = 'block';
    const thumbImg = freshBtn.querySelector('#trailerThumbnail');
    if (thumbImg) thumbImg.src = toSafeUrl(thumb);

    freshBtn.onclick = () => { if (targetUrl) window.api.openExternal(targetUrl); };
}