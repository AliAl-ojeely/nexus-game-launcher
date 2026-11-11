cmake_minimum_required(VERSION 3.22)
project(NexusOverlayPOC LANGUAGES CXX)

if(NOT WIN32)
    message(FATAL_ERROR "Nexus native overlay requires Windows.")
endif()
# Build Win32 into a SEPARATE build-x86 directory; do not reuse the x64 cache.
# NexusProcessProbe and the controlled test game stay in the original x64 build.


set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)
FetchContent_Declare(minhook
    GIT_REPOSITORY https://github.com/TsudaKageyu/minhook.git
    GIT_TAG v1.3.4
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(minhook)

add_library(NexusOverlayHook SHARED
    src/overlay_hook.cpp
    src/frame_pipe.cpp
    src/renderer.cpp
)
target_include_directories(NexusOverlayHook PRIVATE src)
target_compile_definitions(NexusOverlayHook PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
target_link_libraries(NexusOverlayHook PRIVATE minhook d3d11 dxgi d3dcompiler user32 gdi32)

# Separate OpenGL backend. The existing D3D11 Hook DLL is unchanged.
# Win32 and x64 are built in their existing SEPARATE CMake build directories.
add_library(NexusOpenGLHook SHARED
    src/opengl_hook.cpp
    src/opengl_renderer.cpp
    src/frame_pipe.cpp
)
target_include_directories(NexusOpenGLHook PRIVATE src)
target_compile_definitions(NexusOpenGLHook PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
target_link_libraries(NexusOpenGLHook PRIVATE minhook opengl32 gdi32 user32)

add_executable(NexusOverlayInjector src/injector.cpp)
target_compile_definitions(NexusOverlayInjector PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
target_link_libraries(NexusOverlayInjector PRIVATE kernel32)

set(NEXUS_NATIVE_TARGETS NexusOverlayHook NexusOpenGLHook NexusOverlayInjector)
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    add_executable(NexusProcessProbe src/process_probe.cpp)
    target_compile_definitions(NexusProcessProbe PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
    target_link_libraries(NexusProcessProbe PRIVATE kernel32)

    add_executable(NexusD3D11TestGame WIN32 src/test_game.cpp)
    target_compile_definitions(NexusD3D11TestGame PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
    target_link_libraries(NexusD3D11TestGame PRIVATE d3d11 dxgi user32)
    list(APPEND NEXUS_NATIVE_TARGETS NexusProcessProbe NexusD3D11TestGame)
endif()

foreach(target IN LISTS NEXUS_NATIVE_TARGETS)
    set_target_properties(${target} PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
    )
endforeach()

if(MSVC)
    foreach(target IN LISTS NEXUS_NATIVE_TARGETS)
        target_compile_options(${target} PRIVATE /W4 /EHsc /permissive-)
    endforeach()
endif()

# v0.7.1: Separate Direct3D9 renderer/hook. No modifications to D3D11 or OpenGL targets.
add_library(NexusD3D9Hook SHARED
    src/d3d9_hook.cpp
    src/d3d9_renderer.cpp
    src/frame_pipe.cpp
)
target_include_directories(NexusD3D9Hook PRIVATE src)
target_compile_definitions(NexusD3D9Hook PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
target_link_libraries(NexusD3D9Hook PRIVATE minhook d3d9 user32 gdi32)
set_target_properties(NexusD3D9Hook PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    LIBRARY_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
    LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
)
if(MSVC)
    target_compile_options(NexusD3D9Hook PRIVATE /W4 /EHsc /permissive-)
endif()

# v0.7.2: D3D12 bridge is an INDEPENDENT x64-only pilot DLL.
# It does not replace the stable NexusOverlayHook / D3D9 / OpenGL targets.
if(CMAKE_SIZEOF_VOID_P EQUAL 8)
    add_library(NexusD3D12Hook SHARED
        src/d3d12_hook.cpp
        src/d3d12_bridge_renderer.cpp
        src/frame_pipe.cpp
    )
    target_include_directories(NexusD3D12Hook PRIVATE src)
    target_compile_definitions(NexusD3D12Hook PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX UNICODE _UNICODE)
    target_link_libraries(NexusD3D12Hook PRIVATE minhook d3d12 d3d11 dxgi d3dcompiler user32 gdi32)
    set_target_properties(NexusD3D12Hook PROPERTIES
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
        RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
        LIBRARY_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
    )
    if(MSVC)
        target_compile_options(NexusD3D12Hook PRIVATE /W4 /EHsc /permissive-)
    endif()
endif()
