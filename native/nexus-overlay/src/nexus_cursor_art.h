#pragma once
// Small antialiased native D3D11 cursor; rendered in game/backbuffer space.
// No desktop overlay HWND, no cursor image assets, no GDI calls on Present.
#include <array>
#include <cstddef>
#include <vector>
#include <cstdint>
#include <algorithm>
#include <cmath>

namespace nexus_cursor_art {
constexpr unsigned kWidth = 30;
constexpr unsigned kHeight = 40;
struct Point { float x, y; };
constexpr std::array<Point, 7> kShape{{
    {2.8f, 1.0f}, {3.2f, 32.0f}, {10.2f, 25.4f},
    {15.2f, 37.5f}, {21.3f, 34.9f}, {16.1f, 22.8f}, {27.5f, 22.4f}
}};
inline bool inside(float x, float y) {
    bool result = false;
    for (std::size_t i = 0, j = kShape.size() - 1; i < kShape.size(); j = i++) {
        const auto& a = kShape[i]; const auto& b = kShape[j];
        if ((a.y > y) != (b.y > y) &&
            x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) result = !result;
    }
    return result;
}
inline float edgeDistance(float x, float y) {
    float best = 10000.f;
    for (std::size_t i = 0; i < kShape.size(); ++i) {
        const auto& a = kShape[i]; const auto& b = kShape[(i + 1) % kShape.size()];
        const float dx = b.x - a.x, dy = b.y - a.y;
        const float t = std::max(0.f, std::min(1.f,
            ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
        const float distX = x - (a.x + t * dx), distY = y - (a.y + t * dy);
        best = std::min(best, std::sqrt(distX * distX + distY * distY));
    }
    return best;
}
inline std::vector<uint8_t> pixelsBGRA() {
    std::vector<uint8_t> data(kWidth * kHeight * 4, 0);
    constexpr float steps = 4.f;
    for (unsigned py = 0; py < kHeight; ++py) for (unsigned px = 0; px < kWidth; ++px) {
        float black = 0.f, white = 0.f, shadow = 0.f;
        for (int iy = 0; iy < 4; ++iy) for (int ix = 0; ix < 4; ++ix) {
            const float x = float(px) + (float(ix) + .5f) / steps;
            const float y = float(py) + (float(iy) + .5f) / steps;
            if (inside(x, y)) {
                if (edgeDistance(x, y) < 1.8f) black += 1.f;
                else white += 1.f;
            } else if (inside(x - 1.5f, y - 2.0f)) shadow += 1.f;
        }
        // Compose premultiplied transparent pixels: shadow, outline, white.
        const float a = std::min(1.f, (black + white + shadow * .35f) / 16.f);
        const float light = white / 16.f;
        const std::size_t at = (std::size_t(py) * kWidth + px) * 4;
        const float bright = 250.f * light + 13.f * (black / 16.f);
        data[at] = static_cast<uint8_t>(std::min(255.f, bright));
        data[at + 1] = static_cast<uint8_t>(std::min(255.f, bright));
        data[at + 2] = static_cast<uint8_t>(std::min(255.f, bright));
        data[at + 3] = static_cast<uint8_t>(a * 255.f);
    }
    return data;
}
} // namespace nexus_cursor_art
