// Direct3D9 renderer (separate DLL, does not touch D3D11 or OpenGL backends).
// The Electron pipe sends BGRA that is ALREADY premultiplied by Alpha.
#include "d3d9_renderer.h"
#include "nexus_telemetry.h"
#include "nexus_system_cursor.h"
#include "nexus_cursor_art.h"
#include <algorithm>
#include <atomic>
#include <cstring>
#include <utility>

namespace {
struct Vertex { float x, y, z, rhw, u, v; };
constexpr DWORD kFVF = D3DFVF_XYZRHW | D3DFVF_TEX1;
constexpr int kMargin = 24;
std::atomic_flag g_firstInit = ATOMIC_FLAG_INIT;
std::atomic_flag g_firstDraw = ATOMIC_FLAG_INIT;
std::atomic_flag g_firstCursor = ATOMIC_FLAG_INIT;

// Stateblocks do not restore current RT or viewport reliably; save these
// manually, and restore even if BeginScene or a draw fails.
class ScopedD3D9State final {
public:
    explicit ScopedD3D9State(IDirect3DDevice9* d) : device(d) {
        if (FAILED(d->CreateStateBlock(D3DSBT_ALL, &block)) || !block) return;
        if (FAILED(block->Capture())) return;
        d->GetRenderTarget(0, &renderTarget);
        d->GetDepthStencilSurface(&depth);
        d->GetViewport(&viewport);
        valid = true;
    }
    ~ScopedD3D9State() {
        if (valid) {
            if (renderTarget) device->SetRenderTarget(0, renderTarget);
            device->SetDepthStencilSurface(depth); // nullptr is valid here
            device->SetViewport(&viewport);
            block->Apply();
        }
        if (renderTarget) renderTarget->Release();
        if (depth) depth->Release();
        if (block) block->Release();
    }
    bool valid = false;
private:
    IDirect3DDevice9* device;
    IDirect3DStateBlock9* block = nullptr;
    IDirect3DSurface9* renderTarget = nullptr;
    IDirect3DSurface9* depth = nullptr;
    D3DVIEWPORT9 viewport{};
};
} // namespace

void NexusD3D9Renderer::ReleaseResources() {
    if (image_) { image_->Release(); image_ = nullptr; }
    if (cursor_) { cursor_->Release(); cursor_ = nullptr; }
    imageWidth_ = imageHeight_ = cursorWidth_ = cursorHeight_ = 0;
    cursorHotX_ = cursorHotY_ = 0;
    lastSequence_ = 0;
    frame_ = NexusFrame{};
    ready_ = false;
}
void NexusD3D9Renderer::ReleaseForReset(IDirect3DDevice9* device) {
    if (device_ == device) ReleaseResources();
}

bool NexusD3D9Renderer::UpdateTexture(IDirect3DTexture9* texture, unsigned w, unsigned h,
                                       const std::vector<uint8_t>& bgra) {
    if (!texture || w == 0 || h == 0 || w > 2048 || h > 2048 ||
        bgra.size() != size_t(w) * h * 4) return false;
    D3DLOCKED_RECT lock{};
    if (FAILED(texture->LockRect(0, &lock, nullptr, D3DLOCK_DISCARD))) return false;
    for (unsigned y = 0; y < h; ++y)
        std::memcpy(static_cast<uint8_t*>(lock.pBits) + size_t(y) * lock.Pitch,
                    bgra.data() + size_t(y) * w * 4, size_t(w) * 4);
    texture->UnlockRect(0);
    return true;
}
bool NexusD3D9Renderer::MakeTexture(IDirect3DDevice9* device, unsigned w, unsigned h,
                                     const std::vector<uint8_t>& bgra, IDirect3DTexture9** out) {
    if (!device || !out || w == 0 || h == 0) return false;
    *out = nullptr;
    // D3DPOOL_DEFAULT also works with D3D9Ex (managed pool does not).
    if (FAILED(device->CreateTexture(w, h, 1, D3DUSAGE_DYNAMIC, D3DFMT_A8R8G8B8,
                                     D3DPOOL_DEFAULT, out, nullptr))) return false;
    if (!UpdateTexture(*out, w, h, bgra)) {
        (*out)->Release(); *out = nullptr;
        return false;
    }
    return true;
}

