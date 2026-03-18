let isGameRunning = false;

// Apply Language Function
function applyLanguage(lang) {
    document.getElementById('htmlRoot').dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.body.style.fontFamily = lang === 'ar' ? "'Cairo', sans-serif" : "'Poppins', sans-serif";
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dictionary[lang][key]) el.innerText = dictionary[lang][key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (dictionary[lang][key]) el.placeholder = dictionary[lang][key];
    });
}

// Load Settings on Startup
const userSettings = {
    appName: localStorage.getItem('appName') || 'Nexus Launcher',
    theme: localStorage.getItem('theme') || 'dark',
    lang: localStorage.getItem('lang') || 'ar',
    gridSize: localStorage.getItem('gridSize') || '260px' 
};

// Initialize UI
document.getElementById('fpsToggle').checked = localStorage.getItem('showFPS') === 'true';
document.getElementById('sidebarLogoName').innerText = userSettings.appName;
document.getElementById('appNameSetting').value = userSettings.appName;
document.getElementById('themeSetting').value = userSettings.theme;
if (userSettings.theme === 'light') document.body.classList.add('light-mode');
document.getElementById('langSetting').value = userSettings.lang;
applyLanguage(userSettings.lang);
document.getElementById('gridSizeSetting').value = userSettings.gridSize;
document.documentElement.style.setProperty('--grid-size', userSettings.gridSize);

// Save General Settings
document.getElementById('saveGeneralSettings').addEventListener('click', () => {
    const newName = document.getElementById('appNameSetting').value;
    const newTheme = document.getElementById('themeSetting').value;
    const newLang = document.getElementById('langSetting').value;
    const newGrid = document.getElementById('gridSizeSetting').value;
    localStorage.setItem('showFPS', document.getElementById('fpsToggle').checked);
    localStorage.setItem('appName', newName);
    localStorage.setItem('theme', newTheme);
    localStorage.setItem('lang', newLang);
    localStorage.setItem('gridSize', newGrid);
    document.getElementById('sidebarLogoName').innerText = newName;
    if (newTheme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
    document.documentElement.style.setProperty('--grid-size', newGrid);
    applyLanguage(newLang);
    alert(newLang === 'ar' ? "تم حفظ الإعدادات بنجاح!" : "Settings saved successfully!");
});

// Application State
const gamesContainer = document.getElementById('gamesContainer');
const favoritesContainer = document.getElementById('favoritesContainer');
const editModal = document.getElementById('editModal');
const gameNameInput = document.getElementById('gameNameInput');
const gamePathInput = document.getElementById('gamePathInput');
const customPosterInput = document.getElementById('customPosterInput');
const customLogoInput = document.getElementById('customLogoInput');
const customLogoBtn = document.getElementById('customLogoBtn');

let tempGamePath = ""; 
let editingGameId = null; 
let allGamesData = []; 
let currentTab = 'libraryArea'; 
let currentGameExePath = ""; 
let currentScreenshotsList = []; 
let currentScreenshotIndex = 0;  

// Create Game Card Element
function createGameCard(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.style.animationDelay = `${index * 0.03}s`; 
    card.setAttribute('data-title', game.name.toLowerCase());
    
    const isFav = game.isFavorite ? 'active-fav' : '';
    const favIcon = game.isFavorite ? 'fa-solid' : 'fa-regular';

    const posterUrl = game.assets?.poster || 'https://via.placeholder.com/260x390/1e293b/FFFFFF?text=' + encodeURIComponent(game.name);

    card.innerHTML = `
        <div class="game-actions">
            <button class="action-btn fav-btn ${isFav}" title="Favorite"><i class="${favIcon} fa-heart"></i></button>
            <button class="action-btn edit-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete-btn" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
        <img class="game-poster" src="${posterUrl}" alt="${game.name}">
        <div class="game-info"><div class="game-title">${game.name}</div></div>
    `;
    
    card.addEventListener('click', (e) => {
        if(!e.target.closest('.action-btn')) openGameDetailsPage(game);
    });

    card.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation(); 
        if (confirm(userSettings.lang === 'ar' ? `حذف "${game.name}"؟` : `Delete "${game.name}"?`)) {
            await window.api.deleteGame(game.id);
            renderGames();
        }
    });

    card.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation(); 
        editingGameId = game.id; 
        tempGamePath = game.path;
        gameNameInput.value = game.name;
        gamePathInput.value = game.path; 
        const currentPos = game.assets?.poster || "";
        customPosterInput.value = currentPos.startsWith('file:///') ? decodeURIComponent(currentPos.replace('file:///', '')) : "";
        
        const currentLogo = game.assets?.logo || "";
        customLogoInput.value = currentLogo.startsWith('file:///') ? decodeURIComponent(currentLogo.replace('file:///', '')) : "";

        const currentBg = game.assets?.background || "";
        
        document.getElementById('customBgInput').value = currentBg.startsWith('file:///') ? 
        decodeURIComponent(currentBg.replace('file:///', '')) : "";

        document.getElementById('saveGameModalBtn').innerText = userSettings.lang === 'ar' ? "حفظ التعديلات" : "Save Changes";
        editModal.style.display = 'flex';
        document.getElementById('launchArgsInput').value = game.arguments || "";
    });

    card.querySelector('.fav-btn').addEventListener('click', async (e) => {
        e.stopPropagation(); 
        game.isFavorite = !game.isFavorite; 
        await window.api.updateGame(game); 
        renderGames(); 
    });

    return card;
}

