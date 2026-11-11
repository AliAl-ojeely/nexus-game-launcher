'use strict';
// Builds a self-contained preview from the very same OSR UI files.
// No user-controlled paths, network resources, or game process access.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MAX_BYTES = 262144;
function source(relative) {
    const full = path.resolve(ROOT, relative);
    if (!full.startsWith(ROOT + path.sep)) throw new Error('Invalid preview source');
    const data = fs.readFileSync(full, 'utf8');
    if (Buffer.byteLength(data) > MAX_BYTES) throw new Error('Preview source too large');
    return data;
}
function scriptTag(code) {
    // An HTML script end tag inside a JS string must not close the element.
    return '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script>';
}
function buildPreviewHtml() {
    let html = source('overlay/poc/index.html');
    const changes = [
        ['<link rel="stylesheet" href="./ui.css" />', '<style>\n' + source('overlay/poc/ui.css') + '\n</style>'],
        ['<script src="../../modules/overlay-config.js"></script>', scriptTag('window.NEXUS_PREVIEW = true;\n' + source('modules/overlay-config.js'))],
        ['<script src="./ui.js"></script>', scriptTag(source('overlay/poc/ui.js'))],
    ];
    for (const [before, after] of changes) {
        if (!html.includes(before)) throw new Error('Overlay UI preview source changed');
        html = html.replace(before, after);
    }
    if (Buffer.byteLength(html) > MAX_BYTES) throw new Error('Preview document too large');
    return html;
}
module.exports = { buildPreviewHtml };
