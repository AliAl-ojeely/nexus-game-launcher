'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const load = name => fs.readFileSync(path.join(root, name), 'utf8');

test('Windows resources are included only on Windows and outside ASAR', () => {
    const pkg = JSON.parse(load('package.json'));
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(load('package-lock.json'));
    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.deepEqual(pkg.build.win.extraResources, [{from:'build/overlay-runtime',to:'overlay-runtime',filter:['**/*']}]);
    assert.ok(pkg.build.files.includes('overlay/poc/**/*'));
    assert.ok(!pkg.build.extraResources.some(item => item.from === 'build/overlay-runtime'));
});

test('CI builds x64 and x86 native hooks and a frozen Python helper', () => {
    const build = load('.github/scripts/build_overlay_runtime.ps1');
    for (const name of ['x64','Win32','NexusOverlayHook','NexusOverlayInjector','NexusOpenGLHook','NexusD3D9Hook','PyInstaller','nexus_input_bridge']) assert.ok(build.includes(name), name);
    assert.ok(!build.includes('NexusD3D12Hook'), 'D3D12 quarantine must not be lifted');
});

test('Workflow performs unpacked smoke testing and never publishes automatically', () => {
    const yaml = load('.github/workflows/release.yml');
    assert.ok(yaml.includes('workflow_dispatch:'));
    assert.ok(yaml.includes('verify_overlay_resources.ps1'));
    assert.ok(yaml.includes('--dir --publish never'));
    assert.equal(yaml.includes('--publish always'), false);
    assert.ok(yaml.includes('actions/upload-artifact@v4'));
});

test('Development and installed runtime paths are deliberately separate', () => {
    const manager = load('modules/overlay-manager.js');
    assert.ok(manager.includes('app.isPackaged'));
    assert.ok(manager.includes("path.join(process.resourcesPath, 'overlay-runtime')"));
    assert.ok(manager.includes("PACKAGED ? RUNNER : 'py'"));
    assert.ok(manager.includes('NEXUS_OVERLAY_PACKAGED_APP_EXE'));
    assert.ok(manager.includes("process.arch !== 'x64'"));
    assert.ok(manager.includes('readSettings()'));
    assert.ok(manager.includes("'--confirm-unprotected'"));
});

test('Frozen helper uses its own installed resource root and packaged Electron entry', () => {
    const runner = load('tools/run_overlay_real_game.py');
    assert.ok(runner.includes("getattr(sys, 'frozen', False)"));
    assert.ok(runner.includes("NEXUS_OVERLAY_PACKAGED_APP_EXE"));
    assert.ok(runner.includes("'--nexus-overlay-helper'"));
    assert.ok(runner.includes("'nexus_input_bridge'" ) || runner.includes('from nexus_input_bridge import'));
    assert.ok(runner.includes('dx12_safety_reason'));
});

test('Installed Electron helper does not initialize a second launcher instance', () => {
    const main = load('src/main.js');
    assert.ok(main.startsWith("if (process.argv.includes('--nexus-overlay-helper')) {"));
    assert.ok(main.includes("require('../overlay/poc/host.cjs')"));
    assert.ok(main.includes('overlayManager.start(launcher.applyOverlayTimerAction)'));
});