bool NexusD3D9Renderer::EnsureDevice(IDirect3DDevice9* device) {
    if (device_ != device) { ReleaseResources(); device_ = device; }
    if (ready_) return true;
    nexus_system_cursor::Image selected;
    const bool windowsCursor = nexus_system_cursor::LoadConfiguredArrow(selected);
    const std::vector<uint8_t> pixels = windowsCursor ? std::move(selected.pixels)
        : nexus_cursor_art::pixelsBGRA();
    cursorWidth_ = windowsCursor ? selected.width : nexus_cursor_art::kWidth;
    cursorHeight_ = windowsCursor ? selected.height : nexus_cursor_art::kHeight;
    cursorHotX_ = windowsCursor ? selected.hotX : 0;
    cursorHotY_ = windowsCursor ? selected.hotY : 0;
    if (!MakeTexture(device, cursorWidth_, cursorHeight_, pixels, &cursor_)) return false;
    NexusTrace(windowsCursor ? "SYSTEM_CURSOR_LOADED" : "SYSTEM_CURSOR_FALLBACK");
    ready_ = true;
    if (!g_firstInit.test_and_set()) NexusTrace("D3D9_RENDERER_INITIALIZED");
    return true;
}
bool NexusD3D9Renderer::UpdateImage(IDirect3DDevice9* device) {
    NexusFrame incoming;
    if (NexusGetNewFrame(lastSequence_, incoming)) {
        lastSequence_ = incoming.sequence;
        if (incoming.width == 0 || incoming.height == 0) {
            if (image_) { image_->Release(); image_ = nullptr; }
            imageWidth_ = imageHeight_ = 0;
            frame_ = NexusFrame{};
            return false;
        }
        frame_ = std::move(incoming);
        if (frame_.width != imageWidth_ || frame_.height != imageHeight_ || !image_) {
            if (image_) { image_->Release(); image_ = nullptr; }
            imageWidth_ = frame_.width; imageHeight_ = frame_.height;
            if (!MakeTexture(device, imageWidth_, imageHeight_, frame_.bgra, &image_)) return false;
        } else if (!UpdateTexture(image_, imageWidth_, imageHeight_, frame_.bgra)) return false;
    }
    return image_ != nullptr;
}

bool NexusD3D9Renderer::Quad(IDirect3DDevice9* device, IDirect3DTexture9* texture,
                              float x, float y, float width, float height) {
    if (!texture || width <= 0 || height <= 0) return false;
    // The -0.5 offset aligns D3D9 XYZRHW quads to pixel centers.
    const float left = x - 0.5f, top = y - 0.5f;
    const Vertex verts[4] = {
        {left,          top,           0.f, 1.f, 0.f, 0.f},
        {left + width,  top,           0.f, 1.f, 1.f, 0.f},
        {left,          top + height,  0.f, 1.f, 0.f, 1.f},
        {left + width,  top + height,  0.f, 1.f, 1.f, 1.f},
    };
    device->SetTexture(0, texture);
    return SUCCEEDED(device->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, 2, verts, sizeof(Vertex)));
}

