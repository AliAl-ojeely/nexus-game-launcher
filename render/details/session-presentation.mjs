'use strict';
// Paint only the currently selected game's UI, using the renderer's per-game
// projection. No IPC commands, backup actions or session mutations happen here.
function showTime(raw) {
    const seconds = Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor(seconds % 3600 / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}
function setHtml(element, content) {
    if (element.innerHTML !== content) element.innerHTML = content;
}
export function paintDetailsSession(document, tracker, gameId, lang = 'en') {
    const record = tracker.get(gameId);
    const running = !!record;
    const isArabic = lang === 'ar';
    const play = document.getElementById('detailsPlayBtn');
    const timer = document.getElementById('sessionTimerContainer');
    const time = document.getElementById('sessionTimerValue');
    const pause = document.getElementById('pauseTimerBtn');
    if (timer) timer.style.display = running ? 'flex' : 'none';
    if (time) time.innerText = showTime(record?.elapsed);
    if (pause) {
        pause.style.display = running && record.phase === 'running' ? 'flex' : 'none';
        pause.disabled = !running || record.phase !== 'running';
        setHtml(pause, record?.paused
            ? '<i class="fa-regular fa-circle-play"></i>'
            : '<i class="fa-regular fa-circle-pause"></i>');
    }
    if (play) {
        play.disabled = running && record.phase !== 'running';
        play.classList.remove('play-btn-running', 'play-btn-stopping', 'play-btn-securing');
        play.style.cssText = '';
        if (record?.phase === 'launching') {
            setHtml(play, `<i class="fa-solid fa-spinner fa-spin"></i> ${isArabic ? 'جاري التشغيل...' : 'Launching...'}`);
        } else if (record?.phase === 'stopping') {
            play.classList.add('play-btn-stopping');
            setHtml(play, `<i class="fa-solid fa-spinner fa-spin"></i> ${isArabic ? 'جاري الإيقاف...' : 'Stopping...'}`);
        } else if (running) {
            play.classList.add('play-btn-running');
            setHtml(play, `<i class="fa-solid fa-stop"></i> ${isArabic ? 'إيقاف' : 'Stop'}`);
        } else {
            setHtml(play, `<i class="fa-solid fa-play"></i> <span data-i18n="btn_play">${isArabic ? 'إلعب الآن' : 'Play'}</span>`);
        }
    }
    return running;
}
