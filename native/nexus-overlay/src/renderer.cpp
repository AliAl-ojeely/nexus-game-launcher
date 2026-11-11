#include "renderer.h"
#include "nexus_telemetry.h"
#include "nexus_cursor_art.h"
#include "nexus_system_cursor.h"
#include <d3dcompiler.h>
#include <algorithm>
#include <cstring>
#include <atomic>
#include <mutex>
#include <vector>
#include <utility>

using Microsoft::WRL::ComPtr;
namespace {
constexpr const char* SHADER = R"(
cbuffer NexusConstants : register(b0) {
    float4 rect;       // x,y,width,height in pixels
    float4 targetSize; // backbuffer dimensions
};
struct VertexOut {
    float4 position : SV_POSITION;
    float2 uv : TEXCOORD0;
};
VertexOut VertexMain(uint vertexId : SV_VertexID) {
    float2 uv[6] = {
        float2(0,0), float2(1,0), float2(0,1),
        float2(0,1), float2(1,0), float2(1,1)
    };
    VertexOut result;
    result.uv = uv[vertexId];
    float2 p = rect.xy + result.uv * rect.zw;
    float2 clipPos = float2(p.x / targetSize.x * 2.0 - 1.0,
                           1.0 - p.y / targetSize.y * 2.0);
    result.position = float4(clipPos, 0, 1);
    return result;
}
Texture2D overlayTexture : register(t0);
SamplerState overlaySampler : register(s0);
float4 PixelMain(VertexOut input) : SV_TARGET {
    return overlayTexture.Sample(overlaySampler, input.uv);
}
)";
struct Constants {
    float rect[4];
    float target[4];
};

// Stores only the D3D11 pipeline slots modified by this POC renderer.
// Experimental: advanced renderers using class-linked shaders or OM UAVs may need fuller state isolation.
struct ScopedPipeline {
    ID3D11DeviceContext* ctx;
    ComPtr<ID3D11RenderTargetView> rtv;
    ComPtr<ID3D11DepthStencilView> dsv;
    ComPtr<ID3D11BlendState> blend;
    ComPtr<ID3D11DepthStencilState> depth;
    ComPtr<ID3D11RasterizerState> raster;
    ComPtr<ID3D11InputLayout> layout;
    ComPtr<ID3D11VertexShader> vs;
    ComPtr<ID3D11PixelShader> ps;
    ComPtr<ID3D11GeometryShader> gs;
    ComPtr<ID3D11HullShader> hs;
    ComPtr<ID3D11DomainShader> ds;
    ComPtr<ID3D11Buffer> vsCB;
    ComPtr<ID3D11ShaderResourceView> psSRV;
    ComPtr<ID3D11SamplerState> psSampler;
    FLOAT blendFactor[4]{};
    UINT sampleMask = 0;
    UINT stencilRef = 0;
    D3D11_PRIMITIVE_TOPOLOGY topology = D3D11_PRIMITIVE_TOPOLOGY_UNDEFINED;
    D3D11_VIEWPORT viewports[D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE]{};
    UINT viewportCount = D3D11_VIEWPORT_AND_SCISSORRECT_OBJECT_COUNT_PER_PIPELINE;

