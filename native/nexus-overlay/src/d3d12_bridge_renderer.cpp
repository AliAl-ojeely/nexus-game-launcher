// DXGI D3D12 back-buffer -> D3D11On12 overlay compositor.
// Limited pilot: SDR flip-model swap chains, uniquely observed DIRECT queue.
// Backend is independent from NexusOverlayHook.dll (stable D3D11 backend).
#include "d3d12_bridge_renderer.h"
#include "nexus_cursor_art.h"
#include "nexus_system_cursor.h"
#include "nexus_telemetry.h"
#include <d3dcompiler.h>
#include <algorithm>
#include <atomic>
#include <cstring>
#include <utility>
#include <vector>

using Microsoft::WRL::ComPtr;
namespace {
constexpr char kShader[] = R"(
cbuffer NexusConstants : register(b0) { float4 rect; float4 target; };
struct VSOut { float4 position : SV_POSITION; float2 uv : TEXCOORD0; };
VSOut VSMain(uint id : SV_VertexID) {
    float2 uv[6] = { float2(0,0),float2(1,0),float2(0,1),
                     float2(0,1),float2(1,0),float2(1,1) };
    VSOut o; o.uv=uv[id]; float2 xy=rect.xy+rect.zw*o.uv;
    o.position=float4(2.0*xy.x/target.x-1.0,1.0-2.0*xy.y/target.y,0,1);
    return o;
}
Texture2D tex : register(t0);
SamplerState sampling : register(s0);
float4 PSMain(VSOut i) : SV_TARGET { return tex.Sample(sampling,i.uv); }
)";
struct Constants { float rect[4]; float target[4]; };
bool AllowedFormat(DXGI_FORMAT format) {
    // HDR requires color-space-aware composition, not yet available here.
    return format == DXGI_FORMAT_R8G8B8A8_UNORM || format == DXGI_FORMAT_B8G8R8A8_UNORM ||
           format == DXGI_FORMAT_R8G8B8A8_UNORM_SRGB || format == DXGI_FORMAT_B8G8R8A8_UNORM_SRGB;
}
}
void NexusD3D12Bridge::Reset() {
    if (context_) { context_->ClearState(); context_->Flush(); }
    cursorSRV_.Reset(); cursorTexture_.Reset(); srv_.Reset(); texture_.Reset();
    raster_.Reset(); depth_.Reset(); blend_.Reset(); sampler_.Reset();
    constant_.Reset(); pixel_.Reset(); vertex_.Reset();
    on12_.Reset(); context_.Reset(); d11_.Reset(); queue_.Reset(); d12_.Reset();
    frame_ = NexusFrame{};
    imageW_ = imageH_ = cursorW_ = cursorH_ = uploadSequence_ = 0;
    hotX_ = hotY_ = 0;
}
bool NexusD3D12Bridge::Initialize(ID3D12Device* device, ID3D12CommandQueue* queue) {
    Reset();
    // Must be the game's observed queue. A new independent queue would NOT be
    // suitable for the game's swap-chain presentation ordering.
    IUnknown* queues[1] = { queue };
    D3D_FEATURE_LEVEL levels[] = { D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0 };
    HRESULT hr = D3D11On12CreateDevice(device, D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        levels, 2, queues, 1, 0, d11_.GetAddressOf(), context_.GetAddressOf(), nullptr);
    if (FAILED(hr) || !d11_ || !context_ || FAILED(d11_.As(&on12_))) {
        static std::atomic_flag once = ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D12_ON12_CREATE_FAILED");
        Reset(); return false;
    }
    ComPtr<ID3DBlob> vs, ps, errors;
    hr = D3DCompile(kShader, std::strlen(kShader), "nexus-dx12-bridge", nullptr, nullptr,
                    "VSMain", "vs_5_0", 0, 0, vs.GetAddressOf(), errors.GetAddressOf());
    if (FAILED(hr)) { Reset(); return false; }
    errors.Reset();
    hr = D3DCompile(kShader, std::strlen(kShader), "nexus-dx12-bridge", nullptr, nullptr,
                    "PSMain", "ps_5_0", 0, 0, ps.GetAddressOf(), errors.GetAddressOf());
    if (FAILED(hr) || FAILED(d11_->CreateVertexShader(vs->GetBufferPointer(), vs->GetBufferSize(),
            nullptr, vertex_.GetAddressOf())) ||
        FAILED(d11_->CreatePixelShader(ps->GetBufferPointer(), ps->GetBufferSize(),
            nullptr, pixel_.GetAddressOf()))) { Reset(); return false; }
    D3D11_BUFFER_DESC cb{};
    cb.ByteWidth=sizeof(Constants); cb.Usage=D3D11_USAGE_DEFAULT;
    cb.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
    if (FAILED(d11_->CreateBuffer(&cb,nullptr,constant_.GetAddressOf()))) { Reset(); return false; }
    D3D11_SAMPLER_DESC sd{};
    sd.Filter=D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU=sd.AddressV=sd.AddressW=D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MaxLOD=D3D11_FLOAT32_MAX;
    if (FAILED(d11_->CreateSamplerState(&sd,sampler_.GetAddressOf()))) { Reset(); return false; }
    D3D11_BLEND_DESC bd{};
    auto& rt=bd.RenderTarget[0]; rt.BlendEnable=TRUE;
    rt.SrcBlend=D3D11_BLEND_ONE; rt.DestBlend=D3D11_BLEND_INV_SRC_ALPHA;
    rt.BlendOp=D3D11_BLEND_OP_ADD;
    rt.SrcBlendAlpha=D3D11_BLEND_ONE; rt.DestBlendAlpha=D3D11_BLEND_INV_SRC_ALPHA;
    rt.BlendOpAlpha=D3D11_BLEND_OP_ADD;
    rt.RenderTargetWriteMask=D3D11_COLOR_WRITE_ENABLE_ALL;
    if (FAILED(d11_->CreateBlendState(&bd,blend_.GetAddressOf()))) { Reset(); return false; }
    D3D11_DEPTH_STENCIL_DESC dd{};
    dd.DepthEnable=FALSE; dd.StencilEnable=FALSE;
    if (FAILED(d11_->CreateDepthStencilState(&dd,depth_.GetAddressOf()))) { Reset(); return false; }
    D3D11_RASTERIZER_DESC rs{};
    rs.FillMode=D3D11_FILL_SOLID; rs.CullMode=D3D11_CULL_NONE;
    rs.DepthClipEnable=TRUE;
    if (FAILED(d11_->CreateRasterizerState(&rs,raster_.GetAddressOf()))) { Reset(); return false; }

    nexus_system_cursor::Image system;
    const bool fromWindows=nexus_system_cursor::LoadConfiguredArrow(system);
    const std::vector<uint8_t> pixels = fromWindows ? std::move(system.pixels) : nexus_cursor_art::pixelsBGRA();
    cursorW_=fromWindows?system.width:nexus_cursor_art::kWidth;
    cursorH_=fromWindows?system.height:nexus_cursor_art::kHeight;
    hotX_=fromWindows?system.hotX:0; hotY_=fromWindows?system.hotY:0;
    NexusTrace(fromWindows ? "SYSTEM_CURSOR_LOADED" : "SYSTEM_CURSOR_FALLBACK");
    D3D11_TEXTURE2D_DESC ct{};
    ct.Width=cursorW_; ct.Height=cursorH_; ct.MipLevels=1; ct.ArraySize=1;
    ct.Format=DXGI_FORMAT_B8G8R8A8_UNORM; ct.SampleDesc.Count=1;
    ct.Usage=D3D11_USAGE_IMMUTABLE; ct.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    D3D11_SUBRESOURCE_DATA init{}; init.pSysMem=pixels.data(); init.SysMemPitch=cursorW_*4;
    if (!cursorW_ || !cursorH_ || FAILED(d11_->CreateTexture2D(&ct,&init,cursorTexture_.GetAddressOf())) ||
        FAILED(d11_->CreateShaderResourceView(cursorTexture_.Get(),nullptr,cursorSRV_.GetAddressOf()))) {
        Reset(); return false;
    }
    d12_=device; queue_=queue;
    NexusTrace("D3D12_RENDERER_INITIALIZED");
    return true;
}
bool NexusD3D12Bridge::Upload(const NexusFrame& frame) {
    if (!frame.width || !frame.height || frame.bgra.size()!=size_t(frame.width)*frame.height*4) return false;
    if (!texture_ || frame.width!=imageW_ || frame.height!=imageH_) {
        srv_.Reset(); texture_.Reset();
        D3D11_TEXTURE2D_DESC d{};
        d.Width=frame.width; d.Height=frame.height; d.ArraySize=1; d.MipLevels=1;
        d.Format=DXGI_FORMAT_B8G8R8A8_UNORM; d.SampleDesc.Count=1;
        d.Usage=D3D11_USAGE_DYNAMIC; d.BindFlags=D3D11_BIND_SHADER_RESOURCE;
        d.CPUAccessFlags=D3D11_CPU_ACCESS_WRITE;
        if (FAILED(d11_->CreateTexture2D(&d,nullptr,texture_.GetAddressOf())) ||
            FAILED(d11_->CreateShaderResourceView(texture_.Get(),nullptr,srv_.GetAddressOf()))) return false;
        imageW_=frame.width; imageH_=frame.height;
    }
    D3D11_MAPPED_SUBRESOURCE map{};
    if (FAILED(context_->Map(texture_.Get(),0,D3D11_MAP_WRITE_DISCARD,0,&map))) return false;
    const size_t rowBytes=size_t(frame.width)*4;
    for (uint32_t y=0;y<frame.height;++y) {
        std::memcpy(static_cast<uint8_t*>(map.pData)+size_t(y)*map.RowPitch,
                    frame.bgra.data()+size_t(y)*rowBytes,rowBytes);
    }
    context_->Unmap(texture_.Get(),0);
    uploadSequence_=frame.sequence;
    return true;
}
bool NexusD3D12Bridge::DrawToWrapped(ID3D11Texture2D* wrapped, unsigned width, unsigned height) {
    ComPtr<ID3D11RenderTargetView> rtv;
    if (FAILED(d11_->CreateRenderTargetView(wrapped,nullptr,rtv.GetAddressOf()))) return false;
    D3D11_VIEWPORT vp{};
    vp.Width=float(width); vp.Height=float(height); vp.MinDepth=0; vp.MaxDepth=1;
    context_->RSSetViewports(1,&vp);
    context_->RSSetState(raster_.Get());
    ID3D11RenderTargetView* rtvs[]={rtv.Get()};
    context_->OMSetRenderTargets(1,rtvs,nullptr);
    const FLOAT factor[4]={0,0,0,0};
    context_->OMSetBlendState(blend_.Get(),factor,0xffffffff);
    context_->OMSetDepthStencilState(depth_.Get(),0);
    context_->IASetInputLayout(nullptr);
    context_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
    context_->VSSetShader(vertex_.Get(),nullptr,0);
    context_->PSSetShader(pixel_.Get(),nullptr,0);
    context_->GSSetShader(nullptr,nullptr,0);
    ID3D11SamplerState* samp[]={sampler_.Get()};
    ID3D11Buffer* cb[]={constant_.Get()};
    context_->PSSetSamplers(0,1,samp);
    context_->VSSetConstantBuffers(0,1,cb);
    auto quad=[this,width,height](ID3D11ShaderResourceView* view,
                                  float x,float y,float w,float h) {
        const Constants values{{x,y,w,h},{float(width),float(height),0,0}};
        context_->UpdateSubresource(constant_.Get(),0,nullptr,&values,0,0);
        ID3D11ShaderResourceView* views[]={view};
        context_->PSSetShaderResources(0,1,views);
        context_->Draw(6,0);
    };
    const float x=std::max(8.f,float(width)-float(imageW_)-24.f);
    quad(srv_.Get(),x,24.f,float(imageW_),float(imageH_));
    const NexusCursorState cursor=NexusGetCursorState();
    if (cursor.valid && cursorSRV_) {
        const float cx=float(cursor.xNorm)*float(width-1)/65535.f;
        const float cy=float(cursor.yNorm)*float(height-1)/65535.f;
        quad(cursorSRV_.Get(),cx-float(hotX_),cy-float(hotY_),float(cursorW_),float(cursorH_));
        static std::atomic_flag cursorTrace=ATOMIC_FLAG_INIT;
        if (!cursorTrace.test_and_set()) NexusTrace("CURSOR_DRAWN");
    }
    ID3D11ShaderResourceView* clearView[]={nullptr};
    context_->PSSetShaderResources(0,1,clearView);
    context_->OMSetRenderTargets(0,nullptr,nullptr);
    return true;
}
bool NexusD3D12Bridge::Draw(IDXGISwapChain* chain, ID3D12Device* device, ID3D12CommandQueue* queue) {
    if (!NexusOverlayVisible() || !chain || !device || !queue) return false;
    ComPtr<IDXGISwapChain3> chain3;
    if (FAILED(chain->QueryInterface(IID_PPV_ARGS(chain3.GetAddressOf())))) {
        static std::atomic_flag once=ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D12_SWAPCHAIN3_UNAVAILABLE");
        return false;
    }
    // Read the CURRENT buffer index, never assume GetBuffer(0) is being presented.
    const unsigned index=chain3->GetCurrentBackBufferIndex();
    ComPtr<ID3D12Resource> backBuffer;
    if (FAILED(chain3->GetBuffer(index,IID_PPV_ARGS(backBuffer.GetAddressOf())))) return false;
    const auto desc=backBuffer->GetDesc();
    if (!desc.Width || !desc.Height || desc.Width>32768 || desc.Height>32768 ||
        desc.SampleDesc.Count!=1 || !AllowedFormat(desc.Format)) {
        static std::atomic_flag once=ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D12_BACKBUFFER_FORMAT_UNSUPPORTED");
        return false;
    }
    if (d12_.Get()!=device || queue_.Get()!=queue || !on12_) {
        if (!Initialize(device,queue)) return false;
    }
    NexusFrame incoming;
    if (NexusGetNewFrame(uploadSequence_,incoming)) frame_=std::move(incoming);
    if (frame_.bgra.empty() || !frame_.width || !frame_.height) return false;
    if (frame_.sequence!=uploadSequence_ && !Upload(frame_)) return false;
    D3D11_RESOURCE_FLAGS rflags{}; rflags.BindFlags=D3D11_BIND_RENDER_TARGET;
    ComPtr<ID3D11Texture2D> wrapped;
    // The game already finished its D3D12 render and transitioned to PRESENT.
    // Acquire/Release handles barriers and returns the buffer to PRESENT.
    HRESULT hr=on12_->CreateWrappedResource(backBuffer.Get(), &rflags,
        D3D12_RESOURCE_STATE_PRESENT, D3D12_RESOURCE_STATE_PRESENT,
        IID_PPV_ARGS(wrapped.GetAddressOf()));
    if (FAILED(hr) || !wrapped) {
        static std::atomic_flag once=ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D12_CREATE_WRAPPED_FAILED");
        return false;
    }
    ID3D11Resource* resources[]={wrapped.Get()};
    on12_->AcquireWrappedResources(resources,1);
    const bool drawn=DrawToWrapped(wrapped.Get(),static_cast<UINT>(desc.Width),desc.Height);
    on12_->ReleaseWrappedResources(resources,1);
    // Submit to the SAME queue before the game calls IDXGISwapChain::Present.
    context_->Flush();
    // Do not retain wrapped back-buffer COM refs across ResizeBuffers. Clear the
    // private D3D11On12 context so normal game resize can proceed unimpeded.
    context_->ClearState();
    context_->Flush();
    wrapped.Reset(); backBuffer.Reset();
    if (drawn) {
        static std::atomic_flag first=ATOMIC_FLAG_INIT;
        if (!first.test_and_set()) NexusTrace("FRAME_DRAWN");
    }
    return drawn;
}
