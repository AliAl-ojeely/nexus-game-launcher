// Read-only Win32 process snapshot. JSON stdout is consumed by Electron.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <tlhelp32.h>
#include <string>
#include <cstdio>
#include <vector>

static std::string Utf8(const wchar_t* input) {
    const int bytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input, -1, nullptr, 0, nullptr, nullptr);
    if (bytes <= 1) return {};
    std::string s(static_cast<size_t>(bytes), '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, input, -1, &s[0], bytes, nullptr, nullptr);
    s.pop_back();
    return s;
}
static std::string JsonEscape(const std::string& text) {
    const char* hex = "0123456789abcdef";
    std::string out;
    for (unsigned char c : text) {
        switch (c) {
        case '\\': out += "\\\\"; break;
        case '"': out += "\\\""; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20) {
                out += "\\u00";
                out += hex[(c >> 4) & 15];
                out += hex[c & 15];
            } else out += static_cast<char>(c);
        }
    }
    return out;
}
int wmain() {
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return 2;
    PROCESSENTRY32W info{};
    info.dwSize = sizeof(info);
    if (!Process32FirstW(snapshot, &info)) { CloseHandle(snapshot); return 3; }
    bool first = true;
    std::fputs("[", stdout);
    do {
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, info.th32ProcessID);
        if (!process) continue;
        wchar_t fullPath[32768]{};
        DWORD capacity = static_cast<DWORD>(sizeof(fullPath) / sizeof(fullPath[0]));
        const BOOL hasPath = QueryFullProcessImageNameW(process, 0, fullPath, &capacity);
        CloseHandle(process);
        if (!hasPath) continue;
        const std::string escaped = JsonEscape(Utf8(fullPath));
        if (!first) std::fputc(',', stdout);
        first = false;
        std::printf("{\"pid\":%lu,\"ppid\":%lu,\"path\":\"%s\"}",
                    static_cast<unsigned long>(info.th32ProcessID),
                    static_cast<unsigned long>(info.th32ParentProcessID), escaped.c_str());
    } while (Process32NextW(snapshot, &info));
    CloseHandle(snapshot);
    std::fputs("]\n", stdout);
    return 0;
}
