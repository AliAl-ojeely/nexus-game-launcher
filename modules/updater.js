const { app } = require('electron');
const packageJson = require('../package.json');

// استبدل هذا باسم المستودع الخاص بك على جيتهاب إذا كان مختلفاً
const GITHUB_REPO = 'AliAl-ojeely/NEXUS-GAME-LAUNCHER';

function compareVersions(v1, v2) {
    const p1 = v1.split('.').map(Number);
    const p2 = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
        const n1 = p1[i] || 0;
        const n2 = p2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

async function checkGitHubReleases() {
    try {
        const currentVersion = packageJson.version;
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: { 'User-Agent': 'Nexus-Game-Launcher' }
        });

        if (!response.ok) {
            return { error: 'Failed to fetch release from GitHub' };
        }

        const data = await response.json();
        // إزالة حرف 'v' من رقم الإصدار إذا كان موجوداً (مثلاً v1.9.5 يصبح 1.9.5)
        const latestVersion = data.tag_name.replace(/^v/, '');
        const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

        return {
            hasUpdate,
            currentVersion,
            latestVersion: data.tag_name,
            releaseNotes: data.body,
            downloadUrl: data.html_url
        };
    } catch (err) {
        console.error('[UPDATER] Error checking for updates:', err);
        return { error: err.message };
    }
}

module.exports = {
    checkGitHubReleases
};