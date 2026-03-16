const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'games.json');

function initDB() {
    if (!fs.existsSync(dbPath)) {
        try { fs.writeFileSync(dbPath, '[]', 'utf-8'); } 
        catch (err) { console.error("Failed to create initial JSON file:", err); }
    }
}

function getGames() {
    try {
        if (!fs.existsSync(dbPath)) return [];
        let games = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        // إزالة خاصية playtime إن وُجدت من الألعاب القديمة لتنظيف البيانات
        games = games.map(g => { delete g.playtime; delete g.playTime; return g; });
        return games;
    } catch (err) { return []; }
}

function saveGame(newGame) {
    try {
        const data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data.push(newGame);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
}

function updateGame(updatedGame) {
    try {
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data = data.map(g => g.id === updatedGame.id ? updatedGame : g);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
}

function deleteGame(gameId) {
    try {
        let data = JSON.parse(fs.readFileSync(dbPath, 'utf-8') || '[]');
        data = data.filter(g => g.id !== gameId);
        fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
        return true;
    } catch (err) { return false; }
}

function saveGameDetails(gameId, details) {
    try {
        const data = fs.readFileSync(dbPath, 'utf-8');
        let games = JSON.parse(data);
        const gameIndex = games.findIndex(g => g.id === gameId);
        if (gameIndex !== -1) {
            games[gameIndex].fetchedDetails = details;
            fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
            return { success: true };
        }
        return { success: false };
    } catch (error) { return { success: false, error: error.message }; }
}

module.exports = { initDB, getGames, saveGame, updateGame, deleteGame, saveGameDetails };