// Render all games
async function renderGames() {
    gamesContainer.innerHTML = ''; 
    favoritesContainer.innerHTML = '';
    try {
        allGamesData = await window.api.getGames();
        document.getElementById('gameCountDisplay').innerText = allGamesData.length;
        allGamesData.forEach((game, index) => {
            gamesContainer.appendChild(createGameCard(game, index));
            if(game.isFavorite) favoritesContainer.appendChild(createGameCard(game, index));
        });
    } catch (error) { console.error("Error loading games:", error); }
}

// Game Details Page Logic
async function openGameDetailsPage(game) {

    document.querySelectorAll('.page-area').forEach(page => page.classList.remove('active'));
    document.getElementById('mainTopbar').style.display = 'none';
    document.getElementById('gameDetailsArea').classList.add('active');

    document.getElementById('detailsGameTitle').innerText = game.name;
    currentGameExePath = game.path;

    const banner = document.getElementById('detailsBanner');
    const logoImg = document.getElementById('detailsLogo');
    const mediaContainer = document.getElementById('detailsMediaContainer');
    
    const initialBg = game.assets?.background || game.assets?.poster || "";
    banner.style.backgroundImage = `url('${initialBg}')`; 
    if (logoImg) {
        logoImg.src = ""; 
        logoImg.style.display = 'none';
    }

    if (game.assets?.background) {
        banner.style.backgroundImage = `url('${game.assets.background}')`;
    } else {
        // إذا لم توجد خلفية، نستخدم البوستر كخلفية مؤقتة (Fallback)
        banner.style.backgroundImage = `url('${game.assets.poster}')`;
        }

    if (!game.metadata || !game.metadata.description || game.metadata.description === "") {
        document.getElementById('detailsDescription').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching details...';
        

        const freshData = await window.api.fetchGameDetails(game.name);
        
        if (freshData) {
            await window.api.saveGameDetails(game.id, freshData);
            
            game.assets = freshData.assets;
            game.metadata = freshData.metadata;
        }
    }

    const assets = game.assets || {};
    const meta = game.metadata || {};

    if (assets.background) {
        banner.style.backgroundImage = `url('${assets.background}')`;
    }

    if (assets.logo && logoImg) {
        logoImg.src = assets.logo;
        logoImg.style.display = 'block';
    } else if (logoImg) {
        logoImg.style.display = 'none';
    }

    document.getElementById('detailsDescription').innerHTML = meta.description || "No description available.";
    document.getElementById('detailsDev').innerText = meta.developer || "N/A";
    document.getElementById('detailsPub').innerText = meta.publisher || "N/A";
    document.getElementById('detailsRelease').innerText = meta.releaseDate || "N/A";

    if (mediaContainer) {
        mediaContainer.innerHTML = ''; 
        
        if (meta.media?.trailer) {
            mediaContainer.innerHTML += `
                <div class="video-wrapper">
                    <video controls class="media-main-video" poster="${assets.background}">
                        <source src="${meta.media.trailer}" type="video/webm">
                    </video>
                </div>`;
        }
        
        if (meta.media?.screenshots && meta.media.screenshots.length > 0) {
            currentScreenshotsList = meta.media.screenshots;
            let ssHtml = '<div class="screenshots-grid">';
            meta.media.screenshots.forEach((ss, index) => {
                ssHtml += `<img src="${ss}" alt="Screenshot" onclick="openLightbox(${index})" loading="lazy">`;
            });
            ssHtml += '</div>';
            mediaContainer.innerHTML += ssHtml;
        }
    }

    const reqMinEl = document.getElementById('reqMin');
    const reqRecEl = document.getElementById('reqRec');
    
    if (reqMinEl && reqRecEl) {
        reqMinEl.innerHTML = meta.systemRequirements?.minimum || "N/A";
        reqRecEl.innerHTML = meta.systemRequirements?.recommended || "N/A";
    }
}

