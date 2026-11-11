#pragma once
// Capture the user's currently configured Windows NORMAL SELECT cursor, not
// artwork authored by Nexus. DrawIconEx is rendered over black and white DIBs
// to recover premultiplied BGRA with a transparent background. This also works
// with older monochrome cursors which have no useful ARGB bitmap alpha.
// The real hardware mouse cursor cannot reliably appear in D3D exclusive
// fullscreen while the game owns input; only its Windows-selected shape is used.
#include <windows.h>
#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <vector>
#include <utility>

namespace nexus_system_cursor {
struct Image {
    UINT width = 0, height = 0;
    int hotX = 0, hotY = 0;
    std::vector<uint8_t> pixels;
};

inline bool DrawOnBackground(HCURSOR cursor, UINT width, UINT height,
                             bool white, std::vector<uint8_t>& output) {
    BITMAPINFO bmi{};
    bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bmi.bmiHeader.biWidth = static_cast<LONG>(width);
    bmi.bmiHeader.biHeight = -static_cast<LONG>(height); // top-down BGRA
    bmi.bmiHeader.biPlanes = 1;
    bmi.bmiHeader.biBitCount = 32;
    bmi.bmiHeader.biCompression = BI_RGB;
    HDC dc = CreateCompatibleDC(nullptr);
    if (!dc) return false;
    void* bits = nullptr;
    HBITMAP dib = CreateDIBSection(dc, &bmi, DIB_RGB_COLORS, &bits, nullptr, 0);
    if (!dib || !bits) {
        if (dib) DeleteObject(dib);
        DeleteDC(dc);
        return false;
    }
    const HGDIOBJ previous = SelectObject(dc, dib);
    if (!previous || previous == HGDI_ERROR) {
        DeleteObject(dib);
        DeleteDC(dc);
        return false;
    }
    auto* bytes = static_cast<uint8_t*>(bits);
    const size_t length = size_t(width) * height * 4;
    // Both canvases are opaque; their RGB difference reveals coverage alpha.
    for (size_t i = 0; i < length; i += 4) {
        bytes[i] = bytes[i + 1] = bytes[i + 2] = white ? 255 : 0;
        bytes[i + 3] = 255;
    }
    const BOOL drawn = DrawIconEx(dc, 0, 0, cursor, static_cast<int>(width),
                                  static_cast<int>(height), 0, nullptr, DI_NORMAL);
    if (drawn) output.assign(bytes, bytes + length);
    SelectObject(dc, previous);
    DeleteObject(dib);
    DeleteDC(dc);
    return drawn != FALSE;
}

inline bool LoadConfiguredArrow(Image& image) {
    // LoadCursor(NULL, IDC_ARROW) selects the Windows system cursor, including
    // user-customized normal-select schemes. Do not call SetSystemCursor.
    HCURSOR cursor = LoadCursorW(nullptr, IDC_ARROW);
    if (!cursor) return false;
    ICONINFO info{};
    if (!GetIconInfo(cursor, &info)) return false;
    BITMAP bitmap{};
    int nativeWidth = 0, nativeHeight = 0;
    if (info.hbmColor && GetObjectW(info.hbmColor, sizeof(bitmap), &bitmap)) {
        nativeWidth = bitmap.bmWidth;
        nativeHeight = std::abs(bitmap.bmHeight);
    } else if (info.hbmMask && GetObjectW(info.hbmMask, sizeof(bitmap), &bitmap)) {
        nativeWidth = bitmap.bmWidth;
        nativeHeight = std::abs(bitmap.bmHeight) / 2;
    }
    if (info.hbmColor) DeleteObject(info.hbmColor);
    if (info.hbmMask) DeleteObject(info.hbmMask);
    if (nativeWidth < 1 || nativeHeight < 1) return false;
    const UINT w = static_cast<UINT>(std::clamp(nativeWidth, 1, 192));
    const UINT h = static_cast<UINT>(std::clamp(nativeHeight, 1, 192));
    std::vector<uint8_t> black, white;
    if (!DrawOnBackground(cursor, w, h, false, black) ||
        !DrawOnBackground(cursor, w, h, true, white)) return false;
    const size_t size = size_t(w) * h * 4;
    if (black.size() != size || white.size() != size) return false;
    std::vector<uint8_t> result(size, 0);
    bool anyVisible = false;
    for (size_t i = 0; i < size; i += 4) {
        // Each channel: compositedWhite - compositedBlack = 255*(1-alpha).
        // The resulting RGB on black is already premultiplied and matches
        // this renderer's D3D11_BLEND_ONE / INV_SRC_ALPHA blend state.
        const int deltaB = int(white[i]) - int(black[i]);
        const int deltaG = int(white[i+1]) - int(black[i+1]);
        const int deltaR = int(white[i+2]) - int(black[i+2]);
        const int a = std::clamp(255 - (deltaB + deltaG + deltaR) / 3, 0, 255);
        result[i] = black[i];
        result[i+1] = black[i+1];
        result[i+2] = black[i+2];
        result[i+3] = static_cast<uint8_t>(a);
        anyVisible |= a > 0;
    }
    if (!anyVisible) return false;
    image.width = w;
    image.height = h;
    image.hotX = std::clamp(int(info.xHotspot * w / static_cast<UINT>(nativeWidth)), 0, int(w) - 1);
    image.hotY = std::clamp(int(info.yHotspot * h / static_cast<UINT>(nativeHeight)), 0, int(h) - 1);
    image.pixels = std::move(result);
    return true;
}
} // namespace nexus_system_cursor
