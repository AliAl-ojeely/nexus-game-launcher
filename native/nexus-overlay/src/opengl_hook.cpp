// Separate OpenGL DLL: does NOT install or modify the stable D3D11 DXGI hook.
// For opted-in games without online anti-cheat only. Standard WGL/GDI swap points.
#include "opengl_renderer.h"
#include "frame_pipe.h"
#include "nexus_telemetry.h"
#include <windows.h>
#include <GL/gl.h>
#include <MinHook.h>
#include <atomic>
#include <mutex>

namespace {
using SwapFn = BOOL (WINAPI*)(HDC);
SwapFn g_originalGdiSwap = nullptr;
SwapFn g_originalWglSwap = nullptr;
std::recursive_mutex g_glMutex;
NexusOpenGLRenderer g_renderer;
thread_local bool g_insideSwap = false;
std::atomic_flag g_swapLogged = ATOMIC_FLAG_INIT;
std::atomic_flag g_visibleLogged = ATOMIC_FLAG_INIT;

// Sometimes GDI SwapBuffers delegates to WGL SwapBuffers. Thread-local guard
// ensures a single Nexus draw even if both exported functions are intercepted.
void BeforeSwap(HDC dc) {
    if (!dc || !wglGetCurrentContext()) return;
    if (!g_swapLogged.test_and_set()) NexusTrace("OPENGL_SWAP_PRESENT");
    if (NexusOverlayVisible() && !g_visibleLogged.test_and_set())
        NexusTrace("OPENGL_VISIBLE_SWAP_PRESENT");
    if (!NexusOverlayVisible()) return;
    try {
        std::lock_guard<std::recursive_mutex> lock(g_glMutex);
        g_renderer.Draw(dc);
    } catch (...) {
        NexusTrace("OPENGL_RENDER_EXCEPTION");
    }
}
BOOL WINAPI HookGdiSwap(HDC dc) {
    if (g_insideSwap) return g_originalGdiSwap(dc);
    g_insideSwap = true;
    BeforeSwap(dc);
    const BOOL result = g_originalGdiSwap(dc);
    g_insideSwap = false;
    return result;
}
BOOL WINAPI HookWglSwap(HDC dc) {
    if (g_insideSwap) return g_originalWglSwap(dc);
    g_insideSwap = true;
    BeforeSwap(dc);
    const BOOL result = g_originalWglSwap(dc);
    g_insideSwap = false;
    return result;
}
bool InstallSwapHook(HMODULE module, const char* exportName, LPVOID detour, LPVOID* trampoline) {
    if (!module) return false;
    FARPROC entry = GetProcAddress(module, exportName);
    if (!entry) return false;
    const MH_STATUS created = MH_CreateHook(reinterpret_cast<LPVOID>(entry), detour, trampoline);
    // Do not borrow another hook's trampoline; only enable hooks we created.
    if (created != MH_OK) return false;
    return MH_EnableHook(reinterpret_cast<LPVOID>(entry)) == MH_OK;
}
DWORD WINAPI Worker(LPVOID) {
    NexusTrace("DLL_WORKER_STARTED");
    const HANDLE pipe = CreateThread(nullptr, 0,
        [](LPVOID)->DWORD { NexusPipeReaderLoop(); return 0; }, nullptr, 0, nullptr);
    if (pipe) CloseHandle(pipe);

    // A game may load opengl32 after Nexus enters the process.
    for (unsigned i = 0; i != 40; ++i) {
        HMODULE ogl = GetModuleHandleW(L"opengl32.dll");
        if (!ogl) { Sleep(500); continue; }
        const MH_STATUS status = MH_Initialize();
        if (status != MH_OK && status != MH_ERROR_ALREADY_INITIALIZED) break;
        HMODULE gdi = GetModuleHandleW(L"gdi32.dll");
        const bool gdiOk = InstallSwapHook(gdi, "SwapBuffers",
            reinterpret_cast<LPVOID>(&HookGdiSwap), reinterpret_cast<LPVOID*>(&g_originalGdiSwap));
        const bool wglOk = InstallSwapHook(ogl, "wglSwapBuffers",
            reinterpret_cast<LPVOID>(&HookWglSwap), reinterpret_cast<LPVOID*>(&g_originalWglSwap));
        if (gdiOk || wglOk) {
            NexusTrace("OPENGL_HOOK_INSTALLED");
            NexusTrace("HOOK_INSTALLED");
            return 0;
        }
        Sleep(500);
    }
    NexusTrace("OPENGL_HOOK_INSTALL_FAILED");
    return 1;
}
} // namespace

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(module);
        const HANDLE thread = CreateThread(nullptr, 0, Worker, nullptr, 0, nullptr);
        if (thread) CloseHandle(thread);
    }
    return TRUE;
}
