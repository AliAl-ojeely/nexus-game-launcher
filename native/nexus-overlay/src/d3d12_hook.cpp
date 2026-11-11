// Experimental D3D12 DXGI overlay, independent from the existing D3D11 DLL.
// Observes the application's actual Direct3D12 DIRECT queues, matches them
// against the present swap chain's device and refuses ambiguous matches.
// No anti-cheat workarounds, no system hooks, no game file modifications.
#include "d3d12_bridge_renderer.h"
#include "frame_pipe.h"
#include "nexus_telemetry.h"
#include <windows.h>
#include <d3d11.h>
#include <d3d12.h>
#include <dxgi1_4.h>
#include <MinHook.h>
#include <wrl/client.h>
#include <atomic>
#include <mutex>
#include <vector>
#include <utility>

using Microsoft::WRL::ComPtr;
namespace {
using PresentFn = HRESULT (STDMETHODCALLTYPE*)(IDXGISwapChain*,UINT,UINT);
using Present1Fn = HRESULT (STDMETHODCALLTYPE*)(IDXGISwapChain1*,UINT,UINT,const DXGI_PRESENT_PARAMETERS*);
using ExecuteFn = void (STDMETHODCALLTYPE*)(ID3D12CommandQueue*,UINT,ID3D12CommandList* const*);
PresentFn originalPresent = nullptr;
Present1Fn originalPresent1 = nullptr;
ExecuteFn originalExecute = nullptr;
std::mutex queueMutex;
struct ObservedQueue {
    ComPtr<ID3D12CommandQueue> queue;
    ComPtr<IUnknown> deviceIdentity;
};
std::vector<ObservedQueue> directQueues;
std::atomic<bool> tooManyQueues{false};
std::mutex drawMutex;
NexusD3D12Bridge bridge;
std::atomic_flag firstPresent = ATOMIC_FLAG_INIT;
std::atomic_flag firstVisible = ATOMIC_FLAG_INIT;
std::atomic_flag firstNoQueue = ATOMIC_FLAG_INIT;
std::atomic_flag firstAmbiguous = ATOMIC_FLAG_INIT;
std::atomic_flag firstUnexpectedSwapchain = ATOMIC_FLAG_INIT;
std::atomic_flag firstQueueMatch = ATOMIC_FLAG_INIT;

void STDMETHODCALLTYPE HookExecute(ID3D12CommandQueue* queue, UINT count,
                                    ID3D12CommandList* const* lists) {
    // Capture only non-empty submissions on DIRECT queues; do not infer the
    // presentation queue from a random D3D12 device/compute/copy command queue.
    if (queue && count && lists && queue->GetDesc().Type == D3D12_COMMAND_LIST_TYPE_DIRECT) {
        bool record = false;
        {
            std::lock_guard<std::mutex> lock(queueMutex);
            bool known = false;
            for (const auto& item:directQueues) {
                if (item.queue.Get()==queue) { known = true; break; }
            }
            record = !known && directQueues.size()<8 && !tooManyQueues.load();
            if (!known && !record) tooManyQueues.store(true);
        }
        if (record) {
            ComPtr<ID3D12Device> device;
            ComPtr<IUnknown> identity;
            if (SUCCEEDED(queue->GetDevice(IID_PPV_ARGS(device.GetAddressOf()))) &&
                SUCCEEDED(device.As(&identity))) {
                std::lock_guard<std::mutex> lock(queueMutex);
                bool seen = false;
                for (const auto& item:directQueues) if (item.queue.Get()==queue) seen=true;
                if (!seen && directQueues.size()<8) {
                    ObservedQueue item;
                    item.queue = queue;
                    item.deviceIdentity = identity;
                    directQueues.push_back(std::move(item));
                    if (directQueues.size()==1) NexusTrace("D3D12_DIRECT_QUEUE_OBSERVED");
                }
            }
        }
    }
    if (originalExecute) originalExecute(queue,count,lists);
}

// Must be invoked ONLY with a COM object belonging to the current swap chain's
// D3D12 device. If multiple DIRECT queues were observed for that device,
// refuse to guess which was passed to DXGI at swapchain creation.
ComPtr<ID3D12CommandQueue> MatchingQueue(ID3D12Device* device) {
    ComPtr<IUnknown> identity;
    if (FAILED(device->QueryInterface(IID_PPV_ARGS(identity.GetAddressOf())))) return {};
    ComPtr<ID3D12CommandQueue> match;
    std::lock_guard<std::mutex> lock(queueMutex);
    if (tooManyQueues.load()) return {};
    for (const auto& candidate:directQueues) {
        if (candidate.deviceIdentity.Get() != identity.Get()) continue;
        if (match) {
            if (!firstAmbiguous.test_and_set()) NexusTrace("D3D12_QUEUE_AMBIGUOUS");
            return {};
        }
        match = candidate.queue;
    }
    if (match && !firstQueueMatch.test_and_set()) NexusTrace("D3D12_QUEUE_DEVICE_MATCH");
    return match;
}

void TryDraw(IDXGISwapChain* chain, UINT flags) {
    if (!chain || (flags & DXGI_PRESENT_TEST)) return;
    if (!firstPresent.test_and_set()) NexusTrace("PRESENT_CALLED");
    if (!NexusOverlayVisible()) return;
    if (!firstVisible.test_and_set()) NexusTrace("VISIBLE_PRESENT_CALLED");
    try {
        std::lock_guard<std::mutex> lock(drawMutex);
        ComPtr<ID3D12Resource> buffer;
        ComPtr<ID3D12Device> device;
        if (FAILED(chain->GetBuffer(0,IID_PPV_ARGS(buffer.GetAddressOf()))) ||
            FAILED(buffer->GetDevice(IID_PPV_ARGS(device.GetAddressOf())))) {
            if (!firstUnexpectedSwapchain.test_and_set()) NexusTrace("D3D12_SWAPCHAIN_NOT_D3D12");
            return;
        }
        ComPtr<ID3D12CommandQueue> queue = MatchingQueue(device.Get());
        if (!queue) {
            if (!firstNoQueue.test_and_set()) NexusTrace("D3D12_QUEUE_NOT_CAPTURED_OR_AMBIGUOUS");
            return;
        }
        bridge.Draw(chain,device.Get(),queue.Get());
    } catch (...) {
        NexusTrace("D3D12_DRAW_EXCEPTION");
    }
}
HRESULT STDMETHODCALLTYPE HookPresent(IDXGISwapChain* chain,UINT interval,UINT flags) {
    TryDraw(chain,flags);
    return originalPresent(chain,interval,flags);
}
HRESULT STDMETHODCALLTYPE HookPresent1(IDXGISwapChain1* chain, UINT interval, UINT flags,
                                       const DXGI_PRESENT_PARAMETERS* params) {
    TryDraw(chain,flags);
    return originalPresent1(chain,interval,flags,params);
}
LRESULT CALLBACK WindowProc(HWND window,UINT message,WPARAM w,LPARAM l) {
    return DefWindowProcW(window,message,w,l);
}

bool HookQueue() {
    ComPtr<ID3D12Device> device;
    HRESULT hr=D3D12CreateDevice(nullptr,D3D_FEATURE_LEVEL_11_0,
                                  IID_PPV_ARGS(device.GetAddressOf()));
    if (FAILED(hr)) {
        ComPtr<IDXGIFactory4> factory;
        ComPtr<IDXGIAdapter> warp;
        if (SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(factory.GetAddressOf()))) &&
            SUCCEEDED(factory->EnumWarpAdapter(IID_PPV_ARGS(warp.GetAddressOf())))) {
            hr=D3D12CreateDevice(warp.Get(),D3D_FEATURE_LEVEL_11_0,
                                 IID_PPV_ARGS(device.ReleaseAndGetAddressOf()));
        }
    }
    if (FAILED(hr) || !device) { NexusTrace("D3D12_DUMMY_DEVICE_FAILED"); return false; }
    D3D12_COMMAND_QUEUE_DESC desc{}; desc.Type=D3D12_COMMAND_LIST_TYPE_DIRECT;
    ComPtr<ID3D12CommandQueue> queue;
    if (FAILED(device->CreateCommandQueue(&desc,IID_PPV_ARGS(queue.GetAddressOf())))) return false;
    auto** vtbl=*reinterpret_cast<void***>(queue.Get());
    // ID3D12CommandQueue inherits IUnknown/Object/DeviceChild/Pageable;
    // ExecuteCommandLists is vtable index 10 (after Update/CopyTileMappings).
    MH_STATUS status=MH_CreateHook(vtbl[10],reinterpret_cast<void*>(&HookExecute),
                                  reinterpret_cast<void**>(&originalExecute));
    return status==MH_OK && MH_EnableHook(vtbl[10])==MH_OK;
}

