#include <windows.h>
#include <string>
#include <iostream>
#include <filesystem>
#include <cwchar>
#include <cwctype>
#include <algorithm>
#include <tlhelp32.h>
#include <cstdint>

namespace {
std::wstring Lower(std::wstring s) {
    std::transform(s.begin(), s.end(), s.begin(), towlower);
    return s;
}
void Usage() {
    std::wcout << L"NexusOverlayInjector (matching x86/x64 targets, unprotected games only)\n"
               << L"Usage: NexusOverlayInjector.exe --pid <number> --dll <absolute-path> "
                  L"[--expected-exe <filename.exe> | --expected-path <absolute-exe-path>] "
                  L"--allow-unprotected\n";
}
}

int wmain(int argc, wchar_t* argv[]) {
    DWORD pid = 0;
    std::wstring dll, expected, expectedPath;
    bool permitted = false;
    for (int i = 1; i < argc; ++i) {
        const std::wstring token = argv[i];
        if (token == L"--pid" && i + 1 < argc) {
            try { pid = static_cast<DWORD>(std::stoul(argv[++i])); }
            catch (...) { std::wcerr << L"Invalid PID.\n"; return 2; }
        } else if (token == L"--dll" && i + 1 < argc) {
            dll = argv[++i];
        } else if (token == L"--expected-exe" && i + 1 < argc) {
            expected = argv[++i];
        } else if (token == L"--expected-path" && i + 1 < argc) {
            expectedPath = argv[++i];
        } else if (token == L"--allow-unprotected") {
            permitted = true;
        } else {
            Usage(); return 2;
        }
    }
    if (!pid || pid == GetCurrentProcessId() || !permitted || dll.empty() || (expected.empty() && expectedPath.empty())) {
        Usage();
        return 2;
    }
    const auto absDll = std::filesystem::absolute(dll).wstring();
    if (!std::filesystem::exists(absDll) || Lower(std::filesystem::path(absDll).extension().wstring()) != L".dll") {
        std::wcerr << L"DLL does not exist: " << absDll << L"\n";
        return 3;
    }
    HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_CREATE_THREAD |
                                 PROCESS_VM_OPERATION | PROCESS_VM_WRITE | PROCESS_VM_READ,
                                 FALSE, pid);
    if (!process) {
        std::wcerr << L"Cannot open process (err=" << GetLastError()
                   << L"). Protected/elevated games are unsupported.\n";
        return 4;
    }
    wchar_t path[32768]{};
    DWORD length = _countof(path);
    if (!QueryFullProcessImageNameW(process, 0, path, &length) ||
        (!expected.empty() && Lower(std::filesystem::path(path).filename().wstring()) != Lower(expected)) ||
        (!expectedPath.empty() && Lower(std::filesystem::path(path).lexically_normal().wstring()) !=
                                  Lower(std::filesystem::path(expectedPath).lexically_normal().wstring()))) {
        std::wcerr << L"PID executable mismatch. Refusing injection.\n";
        CloseHandle(process);
        return 5;
    }
    BOOL isTargetWow64 = FALSE;
    BOOL isSelfWow64 = FALSE;
    if (!IsWow64Process(process, &isTargetWow64) ||
        !IsWow64Process(GetCurrentProcess(), &isSelfWow64) ||
        (isTargetWow64 != isSelfWow64)) {
        std::wcerr << L"Target/injector architecture mismatch (x86 DLL -> x86 game, x64 DLL -> x64 game).\n";
        CloseHandle(process);
        return 6;
    }
    std::wcout << L"Target verified: " << path << L" (PID " << pid << L")\n";
    const SIZE_T bytes = (absDll.size() + 1) * sizeof(wchar_t);
    LPVOID remoteString = VirtualAllocEx(process, nullptr, bytes, MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
    if (!remoteString) { CloseHandle(process); return 7; }
    SIZE_T written = 0;
    if (!WriteProcessMemory(process, remoteString, absDll.c_str(), bytes, &written) || written != bytes) {
        std::wcerr << L"Unable to write DLL path.\n";
        VirtualFreeEx(process, remoteString, 0, MEM_RELEASE);
        CloseHandle(process); return 8;
    }
    // Locate the target process's actual module base. GetProcAddress may be
    // forwarded from kernel32 to kernelbase; NEVER assume an export address is
    // identical in two different processes just because they share a bitness.
    HMODULE kernel = GetModuleHandleW(L"kernel32.dll");
    const auto localEntry = kernel ? GetProcAddress(kernel, "LoadLibraryW") : nullptr;
    HMODULE owner = nullptr;
    if (localEntry) {
        GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
                           GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                           reinterpret_cast<LPCWSTR>(localEntry), &owner);
    }
    wchar_t ownerPath[MAX_PATH]{};
    if (!owner || !GetModuleFileNameW(owner, ownerPath, _countof(ownerPath))) {
        std::wcerr << L"Unable to resolve local LoadLibraryW module.\n";
        VirtualFreeEx(process, remoteString, 0, MEM_RELEASE);
        CloseHandle(process); return 9;
    }
    const auto ownerName = Lower(std::filesystem::path(ownerPath).filename().wstring());
    const auto offset = reinterpret_cast<uintptr_t>(localEntry) - reinterpret_cast<uintptr_t>(owner);
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid);
    uintptr_t remoteEntry = 0;
    if (snapshot != INVALID_HANDLE_VALUE) {
        MODULEENTRY32W info{};
        info.dwSize = sizeof(info);
        if (Module32FirstW(snapshot, &info)) do {
            if (Lower(info.szModule) == ownerName && offset < info.modBaseSize) {
                remoteEntry = reinterpret_cast<uintptr_t>(info.modBaseAddr) + offset;
                break;
            }
        } while (Module32NextW(snapshot, &info));
        CloseHandle(snapshot);
    }
    if (!remoteEntry) {
        std::wcerr << L"Unable to resolve target process LoadLibraryW address.\n";
        VirtualFreeEx(process, remoteString, 0, MEM_RELEASE);
        CloseHandle(process); return 9;
    }
    // Standard LoadLibraryW proof-of-concept; not an Anti-Cheat bypass.
    HANDLE thread = CreateRemoteThread(process, nullptr, 0,
        reinterpret_cast<LPTHREAD_START_ROUTINE>(remoteEntry), remoteString, 0, nullptr);
    if (!thread) {
        std::wcerr << L"Remote LoadLibrary thread was rejected (err=" << GetLastError() << L").\n";
        VirtualFreeEx(process, remoteString, 0, MEM_RELEASE);
        CloseHandle(process); return 9;
    }
    if (WaitForSingleObject(thread, 10000) != WAIT_OBJECT_0) {
        std::wcerr << L"Timeout: unable to confirm DLL load. The target may still be running.\n";
        // Do NOT free remote memory while the thread may still be using it.
        CloseHandle(thread);
        CloseHandle(process); return 10;
    }
    DWORD exitCode = 0;
    GetExitCodeThread(thread, &exitCode);
    CloseHandle(thread);
    VirtualFreeEx(process, remoteString, 0, MEM_RELEASE);
    CloseHandle(process);
    if (!exitCode) {
        std::wcerr << L"LoadLibraryW reported failure. Check dependencies and same architecture.\n";
        return 11;
    }
    std::wcout << L"DLL loaded (thread exit code nonzero). Check game image and DebugView for hook logs.\n";
    return 0;
}
