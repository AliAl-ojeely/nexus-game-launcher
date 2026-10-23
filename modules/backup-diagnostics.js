'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createBackupLogger(userData, io = fs) {
  const logDir = path.join(userData, 'logs');
  const logFile = path.join(logDir, 'backup-events.jsonl');
  function emit(level, code, message, context = {}) {
    const event = {
      id: randomUUID(), time: new Date().toISOString(), level,
      code: String(code || 'UNKNOWN').slice(0, 80),
      message: String(message || 'Unknown backup issue').slice(0, 1500),
      context: {
        operation: String(context.operation || 'unknown').slice(0, 80),
        game: String(context.game || '').slice(0, 160),
      },
    };
    try {
      io.mkdirSync(logDir, { recursive: true });
      if (io.existsSync(logFile) && io.statSync(logFile).size > 2 * 1024 * 1024) {
        const old = logFile + '.1';
        if (io.existsSync(old)) io.unlinkSync(old);
        io.renameSync(logFile, old);
      }
      io.appendFileSync(logFile, JSON.stringify(event) + '\n', 'utf8');
      return { eventId: event.id, logged: true };
    } catch (error) {
      console.error('[Backup Diagnostics] LOG WRITE FAILED', error, event);
      return { eventId: event.id, logged: false, logError: String(error.message || error) };
    }
  }
  return { emit, logFile };
}
module.exports = { createBackupLogger };
