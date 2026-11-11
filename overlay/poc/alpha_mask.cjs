'use strict';

// Chromium offscreen frames are BGRA8 with premultiplied alpha. Keep the
// pixels rendered by HTML, but force the transparent 8px frame margin and
// rounded outer corners to alpha=0. Scaling all four channels preserves
// premultiplication and avoids square halos with D3D11 ONE/INV_SRC_ALPHA.
const WIDGET_PADDING = 8;
const WIDGET_RADIUS = 18;

function maskPixel(bitmap, index, coverage) {
    if (coverage <= 0) {
        bitmap[index] = 0;
        bitmap[index + 1] = 0;
        bitmap[index + 2] = 0;
        bitmap[index + 3] = 0;
    } else if (coverage < 1) {
        bitmap[index] = Math.round(bitmap[index] * coverage);
        bitmap[index + 1] = Math.round(bitmap[index + 1] * coverage);
        bitmap[index + 2] = Math.round(bitmap[index + 2] * coverage);
        bitmap[index + 3] = Math.round(bitmap[index + 3] * coverage);
    }
}

function maskRoundedWidget(bitmap, width, height) {
    if (!Buffer.isBuffer(bitmap) || !Number.isInteger(width) || !Number.isInteger(height) ||
        width < 2 * (WIDGET_PADDING + WIDGET_RADIUS) ||
        height < 2 * (WIDGET_PADDING + WIDGET_RADIUS) ||
        bitmap.length !== width * height * 4) {
        throw new RangeError('Invalid Nexus offscreen BGRA frame');
    }
    const p = WIDGET_PADDING;
    const r = WIDGET_RADIUS;
    const stride = width * 4;

    // Clear any OSR background pixels in the otherwise transparent margin.
    bitmap.fill(0, 0, p * stride);
    bitmap.fill(0, (height - p) * stride, height * stride);
    for (let y = p; y < height - p; ++y) {
        const base = y * stride;
        bitmap.fill(0, base, base + p * 4);
        bitmap.fill(0, base + (width - p) * 4, base + stride);
    }

    // Clip the 18px rounded corners. Feather the last pixel for clean edges.
    // Coordinates match: .layer { padding: 8px }; .widget { radius: 18px }.
    const corners = [
        { x0: p, y0: p, cx: p + r, cy: p + r },
        { x0: width - p - r, y0: p, cx: width - p - r, cy: p + r },
        { x0: p, y0: height - p - r, cx: p + r, cy: height - p - r },
        { x0: width - p - r, y0: height - p - r,
          cx: width - p - r, cy: height - p - r },
    ];
    for (const c of corners) {
        for (let y = c.y0; y < c.y0 + r; ++y) {
            for (let x = c.x0; x < c.x0 + r; ++x) {
                const dx = x + 0.5 - c.cx;
                const dy = y + 0.5 - c.cy;
                const distance = Math.hypot(dx, dy);
                const coverage = Math.max(0, Math.min(1, r + 0.5 - distance));
                if (coverage < 1) maskPixel(bitmap, (y * width + x) * 4, coverage);
            }
        }
    }
    return bitmap;
}

module.exports = { maskRoundedWidget, WIDGET_PADDING, WIDGET_RADIUS };
