const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const ptPath = path.join(app.getPath('userData'), 'playTime.json');

function initPlaytimeDB() {
    if (!fs.existsSync(ptPath)) {
        try { fs.writeFileSync(ptPath, '{}', 'utf-8'); }
        catch (err) { console.error("[Playtime DB] Init Error:", err); }
    }
}

function getPlaytime(gameName) {
    try {
        if (!fs.existsSync(ptPath)) return 0;
        const content = fs.readFileSync(ptPath, 'utf-8');
        if (!content.trim()) return 0;

        let data = JSON.parse(content);

        // 🛡️ حماية ضد المصفوفات
        if (Array.isArray(data)) return 0;

        return data[gameName] || 0;
    } catch (err) {
        return 0;
    }
}

function addPlaytime(gameName, minutes) {
    try {
        if (!fs.existsSync(ptPath)) initPlaytimeDB();

        const content = fs.readFileSync(ptPath, 'utf-8');
        let data = content.trim() ? JSON.parse(content) : {};

        // 🚨 الحل الجذري للكارثة: إذا وجد الكود [] سيحولها فوراً إلى {}
        if (Array.isArray(data)) {
            data = {};
        }

        if (!data[gameName]) data[gameName] = 0;
        data[gameName] += minutes;

        fs.writeFileSync(ptPath, JSON.stringify(data, null, 2));

        console.log(`\n✅ [Playtime DB] Saved to: ${ptPath}`);
        console.log(`[Playtime DB] ${gameName} -> ${data[gameName]} mins\n`);

        return data[gameName];
    } catch (err) {
        console.error("[Playtime DB] Write Error:", err);
        return false;
    }
}

module.exports = { initPlaytimeDB, getPlaytime, addPlaytime };