#pragma once
// Experimental Direct3D9 x86/x64 renderer for the same Electron BGRA channel.
// Called only on game rendering threads with the original game D3D9 device.
#include "frame_pipe.h"
#include <d3d9.h>
#include <cstdint>
#include <vector>

class NexusD3D9Renderer final {
public:
    void Draw(IDirect3DDevice9* device, IDirect3DSurface9* target = nullptr);
    void ReleaseForReset(IDirect3DDevice9* device);
private:
    IDirect3DDevice9* device_ = nullptr; // non-owning; never AddRef the game device
    IDirect3DTexture9* image_ = nullptr;
    IDirect3DTexture9* cursor_ = nullptr;
    unsigned imageWidth_ = 0, imageHeight_ = 0;
    unsigned cursorWidth_ = 0, cursorHeight_ = 0;
    int cursorHotX_ = 0, cursorHotY_ = 0;
    uint64_t lastSequence_ = 0;
    NexusFrame frame_;
    bool ready_ = false;
    void ReleaseResources();
    bool EnsureDevice(IDirect3DDevice9* device);
    bool UpdateImage(IDirect3DDevice9* device);
    static bool MakeTexture(IDirect3DDevice9* device, unsigned w, unsigned h,
                            const std::vector<uint8_t>& bgra, IDirect3DTexture9** out);
    static bool UpdateTexture(IDirect3DTexture9* texture, unsigned w, unsigned h,
                              const std::vector<uint8_t>& bgra);
    static bool Quad(IDirect3DDevice9* device, IDirect3DTexture9* texture,
                     float x, float y, float width, float height);
};
