// render/backup-ui.js

export function updateBackupSidebarUI(bInfo, gameName, lang) {
    const el = document.getElementById('backupStatusValue');
    if (!el) return;

    if (!bInfo?.lastBackupDate) {
        el.innerHTML = `<small style="color:var(--text-muted); opacity:0.5;">
            ${lang === 'ar' ? 'لم يتم الحفظ بعد' : 'Not backed up yet'}
        </small>`;
        return;
    }

    const folderTip = lang === 'ar' ? 'افتح مجلد النسخ' : 'Show backup folder';
    const zipFolder = bInfo.config?.backupPath
        ? `${bInfo.config.backupPath}\\NexusBackups\\${gameName.replace(/[<>:"/\\|?*]/g, '_').trim()}`
        : null;

    // Build the list of all backups
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
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <small style="font-size: 11px; color:var(--text-muted); word-break: break-all;">${backup.fileName}${dateLabel}</small>
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
                </div>
            `;
        });
        backupsHtml += `</div></div>`;
    }

    el.innerHTML = `
        <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
            <i class="fa-solid fa-circle-check" style="color:#10b981; font-size:12px;"></i>
            <small style="color:var(--text-muted);">
                ${lang === 'ar' ? 'آخر نسخة' : 'Last Backup'}: 
                <strong style="color:var(--text-main);">${bInfo.lastBackupDate}</strong>
            </small>
            <small style="color:var(--text-muted); opacity:0.6;">(${bInfo.backupCounter} ${lang === 'ar' ? 'نسخة' : 'backups'})</small>
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
        ${backupsHtml}
    `;

    // Folder button listener
    const folderBtn = document.getElementById('openBackupFolderBtn');
    if (folderBtn) {
        folderBtn.onclick = () => {
            const folder = folderBtn.dataset.folder;
            if (folder) window.api.openFolder(folder);
        };
    }

    // Attach restore button listeners
    attachRestoreListeners(lang);
}

function attachRestoreListeners(lang) {
    const confirmMessage = lang === 'ar'
        ? '⚠️ تحذير: استعادة النسخة ستحل محل بيانات الحفظ الحالية.\nيجب إغلاق اللعبة قبل الاستعادة.\n\nهل تريد المتابعة؟'
        : '⚠️ Warning: Restoring will overwrite your current save data.\nThe game must be closed before restoring.\n\nDo you want to proceed?';

    document.querySelectorAll('.restore-backup-btn').forEach(btn => {
        // Remove any existing listener to avoid duplicates
        btn.removeEventListener('click', restoreHandler);
        btn.addEventListener('click', restoreHandler);
    });

    async function restoreHandler(event) {
        const btn = event.currentTarget;
        const zipPath = btn.dataset.zip;
        const gameName = btn.dataset.game;

        if (!confirm(confirmMessage)) return;

        // Disable button and show spinner
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.style.opacity = '0.7';

        try {
            const result = await window.api.backup.restore(zipPath, gameName);
            if (result.success) {
                showToast('success',
                    lang === 'ar' ? 'تم الاستعادة بنجاح ✅' : 'Restored successfully ✅',
                    result.targetPath,
                    5000
                );
            } else {
                showToast('error',
                    lang === 'ar' ? 'فشل الاستعادة' : 'Restore failed',
                    result.error || '',
                    5000
                );
            }
        } catch (err) {
            showToast('error',
                lang === 'ar' ? 'خطأ أثناء الاستعادة' : 'Restore error',
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

function showToast(type, message, sub, duration) {
    // Use existing global toast if available, otherwise fallback
    if (typeof window.showToast === 'function') {
        window.showToast(type, message, sub, duration);
    } else {
        console.log(`[Toast] ${type}: ${message} - ${sub}`);
        alert(message);
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