// Lightbox Functions
function openLightbox(index) {
    currentScreenshotIndex = index;
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImage');
    lightboxImg.src = currentScreenshotsList[currentScreenshotIndex];
    lightbox.classList.add('show');
}
document.getElementById('closeLightbox').addEventListener('click', () => document.getElementById('imageLightbox').classList.remove('show'));
document.getElementById('prevLightbox').addEventListener('click', (e) => {
    e.stopPropagation();
    currentScreenshotIndex = (currentScreenshotIndex > 0) ? currentScreenshotIndex - 1 : currentScreenshotsList.length - 1;
    document.getElementById('lightboxImage').src = currentScreenshotsList[currentScreenshotIndex];
});
document.getElementById('nextLightbox').addEventListener('click', (e) => {
    e.stopPropagation();
    currentScreenshotIndex = (currentScreenshotIndex < currentScreenshotsList.length - 1) ? currentScreenshotIndex + 1 : 0;
    document.getElementById('lightboxImage').src = currentScreenshotsList[currentScreenshotIndex];
});
document.getElementById('imageLightbox').addEventListener('click', (e) => {
    if (e.target.id === 'imageLightbox') document.getElementById('imageLightbox').classList.remove('show');
});

// Sidebar Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        this.classList.add('active');
        document.querySelectorAll('.page-area').forEach(page => page.classList.remove('active'));
        const targetArea = this.getAttribute('data-target');
        document.getElementById(targetArea).classList.add('active');
        currentTab = targetArea;
        document.getElementById('mainTopbar').style.display = targetArea === 'settingsArea' ? 'none' : 'flex';
    });
});

document.getElementById('backToLibraryBtn').addEventListener('click', () => {
    document.getElementById('gameDetailsArea').classList.remove('active');
    document.getElementById(currentTab).classList.add('active');
    if(currentTab !== 'settingsArea') document.getElementById('mainTopbar').style.display = 'flex';
});