    explicit ScopedPipeline(ID3D11DeviceContext* context) : ctx(context) {
        ctx->OMGetRenderTargets(1, rtv.GetAddressOf(), dsv.GetAddressOf());
        ctx->OMGetBlendState(blend.GetAddressOf(), blendFactor, &sampleMask);
        ctx->OMGetDepthStencilState(depth.GetAddressOf(), &stencilRef);
        ctx->RSGetState(raster.GetAddressOf());
        ctx->RSGetViewports(&viewportCount, viewports);
        ctx->IAGetInputLayout(layout.GetAddressOf());
        ctx->IAGetPrimitiveTopology(&topology);
        ctx->VSGetShader(vs.GetAddressOf(), nullptr, nullptr);
        ctx->PSGetShader(ps.GetAddressOf(), nullptr, nullptr);
        ctx->GSGetShader(gs.GetAddressOf(), nullptr, nullptr);
        ctx->HSGetShader(hs.GetAddressOf(), nullptr, nullptr);
        ctx->DSGetShader(ds.GetAddressOf(), nullptr, nullptr);
        ctx->VSGetConstantBuffers(0, 1, vsCB.GetAddressOf());
        ctx->PSGetShaderResources(0, 1, psSRV.GetAddressOf());
        ctx->PSGetSamplers(0, 1, psSampler.GetAddressOf());
    }
    ~ScopedPipeline() {
        ctx->OMSetRenderTargets(1, rtv.GetAddressOf(), dsv.Get());
        ctx->OMSetBlendState(blend.Get(), blendFactor, sampleMask);
        ctx->OMSetDepthStencilState(depth.Get(), stencilRef);
        ctx->RSSetState(raster.Get());
        ctx->RSSetViewports(viewportCount, viewportCount ? viewports : nullptr);
        ctx->IASetInputLayout(layout.Get());
        ctx->IASetPrimitiveTopology(topology);
        ctx->VSSetShader(vs.Get(), nullptr, 0);
        ctx->PSSetShader(ps.Get(), nullptr, 0);
        ctx->GSSetShader(gs.Get(), nullptr, 0);
        ctx->HSSetShader(hs.Get(), nullptr, 0);
        ctx->DSSetShader(ds.Get(), nullptr, 0);
        ctx->VSSetConstantBuffers(0, 1, vsCB.GetAddressOf());
        ctx->PSSetShaderResources(0, 1, psSRV.GetAddressOf());
        ctx->PSSetSamplers(0, 1, psSampler.GetAddressOf());
    }
};
}

bool NexusD3D11Renderer::Initialise(ID3D11Device* device) {
    device_ = device;
    vertexShader_.Reset(); pixelShader_.Reset(); constants_.Reset();
    texture_.Reset(); shaderResource_.Reset(); sampler_.Reset();
    cursorTexture_.Reset(); cursorSRV_.Reset();
    cursorWidth_ = cursorHeight_ = cursorHotX_ = cursorHotY_ = 0;
    blend_.Reset(); depth_.Reset(); raster_.Reset();
    uploadedSequence_ = 0;
    imageWidth_ = imageHeight_ = 0;

    ComPtr<ID3DBlob> vs, ps, errors;
    if (FAILED(D3DCompile(SHADER, strlen(SHADER), "nexus_overlay", nullptr, nullptr,
                          "VertexMain", "vs_4_0", 0, 0, vs.GetAddressOf(), errors.GetAddressOf()))) {
        OutputDebugStringA(errors ? static_cast<char*>(errors->GetBufferPointer()) : "Nexus VS compile failed\n");
        return false;
    }
    errors.Reset();
    if (FAILED(D3DCompile(SHADER, strlen(SHADER), "nexus_overlay", nullptr, nullptr,
                          "PixelMain", "ps_4_0", 0, 0, ps.GetAddressOf(), errors.GetAddressOf()))) {
        OutputDebugStringA(errors ? static_cast<char*>(errors->GetBufferPointer()) : "Nexus PS compile failed\n");
        return false;
    }
    if (FAILED(device->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(), nullptr,
                                          vertexShader_.GetAddressOf()))) return false;
    if (FAILED(device->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(), nullptr,
                                         pixelShader_.GetAddressOf()))) return false;

    D3D11_BUFFER_DESC cbd{};
    cbd.ByteWidth = sizeof(Constants);
    cbd.Usage = D3D11_USAGE_DEFAULT;
    cbd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    if (FAILED(device->CreateBuffer(&cbd, nullptr, constants_.GetAddressOf()))) return false;

    D3D11_SAMPLER_DESC sd{};
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MaxLOD = D3D11_FLOAT32_MAX;
    if (FAILED(device->CreateSamplerState(&sd, sampler_.GetAddressOf()))) return false;

    D3D11_BLEND_DESC bd{};
    bd.RenderTarget[0].BlendEnable = TRUE;
    bd.RenderTarget[0].SrcBlend = D3D11_BLEND_ONE; // Chromium bitmap uses premultiplied alpha.
    bd.RenderTarget[0].DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOp = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].SrcBlendAlpha = D3D11_BLEND_ONE;
    bd.RenderTarget[0].DestBlendAlpha = D3D11_BLEND_INV_SRC_ALPHA;
    bd.RenderTarget[0].BlendOpAlpha = D3D11_BLEND_OP_ADD;
    bd.RenderTarget[0].RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    if (FAILED(device->CreateBlendState(&bd, blend_.GetAddressOf()))) return false;

    D3D11_DEPTH_STENCIL_DESC dd{};
    dd.DepthEnable = FALSE;
    dd.StencilEnable = FALSE;
    if (FAILED(device->CreateDepthStencilState(&dd, depth_.GetAddressOf()))) return false;

    D3D11_RASTERIZER_DESC rd{};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;
    rd.DepthClipEnable = TRUE;
    rd.ScissorEnable = FALSE;
    if (FAILED(device->CreateRasterizerState(&rd, raster_.GetAddressOf()))) return false;
    // Use the user's configured Windows normal-select pointer. The renderer
    // still composites it into DXGI because games may hide the hardware cursor
    // in fullscreen. Keep our previous cursor artwork as a safe fallback.
    nexus_system_cursor::Image systemCursor;
    const bool fromWindows = nexus_system_cursor::LoadConfiguredArrow(systemCursor);
    const std::vector<uint8_t> cursorPixels = fromWindows
        ? std::move(systemCursor.pixels) : nexus_cursor_art::pixelsBGRA();
    cursorWidth_ = fromWindows ? systemCursor.width : nexus_cursor_art::kWidth;
    cursorHeight_ = fromWindows ? systemCursor.height : nexus_cursor_art::kHeight;
    cursorHotX_ = fromWindows ? systemCursor.hotX : 0;
    cursorHotY_ = fromWindows ? systemCursor.hotY : 0;
    NexusTrace(fromWindows ? "SYSTEM_CURSOR_LOADED" : "SYSTEM_CURSOR_FALLBACK");
    D3D11_TEXTURE2D_DESC td{};
    td.Width = cursorWidth_;
    td.Height = cursorHeight_;
    td.MipLevels = 1;
    td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_IMMUTABLE;
    td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA source{};
    source.pSysMem = cursorPixels.data();
    source.SysMemPitch = cursorWidth_ * 4;
    if (FAILED(device->CreateTexture2D(&td, &source, cursorTexture_.GetAddressOf()))) return false;
    if (FAILED(device->CreateShaderResourceView(cursorTexture_.Get(), nullptr, cursorSRV_.GetAddressOf()))) return false;
    return true;
}

