#pragma once
// Small, opt-in proof-of-concept trace. Only sparse milestones, not per-frame logging.
// Intended for local unprotected D3D11 testing. The installer never modifies game files.
#include <windows.h>
#include <cstdio>
#include <string>

inline void NexusTrace(const char* milestone) noexcept {
    if (!milestone) return;
    wchar_t temp[MAX_PATH + 2]{};
    const DWORD length = GetTempPathW(MAX_PATH, temp);
    if (!length || length > MAX_PATH) return;
    const std::wstring fileName = std::wstring(temp) + L"NexusOverlayHook_" +
                                  std::to_wstring(GetCurrentProcessId()) + L".log";
    HANDLE file = CreateFileW(fileName.c_str(), FILE_APPEND_DATA,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    char message[256]{};
    const int count = std::snprintf(message, sizeof(message), "[NEXUS-HOOK] %s\r\n", milestone);
    if (count > 0) {
        const DWORD bytes = static_cast<DWORD>(count >= int(sizeof(message)) ? sizeof(message) - 1 : count);
        DWORD written = 0;
        WriteFile(file, message, bytes, &written, nullptr);
    }
    CloseHandle(file);
}
