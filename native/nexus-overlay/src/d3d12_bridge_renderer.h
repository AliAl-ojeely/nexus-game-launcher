#pragma once
// Experimental D3D12 -> D3D11On12 compositor. No changes to existing D3D11 DLL.
// The caller must supply a *uniquely identified* DIRECT queue belonging to the
// device of the swap-chain back buffer. Never invent a queue or share a foreign one.
#include "frame_pipe.h"
#include <d3d11.h>
#include <d3d11on12.h>
#include <d3d12.h>
#include <dxgi1_4.h>
#include <wrl/client.h>
#include <cstdint>

class NexusD3D12Bridge {
public:
    bool Draw(IDXGISwapChain* chain, ID3D12Device* device, ID3D12CommandQueue* queue);
    void Reset();
private:
    bool Initialize(ID3D12Device* device, ID3D12CommandQueue* queue);
    bool Upload(const NexusFrame& frame);
    bool DrawToWrapped(ID3D11Texture2D* wrapped, unsigned width, unsigned height);
    Microsoft::WRL::ComPtr<ID3D12Device> d12_;
    Microsoft::WRL::ComPtr<ID3D12CommandQueue> queue_;
    Microsoft::WRL::ComPtr<ID3D11Device> d11_;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> context_;
    Microsoft::WRL::ComPtr<ID3D11On12Device> on12_;
    Microsoft::WRL::ComPtr<ID3D11VertexShader> vertex_;
    Microsoft::WRL::ComPtr<ID3D11PixelShader> pixel_;
    Microsoft::WRL::ComPtr<ID3D11Buffer> constant_;
    Microsoft::WRL::ComPtr<ID3D11SamplerState> sampler_;
    Microsoft::WRL::ComPtr<ID3D11BlendState> blend_;
    Microsoft::WRL::ComPtr<ID3D11DepthStencilState> depth_;
    Microsoft::WRL::ComPtr<ID3D11RasterizerState> raster_;
    Microsoft::WRL::ComPtr<ID3D11Texture2D> texture_;
    Microsoft::WRL::ComPtr<ID3D11ShaderResourceView> srv_;
    Microsoft::WRL::ComPtr<ID3D11Texture2D> cursorTexture_;
    Microsoft::WRL::ComPtr<ID3D11ShaderResourceView> cursorSRV_;
    unsigned imageW_ = 0, imageH_ = 0;
    unsigned cursorW_ = 0, cursorH_ = 0;
    int hotX_ = 0, hotY_ = 0;
    uint64_t uploadSequence_ = 0;
    NexusFrame frame_;
};