bool NexusD3D11Renderer::UpdateImage(ID3D11DeviceContext* ctx, const NexusFrame& frame) {
    if (frame.width == 0 || frame.height == 0 || frame.bgra.empty()) return false;
    if (!texture_ || frame.width != imageWidth_ || frame.height != imageHeight_) {
        shaderResource_.Reset(); texture_.Reset();
        D3D11_TEXTURE2D_DESC td{};
        td.Width = frame.width;
        td.Height = frame.height;
        td.MipLevels = 1;
        td.ArraySize = 1;
        td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
        td.SampleDesc.Count = 1;
        td.Usage = D3D11_USAGE_DYNAMIC;
        td.BindFlags = D3D11_BIND_SHADER_RESOURCE;
        td.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
        if (FAILED(device_->CreateTexture2D(&td, nullptr, texture_.GetAddressOf()))) return false;
        if (FAILED(device_->CreateShaderResourceView(texture_.Get(), nullptr,
                                                      shaderResource_.GetAddressOf()))) return false;
        imageWidth_ = frame.width;
        imageHeight_ = frame.height;
    }
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(ctx->Map(texture_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &mapped))) return false;
    const size_t srcPitch = size_t(frame.width) * 4;
    for (uint32_t y = 0; y < frame.height; ++y) {
        memcpy(static_cast<uint8_t*>(mapped.pData) + size_t(y) * mapped.RowPitch,
               frame.bgra.data() + size_t(y) * srcPitch, srcPitch);
    }
    ctx->Unmap(texture_.Get(), 0);
    uploadedSequence_ = frame.sequence;
    return true;
}

