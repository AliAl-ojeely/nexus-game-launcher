// modules/youtube-api.js
const axios = require('axios');
const secrets = require('../src/secrets.json');
const API_KEY = secrets.YOUTUBE_API_KEY;

async function getTrailerData(gameName) {
    if (!API_KEY) return null;
    try {
        const query = encodeURIComponent(`${gameName} official trailer`);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${query}&type=video&maxResults=1&key=${API_KEY}`;

        // 🟢 السطر الناقص كان هنا: يجب تنفيذ الطلب وتخزينه في response
        const response = await axios.get(url);

        if (response.data.items && response.data.items.length > 0) {
            const video = response.data.items[0];
            const thumbnails = video.snippet.thumbnails;

            return {
                videoId: video.id.videoId,
                // جودة HD كما طلبت
                thumbnail: thumbnails.maxres?.url || thumbnails.standard?.url || thumbnails.high?.url
            };
        }
        return null;
    } catch (err) {
        console.error('[YouTube Search] Failed:', err.message);
        return null;
    }
}

module.exports = { getTrailerData };