void NexusD3D9Renderer::Draw(IDirect3DDevice9* device, IDirect3DSurface9* optionalBackbuffer) {
    if (!device || !NexusOverlayVisible()) return;
    if (!EnsureDevice(device) || !UpdateImage(device)) return;
    IDirect3DSurface9* back = optionalBackbuffer;
    if (back) back->AddRef();
    else if (FAILED(device->GetBackBuffer(0, 0, D3DBACKBUFFER_TYPE_MONO, &back))) {
        static std::atomic_flag once = ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D9_BACKBUFFER_UNAVAILABLE");
        return;
    }
    D3DSURFACE_DESC desc{};
    if (!back || FAILED(back->GetDesc(&desc)) || !desc.Width || !desc.Height) {
        if (back) back->Release();
        return;
    }
    {
        ScopedD3D9State saved(device);
        if (saved.valid) {
            device->SetDepthStencilSurface(nullptr);
            if (SUCCEEDED(device->SetRenderTarget(0, back))) {
                D3DVIEWPORT9 viewport{};
                viewport.Width = desc.Width; viewport.Height = desc.Height;
                viewport.MinZ = 0.f; viewport.MaxZ = 1.f;
                device->SetViewport(&viewport);
                device->SetVertexShader(nullptr);
                device->SetPixelShader(nullptr);
                device->SetFVF(kFVF);
                device->SetRenderState(D3DRS_ALPHABLENDENABLE, TRUE);
                device->SetRenderState(D3DRS_SRCBLEND, D3DBLEND_ONE); // PREMULTIPLIED
                device->SetRenderState(D3DRS_DESTBLEND, D3DBLEND_INVSRCALPHA);
                device->SetRenderState(D3DRS_BLENDOP, D3DBLENDOP_ADD);
                device->SetRenderState(D3DRS_SEPARATEALPHABLENDENABLE, FALSE);
                device->SetRenderState(D3DRS_ALPHATESTENABLE, FALSE);
                device->SetRenderState(D3DRS_ZENABLE, D3DZB_FALSE);
                device->SetRenderState(D3DRS_ZWRITEENABLE, FALSE);
                device->SetRenderState(D3DRS_STENCILENABLE, FALSE);
                device->SetRenderState(D3DRS_CULLMODE, D3DCULL_NONE);
                device->SetRenderState(D3DRS_SCISSORTESTENABLE, FALSE);
                device->SetRenderState(D3DRS_COLORWRITEENABLE, 0xF);
                device->SetRenderState(D3DRS_SRGBWRITEENABLE, FALSE);
                device->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_SELECTARG1);
                device->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE);
                device->SetTextureStageState(0, D3DTSS_ALPHAOP, D3DTOP_SELECTARG1);
                device->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
                device->SetTextureStageState(1, D3DTSS_COLOROP, D3DTOP_DISABLE);
                device->SetTextureStageState(1, D3DTSS_ALPHAOP, D3DTOP_DISABLE);
                device->SetSamplerState(0, D3DSAMP_MINFILTER, D3DTEXF_LINEAR);
                device->SetSamplerState(0, D3DSAMP_MAGFILTER, D3DTEXF_LINEAR);
                device->SetSamplerState(0, D3DSAMP_MIPFILTER, D3DTEXF_NONE);
                device->SetSamplerState(0, D3DSAMP_ADDRESSU, D3DTADDRESS_CLAMP);
                device->SetSamplerState(0, D3DSAMP_ADDRESSV, D3DTADDRESS_CLAMP);
                if (SUCCEEDED(device->BeginScene())) {
                    const float x = float(desc.Width) - float(imageWidth_) - float(kMargin);
                    const float y = float(kMargin);
                    const bool drew = Quad(device, image_, std::max(0.f, x), y, float(imageWidth_), float(imageHeight_));
                    const NexusCursorState pos = NexusGetCursorState();
                    if (pos.valid && cursor_) {
                        const float cx = float(pos.xNorm) * float(desc.Width - 1) / 65535.f;
                        const float cy = float(pos.yNorm) * float(desc.Height - 1) / 65535.f;
                        if (Quad(device, cursor_, cx - float(cursorHotX_), cy - float(cursorHotY_),
                                 float(cursorWidth_), float(cursorHeight_)) &&
                            !g_firstCursor.test_and_set()) NexusTrace("CURSOR_DRAWN");
                    }
                    device->EndScene();
                    if (drew) {
                        if (!g_firstDraw.test_and_set()) NexusTrace("FRAME_DRAWN");
                    } else {
                        static std::atomic_flag drawFail = ATOMIC_FLAG_INIT;
                        if (!drawFail.test_and_set()) NexusTrace("D3D9_DRAW_FAILED");
                    }
                } else {
                    static std::atomic_flag once = ATOMIC_FLAG_INIT;
                    if (!once.test_and_set()) NexusTrace("D3D9_BEGINSCENE_FAILED");
                }
            } else {
                static std::atomic_flag once = ATOMIC_FLAG_INIT;
                if (!once.test_and_set()) NexusTrace("D3D9_RENDER_TARGET_UNAVAILABLE");
            }
        }
    }
    back->Release();
}
