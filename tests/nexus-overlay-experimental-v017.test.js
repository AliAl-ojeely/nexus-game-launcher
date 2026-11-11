'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = path.resolve(__dirname, '..');
const read = path => fs.readFileSync(require('node:path').join(base, path), 'utf8');

test('experimental warning is a permanent sibling of the editor', () => {
    const html = read('index.html');
    const section = html.split('id="settings-overlay-panel"')[1].split('id="settings-backup-panel"')[0];
    const note = section.indexOf('class="overlay-master-note"');
    const warning = section.indexOf('class="overlay-experimental-warning" role="note"');
    const editor = section.indexOf('class="overlay-editor" id="overlayEditor" hidden');
    assert.ok(note >= 0 && warning > note && editor > warning);
    assert.equal((section.match(/data-i18n="overlay_experimental_warning"/g) || []).length, 1);
    assert.ok(!section.slice(warning, editor).includes(' hidden'));
});

test('the notice preserves existing Nexus styling and is not conditional on enabled', () => {
    const css = read('css/overlay-editor.css');
    assert.match(css, /#settingsArea #settings-overlay-panel \.overlay-experimental-warning\s*\{/);
    assert.match(css, /border-inline-start:\s*3px/);
    assert.match(css, /color:\s*var\(--text-main\)/);
    assert.doesNotMatch(css, /#overlayEditor[^\n]*\.overlay-experimental-warning/);
});

test('both Arabic and English messages describe experimental status', () => {
    const t = read('src/translations.js');
    assert.equal((t.match(/overlay_experimental_warning:/g) || []).length, 2);
    assert.ok(t.includes('لا يزال Modal Overlay قيد الاختبار'));
    assert.ok(t.includes('is not fully supported'));
    assert.ok(t.includes('may change significantly'));
});
