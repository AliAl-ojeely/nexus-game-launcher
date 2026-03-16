const axios = require('axios');

async function fetchGameInfo(gameName) {
    try {
        const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
        const response = await axios.get(url);
        if (response.data && response.data.total > 0) {
            const game = response.data.items[0];
            return {
                name: game.name,
                poster: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.id}/library_600x900.jpg`
            };
        }
    } catch (err) { console.error("Steam API Error:", err.message); }
    return null;
}

async function fetchGameDetails(gameName) {
    try {
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
        const searchResponse = await axios.get(searchUrl);
        if (searchResponse.data && searchResponse.data.total > 0) {
            const appId = searchResponse.data.items[0].id;
            const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`;
            const detailsResponse = await axios.get(detailsUrl);
            if (detailsResponse.data[appId].success) {
                const gameData = detailsResponse.data[appId].data;
                let trailerUrl = "";
                if (gameData.movies && gameData.movies.length > 0) {
                    trailerUrl = gameData.movies[0].webm?.max || gameData.movies[0].mp4?.max || "";
                }
                return {
                    description: gameData.short_description || "No description available.",
                    developer: gameData.developers ? gameData.developers.join(', ') : "Unknown",
                    publisher: gameData.publishers ? gameData.publishers.join(', ') : "Unknown",
                    releaseDate: gameData.release_date ? gameData.release_date.date : "Unknown",
                    background: gameData.background_raw || gameData.background || "",
                    media: { trailer: trailerUrl, screenshots: gameData.screenshots ? gameData.screenshots.map(ss => ss.path_full) : [] },
                    systemRequirements: {
                        minimum: gameData.pc_requirements?.minimum || "Not Available",
                        recommended: gameData.pc_requirements?.recommended || "Not Available"
                    }
                };
            }
        }
    } catch (err) { console.error("Steam Details API Error:", err.message); }
    return null; 
}

module.exports = { fetchGameInfo, fetchGameDetails };