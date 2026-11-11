#include "renderer.h"
#include "frame_pipe.h"
#include "nexus_telemetry.h"
#include <windows.h>
#include <d3d11.h>
#include <d3d12.h>
#include <dxgi1_2.h>
#include <MinHook.h>
#include <mutex>
#include <unordered_map>
#include <atomic>

namespace {
using PresentFn = HRESULT (STDMETHODCALLTYPE*)(IDXGISwapChain*, UINT, UINT);
using Present1Fn = HRESULT (STDMETHODCALLTYPE*)(IDXGISwapChain1*, UINT, UINT, const DXGI_PRESENT_PARAMETERS*);
PresentFn g_originalPresent = nullptr;
Present1Fn g_originalPresent1 = nullptr;
NexusD3D11Renderer g_renderer;
std::mutex g_drawMutex;
std::atomic_flag g_firstPresent = ATOMIC_FLAG_INIT;
std::atomic<unsigned> g_presentCount{0};
std::atomic<int> g_lastFullscreen{-1};

// DXGI diagnostics only. This does NOT enable D3D12 drawing. The presence of
// d3d12.dll in a process is not proof that this swap chain uses D3D12.
enum class SwapBackend { D3D11, D3D12, Unknown };
std::unordered_map<IDXGISwapChain*, SwapBackend> g_backendByChain;
std::atomic_flag g_firstD3D12Visible = ATOMIC_FLAG_INIT;
std::atomic_flag g_firstVisiblePresent = ATOMIC_FLAG_INIT;

// Called only while g_drawMutex is held. Inspect the actual Present swap chain.
// Avoid probes every frame and avoid retaining COM objects or game resources.
SwapBackend DiagnoseSwapchain(IDXGISwapChain* chain) {
    auto found = g_backendByChain.find(chain);
    if (found != g_backendByChain.end()) return found->second;
    // Cap the number of diagnostic probes for unusual multi-swapchain games.
    if (g_backendByChain.size() >= 24) return SwapBackend::Unknown;
    Microsoft::WRL::ComPtr<ID3D11Device> d3d11;
    Microsoft::WRL::ComPtr<ID3D12Device> d3d12;
    Microsoft::WRL::ComPtr<ID3D12Resource> buffer12;
    const bool isD3D11 = SUCCEEDED(chain->GetDevice(IID_PPV_ARGS(d3d11.GetAddressOf())));
    const bool isD3D12 = SUCCEEDED(chain->GetDevice(IID_PPV_ARGS(d3d12.GetAddressOf())));
    // D3D12 flip-model back buffers normally expose ID3D12Resource, which is
    // stronger evidence than loaded DLL modules alone.
    const bool bufferIsD3D12 = SUCCEEDED(chain->GetBuffer(0, IID_PPV_ARGS(buffer12.GetAddressOf())));
    const SwapBackend backend = (isD3D12 || bufferIsD3D12) ? SwapBackend::D3D12 :
                                isD3D11 ? SwapBackend::D3D11 : SwapBackend::Unknown;
    g_backendByChain.emplace(chain, backend);
    NexusTrace(backend == SwapBackend::D3D12 ? "PRESENT_SWAPCHAIN_D3D12" :
               backend == SwapBackend::D3D11 ? "PRESENT_SWAPCHAIN_D3D11" :
                                                "PRESENT_SWAPCHAIN_UNKNOWN");
    return backend;
}

void TryDraw(IDXGISwapChain* swapchain, UINT flags) {
    if (flags & DXGI_PRESENT_TEST) return;
    if (!g_firstPresent.test_and_set()) NexusTrace("PRESENT_CALLED");
    // Periodically report the DXGI state of the swap chain we are actually presenting.
    // Not equivalent to proving that Windows Fullscreen Optimizations are disabled.
    if ((g_presentCount.fetch_add(1, std::memory_order_relaxed) % 120) == 0) {
        BOOL fullscreen = FALSE;
        if (SUCCEEDED(swapchain->GetFullscreenState(&fullscreen, nullptr))) {
            const int next = fullscreen ? 1 : 0;
            if (g_lastFullscreen.exchange(next) != next) {
                NexusTrace(fullscreen ? "DXGI_FULLSCREEN_TRUE" : "DXGI_FULLSCREEN_FALSE");
            }
        }
    }
    // Do not allow an overlay failure to break a game's Present call.
    try {
        std::lock_guard<std::mutex> guard(g_drawMutex);
        const SwapBackend backend = DiagnoseSwapchain(swapchain);
        if (NexusOverlayVisible() && !g_firstVisiblePresent.test_and_set()) {
            NexusTrace("VISIBLE_PRESENT_CALLED");
        }
        if (backend == SwapBackend::D3D12) {
            // Keep presenting the game untouched. Our existing renderer is
            // D3D11 only; casting or attempting to render would be unsafe.
            if (NexusOverlayVisible() && !g_firstD3D12Visible.test_and_set()) {
                NexusTrace("D3D12_RENDERER_NOT_INSTALLED");
            }
            return;
        }
        g_renderer.Draw(swapchain);
    } catch (...) {
        OutputDebugStringW(L"[Nexus] Renderer caught an exception.\n");
    }
}
HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain* swapchain, UINT interval, UINT flags) {
    TryDraw(swapchain, flags);
    return g_originalPresent(swapchain, interval, flags);
}
HRESULT STDMETHODCALLTYPE HookPresent1(IDXGISwapChain1* swapchain, UINT interval, UINT flags,
                                       const DXGI_PRESENT_PARAMETERS* params) {
    TryDraw(swapchain, flags);
    return g_originalPresent1(swapchain, interval, flags, params);
}
LRESULT CALLBACK DummyProc(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    return DefWindowProcW(hwnd, msg, wparam, lparam);
}

