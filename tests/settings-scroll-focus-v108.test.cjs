'use strict';
// Static integration guard. Real click/focus regression is in qa/validate.py.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT,p),'utf8');
const css = read('css/overlay-editor-layout-v106.css');
const html = read('index.html');
const editor = read('render/overlay-editor.js');
const marker = 'NEXUS_SETTINGS_SCROLL_FOCUS_V108';
const start = css.indexOf(marker+'_START');
const end = css.indexOf(marker+'_END');
const fix = css.slice(start,end);
function declarations(selector) {
    const blocks = [...fix.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
    const b = blocks.find(m => m[1].includes(selector));
    assert.ok(b, selector);
    return b[2];
}
test('settings scroll fix is loaded once, after the original overlay styles',()=>{
    assert.equal((css.match(new RegExp(marker+'_START','g'))||[]).length,1);
    assert.equal((css.match(new RegExp(marker+'_END','g'))||[]).length,1);
    assert.ok(start>0 && end>start);
    assert.ok(html.indexOf('href="css/overlay-editor.css"')>=0);
    assert.ok(html.indexOf('href="css/overlay-layout-polish-v105.css"')>=0);
    const target=html.indexOf('href="css/overlay-editor-layout-v106.css"');
    assert.ok(target>html.indexOf('href="css/overlay-editor.css"'));
    assert.ok(target>html.indexOf('href="css/overlay-layout-polish-v105.css"'));
});
test('outer Settings wrappers clip without becoming focus-scroll containers',()=>{
    for(const s of ['#settingsArea.page-area','#settingsArea .settings-shell','#settingsArea #settings-overlay-panel > .settings-section']) {
        assert.match(declarations(s),/overflow:\s*clip\s*;/);
    }
});
test('the existing inner Settings scroller retains vertical scrolling and contains positioned controls',()=>{
    const d=declarations('#settingsArea #settingsPanelScroll');
    assert.match(d,/position:\s*relative\s*;/);
    assert.match(d,/min-height:\s*0\s*;/);
    assert.match(d,/overflow-x:\s*hidden\s*;/);
    assert.match(d,/overflow-y:\s*auto\s*;/);
    assert.match(d,/overscroll-behavior-y:\s*contain\s*;/);
});
test('all four Overlay radio families remain focusable inside their own card',()=>{
    for(const cls of ['.overlay-size-choice','.nx-window-scale-choice','.nexus-concept-choice','.nexus-corner-grid label']) {
        const prefix='#settingsArea #settings-overlay-panel '+cls;
        assert.match(declarations(prefix),/position:\s*relative\s*;/);
        const d=declarations(prefix+' > input[type="radio"]');
        assert.match(d,/position:\s*absolute\s*;/);
        assert.match(d,/top:\s*50%\s*;/);
        assert.match(d,/left:\s*50%\s*;/);
        assert.match(d,/transform:\s*translate\(-50%,\s*-50%\)\s*;/);
        assert.doesNotMatch(d,/display:\s*none|visibility:\s*hidden/);
    }
});
test('all original Settings tabs, radios, preview and Save controls remain present',()=>{
    for(const id of ['settings-general-tab','settings-appearance-tab','settings-overlay-tab','settings-backup-tab','settingsPanelScroll','overlayEditor','overlayPreviewStage','overlayPreviewFrame','saveGeneralSettings']) {
        assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1,id);
    }
    for(const [name,values] of Object.entries({overlaySizeMode:['full','medium','minimal'],overlayWindowScale:['small','large'],overlayConceptLayout:['dockline','corner-pulse','side-rail','command-strip'],overlayCorner:['top-left','top-right','bottom-left','bottom-right']})) {
        const tags=[...html.matchAll(/<input\b[^>]*>/g)].map(m=>m[0]).filter(t=>t.includes('name="'+name+'"'));
        assert.equal(tags.length,values.length,name);
        for(const value of values) assert.ok(tags.some(t=>t.includes('type="radio"')&&t.includes('value="'+value+'"')),name+':'+value);
    }
});
test('preview sizing and input refresh remain wired to their existing handlers',()=>{
    assert.match(editor,/const frameWidth = large \? 728 : 560/);
    assert.match(editor,/const frameHeight = large \? 439 : 338/);
    assert.match(editor,/editor\.addEventListener\('input'/);
    assert.match(editor,/editor\.addEventListener\('change'/);
    assert.match(editor,/new ResizeObserver\(scaleFrame\)/);
    assert.doesNotMatch(fix,/overlayPreviewFrame|overlay-preview-stage|overlayEditor\[hidden\]/);
});