void NexusD3D11Renderer::Draw(IDXGISwapChain* chain) {
    if (!NexusOverlayVisible()) return;
    ComPtr<ID3D11Device> incoming;
    if (FAILED(chain->GetDevice(IID_PPV_ARGS(incoming.GetAddressOf())))) return;
    if (device_.Get() != incoming.Get()) {
        if (!Initialise(incoming.Get())) return;
    }
    NexusFrame next;
    if (NexusGetNewFrame(uploadedSequence_, next)) latestFrame_ = std::move(next);
    if (latestFrame_.width == 0 || latestFrame_.bgra.empty()) return;
    ComPtr<ID3D11DeviceContext> ctx;
    incoming->GetImmediateContext(ctx.GetAddressOf());
    if (!ctx) return;
    if (uploadedSequence_ != latestFrame_.sequence && !UpdateImage(ctx.Get(), latestFrame_)) return;

    ComPtr<ID3D11Texture2D> backBuffer;
    if (FAILED(chain->GetBuffer(0, IID_PPV_ARGS(backBuffer.GetAddressOf())))) return;
    D3D11_TEXTURE2D_DESC desc{};
    backBuffer->GetDesc(&desc);
    if (!desc.Width || !desc.Height || desc.SampleDesc.Count > 1) return;
    ComPtr<ID3D11RenderTargetView> target;
    if (FAILED(incoming->CreateRenderTargetView(backBuffer.Get(), nullptr, target.GetAddressOf()))) return;

    ScopedPipeline saved(ctx.Get());
    D3D11_VIEWPORT vp{};
    vp.TopLeftX = 0;
    vp.TopLeftY = 0;
    vp.Width = static_cast<float>(desc.Width);
    vp.Height = static_cast<float>(desc.Height);
    vp.MinDepth = 0; vp.MaxDepth = 1;
    ctx->RSSetViewports(1, &vp);
    ctx->RSSetState(raster_.Get());
    ID3D11RenderTargetView* renderTargets[] = { target.Get() };
    ctx->OMSetRenderTargets(1, renderTargets, nullptr);
    const FLOAT factor[4] = {0,0,0,0};
    ctx->OMSetBlendState(blend_.Get(), factor, 0xffffffff);
    ctx->OMSetDepthStencilState(depth_.Get(), 0);
    ctx->IASetInputLayout(nullptr);
    ctx->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    ctx->VSSetShader(vertexShader_.Get(), nullptr, 0);
    ctx->PSSetShader(pixelShader_.Get(), nullptr, 0);
    ctx->GSSetShader(nullptr, nullptr, 0);
    ctx->HSSetShader(nullptr, nullptr, 0);
    ctx->DSSetShader(nullptr, nullptr, 0);
    ID3D11ShaderResourceView* srv[] = {shaderResource_.Get()};
    ID3D11SamplerState* sampler[] = {sampler_.Get()};
    ID3D11Buffer* cb[] = {constants_.Get()};
    ctx->PSSetShaderResources(0, 1, srv);
    ctx->PSSetSamplers(0, 1, sampler);
    ctx->VSSetConstantBuffers(0, 1, cb);
    // Anchor the widget to the top-right, independent of the game resolution.
    // This is composited into the game's back buffer, not a topmost HWND.
    const float x = std::max(8.f, static_cast<float>(desc.Width) - float(imageWidth_) - 24.f);
    Constants data{
        {x, 24.f, float(imageWidth_), float(imageHeight_)},
        {float(desc.Width), float(desc.Height), 0.f, 0.f}
    };
    ctx->UpdateSubresource(constants_.Get(), 0, nullptr, &data, 0, 0);
    ctx->Draw(6, 0);
    // Draw the mouse arrow in the *entire* game's backbuffer, after the HTML.
    // Cursor updates are independent of Electron's offscreen frame rate.
    const NexusCursorState cursor = NexusGetCursorState();
    if (cursor.valid && cursorSRV_) {
        const float cx = float(cursor.xNorm) * float(desc.Width - 1) / 65535.f;
        const float cy = float(cursor.yNorm) * float(desc.Height - 1) / 65535.f;
        const Constants pointerData{
            {cx - float(cursorHotX_), cy - float(cursorHotY_), float(cursorWidth_), float(cursorHeight_)},
            {float(desc.Width), float(desc.Height), 0.f, 0.f}
        };
        ID3D11ShaderResourceView* cursorView[] = {cursorSRV_.Get()};
        ctx->PSSetShaderResources(0, 1, cursorView);
        ctx->UpdateSubresource(constants_.Get(), 0, nullptr, &pointerData, 0, 0);
        ctx->Draw(6, 0);
        // Preserve the v0.6.3 native cursor telemetry in the released build.
        static std::atomic_flag firstCursorDraw = ATOMIC_FLAG_INIT;
        if (!firstCursorDraw.test_and_set()) NexusTrace("CURSOR_DRAWN");
    }
    static std::atomic_flag firstDraw = ATOMIC_FLAG_INIT;
    if (!firstDraw.test_and_set()) NexusTrace("FRAME_DRAWN");
}