bool HookPresentMethods() {
    HINSTANCE instance=GetModuleHandleW(nullptr);
    const wchar_t* cls=L"NexusDX12HookDummy";
    WNDCLASSW wc{}; wc.hInstance=instance; wc.lpfnWndProc=WindowProc; wc.lpszClassName=cls;
    RegisterClassW(&wc);
    HWND hwnd=CreateWindowExW(0,cls,L"NexusDX12Dummy",WS_OVERLAPPEDWINDOW,
                               0,0,64,64,nullptr,nullptr,instance,nullptr);
    if (!hwnd) return false;
    DXGI_SWAP_CHAIN_DESC desc{};
    desc.BufferDesc.Width=64; desc.BufferDesc.Height=64;
    desc.BufferDesc.Format=DXGI_FORMAT_R8G8B8A8_UNORM;
    desc.SampleDesc.Count=1; desc.BufferUsage=DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount=1; desc.OutputWindow=hwnd; desc.Windowed=TRUE;
    desc.SwapEffect=DXGI_SWAP_EFFECT_DISCARD;
    ComPtr<IDXGISwapChain> swapchain;
    ComPtr<ID3D11Device> device;
    ComPtr<ID3D11DeviceContext> context;
    D3D_FEATURE_LEVEL level{};
    HRESULT hr=D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_HARDWARE,nullptr,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&desc,
        swapchain.GetAddressOf(),device.GetAddressOf(),&level,context.GetAddressOf());
    if (FAILED(hr)) {
        hr=D3D11CreateDeviceAndSwapChain(nullptr,D3D_DRIVER_TYPE_WARP,nullptr,
            D3D11_CREATE_DEVICE_BGRA_SUPPORT,nullptr,0,D3D11_SDK_VERSION,&desc,
            swapchain.GetAddressOf(),device.GetAddressOf(),&level,context.GetAddressOf());
    }
    bool success=false;
    if (SUCCEEDED(hr) && swapchain) {
        auto** vtbl=*reinterpret_cast<void***>(swapchain.Get());
        const MH_STATUS created=MH_CreateHook(vtbl[8],reinterpret_cast<void*>(&HookPresent),
                                              reinterpret_cast<void**>(&originalPresent));
        success=created==MH_OK && MH_EnableHook(vtbl[8])==MH_OK;
        ComPtr<IDXGISwapChain1> swapchain1;
        if (SUCCEEDED(swapchain.As(&swapchain1))) {
            auto** table1=*reinterpret_cast<void***>(swapchain1.Get());
            if (MH_CreateHook(table1[22],reinterpret_cast<void*>(&HookPresent1),
                              reinterpret_cast<void**>(&originalPresent1))==MH_OK) {
                MH_EnableHook(table1[22]);
            }
        }
    }
    context.Reset();device.Reset();swapchain.Reset();
    DestroyWindow(hwnd);
    return success;
}

