#pragma once
#include "frame_pipe.h"
#include <d3d11.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <cstdint>

class NexusD3D11Renderer {
public:
    void Draw(IDXGISwapChain* chain);

private:
    bool Initialise(ID3D11Device* device);
    bool UpdateImage(ID3D11DeviceContext* ctx, const NexusFrame& frame);
    Microsoft::WRL::ComPtr<ID3D11Device> device_;
    Microsoft::WRL::ComPtr<ID3D11VertexShader> vertexShader_;
    Microsoft::WRL::ComPtr<ID3D11PixelShader> pixelShader_;
    Microsoft::WRL::ComPtr<ID3D11Buffer> constants_;
    Microsoft::WRL::ComPtr<ID3D11Texture2D> texture_;
    Microsoft::WRL::ComPtr<ID3D11ShaderResourceView> shaderResource_;
    Microsoft::WRL::ComPtr<ID3D11Texture2D> cursorTexture_;
    Microsoft::WRL::ComPtr<ID3D11ShaderResourceView> cursorSRV_;
    Microsoft::WRL::ComPtr<ID3D11SamplerState> sampler_;
    Microsoft::WRL::ComPtr<ID3D11BlendState> blend_;
    Microsoft::WRL::ComPtr<ID3D11DepthStencilState> depth_;
    Microsoft::WRL::ComPtr<ID3D11RasterizerState> raster_;
    UINT cursorWidth_ = 0, cursorHeight_ = 0;
    int cursorHotX_ = 0, cursorHotY_ = 0;
    uint64_t uploadedSequence_ = 0;
    uint32_t imageWidth_ = 0, imageHeight_ = 0;
    NexusFrame latestFrame_;
};