// Play Button
document.getElementById('detailsPlayBtn').addEventListener('click', () => {
    if (isGameRunning) return;

    if (currentGameExePath) {
        const showFPS = localStorage.getItem('showFPS') === 'true';
        const currentGame = allGamesData.find(g => g.path === currentGameExePath);

        if (currentGame) {
            isGameRunning = true;
            const playBtn = document.getElementById('detailsPlayBtn');
            playBtn.disabled = true;
            playBtn.style.opacity = "0.6";
            playBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${userSettings.lang === 'ar' ? 'جاري التشغيل...' : 'Running...'}`;

            window.api.launchGame(currentGame.path, showFPS, currentGame.arguments || "", currentGame.id);
        }
    }
});

document.getElementById('detailsFolderBtn').addEventListener('click', () => {
    if (currentGameExePath) window.api.openFolder(currentGameExePath);
});

document.getElementById('searchInput').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const cards = document.querySelectorAll('.game-card');
    cards.forEach(card => card.style.display = card.getAttribute('data-title').includes(searchTerm) ? 'block' : 'none');
});

// Add/Edit Game Logic
document.getElementById('addGameBtn').addEventListener('click', async () => {
    const selectedPath = await window.api.selectGame();
    if (selectedPath) {
        editingGameId = null; 
        tempGamePath = selectedPath;
        gamePathInput.value = selectedPath; 
        
        const pathParts = selectedPath.split(/[/\\]/).filter(Boolean);
        let rawName = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0];

        rawName = rawName
        .replace(/[-_.]/g, ' ')
        .replace(/\b(repack|fitgirl|empress|codex|skidrow)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

        gameNameInput.value = rawName;
        customLogoInput.value = "";
        
        customPosterInput.value = ""; 
        document.getElementById('saveGameModalBtn').innerText = userSettings.lang === 'ar' ? "إضافة وبحث" : "Add & Search";
        editModal.style.display = 'flex';
    }
});

document.getElementById('changePathBtn').addEventListener('click', async () => {
    const newPath = await window.api.selectGame();
    if (newPath) { 
        tempGamePath = newPath; 
        gamePathInput.value = newPath; 
        if (!gameNameInput.value.trim()) {
            const pathParts = newPath.split(/[/\\]/).filter(Boolean);
            gameNameInput.value = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0].split('.')[0];
        }
    }
});

document.getElementById('customImageBtn').addEventListener('click', async () => {
    const imagePath = await window.api.selectImage();
    if (imagePath) customPosterInput.value = imagePath; 
});

customLogoBtn.addEventListener('click', async () => {
    const imagePath = await window.api.selectImage();
    if (imagePath) customLogoInput.value = imagePath; 
});

document.getElementById('cancelModalBtn').addEventListener('click', () => editModal.style.display = 'none');

document.getElementById('saveGameModalBtn').addEventListener('click', async () => {
    const finalName = gameNameInput.value.trim();
    if (!finalName || !tempGamePath) return; 

    const btn = document.getElementById('saveGameModalBtn');
    const originalBtnText = btn.innerText;
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        let customImage = customPosterInput.value.trim();
        let customLogo = customLogoInput.value.trim(); 
        let customBg = document.getElementById('customBgInput').value.trim();
        const launchArgs = document.getElementById('launchArgsInput').value.trim();
        
        const existingGame = editingGameId ? allGamesData.find(g => g.id === editingGameId) : null;

        let finalAssets = existingGame ? { ...existingGame.assets } : { poster: "", background: "", logo: "" };
        let finalMetadata = existingGame ? { ...existingGame.metadata } : {};


        if (customImage !== "") {

            finalAssets.poster = customImage.startsWith('file:///') ? customImage : "file:///" + customImage.replace(/\\/g, '/');
        } else if (existingGame && (existingGame.name !== finalName || existingGame.assets.poster.startsWith('file:///'))) {

            const freshInfo = await window.api.fetchGameInfo(finalName);
            finalAssets.poster = freshInfo?.poster || "";
        }

        if (customLogo !== "") {

            finalAssets.logo = customLogo.startsWith('file:///') ? customLogo : "file:///" + customLogo.replace(/\\/g, '/');
        } else {
            const freshDetails = await window.api.fetchGameDetails(finalName);
            if (freshDetails && freshDetails.assets) {
                finalAssets.logo = freshDetails.assets.logo;
                finalAssets.background = freshDetails.assets.background; 
                finalMetadata = freshDetails.metadata;
            } else {
                finalAssets.logo = "";
            }
        }

        if (customBg !== "") {
            finalAssets.background = customBg.startsWith('file:///') ? customBg : "file:///" + customBg.replace(/\\/g, '/');
        } else {
            // إذا حذفها المستخدم، نطلب من الـ API جلب الخلفية التلقائية
            finalAssets.background = ""; // تصفير مؤقت
            const freshDetails = await window.api.fetchGameDetails(finalName);
            if (freshDetails && freshDetails.assets) {
            finalAssets.background = freshDetails.assets.background;
            }
        }

        if (existingGame && existingGame.name !== finalName) {
            finalMetadata = {}; 
        }

        const gameData = {
            id: editingGameId || Date.now(),
            name: finalName,
            path: tempGamePath,
            arguments: launchArgs,
            isFavorite: existingGame ? existingGame.isFavorite : false,
            assets: finalAssets,
            metadata: finalMetadata
        };

        if (editingGameId) {
            await window.api.updateGame(gameData);
        } else {
            await window.api.saveGame(gameData);
        }
        
        editModal.style.display = 'none';
        await renderGames();

    } catch (error) { 
        console.error("Critical Save Error:", error);
        alert(userSettings.lang === 'ar' ? "فشل الحفظ، تحقق من الاتصال" : "Save failed, check your connection");
    } finally {
        btn.disabled = false;
        btn.innerText = userSettings.lang === 'ar' ? "حفظ التعديلات" : "Save Changes";
    }
});

renderGames();


document.getElementById('removePosterBtn').addEventListener('click', () => {
    document.getElementById('customPosterInput').value = "";

    console.log("Poster path cleared. API will fetch a new one on save.");
});

document.getElementById('removeLogoBtn').addEventListener('click', () => {
    document.getElementById('customLogoInput').value = "";

    console.log("Logo cleared, will revert to auto-fetch on save.");
});

document.getElementById('customBgBtn').addEventListener('click', async () => {
    const imagePath = await window.api.selectImage();
    if (imagePath) document.getElementById('customBgInput').value = imagePath; 
});

document.getElementById('removeBgBtn').addEventListener('click', () => {
    document.getElementById('customBgInput').value = "";
    console.log("Background cleared.");
});

// Developer & Shortcuts Logic
document.addEventListener('DOMContentLoaded', () => {
    const logo = document.querySelector('.logo');
    const devModal = document.getElementById('devModal');
    if (logo && devModal) {
        logo.addEventListener('click', () => devModal.classList.add('show'));
        devModal.addEventListener('click', (e) => { if (e.target === devModal) devModal.classList.remove('show'); });
    }
    document.querySelectorAll('#devModal a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.api && window.api.openExternal) window.api.openExternal(e.currentTarget.href);
        });
    });
});

function handleGoBack() {
    const detailsArea = document.getElementById('gameDetailsArea');
    if (detailsArea && detailsArea.classList.contains('active')) document.getElementById('backToLibraryBtn').click();
}

document.addEventListener('keydown', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;
    const lightbox = document.getElementById('imageLightbox');
    const isImageViewerOpen = lightbox && lightbox.classList.contains('show'); 

    switch(event.key) {
        case 'ArrowRight': if (isImageViewerOpen) document.getElementById('nextLightbox').click(); break;
        case 'ArrowLeft': if (isImageViewerOpen) document.getElementById('prevLightbox').click(); break;
        case 'Escape': if (isImageViewerOpen) document.getElementById('closeLightbox').click(); else handleGoBack(); break;
        case 'Backspace': if (!isImageViewerOpen) handleGoBack(); break;
        case 'Enter':
            const detailsArea = document.getElementById('gameDetailsArea');
            if (detailsArea && detailsArea.classList.contains('active') && !isImageViewerOpen) document.getElementById('detailsPlayBtn').click();
            break;
    }
});

document.addEventListener('mouseup', (event) => {
    if (event.button === 3) {
        event.preventDefault();
        const lightbox = document.getElementById('imageLightbox');
        if (lightbox && lightbox.classList.contains('show')) document.getElementById('closeLightbox').click();
        else handleGoBack();
    }
});

document.addEventListener('wheel', (event) => {
    const lightbox = document.getElementById('imageLightbox');
    if (lightbox && lightbox.classList.contains('show')) {
        if (event.deltaY > 0) document.getElementById('nextLightbox').click();
        else if (event.deltaY < 0) document.getElementById('prevLightbox').click();
    }
});

// Game Event Listeners
window.api.onGameError((data) => {
    console.error("Game Launch Error:", data);
    const errorModal = document.createElement('div');
    errorModal.className = 'custom-error-modal';
    errorModal.innerHTML = `
        <div class="error-content">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <h3>Game Execution Error</h3>
            <p>${data.message}</p>
            <small>Exit Code: ${data.code || 'Unknown'}</small>
            <button onclick="this.parentElement.parentElement.remove()">Dismiss</button>
        </div>
    `;
    document.body.appendChild(errorModal);
});

window.api.onGameStopped((data) => {
    isGameRunning = false; 
    const playBtn = document.getElementById('detailsPlayBtn');
    if (playBtn) {
        playBtn.disabled = false;
        playBtn.style.opacity = "1";
        const btnText = userSettings.lang === 'ar' ? 'إلعب الآن' : 'Play';
        playBtn.innerHTML = `<i class="fa-solid fa-play"></i> ${btnText}`;
    }
});