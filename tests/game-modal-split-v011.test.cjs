'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.env.NEXUS_TEST_PROJECT || process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/game-modal-split-v011.css'), 'utf8');
const main = fs.readFileSync(path.join(root, 'css/main.css'), 'utf8');
const init = fs.readFileSync(path.join(root, 'render/modal/init.js'), 'utf8');
const start = html.indexOf('id="editModal"');
const end = html.indexOf('Image Lightbox', start);
const modal = html.slice(start, end);
const primary = modal.indexOf('nexus-game-modal-primary-v010');
const secondary = modal.indexOf('nexus-game-modal-secondary-v010');
const footer = modal.indexOf('class="modal-buttons"');
const idPos = id => modal.indexOf(`id="${id}"`);
const icons = {
  changePathBtn: 'fa-folder', browseOriginPathBtn: 'fa-folder-open',
  selectCustomBackupBtn: 'fa-folder-tree', customImageBtn: 'fa-image',
  removePosterBtn: 'fa-xmark', customLogoBtn: 'fa-image',
  removeLogoBtn: 'fa-xmark', customBgBtn: 'fa-image',
  removeBgBtn: 'fa-xmark', customIconBtn: 'fa-image',
  removeIconBtn: 'fa-xmark', saveGameModalBtn: 'fa-check',
};

function iconFor(id) {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = modal.match(new RegExp(`<button\\b(?=[^>]*\\bid="${safe}")[^>]*>([\\s\\S]*?)<\\/button>`));
  assert.ok(found, `Missing existing button ${id}`);
  const icon = found[1].match(/<i\s+class="([^"]+)"\s*><\/i>/);
  assert.ok(icon, `Missing original icon in ${id}`);
  return icon[1].split(/\s+/);
}

test('the original Game Details modal alone uses a two-column layout', () => {
  assert.ok(start > 0 && end > start);
  assert.equal((html.match(/nexus-game-modal-columns-v010/g) || []).length, 1);
  assert.ok(primary > 0 && secondary > primary && footer > secondary);
});

test('left column contains Game Name, EXE, three save and launch fields', () => {
  assert.ok(primary < idPos('gameNameInput'));
  assert.ok(idPos('gameNameInput') < idPos('gamePathInput'));
  assert.ok(idPos('gamePathInput') < idPos('editGameOriginPath'));
  assert.ok(idPos('editGameOriginPath') < idPos('editGameBackupPath'));
  assert.ok(idPos('editGameBackupPath') < idPos('launchArgsInput'));
  assert.ok(idPos('launchArgsInput') < secondary);
});

test('Installed Game toggle stays directly after Executable Path in left column', () => {
  assert.match(init, /pathGroup\.insertAdjacentElement\("afterend", group\)/);
  assert.match(init, /checkbox\.id = "gameInstalledInput"/);
  assert.ok(idPos('gamePathInput') < secondary);
});

test('right column begins with Custom Poster and retains original artwork controls', () => {
  const ids = [
    'customPosterInput', 'customLogoInput', 'customBgInput', 'customIconInput',
  ];
  let p = secondary;
  for (const id of ids) {
    assert.ok(idPos(id) > p && idPos(id) < footer, id);
    p = idPos(id);
  }
});

test('Save and Cancel are below the artwork column only', () => {
  assert.ok(idPos('saveGameModalBtn') > footer);
  assert.ok(idPos('cancelModalBtn') > idPos('saveGameModalBtn'));
  assert.match(css, /align-self:\s*flex-end/);
  assert.match(css, /width:\s*calc\(\(100% - 16px\) \/ 2\)/);
});

test('original Font Awesome icons remain intact on ALL 12 modal buttons', () => {
  for (const [id, icon] of Object.entries(icons)) {
    const classes = iconFor(id);
    assert.ok(classes.includes('fa-solid'), `${id}: original FA icon style`);
    assert.ok(classes.includes(icon), `${id}: expected original ${icon}`);
  }
});

test('original modal header retains the gamepad icon', () => {
  assert.match(modal, /<h2><i class="fa-solid fa-gamepad"><\/i>/);
});

test('modal controls are never duplicated by the split', () => {
  for (const id of ['gameNameInput', 'gamePathInput', 'editGameOriginPath',
    'editGameBackupPath', 'launchArgsInput', 'customPosterInput', 'customLogoInput',
    'customBgInput', 'customIconInput', ...Object.keys(icons), 'cancelModalBtn']) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.equal((modal.match(new RegExp(`id="${escaped}"`, 'g')) || []).length, 1, id);
  }
});

test('only the new scoped stylesheet is active', () => {
  assert.equal((main.match(/@import url\('game-modal-split-v011\.css'\);/g) || []).length, 1);
  assert.doesNotMatch(main, /@import url\('game-modal-split-v010\.css'\);/);
  assert.ok(main.indexOf('backup-hover-polish-v076.css') < main.indexOf('game-modal-split-v011.css'));
});

test('desktop columns are equal with independently scrollable content', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /overflow-y:\s*auto/);
  assert.match(css, /border-inline-end:\s*1px/);
});

test('narrow windows stack the original controls and keep usable footer', () => {
  assert.match(css, /@media \(max-width: 840px\)/);
  assert.match(css, /\.nexus-game-modal-columns-v010\s*\{\s*display:\s*block/);
  assert.match(css, /align-self:\s*stretch/);
});

test('no icon substitutions, generated icon content or animations are introduced', () => {
  assert.doesNotMatch(css, /content:\s*['"][^'"]+['"]/);
  assert.doesNotMatch(css, /font-family:\s*['"](?:Font Awesome|Segoe UI Emoji)/i);
  assert.doesNotMatch(css, /\.fa-(?:folder|image|gamepad|check|xmark)/);
});

test('all original modal handlers are referenced and remain external to visual patch', () => {
  assert.match(init, /pathGroup\.insertAdjacentElement\("afterend", group\)/);
  assert.ok(idPos('editGameOriginPath') > primary);
  assert.ok(idPos('launchArgsInput') < secondary);
});

test('game data, backup implementation and asset providers are untouched', () => {
  assert.doesNotMatch(css, /games\.json|gamesBackSave\.json|steamGrid-api/);
  assert.doesNotMatch(modal, /<script\b/i);
});
