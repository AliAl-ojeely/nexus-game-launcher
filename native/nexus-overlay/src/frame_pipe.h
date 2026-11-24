#pragma once
#include <cstdint>
#include <vector>

struct NexusFrame {
    uint32_t width = 0;
    uint32_t height = 0;
    uint64_t sequence = 0;
    std::vector<uint8_t> bgra;
};

// Blocking pipe reader: run in a worker thread, never on the Present thread.
void NexusPipeReaderLoop();
bool NexusGetNewFrame(uint64_t lastSequence, NexusFrame& output);
bool NexusOverlayVisible();
// 0=TL 1=TR 2=BL 3=BR. Bounded NXP1 placement, no screen coordinate injection.
uint32_t NexusOverlayCorner();
struct NexusWidgetOrigin { float x = 24.f; float y = 24.f; };
NexusWidgetOrigin NexusComputeWidgetOrigin(uint32_t screenWidth, uint32_t screenHeight,
    uint32_t widgetWidth, uint32_t widgetHeight);

// Normalized 0..65535 cursor position across the entire game viewport.
struct NexusCursorState { uint32_t xNorm = 0; uint32_t yNorm = 0; bool valid = false; };
NexusCursorState NexusGetCursorState();
