#include <windows.h>
#include <d3d11.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <cwchar>

// Controlled Nexus test process only. No installed game is touched.
// WM_APP messages below are sent solely to this test window by run_overlay_demo.py.
using Microsoft::WRL::ComPtr;
namespace {
constexpr UINT WM_NEXUS_ENTER_DXGI_FULLSCREEN = WM_APP + 0x71;
constexpr UINT WM_NEXUS_LEAVE_DXGI_FULLSCREEN = WM_APP + 0x72;

HWND g_hwnd = nullptr;
ComPtr<ID3D11Device> g_device;
ComPtr<ID3D11DeviceContext> g_context;
ComPtr<IDXGISwapChain> g_swapchain;
ComPtr<ID3D11RenderTargetView> g_rtv;
bool g_needsResize = false;
bool g_hasPublishedState = false;
BOOL g_publishedFullscreen = FALSE;
HRESULT g_lastSwitchResult = S_OK;
HRESULT g_lastTargetResult = S_OK;
HRESULT g_lastResizeResult = S_OK;
bool g_preferDesktopResolution = false;

// Physical output dimensions are an independent measurement from the swap-chain buffer.
bool GetOutputPixels(UINT& width, UINT& height) {
    width = height = 0;
    if (!g_swapchain) return false;
    ComPtr<IDXGIOutput> output;
    if (FAILED(g_swapchain->GetContainingOutput(output.GetAddressOf())) || !output) return false;
    DXGI_OUTPUT_DESC desc{};
    if (FAILED(output->GetDesc(&desc))) return false;
    const LONG w = desc.DesktopCoordinates.right - desc.DesktopCoordinates.left;
    const LONG h = desc.DesktopCoordinates.bottom - desc.DesktopCoordinates.top;
    if (w <= 0 || h <= 0) return false;
    width = static_cast<UINT>(w);
    height = static_cast<UINT>(h);
    return true;
}

void PublishDxgiState(bool force = false) {
    if (!g_swapchain) return;
    BOOL fullscreen = FALSE;
    HRESULT queryHr = g_swapchain->GetFullscreenState(&fullscreen, nullptr);
    if (FAILED(queryHr)) fullscreen = FALSE;
    if (!force && g_hasPublishedState && fullscreen == g_publishedFullscreen) return;
    g_publishedFullscreen = fullscreen;
    g_hasPublishedState = true;

    DXGI_SWAP_CHAIN_DESC desc{};
    g_swapchain->GetDesc(&desc);
    wchar_t tempDir[MAX_PATH]{};
    DWORD n = GetTempPathW(MAX_PATH, tempDir);
    if (!n || n >= MAX_PATH) return;
    wchar_t statusPath[MAX_PATH]{};
    if (swprintf_s(statusPath, _countof(statusPath), L"%sNexusOverlayPOC_%lu.json",
                   tempDir, GetCurrentProcessId()) < 0) return;
    UINT outputWidth = 0, outputHeight = 0;
    GetOutputPixels(outputWidth, outputHeight);
    RECT client{};
    GetClientRect(g_hwnd, &client);
    const UINT clientWidth = static_cast<UINT>(client.right - client.left);
    const UINT clientHeight = static_cast<UINT>(client.bottom - client.top);
    const UINT windowDpi = GetDpiForWindow(g_hwnd);
    char json[750]{};
    sprintf_s(json, sizeof(json),
              "{\"pid\":%lu,\"dxgiFullscreen\":%s,\"switchHr\":\"0x%08lX\","
              "\"queryHr\":\"0x%08lX\",\"bufferWidth\":%u,\"bufferHeight\":%u,"
              "\"outputWidth\":%u,\"outputHeight\":%u,\"clientWidth\":%u,"
              "\"clientHeight\":%u,\"dpi\":%u,\"targetHr\":\"0x%08lX\","
              "\"resizeHr\":\"0x%08lX\",\"desktopModeRequested\":%s}\n",
              GetCurrentProcessId(), fullscreen ? "true" : "false",
              static_cast<unsigned long>(g_lastSwitchResult),
              static_cast<unsigned long>(queryHr),
              desc.BufferDesc.Width, desc.BufferDesc.Height,
              outputWidth, outputHeight, clientWidth, clientHeight, windowDpi,
              static_cast<unsigned long>(g_lastTargetResult),
              static_cast<unsigned long>(g_lastResizeResult),
              g_preferDesktopResolution ? "true" : "false");
    HANDLE file = CreateFileW(statusPath, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    DWORD written = 0;
    WriteFile(file, json, static_cast<DWORD>(strlen(json)), &written, nullptr);
    CloseHandle(file);
    OutputDebugStringA(fullscreen ? "[Nexus Test] DXGI GetFullscreenState=TRUE\n"
                                  : "[Nexus Test] DXGI GetFullscreenState=FALSE\n");
}

// Never ResizeBuffers from WM_SIZE during a DXGI SetFullscreenState reentrant callback.
// Defer it to the regular render loop instead.
bool RefreshRenderTarget() {
    if (!g_swapchain || !g_device || !g_context) return false;
    g_context->OMSetRenderTargets(0, nullptr, nullptr);
    g_rtv.Reset();
    RECT rc{};
    GetClientRect(g_hwnd, &rc);
    UINT width = static_cast<UINT>(rc.right - rc.left);
    UINT height = static_cast<UINT>(rc.bottom - rc.top);
    if (!width || !height) return false;
    BOOL fullscreen = FALSE;
    if (SUCCEEDED(g_swapchain->GetFullscreenState(&fullscreen, nullptr)) && fullscreen) {
        // Avoid virtualized Win32 window dimensions in a true DXGI fullscreen test.
        // The currently active output size is authoritative for the back buffer.
        UINT outputWidth = 0, outputHeight = 0;
        if (GetOutputPixels(outputWidth, outputHeight)) {
            width = outputWidth;
            height = outputHeight;
        }
    }
    g_lastResizeResult = g_swapchain->ResizeBuffers(
        0, width, height, DXGI_FORMAT_UNKNOWN, DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH);
    if (FAILED(g_lastResizeResult)) {
        OutputDebugStringA("[Nexus Test] ResizeBuffers failed; retaining retry flag.\n");
        return false;
    }
    ComPtr<ID3D11Texture2D> buffer;
    if (FAILED(g_swapchain->GetBuffer(0, IID_PPV_ARGS(buffer.GetAddressOf())))) return false;
    if (FAILED(g_device->CreateRenderTargetView(buffer.Get(), nullptr,
                                                g_rtv.GetAddressOf()))) return false;
    g_needsResize = false;
    PublishDxgiState(true);
    return true;
}

void RequestFullscreen(bool desired) {
    if (!g_swapchain) return;
    BOOL current = FALSE;
    if (FAILED(g_swapchain->GetFullscreenState(&current, nullptr))) return;
    if ((current != FALSE) == desired) { PublishDxgiState(true); return; }
    // DXGI needs an unbound back buffer for the follow-up ResizeBuffers.
    if (g_context) g_context->OMSetRenderTargets(0, nullptr, nullptr);
    g_rtv.Reset();
    g_lastTargetResult = S_OK;
    if (desired && g_preferDesktopResolution) {
        // Match the active monitor mode before switching (the user can disable this
        // with --resolution original to compare the old 0.2 behavior).
        UINT outputWidth = 0, outputHeight = 0;
        if (GetOutputPixels(outputWidth, outputHeight)) {
            DXGI_SWAP_CHAIN_DESC currentDesc{};
            g_swapchain->GetDesc(&currentDesc);
            DXGI_MODE_DESC target{};
            target.Width = outputWidth;
            target.Height = outputHeight;
            target.Format = currentDesc.BufferDesc.Format;
            // Zero numerator/denominator: let DXGI choose a supported refresh rate.
            target.RefreshRate.Numerator = 0;
            target.RefreshRate.Denominator = 0;
            target.Scaling = DXGI_MODE_SCALING_UNSPECIFIED;
            target.ScanlineOrdering = DXGI_MODE_SCANLINE_ORDER_UNSPECIFIED;
            g_lastTargetResult = g_swapchain->ResizeTarget(&target);
            if (FAILED(g_lastTargetResult))
                OutputDebugStringA("[Nexus Test] ResizeTarget to desktop mode failed.\n");
        }
    }
    g_lastSwitchResult = g_swapchain->SetFullscreenState(desired ? TRUE : FALSE, nullptr);
    g_needsResize = true;
    PublishDxgiState(true);
    if (FAILED(g_lastSwitchResult))
        OutputDebugStringA("[Nexus Test] SetFullscreenState failed; use F11 after focusing the test game.\n");
}

LRESULT CALLBACK WindowProcedure(HWND hwnd, UINT msg, WPARAM wparam, LPARAM lparam) {
    switch (msg) {
        case WM_KEYDOWN:
            if (wparam == VK_ESCAPE) { DestroyWindow(hwnd); return 0; }
            if (wparam == VK_F11 && g_swapchain) {
                if (lparam & (1L << 30)) return 0; // Ignore held-key auto repeat.
                BOOL fullscreen = FALSE;
                if (SUCCEEDED(g_swapchain->GetFullscreenState(&fullscreen, nullptr)))
                    RequestFullscreen(fullscreen == FALSE);
                return 0;
            }
            break;
        case WM_NEXUS_ENTER_DXGI_FULLSCREEN:
            RequestFullscreen(true);
            return 0;
        case WM_NEXUS_LEAVE_DXGI_FULLSCREEN:
            RequestFullscreen(false);
            return 0;
        case WM_SIZE:
        case WM_DISPLAYCHANGE:
            g_needsResize = true;
            return 0;
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;
    }
    return DefWindowProcW(hwnd, msg, wparam, lparam);
}
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show) {
    // Keep monitor/window pixel dimensions coherent on scaled displays.
    // This must happen before creating any HWND.
    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    wchar_t resolutionMode[64]{};
    if (GetEnvironmentVariableW(L"NEXUS_TEST_RESOLUTION", resolutionMode,
                                static_cast<DWORD>(_countof(resolutionMode))) > 0) {
        g_preferDesktopResolution = _wcsicmp(resolutionMode, L"desktop") == 0;
    }
    WNDCLASSW wc{};
    wc.hInstance = instance;
    wc.lpfnWndProc = WindowProcedure;
    wc.lpszClassName = L"NexusD3D11TestApp";
    wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
    if (!RegisterClassW(&wc)) return 1;

    // A borderless WINDOWED test canvas initially; DXGI fullscreen is a separate,
    // verified SetFullscreenState(TRUE) transition (not WS_POPUP alone).
    const int windowWidth = 1100;
    const int windowHeight = 680;
    int x = (GetSystemMetrics(SM_CXSCREEN) - windowWidth) / 2;
    int y = (GetSystemMetrics(SM_CYSCREEN) - windowHeight) / 2;
    g_hwnd = CreateWindowExW(WS_EX_APPWINDOW, wc.lpszClassName, L"Nexus D3D11 Test Game",
        WS_POPUP, x, y, windowWidth, windowHeight,
        nullptr, nullptr, instance, nullptr);
    if (!g_hwnd) return 1;

    DXGI_SWAP_CHAIN_DESC desc{};
    desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
    desc.BufferDesc.Width = windowWidth;
    desc.BufferDesc.Height = windowHeight;
    desc.SampleDesc.Count = 1;
    desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
    desc.BufferCount = 2;
    desc.OutputWindow = g_hwnd;
    desc.Windowed = TRUE;
    desc.SwapEffect = DXGI_SWAP_EFFECT_DISCARD;
    desc.Flags = DXGI_SWAP_CHAIN_FLAG_ALLOW_MODE_SWITCH;
    D3D_FEATURE_LEVEL level{};
    if (FAILED(D3D11CreateDeviceAndSwapChain(nullptr, D3D_DRIVER_TYPE_HARDWARE,
        nullptr, D3D11_CREATE_DEVICE_BGRA_SUPPORT, nullptr, 0, D3D11_SDK_VERSION,
        &desc, g_swapchain.GetAddressOf(), g_device.GetAddressOf(),
        &level, g_context.GetAddressOf()))) return 2;

    g_needsResize = true;
    ShowWindow(g_hwnd, show);
    UpdateWindow(g_hwnd);
    SetForegroundWindow(g_hwnd);
    PublishDxgiState(true);
    const auto begin = std::chrono::steady_clock::now();
    MSG msg{};
    while (true) {
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) goto done;
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if (g_needsResize) RefreshRenderTarget();
        PublishDxgiState(); // Detect external DXGI fullscreen changes, including Alt+Enter.
        if (g_rtv) {
            float t = std::chrono::duration<float>(std::chrono::steady_clock::now() - begin).count();
            // Neutral, subtly animated test surface. The overlay itself is rendered by Electron.
            FLOAT rgba[] = {
                0.065f + 0.012f * (1 + sinf(t * 0.4f)),
                0.070f + 0.012f * (1 + sinf(t * 0.5f)),
                0.082f + 0.012f * (1 + sinf(t * 0.3f)),
                1.0f
            };
            g_context->ClearRenderTargetView(g_rtv.Get(), rgba);
            g_swapchain->Present(1, 0);
        } else Sleep(10);
    }
done:
    g_rtv.Reset();
    if (g_swapchain) g_swapchain->SetFullscreenState(FALSE, nullptr);
    g_swapchain.Reset(); g_context.Reset(); g_device.Reset();
    return 0;
}
