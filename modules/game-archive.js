'use strict';

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const KINDS = Object.freeze(['poster', 'background', 'logo', 'icon']);

// Exact identity only: aliases and title similarity must not restore another game.
function normalName(value) {
    return String(value || '').normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function steamId(game) {
    const raw = game?.metadata?.steamAppId;
    const id = String(raw == null ? '' : raw).trim();
    return /^\d{1,12}$/.test(id) && Number(id) > 0 ? id : '';
}

function matchesIdentity(saved, fresh) {
    if (!saved || !fresh || !normalName(saved.name) || !normalName(fresh.name)) return false;
    const oldId = steamId(saved);
    const newId = steamId(fresh);
    if (oldId && newId) return oldId === newId;
    return normalName(saved.name) === normalName(fresh.name);
}

function localFilePath(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        if (/^(?:local-resource|file):\/\//i.test(value)) {
            const url = new URL(value);
            if (url.protocol !== 'local-resource:' && url.protocol !== 'file:') return null;
            if (url.host && url.host !== 'localhost') return null;
            let filename = decodeURIComponent(url.pathname);
            if (/^\/[a-zA-Z]:\//.test(filename)) filename = filename.slice(1);
            return filename;
        }
        return path.isAbsolute(value) ? value : null;
    } catch (_) {
        return null;
    }
}

function usableCachedArtwork(saved = {}) {
    const retained = {};
    for (const kind of KINDS) {
        const value = saved?.[kind];
        const file = localFilePath(value);
        if (file && fs.existsSync(file)) retained[kind] = value;
    }
    return retained;
}

function mergeArchivedGame(saved, fresh, manualArtwork = {}) {
    if (!saved || !matchesIdentity(saved, fresh)) return { ...fresh, assets: { ...(fresh.assets || {}), ...manualArtwork } };
    const cleanSaved = { ...saved };
    delete cleanSaved.playtime;
    delete cleanSaved.manualAssets;
    const metadata = {
        ...(fresh.metadata || {}),
        ...(cleanSaved.metadata || {}),
        media: {
            ...(fresh.metadata?.media || {}),
            ...(cleanSaved.metadata?.media || {}),
        },
    };
    return {
        ...cleanSaved,
        ...fresh,
        id: fresh.id,
        name: fresh.name,
        path: fresh.path,
        isInstalled: fresh.isInstalled !== false,
        arguments: fresh.arguments || cleanSaved.arguments || '',
        isFavorite: cleanSaved.isFavorite === true || fresh.isFavorite === true,
        metadata,
        assets: { ...(fresh.assets || {}), ...usableCachedArtwork(cleanSaved.assets), ...manualArtwork },
    };
}

// Archive game metadata in userData only. Never touch game executables or artwork files.
function createStore(userDataDir) {
    if (!userDataDir || typeof userDataDir !== 'string') throw new Error('Missing userData directory');
    const archivePath = path.join(userDataDir, 'archived-games.json');

    function read() {
        if (!fs.existsSync(archivePath)) return [];
        const parsed = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
        if (!Array.isArray(parsed) || !parsed.every(entry => entry && typeof entry === 'object' && entry.game && typeof entry.game.name === 'string')) {
            throw new Error('Invalid archived-games.json; archive left untouched');
        }
        return parsed;
    }

    function write(entries) {
        fs.mkdirSync(userDataDir, { recursive: true });
        const temp = archivePath + `.tmp-${process.pid}-${Date.now()}`;
        try {
            fs.writeFileSync(temp, JSON.stringify(entries, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
            fs.renameSync(temp, archivePath);
        } finally {
            if (fs.existsSync(temp)) fs.unlinkSync(temp);
        }
    }

    function archive(game) {
        if (!game || typeof game.name !== 'string' || !game.name.trim() || game.id == null) throw new Error('Invalid game');
        const { playtime, manualAssets, ...snapshot } = game;
        const entries = read().filter(item => String(item.game.id) !== String(game.id));
        entries.push({ archivedAt: new Date().toISOString(), game: snapshot });
        write(entries);
    }

    function find(game) {
        const entries = read();
        for (let i = entries.length - 1; i >= 0; i--) {
            if (matchesIdentity(entries[i].game, game)) return entries[i];
        }
        return null;
    }

    function consume(archivedEntry) {
        if (!archivedEntry) return;
        const entries = read();
        const remaining = entries.filter(item => !(String(item.game.id) === String(archivedEntry.game.id) && item.archivedAt === archivedEntry.archivedAt));
        if (remaining.length !== entries.length) write(remaining);
    }

    return { archivePath, read, archive, find, consume };
}

module.exports = { KINDS, normalName, steamId, matchesIdentity, localFilePath, usableCachedArtwork, mergeArchivedGame, createStore };
