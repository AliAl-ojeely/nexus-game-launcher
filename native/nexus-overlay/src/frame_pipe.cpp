#include "frame_pipe.h"
#include "nexus_telemetry.h"
#include <windows.h>
#include <mutex>
#include <string>
#include <vector>
#include <cstring>
#include <utility>
#include <atomic>

namespace {
std::mutex g_mutex;
NexusFrame g_latest;
std::atomic<bool> g_visible{false};
std::atomic<uint32_t> g_cursorX{0};
std::atomic<uint32_t> g_cursorY{0};
std::atomic<bool> g_cursorValid{false};
constexpr uint32_t MAX_WIDTH = 800;
constexpr uint32_t MAX_HEIGHT = 600;

bool ReadExactly(HANDLE pipe, void* output, DWORD length) {
    auto* pointer = static_cast<uint8_t*>(output);
    DWORD remaining = length;
    while (remaining != 0) {
        DWORD count = 0;
        if (!ReadFile(pipe, pointer, remaining, &count, nullptr) || count == 0)
            return false;
        pointer += count;
        remaining -= count;
    }
    return true;
}
}

bool NexusOverlayVisible() { return g_visible.load(std::memory_order_acquire); }
NexusCursorState NexusGetCursorState() {
    NexusCursorState state;
    state.xNorm = g_cursorX.load(std::memory_order_relaxed);
    state.yNorm = g_cursorY.load(std::memory_order_relaxed);
    state.valid = g_cursorValid.load(std::memory_order_acquire);
    return state;
}

bool NexusGetNewFrame(uint64_t lastSequence, NexusFrame& output) {
    std::lock_guard<std::mutex> guard(g_mutex);
    if (g_latest.sequence == 0 || g_latest.sequence == lastSequence) return false;
    output = g_latest;
    return true;
}

void NexusPipeReaderLoop() {
    const std::wstring pipeName = L"\\\\.\\pipe\\nexus-overlay-" + std::to_wstring(GetCurrentProcessId());
    bool firstFrameSeen = false;
    for (;;) {
        HANDLE pipe = CreateFileW(pipeName.c_str(), GENERIC_READ, 0, nullptr, OPEN_EXISTING, 0, nullptr);
        if (pipe == INVALID_HANDLE_VALUE) {
            Sleep(700);
            continue;
        }
        OutputDebugStringW(L"[Nexus] Connected to Electron pipe.\n");
        NexusTrace("PIPE_CONNECTED");
        for (;;) {
            uint8_t header[16];
            if (!ReadExactly(pipe, header, sizeof(header))) break;
            auto u32 = [&header](size_t index) -> uint32_t {
                return uint32_t(header[index]) | uint32_t(header[index+1]) << 8 |
                       uint32_t(header[index+2]) << 16 | uint32_t(header[index+3]) << 24;
            };
            if (std::memcmp(header, "NXV1", 4) == 0) {
                // NXV1 command: uint32 visible (0/1), remaining bytes must be zero.
                if (u32(4) > 1 || u32(8) != 0 || u32(12) != 0) break;
                const bool shown = u32(4) == 1;
                if (!shown) g_cursorValid.store(false, std::memory_order_release);
                if (g_visible.exchange(shown) != shown) NexusTrace(shown ? "OVERLAY_SHOWN" : "OVERLAY_HIDDEN");
                continue;
            }
            if (std::memcmp(header, "NXC1", 4) == 0) {
                // NXC1: uint32 normalized X/Y (0..65535) and enabled (0/1).
                if (u32(4) > 65535 || u32(8) > 65535 || u32(12) > 1) break;
                g_cursorX.store(u32(4), std::memory_order_relaxed);
                g_cursorY.store(u32(8), std::memory_order_relaxed);
                g_cursorValid.store(u32(12) == 1, std::memory_order_release);
                continue;
            }
            if (std::memcmp(header, "NXF1", 4) != 0) break;
            const uint32_t width = u32(4), height = u32(8), bytes = u32(12);
            if (width == 0 || height == 0 || width > MAX_WIDTH || height > MAX_HEIGHT ||
                bytes != width * height * 4) break;
            NexusFrame next;
            next.width = width;
            next.height = height;
            next.bgra.resize(bytes);
            if (!ReadExactly(pipe, next.bgra.data(), bytes)) break;
            if (!firstFrameSeen) {
                firstFrameSeen = true;
                NexusTrace("FRAME_RECEIVED");
            }
            {
                std::lock_guard<std::mutex> guard(g_mutex);
                next.sequence = g_latest.sequence + 1;
                g_latest = std::move(next);
            }
        }
        CloseHandle(pipe);
        g_visible.store(false, std::memory_order_release);
        g_cursorValid.store(false, std::memory_order_release);
        {
            std::lock_guard<std::mutex> guard(g_mutex);
            g_latest.sequence += 1;
            g_latest.width = 0;
            g_latest.height = 0;
            g_latest.bgra.clear();
        }
        OutputDebugStringW(L"[Nexus] Pipe disconnected; retrying.\n");
        Sleep(400);
    }
}
