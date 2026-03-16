// Localization Dictionary
const dictionary = {
    ar: {
        nav_library: "مكتبة الألعاب", nav_favorites: "المفضلة", nav_settings: "الإعدادات",
        total_games: "إجمالي الألعاب المثبتة", search_placeholder: "ابحث في مكتبتك...",
        btn_add_game: "إضافة لعبة", title_favorites: "ألعابي المفضلة", title_settings: "إعدادات اللانشر",
        set_app_name: "اسم اللانشر:", set_theme: "المظهر (Theme):", theme_dark: "مظلم", theme_light: "فاتح",
        set_lang: "اللغة (Language):", set_grid: "حجم البطاقات:", grid_small: "صغير", grid_medium: "متوسط", grid_large: "كبير",
        btn_save_settings: "حفظ الإعدادات", modal_title: "بيانات اللعبة", modal_game_name: "اسم اللعبة (للبحث في Steam):",
        modal_game_path: "مسار الملف (.exe):", modal_btn_change: "تغيير", modal_custom_poster: "صورة الغلاف (اختياري):", modal_btn_image: "تحديد",
        modal_btn_save: "حفظ", modal_btn_cancel: "إلغاء", copy: "نسخ", paste: "لصق", cut: "قص",
        btn_back: "رجوع", btn_play: "إلعب الآن", title_description: "وصف اللعبة",
        meta_developer: "المطور", meta_publisher: "الناشر", meta_release: "تاريخ الإصدار",
        title_media: "الوسائط", title_requirements: "متطلبات التشغيل",
        set_fps: "إظهار عداد الأداء (FPS):", fps_desc: "تفعيل عداد الإطارات داخل اللعبة",
        btn_folder: "مجلد اللعبة", modal_launch_args: "خيارات التشغيل (اختياري):"
    },
    en: {
        nav_library: "Game Library", nav_favorites: "Favorites", nav_settings: "Settings",
        total_games: "Total Installed Games", search_placeholder: "Search your library...",
        btn_add_game: "Add Game", title_favorites: "My Favorites", title_settings: "Launcher Settings",
        set_app_name: "Launcher Name:", set_theme: "Theme:", theme_dark: "Dark", theme_light: "Light",
        set_lang: "Language:", set_grid: "Grid Size:", grid_small: "Small", grid_medium: "Medium", grid_large: "Large",
        btn_save_settings: "Save Settings", modal_title: "Game Details", modal_game_name: "Game Name:",
        modal_game_path: "Executable Path:", modal_btn_change: "Browse", modal_custom_poster: "Custom Poster:", modal_btn_image: "Select",
        modal_btn_save: "Save", modal_btn_cancel: "Cancel", copy: "Copy", paste: "Paste", cut: "Cut",
        btn_back: "Back", btn_play: "Play", title_description: "Description",
        meta_developer: "Developer", meta_publisher: "Publisher", meta_release: "Release Date",
        title_media: "Media", title_requirements: "System Requirements",
        set_fps: "Show Performance HUD:", fps_desc: "Enable FPS Counter in-game",
        btn_folder: "Game Folder", modal_launch_args: "Launch Arguments (Optional):"
    }
};

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

    card.innerHTML = `
        <div class="game-actions">
            <button class="action-btn fav-btn ${isFav}" title="Favorite"><i class="${favIcon} fa-heart"></i></button>
            <button class="action-btn edit-btn" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="action-btn delete-btn" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
        <img class="game-poster" src="${game.poster || 'https://via.placeholder.com/260x390/1e293b/FFFFFF?text=' + encodeURIComponent(game.name)}" alt="${game.name}">
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
        customPosterInput.value = game.poster && game.poster.startsWith('file:///') ? decodeURIComponent(game.poster.replace('file:///', '')) : "";
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
    banner.style.backgroundImage = `url('${game.poster}')`; 

    const mediaContainer = document.getElementById('detailsMediaContainer');
    const reqMin = document.getElementById('reqMin');
    const reqRec = document.getElementById('reqRec');

    let detailsToDisplay = null;

    if (game.fetchedDetails) {
        detailsToDisplay = game.fetchedDetails;
    } else {
        document.getElementById('detailsDescription').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Fetching from Steam...';
        document.getElementById('detailsDev').innerText = '...';
        document.getElementById('detailsPub').innerText = '...';
        document.getElementById('detailsRelease').innerText = '...';
        
        if(mediaContainer) mediaContainer.innerHTML = '';
        if(reqMin) reqMin.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        if(reqRec) reqRec.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

        const details = await window.api.fetchGameDetails(game.name);
        
        if (details) {
            detailsToDisplay = details;
            if (window.api.saveGameDetails) await window.api.saveGameDetails(game.id, detailsToDisplay);
            game.fetchedDetails = detailsToDisplay;
        }
    }

    if (detailsToDisplay) {
        if(detailsToDisplay.background) banner.style.backgroundImage = `url('${detailsToDisplay.background}')`;

        document.getElementById('detailsDescription').innerHTML = detailsToDisplay.description;
        document.getElementById('detailsDev').innerText = detailsToDisplay.developer;
        document.getElementById('detailsPub').innerText = detailsToDisplay.publisher;
        document.getElementById('detailsRelease').innerText = detailsToDisplay.releaseDate;

        if (mediaContainer) {
            mediaContainer.innerHTML = ''; 
            if (detailsToDisplay.media.trailer) {
                mediaContainer.innerHTML += `
                    <video controls class="media-main-video" poster="${detailsToDisplay.background || game.poster}">
                        <source src="${detailsToDisplay.media.trailer}" type="video/webm">
                        <source src="${detailsToDisplay.media.trailer.replace('.webm', '.mp4')}" type="video/mp4">
                    </video>`;
            }
            if (detailsToDisplay.media.screenshots && detailsToDisplay.media.screenshots.length > 0) {
                currentScreenshotsList = detailsToDisplay.media.screenshots;
                let ssHtml = '<div class="screenshots-grid">';
                detailsToDisplay.media.screenshots.forEach((ss, index) => {
                    ssHtml += `<img src="${ss}" alt="Screenshot" onclick="openLightbox(${index})">`;
                });
                ssHtml += '</div>';
                mediaContainer.innerHTML += ssHtml;
            }
        }

        if (reqMin && reqRec) {
            reqMin.innerHTML = detailsToDisplay.systemRequirements.minimum || "N/A";
            reqRec.innerHTML = detailsToDisplay.systemRequirements.recommended || "N/A";
        }
    } else {
        document.getElementById('detailsDescription').innerText = "Game not found. Please check the name.";
        document.getElementById('detailsDev').innerText = "N/A";
        document.getElementById('detailsPub').innerText = "N/A";
        document.getElementById('detailsRelease').innerText = "N/A";
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
        gameNameInput.value = pathParts.length >= 2 ? pathParts[pathParts.length - 2] : pathParts[0].split('.')[0];
        customPosterInput.value = ""; 
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

document.getElementById('cancelModalBtn').addEventListener('click', () => editModal.style.display = 'none');

document.getElementById('saveGameModalBtn').addEventListener('click', async () => {
    const finalName = gameNameInput.value.trim();
    if (!finalName || !tempGamePath) return; 

    const btn = document.getElementById('saveGameModalBtn');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    let finalPoster = "";
    let customImage = customPosterInput.value.trim();
    const launchArgs = document.getElementById('launchArgsInput').value.trim();

    try {
        if (customImage !== "") {
            finalPoster = "file:///" + customImage.replace(/\\/g, '/');
        } else {
            const steamData = await window.api.fetchGameInfo(finalName);
            finalPoster = steamData ? steamData.poster : "";
        }
        
        const existingGame = editingGameId ? allGamesData.find(g => g.id === editingGameId) : null;
        
        // تم إزالة playtime و isFavorite من كائن الحفظ الجديد
        const gameData = {
            id: editingGameId || Date.now(),
            name: finalName,
            path: tempGamePath, 
            poster: finalPoster,
            arguments: launchArgs,
            isFavorite: existingGame ? existingGame.isFavorite : false,
            fetchedDetails: existingGame ? existingGame.fetchedDetails : null 
        };
        
        if (editingGameId) await window.api.updateGame(gameData);
        else await window.api.saveGame(gameData);
        
    } catch (error) { console.error("Save Error:", error); } 
    finally {
        editModal.style.display = 'none';
        btn.innerHTML = "Save & Search";
        btn.disabled = false;
        renderGames();
    }
});

renderGames();

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

// فك القفل عن زر التشغيل عند الإغلاق (سيكون فورياً لملفات bat)
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