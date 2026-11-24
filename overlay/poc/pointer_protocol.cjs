'use strict';
const WIDTH = 560;
const HEIGHT = 338;
function decodePointer(key, source) {
    if (source !== 'mouse' || typeof key !== 'string' || key.length > 40) return null;
    const m = /^(move|down|up|cancel):([0-9]{1,3}):([0-9]{1,3})$/.exec(key);
    if (!m) return null;
    const x = Number(m[2]);
    const y = Number(m[3]);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x >= WIDTH || y >= HEIGHT) return null;
    if (m[1] === 'cancel' && (x !== 0 || y !== 0)) return null;
    return { type: m[1], x, y };
}
// Full-game pointer protocol. Screen/client coordinates are never evaluated as DOM
// coordinates until projected into the known 560x338 widget rectangle.
function decodeScreenPointer(key, source) {
    if (source !== 'mouse-screen' || typeof key !== 'string' || key.length > 66) return null;
    const m = /^(move|down|up|cancel):([0-9]{1,5}):([0-9]{1,5}):([0-9]{3,5}):([0-9]{3,5})$/.exec(key);
    if (!m) return null;
    const x = Number(m[2]), y = Number(m[3]), width = Number(m[4]), height = Number(m[5]);
    if (![x,y,width,height].every(Number.isSafeInteger)) return null;
    if (width < 320 || height < 200 || width > 16384 || height > 16384) return null;
    if (x >= width || y >= height) return null;
    if (m[1] === 'cancel' && (x !== 0 || y !== 0)) return null;
    return { type: m[1], x, y, width, height };
}

function widgetOrigin(width, height, corner = 'top-right', widgetWidth = WIDTH, widgetHeight = HEIGHT) {
    const right = corner === 'top-right' || corner === 'bottom-right';
    const bottom = corner === 'bottom-left' || corner === 'bottom-right';
    return { x: right ? Math.max(8, width - widgetWidth - 24) : 24,
             y: bottom ? Math.max(8, height - widgetHeight - 24) : 24 };
}
function projectToWidget(pointer, corner = 'top-right', widgetWidth = WIDTH, widgetHeight = HEIGHT) {
    if (!pointer) return null;
    const origin = widgetOrigin(pointer.width, pointer.height, corner, widgetWidth, widgetHeight);
    const x = pointer.x - origin.x;
    const y = pointer.y - origin.y;
    if (x < 0 || y < 0 || x >= widgetWidth || y >= widgetHeight) return null;
    return { type: pointer.type, x, y, native: true };
}
function toCursorNormalized(pointer) {
    if (!pointer) return null;
    return { x: Math.round(pointer.x * 65535 / Math.max(1, pointer.width - 1)),
             y: Math.round(pointer.y * 65535 / Math.max(1, pointer.height - 1)) };
}
module.exports = { decodePointer, decodeScreenPointer, projectToWidget, widgetOrigin, toCursorNormalized, WIDTH, HEIGHT };
