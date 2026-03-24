const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const playtimeDB = require('./playtime');

const dbPath = path.join(app.getPath('userData'), 'games.json');

function initDB() {
    if (!fs.existsSync(dbPath)) {
        try { fs.writeFileSync(dbPath, '[]', 'utf-8'); }
        catch (err) { console.error("[Database] Init Error:", err); }
    }
}

function getGames() {
    try {
        if (!fs.existsSync(dbPath)) return [];
        const content = fs.readFileSync(dbPath, 'utf-8');
        let games = JSON.parse(content || '[]');

        return games.map(game => {
            if (!game.assets) game.assets = { poster: "", background: "", logo: "" };
            if (!game.metadata) game.metadata = { description: "", developer: "N/A", publisher: "N/A", releaseDate: "N/A", systemRequirements: {}, media: { screenshots: [] } };

            // ✨ السحر هنا: دمج الوقت ديناميكياً من ملف playTime.json
            game.playtime = playtimeDB.getPlaytime(game.name);
            
            delete game.fetchedDetails;
            return game;
        });
    } catch (err) { return []; }
}

function updateGame(updatedGame) {
    try {
        let games = getGames();
        games = games.map(g => {
            if (String(g.id) === String(updatedGame.id)) {
                const tempGame = { ...g, ...updatedGame };
                delete tempGame.playtime; // 🧹 تنظيف: لا تحفظ الوقت في games.json أبداً
                return tempGame;
            }
            return g;
        });
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function saveGame(newGame) {
    try {
        const games = getGames();
        const formattedGame = {
            id: newGame.id || Date.now(),
            name: newGame.name,
            path: newGame.path,
            arguments: newGame.arguments || "",
            isFavorite: newGame.isFavorite || false,
            assets: newGame.assets || { poster: "", background: "", logo: "" },
            metadata: newGame.metadata || { description: "", developer: "N/A", publisher: "N/A", releaseDate: "N/A", systemRequirements: {}, media: { screenshots: [] } }
        };
        // لاحظ لم نضف playtime هنا أبداً
        games.push(formattedGame);
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function deleteGame(gameId) {
    try {
        let games = getGames();
        games = games.filter(g => String(g.id) !== String(gameId));
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function saveGameDetails(gameId, fetchedData) {
    try {
        let games = getGames();
        const index = games.findIndex(g => String(g.id) === String(gameId));

        if (index !== -1 && fetchedData) {
            games[index].assets = {
                poster: fetchedData.assets?.poster || games[index].assets.poster,
                background: fetchedData.assets?.background || games[index].assets.background,
                logo: fetchedData.assets?.logo || games[index].assets.logo
            };
            games[index].metadata = fetchedData.metadata || games[index].metadata;
            fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
            return { success: true };
        }
        return { success: false, error: "Game not found" };
    } catch (error) { return { success: false, error: error.message }; }
}

module.exports = { initDB, getGames, saveGame, updateGame, deleteGame, saveGameDetails };