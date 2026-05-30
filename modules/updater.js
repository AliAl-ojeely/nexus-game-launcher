const { app } = require('electron');
const EventEmitter = require('events');
const packageJson = require('../package.json');
const fetch = require('node-fetch');

// Optional: try to use semver if installed, otherwise fallback
let semver;
try {
    semver = require('semver');
} catch (e) {
    semver = null;
}

const GITHUB_REPO = 'AliAl-ojeely/NEXUS-GAME-LAUNCHER';
const USER_AGENT = 'Nexus-Game-Launcher/1.0';

// Simple version comparison fallback (numeric segments only)
function simpleCompare(v1, v2) {
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

const compareVersions = semver ? semver.gt : (a, b) => simpleCompare(a, b) > 0;

class Updater extends EventEmitter {
    constructor(options = {}) {
        super();
        this.repo = options.repo || GITHUB_REPO;
        this.userAgent = options.userAgent || USER_AGENT;
        this.currentVersion = packageJson.version;
        this.includePrerelease = options.includePrerelease || false;
        this.cacheTtlMs = options.cacheTtlMs || 5 * 60 * 1000; // 5 minutes
        this.lastCheck = null;
        this.cachedResult = null;
        this.abortController = null;
    }

    // Get latest release from GitHub (cached)
    async getLatestRelease() {
        const now = Date.now();
        if (this.cachedResult && this.lastCheck && (now - this.lastCheck) < this.cacheTtlMs) {
            return this.cachedResult;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            const url = this.includePrerelease
                ? `https://api.github.com/repos/${this.repo}/releases?per_page=1`
                : `https://api.github.com/repos/${this.repo}/releases/latest`;

            const response = await fetch(url, {
                headers: { 'User-Agent': this.userAgent },
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Handle rate limiting
            const remaining = response.headers.get('x-ratelimit-remaining');
            const reset = response.headers.get('x-ratelimit-reset');
            if (response.status === 403 && remaining === '0') {
                const resetDate = new Date(reset * 1000);
                this.emit('rate-limited', { resetDate });
                return {
                    error: `GitHub API rate limit exceeded. Resets at ${resetDate.toLocaleString()}`,
                    rateLimited: true,
                    resetDate
                };
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            let release;
            if (this.includePrerelease) {
                const releases = await response.json();
                release = releases[0];
                if (!release) throw new Error('No releases found');
            } else {
                release = await response.json();
            }

            // Extract version from tag_name (remove leading 'v')
            const latestVersion = release.tag_name.replace(/^v/, '');
            const hasUpdate = compareVersions(latestVersion, this.currentVersion);

            const result = {
                hasUpdate,
                currentVersion: this.currentVersion,
                latestVersion: release.tag_name,
                releaseNotes: release.body,
                downloadUrl: release.html_url,
                releaseDate: release.published_at,
                assets: release.assets || [],
                prerelease: release.prerelease || false
            };

            // Cache the result
            this.cachedResult = result;
            this.lastCheck = now;

            return result;
        } catch (err) {
            clearTimeout(timeoutId);

            let errorMessage = err.message;
            if (err.name === 'AbortError') {
                errorMessage = 'Connection timed out (15s). Please check your internet connection.';
            }

            console.error('[UPDATER] Error checking for updates:', errorMessage);
            this.emit('error', new Error(errorMessage));
            return { error: errorMessage };
        }
    }

    // Convenience method that matches the original API
    async checkGitHubReleases() {
        return this.getLatestRelease();
    }

    // Optional: download asset (e.g., installer)
    async downloadAsset(assetUrl, destinationPath, onProgress) {
        this.abortController = new AbortController();

        try {
            const response = await fetch(assetUrl, {
                headers: { 'User-Agent': this.userAgent },
                signal: this.abortController.signal
            });

            if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);

            const contentLength = response.headers.get('content-length');
            const total = parseInt(contentLength, 10);
            let downloaded = 0;

            const fs = require('fs');
            const fileStream = fs.createWriteStream(destinationPath);

            return new Promise((resolve, reject) => {
                response.body.on('data', (chunk) => {
                    downloaded += chunk.length;
                    if (onProgress && total) {
                        onProgress({ downloaded, total, percent: (downloaded / total) * 100 });
                    }
                });

                response.body.pipe(fileStream);

                fileStream.on('close', () => resolve(destinationPath));
                fileStream.on('error', reject);
                response.body.on('error', reject);
            });
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Download was manually cancelled');
            }
            throw error;
        }
    }

    cancelDownload() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    // Start periodic checking (every intervalMs)
    startAutoCheck(intervalMs = 60 * 60 * 1000, callback = null) {
        if (this.intervalId) clearInterval(this.intervalId);
        this.intervalId = setInterval(async () => {
            const result = await this.checkGitHubReleases();
            if (result.hasUpdate && callback) callback(result);
            this.emit('auto-check', result);
        }, intervalMs);
        return this.intervalId;
    }

    stopAutoCheck() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

// Singleton instance for backward compatibility
const defaultUpdater = new Updater();

module.exports = {
    checkGitHubReleases: () => defaultUpdater.checkGitHubReleases(),
    Updater,
    defaultUpdater
};