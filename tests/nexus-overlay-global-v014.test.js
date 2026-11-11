'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
const config = require('../modules/overlay-config');
const { buildPreviewHtml } = require('../modules/overlay-preview');

test('global master is disabled by default and persisted as a validated boolean', () => {
    assert.equal(config.normalize(null).enabled, false);
    assert.equal(config.normalize({ enabled: 'true' }).enabled, false);
    assert.equal(config.normalize({ enabled: true }).enabled, true);
    assert.equal(config.normalize({ enabled: false, metrics: { clock: true } }).metrics.clock, true);
});

test('real OSR markup, CSS and JS are all embedded in one sandboxed preview', () => {
    const html = buildPreviewHtml();
    const actual = fs.readFileSync(path.join(root,'overlay/poc/index.html'),'utf8');
    assert.match(actual, /class="widget"/);
    assert.match(html, /class="widget"/);
    assert.match(html, /NEXUS_PREVIEW = true/);
    assert.match(html, /border-radius:\s*18px/);
    assert.match(html, /applyCustomization/);
    assert.doesNotMatch(html, /<script\s+src=|<link\s+rel="stylesheet"/);
    assert.ok(html.length < 262144);
});

test('single global toggle replaces per-game interface; original settings are retained', () => {
    const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
    const js = fs.readFileSync(path.join(root,'render/overlay-editor.js'),'utf8');
    assert.equal((html.match(/id="overlayEnabled"/g) || []).length, 1);
    assert.match(html, /id="overlayEditor" hidden/);
    assert.match(html, /sandbox="allow-scripts"/);
    assert.doesNotMatch(html, /id="detailsOverlayToggle"/);
    assert.match(js, /overlayGetPreviewHtml\(\)/);
    assert.match(js, /frame\.srcdoc = markup/);
    assert.match(js, /confirmDialog\(/);
    for (const id of ['appNameSetting','fpsToggle','autoBackupToggle','themeSetting','saveGeneralSettings']) {
        assert.match(html, new RegExp('id="'+id+'"'));
    }
    const main = fs.readFileSync(path.join(root,'src/main.js'),'utf8');
    const preload = fs.readFileSync(path.join(root,'src/preload.js'),'utf8');
    assert.doesNotMatch(main,/overlay:game-approval|overlay:set-game-approval/);
    assert.doesNotMatch(preload,/overlayGetApproval|overlaySetApproval/);
    assert.match(main,/writeSettings\(settings\);/);
    assert.match(main,/overlayManager\.stopAll\(\)/);
});

test('global OFF blocks auto-attach; ON uses only verified exact game process', () => {
    let current = { modalOverlay: { enabled: false } };
    let starts = 0;
    const source = fs.readFileSync(path.join(root,'modules/overlay-manager.js'),'utf8');
    const server = { on() { return this; }, listen(_name, callback) { callback(); }, unref() {}, close() {} };
    const context = {
        module: { exports: {} }, __dirname: path.join(root,'modules'),
        process: { platform: 'win32', arch: 'x64', pid: 789, env: {} },
        Buffer, String, Number, Date,
        console: { log() {}, warn() {}, error() {} },
        require(name) {
            if (name === 'node:child_process') return { spawn() {
                starts++;
                const child=new EventEmitter(); child.stdin={destroyed:false,end(){}};
                child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
                child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
                return child;
            } };
            if (name === 'node:fs') return { existsSync:()=>true };
            if (name === 'node:net') return { createServer:()=>server };
            if (name === 'node:path') return path;
            if (name === 'node:crypto') return require('node:crypto');
            if (name === 'electron') return { app: { isPackaged: false } };
            if (name === './app-settings') return { readSettings:()=>current, SETTINGS_FILE:'C:\\Nexus\\settings.json' };
            if (name === './overlay-config') return config;
            throw new Error('Unexpected import '+name);
        },
    };
    vm.runInNewContext(source, context);
    const manager = context.module.exports;
    manager.start(()=>({ok:true}));
    const verified = { gameId:23,gameName:'Local Test',sessionId:'live',activePid:2222,
        activePath:'C:\\Games\\LocalTest.exe',installPath:'C:\\Games\\LocalTest.exe' };
    assert.equal(manager.attach(verified),false);
    assert.equal(starts,0);
    current = {modalOverlay:{enabled:true}};
    assert.equal(manager.attach({...verified,activePath:'C:\\Games\\Unverified.exe'}),false);
    assert.equal(starts,0);
    assert.equal(manager.attach(verified),true);
    assert.equal(starts,1);
    assert.equal(manager.attach(verified),true);
    assert.equal(starts,1);
    manager.stopAll();
    current = {modalOverlay:{enabled:false}};
    assert.equal(manager.attach(verified),false);
    assert.equal(starts,1);
    manager.shutdown();
});

test('native safety and timer control code stays in place', () => {
    const native = fs.readFileSync(path.join(root,'tools/run_overlay_real_game.py'),'utf8');
    const host = fs.readFileSync(path.join(root,'overlay/poc/host.cjs'),'utf8');
    assert.match(native,/DX12_CRASH_QUARANTINE_IMAGES/);
    assert.match(native,/--confirm-unprotected/);
    assert.match(host,/maskRoundedWidget\(bitmap, width, height\)/);
    assert.match(host,/nexus:timer-action/);
});