bool InstallHooks() {
    HINSTANCE instance = GetModuleHandleW(nullptr);
    const wchar_t* cls = L"NexusOverlayDummyD3D11";
    WNDCLASSW wc{};
    wc.hInstance = instance;
    wc.lpfnWndProc = DummyProc;
    wc.lpszClassName = cls;
    RegisterClassW(&wc);
    HWND hwnd = CreateWindowExW(0, cls, L"NexusSwapchain", WS_OVERLAPPEDWINDOW,
                                0, 0, 64, 64, nullptr, nullptr, instance, nullptr);
    if (!hwnd) return false;
    DXGI_SWAP_CHAIN_DESC desc{};
    desc.BufferDesc.Width = 64;
    desc.BufferDesc.Height = 64;
    desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 1;
    desc.OutputWindow = hwnd;
    desc.Windowed = TRUE;
    desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    D3D_FEATURE_LEVEL chosen{};
    Microsoft::WRL::ComPtr<IDXGISwapChain> chain;
    Microsoft::WRL::ComPtr<ID3D11Device> device;
    Microsoft::WRL::ComPtr<ID3D11DeviceContext> ctx;
    HRESULT hr = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, &desc,
        chain.GetAddressOf(), device.GetAddressOf(), &chosen, ctx.GetAddressOf());
    if (FAILED(hr)) {
        hr = D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_WARP, nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION, &desc,
            chain.GetAddressOf(), device.GetAddressOf(), &chosen, ctx.GetAddressOf());
    }
    if (FAILED(hr) || !chain) { DestroyWindow(hwnd); return false; }

    const MH_STATUS status = MH_Initialize();
    if (status != MH_OK && status != MH_ERROR_ALREADY_INITIALIZED) {
        DestroyWindow(hwnd); return false;
    }
    auto** vtable = *reinterpret_cast<void***>(chain.Get());
    const MH_STATUS created = MH_CreateHook(vtable[8], reinterpret_cast<void*>(&HookPresent),
                                             reinterpret_cast<void**>(&g_originalPresent));
    const bool presentOk = created == MH_OK && MH_EnableHook(vtable[8]) == MH_OK;
    Microsoft::WRL::ComPtr<IDXGISwapChain1> chain1;
    if (SUCCEEDED(chain.As(&chain1))) {
        auto** vtable1 = *reinterpret_cast<void***>(chain1.Get());
        if (MH_CreateHook(vtable1[22], reinterpret_cast<void*>(&HookPresent1),
                          reinterpret_cast<void**>(&g_originalPresent1)) == MH_OK) {
            const MH_STATUS enabled = MH_EnableHook(vtable1[22]);
            if (enabled != MH_OK) OutputDebugStringW(L"[Nexus] Present1 hook disabled.\n");
        }
    }
    chain.Reset(); ctx.Reset(); device.Reset();
    DestroyWindow(hwnd);
    return presentOk;
}

DWORD WINAPI Worker(LPVOID) {
    NexusTrace("DLL_WORKER_STARTED");
    HANDLE pipeThread = CreateThread(nullptr, 0, [](LPVOID)->DWORD { NexusPipeReaderLoop(); return 0; },
                                     nullptr, 0, nullptr);
    if (pipeThread) CloseHandle(pipeThread);
    // Some games load d3d11.dll after the app starts.
    for (int attempts = 0; attempts < 25; ++attempts) {
        if (InstallHooks()) {
            OutputDebugStringW(L"[Nexus] DXGI Present hook installed.\n");
            NexusTrace("HOOK_INSTALLED");
            return 0;
        }
        Sleep(800);
    }
    OutputDebugStringW(L"[Nexus] Unable to install D3D11 DXGI hook.\n");
    NexusTrace("HOOK_INSTALL_FAILED");
    return 1;
}
}

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(module);
        HANDLE thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}
