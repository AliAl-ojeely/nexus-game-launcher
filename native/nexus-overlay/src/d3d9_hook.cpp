// Independent legacy Direct3D9 Present/PresentEx/SwapChain9 preview backend.
// Opt-in unprotected games only. D3D11 and OpenGL DLLs are not changed.
#include "d3d9_renderer.h"
#include "frame_pipe.h"
#include "nexus_telemetry.h"
#include <windows.h>
#include <d3d9.h>
#include <MinHook.h>
#include <atomic>
#include <mutex>
#include <vector>

namespace {
using PresentFn = HRESULT (WINAPI*)(IDirect3DDevice9*, const RECT*, const RECT*, HWND, const RGNDATA*);
using SwapPresentFn = HRESULT (WINAPI*)(IDirect3DSwapChain9*, const RECT*, const RECT*, HWND, const RGNDATA*, DWORD);
using PresentExFn = HRESULT (WINAPI*)(IDirect3DDevice9Ex*, const RECT*, const RECT*, HWND, const RGNDATA*, DWORD);
using ResetFn = HRESULT (WINAPI*)(IDirect3DDevice9*, D3DPRESENT_PARAMETERS*);
using EndSceneFn = HRESULT (WINAPI*)(IDirect3DDevice9*);
PresentFn g_present = nullptr;
SwapPresentFn g_swapPresent = nullptr;
PresentExFn g_presentEx = nullptr;
ResetFn g_reset = nullptr;
EndSceneFn g_endScene = nullptr;
NexusD3D9Renderer g_renderer;
std::recursive_mutex g_mutex;
thread_local bool g_inPresent = false;
std::atomic_flag g_presentLogged = ATOMIC_FLAG_INIT;
std::atomic_flag g_swapLogged = ATOMIC_FLAG_INIT;
std::atomic_flag g_exLogged = ATOMIC_FLAG_INIT;
std::atomic_flag g_endLogged = ATOMIC_FLAG_INIT;
std::atomic_flag g_visibleLogged = ATOMIC_FLAG_INIT;

struct ScopedPresent {
    ScopedPresent() : entered(!g_inPresent) { if (entered) g_inPresent = true; }
    ~ScopedPresent() { if (entered) g_inPresent = false; }
    bool entered;
};
void BeforePresent(IDirect3DDevice9* device, IDirect3DSurface9* backbuffer = nullptr) {
    if (!device) return;
    if (NexusOverlayVisible() && !g_visibleLogged.test_and_set())
        NexusTrace("D3D9_VISIBLE_PRESENT_CALLED");
    if (!NexusOverlayVisible()) return;
    try {
        std::lock_guard<std::recursive_mutex> lock(g_mutex);
        g_renderer.Draw(device, backbuffer);
    } catch (...) {
        static std::atomic_flag once = ATOMIC_FLAG_INIT;
        if (!once.test_and_set()) NexusTrace("D3D9_RENDER_EXCEPTION");
    }
}
HRESULT WINAPI HookPresent(IDirect3DDevice9* device, const RECT* src, const RECT* dst,
                           HWND overrideWindow, const RGNDATA* dirty) {
    ScopedPresent scoped;
    if (scoped.entered) {
        if (!g_presentLogged.test_and_set()) NexusTrace("D3D9_PRESENT_CALLED");
        BeforePresent(device);
    }
    return g_present(device, src, dst, overrideWindow, dirty);
}
HRESULT WINAPI HookSwapPresent(IDirect3DSwapChain9* chain, const RECT* src, const RECT* dst,
                               HWND overrideWindow, const RGNDATA* dirty, DWORD flags) {
    ScopedPresent scoped;
    if (scoped.entered) {
        if (!g_swapLogged.test_and_set()) NexusTrace("D3D9_SWAPCHAIN_PRESENT_CALLED");
        IDirect3DDevice9* device = nullptr;
        IDirect3DSurface9* back = nullptr;
        if (SUCCEEDED(chain->GetDevice(&device)) && device) {
            chain->GetBackBuffer(0, D3DBACKBUFFER_TYPE_MONO, &back);
            BeforePresent(device, back);
        }
        if (back) back->Release();
        if (device) device->Release();
    }
    return g_swapPresent(chain, src, dst, overrideWindow, dirty, flags);
}
HRESULT WINAPI HookPresentEx(IDirect3DDevice9Ex* device, const RECT* src, const RECT* dst,
                             HWND overrideWindow, const RGNDATA* dirty, DWORD flags) {
    ScopedPresent scoped;
    if (scoped.entered) {
        if (!g_exLogged.test_and_set()) NexusTrace("D3D9_PRESENTEX_CALLED");
        BeforePresent(device);
    }
    return g_presentEx(device, src, dst, overrideWindow, dirty, flags);
}
HRESULT WINAPI HookReset(IDirect3DDevice9* device, D3DPRESENT_PARAMETERS* params) {
    {
        std::lock_guard<std::recursive_mutex> lock(g_mutex);
        g_renderer.ReleaseForReset(device); // default-pool resources must be released BEFORE Reset
    }
    NexusTrace("D3D9_DEVICE_RESET");
    return g_reset(device, params);
}
HRESULT WINAPI HookEndScene(IDirect3DDevice9* device) {
    if (!g_endLogged.test_and_set()) NexusTrace("D3D9_ENDSCENE_CALLED");
    return g_endScene(device);
}

// Capture the runtime's real COM entry points from a tiny invisible, owned D3D9
// device. We never hook per-game engine symbols or bypass any game protections.
void* VTableEntry(void* obj, size_t slot) {
    return obj ? (*reinterpret_cast<void***>(obj))[slot] : nullptr;
}

bool AddHook(void* target, void* detour, void** trampoline, std::vector<void*>& installed) {
    if (!target) return false;
    for (void* done : installed) if (done == target) return false;
    if (MH_CreateHook(target, detour, trampoline) != MH_OK) return false;
    if (MH_EnableHook(target) != MH_OK) { MH_RemoveHook(target); return false; }
    installed.push_back(target);
    return true;
}

bool CaptureHooks(HWND window) {
    IDirect3D9* api = Direct3DCreate9(D3D_SDK_VERSION);
    if (!api) { NexusTrace("D3D9_DUMMY_API_FAILED"); return false; }
    D3DPRESENT_PARAMETERS parameters{};
    parameters.BackBufferWidth = 16;
    parameters.BackBufferHeight = 16;
    parameters.BackBufferFormat = D3DFMT_UNKNOWN;
    parameters.BackBufferCount = 1;
    parameters.MultiSampleType = D3DMULTISAMPLE_NONE;
    parameters.SwapEffect = D3DSWAPEFFECT_DISCARD;
    parameters.hDeviceWindow = window;
    parameters.Windowed = TRUE;
    parameters.PresentationInterval = D3DPRESENT_INTERVAL_IMMEDIATE;
    IDirect3DDevice9* device = nullptr;
    const HRESULT result = api->CreateDevice(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, window,
        D3DCREATE_SOFTWARE_VERTEXPROCESSING | D3DCREATE_MULTITHREADED, &parameters, &device);
    if (FAILED(result) || !device) {
        api->Release(); NexusTrace("D3D9_DUMMY_DEVICE_FAILED"); return false;
    }
    const MH_STATUS mh = MH_Initialize();
    if (mh != MH_OK && mh != MH_ERROR_ALREADY_INITIALIZED) {
        device->Release(); api->Release(); return false;
    }
    std::vector<void*> installed;
    // IDirect3DDevice9 ABI vtable: Reset 16, Present 17, EndScene 42.
    const bool present = AddHook(VTableEntry(device, 17), reinterpret_cast<void*>(&HookPresent),
        reinterpret_cast<void**>(&g_present), installed);
    AddHook(VTableEntry(device, 16), reinterpret_cast<void*>(&HookReset),
        reinterpret_cast<void**>(&g_reset), installed);
    AddHook(VTableEntry(device, 42), reinterpret_cast<void*>(&HookEndScene),
        reinterpret_cast<void**>(&g_endScene), installed);
    IDirect3DSwapChain9* chain = nullptr;
    if (SUCCEEDED(device->GetSwapChain(0, &chain)) && chain) {
        // IDirect3DSwapChain9 ABI: Present 3; has an extra DWORD flags argument.
        AddHook(VTableEntry(chain, 3), reinterpret_cast<void*>(&HookSwapPresent),
            reinterpret_cast<void**>(&g_swapPresent), installed);
        chain->Release();
    }
    device->Release();
    api->Release();

    // D3D9Ex may present with a separate virtual method at vtable index 121.
    // It uses the same D3D9 runtime but a different versioned interface.
    using Create9ExFn = HRESULT (WINAPI*)(UINT, IDirect3D9Ex**);
    HMODULE library = GetModuleHandleW(L"d3d9.dll");
    auto create9ex = reinterpret_cast<Create9ExFn>(
        library ? GetProcAddress(library, "Direct3DCreate9Ex") : nullptr);
    if (create9ex) {
        IDirect3D9Ex* apiEx = nullptr;
        if (SUCCEEDED(create9ex(D3D_SDK_VERSION, &apiEx)) && apiEx) {
            IDirect3DDevice9Ex* deviceEx = nullptr;
            if (SUCCEEDED(apiEx->CreateDeviceEx(D3DADAPTER_DEFAULT, D3DDEVTYPE_HAL, window,
                  D3DCREATE_SOFTWARE_VERTEXPROCESSING | D3DCREATE_MULTITHREADED,
                  &parameters, nullptr, &deviceEx)) && deviceEx) {
                AddHook(VTableEntry(deviceEx, 121), reinterpret_cast<void*>(&HookPresentEx),
                    reinterpret_cast<void**>(&g_presentEx), installed);
                deviceEx->Release();
            }
            apiEx->Release();
        }
    }
    if (present) NexusTrace("D3D9_DEVICE_PRESENT_HOOKED");
    return present || g_swapPresent || g_presentEx;
}

DWORD WINAPI Worker(LPVOID) {
    NexusTrace("DLL_WORKER_STARTED");
    const HANDLE pipe = CreateThread(nullptr, 0,
        [](LPVOID)->DWORD { NexusPipeReaderLoop(); return 0; }, nullptr, 0, nullptr);
    if (pipe) CloseHandle(pipe);
    // D3D9 was observed by the dispatcher; still wait if loaded during startup.
    for (int attempt = 0; attempt < 30; ++attempt) {
        if (!GetModuleHandleW(L"d3d9.dll")) { Sleep(500); continue; }
        HWND dummy = CreateWindowExW(0, L"STATIC", L"NexusD3D9Dummy",
            WS_OVERLAPPED, 0, 0, 16, 16, nullptr, nullptr, GetModuleHandleW(nullptr), nullptr);
        if (dummy) {
            const bool success = CaptureHooks(dummy);
            DestroyWindow(dummy);
            if (success) {
                NexusTrace("D3D9_HOOK_INSTALLED");
                NexusTrace("HOOK_INSTALLED");
                return 0;
            }
        }
        Sleep(600);
    }
    NexusTrace("D3D9_HOOK_INSTALL_FAILED");
    return 1;
}
} // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(module);
        HANDLE thread = CreateThread(nullptr, 0, &Worker, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}
