"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('new release version is consistent with lockfile and documentation', () => {
    const pkg = JSON.parse(read('package.json'));
    const lock = JSON.parse(read('package-lock.json'));
    assert.equal(pkg.version, '2.7.6');
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.match(read('.github/release-notes/v2.7.6.md'), /experimental/i);
});
test('manual publish opt-in only after successful build matrix and from main', () => {
    const yml = read('.github/workflows/release.yml');
    assert.match(yml, /publish_release:\s*\n\s*description:/);
    assert.match(yml, /default: false/);
    assert.match(yml, /needs: build/);
    assert.match(yml, /inputs\.publish_release/);
    assert.match(yml, /github\.ref == 'refs\/heads\/main'/);
    assert.match(yml, /permissions:\s*\n\s*contents: write/);
    assert.doesNotMatch(yml, /--publish always/);
});
test('release validates all four platform installers and refuses overwrites', () => {
    const yml = read('.github/workflows/release.yml');
    for (const asset of [
        'Nexus-Game-Launcher-Setup-',
        'Nexus-Game-Launcher-${RELEASE_VERSION}.AppImage',
        'Nexus-Game-Launcher-${RELEASE_VERSION}-arm64.AppImage',
        'Nexus-Game-Launcher-${RELEASE_VERSION}-universal.dmg',
        'SHA256SUMS.txt'
    ]) assert.ok(yml.includes(asset), asset);
    assert.ok(yml.includes('gh release view'));
    assert.ok(yml.includes('git ls-remote --tags'));
    assert.ok(yml.includes('gh release create'));
    assert.ok(yml.includes('actions/download-artifact@v4'));
});
