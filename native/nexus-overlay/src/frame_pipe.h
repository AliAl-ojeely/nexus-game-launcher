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

// Normalized 0..65535 cursor position across the entire game viewport.
struct NexusCursorState { uint32_t xNorm = 0; uint32_t yNorm = 0; bool valid = false; };
NexusCursorState NexusGetCursorState();
