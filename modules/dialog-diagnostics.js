// Diagnostics for all renderer dialog / operation errors (never game saves).
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { app } = require('electron');

function reportDialogIssue(issue = {}) {
    const eventId = randomUUID();
    const input = issue && typeof issue === 'object' ? issue : {};
    const safe = value => String(value ?? '').slice(0, 8192);
    const entry = {
        timestamp: new Date().toISOString(), eventId,
        source: 'NexusGlobalDialog',
        code: safe(input.code || 'DIALOG_OPERATION_FAILED').slice(0, 80),
        context: safe(input.context).slice(0, 160),
        message: safe(input.message),
    };
    try {
        const dir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, 'dialog-events.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
        return { logged: true, eventId };
    } catch (error) {
        console.error('[Nexus Dialog] Failed to write diagnostic log:', error);
        return { logged: false, eventId, logError: error.message };
    }
}

module.exports = { reportDialogIssue };
