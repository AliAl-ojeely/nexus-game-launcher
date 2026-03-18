const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const dbPath = path.join(app.getPath('userData'), 'games.json');

function initDB() {
    if (!fs.existsSync(dbPath)) {
        try { fs.writeFileSync(dbPath, '[]', 'utf-8'); } 
        catch (err) { console.error("Database initialization failed:", err); }
    }
}

function getGames() {
    try {
        if (!fs.existsSync(dbPath)) return [];
        const content = fs.readFileSync(dbPath, 'utf-8');
        let games = JSON.parse(content || '[]');

        return games.map(game => {
            // Migration: تحويل البيانات القديمة للهيكلية الجديدة Assets/Metadata
            if (!game.assets) {
                game.assets = {
                    poster: game.poster || "",
                    background: game.background || (game.fetchedDetails ? game.fetchedDetails.background : ""),
                    logo: game.logo || ""
                };
            }
            if (!game.metadata) {
                const oldDetails = game.fetchedDetails || {};
                game.metadata = {
                    description: oldDetails.description || "",
                    developer: oldDetails.developer || "N/A",
                    publisher: oldDetails.publisher || "N/A",
                    releaseDate: oldDetails.releaseDate || "N/A",
                    systemRequirements: oldDetails.systemRequirements || {},
                    media: oldDetails.media || { trailer: "", screenshots: [] }
                };
            }
            delete game.fetchedDetails; // تنظيف الكائن القديم
            return game;
        });
    } catch (err) { return []; }
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
            assets: newGame.assets || { poster: newGame.poster || "", background: "", logo: "" },
            metadata: newGame.metadata || { description: "", developer: "N/A", publisher: "N/A", releaseDate: "N/A", systemRequirements: {}, media: { trailer: "", screenshots: [] } }
        };
        games.push(formattedGame);
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function updateGame(updatedGame) {
    try {
        let games = getGames();
        games = games.map(g => g.id == updatedGame.id ? updatedGame : g);
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function deleteGame(gameId) {
    try {
        let games = getGames();
        games = games.filter(g => g.id != gameId);
        fs.writeFileSync(dbPath, JSON.stringify(games, null, 2));
        return true;
    } catch (err) { return false; }
}

function saveGameDetails(gameId, fetchedData) {
    try {
        let games = getGames();
        const index = games.findIndex(g => g.id == gameId);
        
        if (index !== -1 && fetchedData) {
            // هنا كان الخطأ: يجب الوصول لـ assets و metadata داخل fetchedData
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
    } catch (error) { 
        console.error("Save Details Error:", error);
        return { success: false, error: error.message }; 
    }
}

module.exports = { initDB, getGames, saveGame, updateGame, deleteGame, saveGameDetails };