bool Install() {
    const MH_STATUS status=MH_Initialize();
    if (status!=MH_OK && status!=MH_ERROR_ALREADY_INITIALIZED) return false;
    if (!HookQueue()) return false;
    if (!HookPresentMethods()) return false;
    return true;
}
DWORD WINAPI Worker(LPVOID) {
    NexusTrace("DLL_WORKER_STARTED");
    HANDLE pipeThread=CreateThread(nullptr,0,[](LPVOID)->DWORD { NexusPipeReaderLoop();return 0; },
                                   nullptr,0,nullptr);
    if (pipeThread) CloseHandle(pipeThread);
    for (int attempts=0;attempts<20;++attempts) {
        if (Install()) {
            NexusTrace("D3D12_QUEUE_HOOK_INSTALLED");
            NexusTrace("D3D12_PRESENT_HOOK_INSTALLED");
            NexusTrace("HOOK_INSTALLED");
            return 0;
        }
        Sleep(800);
    }
    NexusTrace("D3D12_HOOK_INSTALL_FAILED");
    return 1;
}
}
BOOL APIENTRY DllMain(HMODULE module,DWORD reason,LPVOID) {
    if (reason==DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(module);
        HANDLE thread=CreateThread(nullptr,0,Worker,nullptr,0,nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}
