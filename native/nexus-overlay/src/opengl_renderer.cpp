// OpenGL 3.x textured-quad backend for the SAME Electron BGRA/alpha stream.
// Independent of D3D11 and intentionally limited to actual current WGL swaps.
// Compatibility OpenGL <3.0, D3D9, DX12 and Vulkan are NOT implemented here.
#include "opengl_renderer.h"
#include "nexus_telemetry.h"
#include "nexus_system_cursor.h"
#include "nexus_cursor_art.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstddef>
#include <cstring>
#include <utility>

namespace {
// Windows SDK's GL/gl.h exposes only GL 1.1. Load modern GL from the active
// driver context, not from a global exported function pointer.
constexpr GLenum N_GL_VERTEX_SHADER = 0x8B31;
constexpr GLenum N_GL_FRAGMENT_SHADER = 0x8B30;
constexpr GLenum N_GL_COMPILE_STATUS = 0x8B81;
constexpr GLenum N_GL_LINK_STATUS = 0x8B82;
constexpr GLenum N_GL_ARRAY_BUFFER = 0x8892;
constexpr GLenum N_GL_ARRAY_BUFFER_BINDING = 0x8894;
constexpr GLenum N_GL_DYNAMIC_DRAW = 0x88E8;
constexpr GLenum N_GL_VERTEX_ARRAY_BINDING = 0x85B5;
constexpr GLenum N_GL_CURRENT_PROGRAM = 0x8B8D;
constexpr GLenum N_GL_DRAW_FRAMEBUFFER = 0x8CA9;
constexpr GLenum N_GL_DRAW_FRAMEBUFFER_BINDING = 0x8CA6;
constexpr GLenum N_GL_PIXEL_UNPACK_BUFFER = 0x88EC;
constexpr GLenum N_GL_PIXEL_UNPACK_BUFFER_BINDING = 0x88EF;
constexpr GLenum N_GL_TEXTURE0 = 0x84C0;
constexpr GLenum N_GL_ACTIVE_TEXTURE = 0x84E0;
constexpr GLenum N_GL_BGRA = 0x80E1;
constexpr GLint N_GL_RGBA8 = 0x8058;
constexpr GLint N_GL_CLAMP_TO_EDGE = 0x812F;
constexpr GLenum N_GL_BLEND_SRC_RGB = 0x80C9;
constexpr GLenum N_GL_BLEND_DST_RGB = 0x80C8;
constexpr GLenum N_GL_BLEND_SRC_ALPHA = 0x80CB;
constexpr GLenum N_GL_BLEND_DST_ALPHA = 0x80CA;
constexpr GLenum N_GL_BLEND_EQUATION_RGB = 0x8009;
constexpr GLenum N_GL_BLEND_EQUATION_ALPHA = 0x883D;
constexpr GLenum N_GL_FUNC_ADD = 0x8006;
constexpr GLenum N_GL_UNPACK_ROW_LENGTH = 0x0CF2;
constexpr GLenum N_GL_UNPACK_SKIP_PIXELS = 0x0CF4;
constexpr GLenum N_GL_UNPACK_SKIP_ROWS = 0x0CF3;
constexpr GLenum N_GL_MAJOR_VERSION = 0x821B;
constexpr GLenum N_GL_FRAMEBUFFER_SRGB = 0x8DB9;

struct Functions {
    GLuint (APIENTRY* CreateShader)(GLenum) = nullptr;
    void (APIENTRY* ShaderSource)(GLuint, GLsizei, const char* const*, const GLint*) = nullptr;
    void (APIENTRY* CompileShader)(GLuint) = nullptr;
    void (APIENTRY* GetShaderiv)(GLuint, GLenum, GLint*) = nullptr;
    void (APIENTRY* DeleteShader)(GLuint) = nullptr;
    GLuint (APIENTRY* CreateProgram)() = nullptr;
    void (APIENTRY* AttachShader)(GLuint, GLuint) = nullptr;
    void (APIENTRY* BindAttribLocation)(GLuint, GLuint, const char*) = nullptr;
    void (APIENTRY* LinkProgram)(GLuint) = nullptr;
    void (APIENTRY* GetProgramiv)(GLuint, GLenum, GLint*) = nullptr;
    void (APIENTRY* UseProgram)(GLuint) = nullptr;
    GLint (APIENTRY* GetUniformLocation)(GLuint, const char*) = nullptr;
    void (APIENTRY* Uniform1i)(GLint, GLint) = nullptr;
    void (APIENTRY* Uniform2f)(GLint, GLfloat, GLfloat) = nullptr;
    void (APIENTRY* GenVertexArrays)(GLsizei, GLuint*) = nullptr;
    void (APIENTRY* BindVertexArray)(GLuint) = nullptr;
    void (APIENTRY* GenBuffers)(GLsizei, GLuint*) = nullptr;
    void (APIENTRY* BindBuffer)(GLenum, GLuint) = nullptr;
    void (APIENTRY* BufferData)(GLenum, std::ptrdiff_t, const void*, GLenum) = nullptr;
    void (APIENTRY* EnableVertexAttribArray)(GLuint) = nullptr;
    void (APIENTRY* VertexAttribPointer)(GLuint, GLint, GLenum, GLboolean, GLsizei, const void*) = nullptr;
    void (APIENTRY* ActiveTexture)(GLenum) = nullptr;
    void (APIENTRY* BlendFuncSeparate)(GLenum, GLenum, GLenum, GLenum) = nullptr;
    void (APIENTRY* BlendEquationSeparate)(GLenum, GLenum) = nullptr;
    void (APIENTRY* BindFramebuffer)(GLenum, GLuint) = nullptr;
};
Functions f;

bool LoadFunctions() {
    const HMODULE module = GetModuleHandleW(L"opengl32.dll");
    if (!module) return false;
    auto get = [module](const char* name) -> PROC {
        PROC p = wglGetProcAddress(name);
        const uintptr_t address = reinterpret_cast<uintptr_t>(p);
        if (!p || address <= 3 || address == static_cast<uintptr_t>(-1))
            p = GetProcAddress(module, name);
        return p;
    };
#define NEXUS_GL_LOAD(name) f.name = reinterpret_cast<decltype(f.name)>(get("gl" #name)); if (!f.name) return false
    NEXUS_GL_LOAD(CreateShader);
    NEXUS_GL_LOAD(ShaderSource);
    NEXUS_GL_LOAD(CompileShader);
    NEXUS_GL_LOAD(GetShaderiv);
    NEXUS_GL_LOAD(DeleteShader);
    NEXUS_GL_LOAD(CreateProgram);
    NEXUS_GL_LOAD(AttachShader);
    NEXUS_GL_LOAD(BindAttribLocation);
    NEXUS_GL_LOAD(LinkProgram);
    NEXUS_GL_LOAD(GetProgramiv);
    NEXUS_GL_LOAD(UseProgram);
    NEXUS_GL_LOAD(GetUniformLocation);
    NEXUS_GL_LOAD(Uniform1i);
    NEXUS_GL_LOAD(Uniform2f);
    NEXUS_GL_LOAD(GenVertexArrays);
    NEXUS_GL_LOAD(BindVertexArray);
    NEXUS_GL_LOAD(GenBuffers);
    NEXUS_GL_LOAD(BindBuffer);
    NEXUS_GL_LOAD(BufferData);
    NEXUS_GL_LOAD(EnableVertexAttribArray);
    NEXUS_GL_LOAD(VertexAttribPointer);
    NEXUS_GL_LOAD(ActiveTexture);
    NEXUS_GL_LOAD(BlendFuncSeparate);
    NEXUS_GL_LOAD(BlendEquationSeparate);
    NEXUS_GL_LOAD(BindFramebuffer);
#undef NEXUS_GL_LOAD
    return true;
}

// Save every graphics state touched by our renderer. GL state belongs to the
// host game, so restoring it is mandatory before calling the real SwapBuffers.
struct ScopedGLState {
    GLint program = 0, vao = 0, array = 0, unpackBuffer = 0;
    GLint drawFramebuffer = 0, drawBuffer = 0;
    GLint activeTexture = 0, unitZeroTexture = 0;
    GLint viewport[4]{}, scissorBox[4]{}, polygonMode[2]{};
    GLint blendSrcRGB = 0, blendDstRGB = 0, blendSrcA = 0, blendDstA = 0;
    GLint blendEqRGB = 0, blendEqA = 0;
    GLint unpackAlignment = 4, unpackRowLength = 0, unpackSkipPixels = 0, unpackSkipRows = 0;
    GLboolean depthWrite = GL_TRUE;
    GLboolean colorWrite[4]{GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE};
    GLboolean blending, depth, stencil, scissor, cull, srgb;
    ScopedGLState() {
        glGetIntegerv(N_GL_CURRENT_PROGRAM, &program);
        glGetIntegerv(N_GL_VERTEX_ARRAY_BINDING, &vao);
        glGetIntegerv(N_GL_ARRAY_BUFFER_BINDING, &array);
        glGetIntegerv(N_GL_PIXEL_UNPACK_BUFFER_BINDING, &unpackBuffer);
        glGetIntegerv(N_GL_DRAW_FRAMEBUFFER_BINDING, &drawFramebuffer);
        glGetIntegerv(GL_DRAW_BUFFER, &drawBuffer);
        glGetIntegerv(N_GL_ACTIVE_TEXTURE, &activeTexture);
        f.ActiveTexture(N_GL_TEXTURE0);
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &unitZeroTexture);
        glGetIntegerv(GL_VIEWPORT, viewport);
        glGetIntegerv(GL_SCISSOR_BOX, scissorBox);
        glGetIntegerv(GL_POLYGON_MODE, polygonMode);
        glGetIntegerv(N_GL_BLEND_SRC_RGB, &blendSrcRGB);
        glGetIntegerv(N_GL_BLEND_DST_RGB, &blendDstRGB);
        glGetIntegerv(N_GL_BLEND_SRC_ALPHA, &blendSrcA);
        glGetIntegerv(N_GL_BLEND_DST_ALPHA, &blendDstA);
        glGetIntegerv(N_GL_BLEND_EQUATION_RGB, &blendEqRGB);
        glGetIntegerv(N_GL_BLEND_EQUATION_ALPHA, &blendEqA);
        glGetIntegerv(GL_UNPACK_ALIGNMENT, &unpackAlignment);
        glGetIntegerv(N_GL_UNPACK_ROW_LENGTH, &unpackRowLength);
        glGetIntegerv(N_GL_UNPACK_SKIP_PIXELS, &unpackSkipPixels);
        glGetIntegerv(N_GL_UNPACK_SKIP_ROWS, &unpackSkipRows);
        glGetBooleanv(GL_DEPTH_WRITEMASK, &depthWrite);
        glGetBooleanv(GL_COLOR_WRITEMASK, colorWrite);
        blending = glIsEnabled(GL_BLEND);
        depth = glIsEnabled(GL_DEPTH_TEST);
        stencil = glIsEnabled(GL_STENCIL_TEST);
        scissor = glIsEnabled(GL_SCISSOR_TEST);
        cull = glIsEnabled(GL_CULL_FACE);
        srgb = glIsEnabled(N_GL_FRAMEBUFFER_SRGB);
    }
    ~ScopedGLState() {
        f.UseProgram(static_cast<GLuint>(program));
        f.BindVertexArray(static_cast<GLuint>(vao));
        f.BindBuffer(N_GL_ARRAY_BUFFER, static_cast<GLuint>(array));
        f.BindBuffer(N_GL_PIXEL_UNPACK_BUFFER, static_cast<GLuint>(unpackBuffer));
        f.BindFramebuffer(N_GL_DRAW_FRAMEBUFFER, static_cast<GLuint>(drawFramebuffer));
        glDrawBuffer(static_cast<GLenum>(drawBuffer));
        glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
        glScissor(scissorBox[0], scissorBox[1], scissorBox[2], scissorBox[3]);
        glPolygonMode(GL_FRONT, static_cast<GLenum>(polygonMode[0]));
        glPolygonMode(GL_BACK, static_cast<GLenum>(polygonMode[1]));
        f.BlendFuncSeparate(static_cast<GLenum>(blendSrcRGB), static_cast<GLenum>(blendDstRGB),
            static_cast<GLenum>(blendSrcA), static_cast<GLenum>(blendDstA));
        f.BlendEquationSeparate(static_cast<GLenum>(blendEqRGB), static_cast<GLenum>(blendEqA));
        glPixelStorei(GL_UNPACK_ALIGNMENT, unpackAlignment);
        glPixelStorei(N_GL_UNPACK_ROW_LENGTH, unpackRowLength);
        glPixelStorei(N_GL_UNPACK_SKIP_PIXELS, unpackSkipPixels);
        glPixelStorei(N_GL_UNPACK_SKIP_ROWS, unpackSkipRows);
        glDepthMask(depthWrite);
        glColorMask(colorWrite[0], colorWrite[1], colorWrite[2], colorWrite[3]);
        auto enable = [](GLenum cap, GLboolean was) { was ? glEnable(cap) : glDisable(cap); };
        enable(GL_BLEND, blending);
        enable(GL_DEPTH_TEST, depth);
        enable(GL_STENCIL_TEST, stencil);
        enable(GL_SCISSOR_TEST, scissor);
        enable(GL_CULL_FACE, cull);
        enable(N_GL_FRAMEBUFFER_SRGB, srgb);
        f.ActiveTexture(N_GL_TEXTURE0);
        glBindTexture(GL_TEXTURE_2D, static_cast<GLuint>(unitZeroTexture));
        f.ActiveTexture(static_cast<GLenum>(activeTexture));
    }
};

const char* VERTEX_SOURCE = R"GLSL(#version 130
in vec2 nexusPosition;
in vec2 nexusUV;
uniform vec2 nexusDisplay;
out vec2 textureUV;
void main() {
    vec2 clip = vec2(2.0 * nexusPosition.x / nexusDisplay.x - 1.0,
                     1.0 - 2.0 * nexusPosition.y / nexusDisplay.y);
    gl_Position = vec4(clip, 0.0, 1.0);
    textureUV = nexusUV;
}
)GLSL";
const char* PIXEL_SOURCE = R"GLSL(#version 130
uniform sampler2D nexusTexture;
in vec2 textureUV;
out vec4 nexusFrag;
void main() { nexusFrag = texture(nexusTexture, textureUV); }
)GLSL";

struct Vertex { float x, y, u, v; };
} // namespace

void NexusOpenGLRenderer::ResetForContext(HGLRC context) {
    // Never delete GL objects via a different context. The game/driver owns the
    // lifetime of an old context; the names are invalid in the new one.
    context_ = context;
    initialised_ = false;
    unsupported_ = false;
    f = Functions{};
    program_ = vertexShader_ = fragmentShader_ = vao_ = vbo_ = 0;
    imageTexture_ = cursorTexture_ = 0;
    imageWidth_ = imageHeight_ = 0;
    cursorWidth_ = cursorHeight_ = cursorHotX_ = cursorHotY_ = 0;
    lastSequence_ = 0;
    frame_ = NexusFrame{};
}

bool NexusOpenGLRenderer::Initialise() {
    const GLubyte* version = glGetString(GL_VERSION);
    unsigned major = 0;
    if (!version || std::sscanf(reinterpret_cast<const char*>(version), "%u", &major) != 1 || major < 3) {
        NexusTrace("OPENGL_VERSION_BELOW_3_UNSUPPORTED");
        return false;
    }
    if (!LoadFunctions()) {
        NexusTrace("OPENGL_REQUIRED_FUNCTIONS_MISSING");
        return false;
    }
    const ScopedGLState saved;
    vertexShader_ = f.CreateShader(N_GL_VERTEX_SHADER);
    fragmentShader_ = f.CreateShader(N_GL_FRAGMENT_SHADER);
    if (!vertexShader_ || !fragmentShader_) return false;
    f.ShaderSource(vertexShader_, 1, &VERTEX_SOURCE, nullptr);
    f.ShaderSource(fragmentShader_, 1, &PIXEL_SOURCE, nullptr);
    f.CompileShader(vertexShader_);
    f.CompileShader(fragmentShader_);
    GLint vertOK = 0, pixelOK = 0;
    f.GetShaderiv(vertexShader_, N_GL_COMPILE_STATUS, &vertOK);
    f.GetShaderiv(fragmentShader_, N_GL_COMPILE_STATUS, &pixelOK);
    if (!vertOK || !pixelOK) {
        NexusTrace("OPENGL_SHADER_COMPILE_FAILED");
        return false;
    }
    program_ = f.CreateProgram();
    if (!program_) return false;
    f.AttachShader(program_, vertexShader_);
    f.AttachShader(program_, fragmentShader_);
    f.BindAttribLocation(program_, 0, "nexusPosition");
    f.BindAttribLocation(program_, 1, "nexusUV");
    f.LinkProgram(program_);
    GLint linked = 0;
    f.GetProgramiv(program_, N_GL_LINK_STATUS, &linked);
    if (!linked) {
        NexusTrace("OPENGL_PROGRAM_LINK_FAILED");
        return false;
    }
    f.DeleteShader(vertexShader_); vertexShader_ = 0;
    f.DeleteShader(fragmentShader_); fragmentShader_ = 0;
    uniformSize_ = f.GetUniformLocation(program_, "nexusDisplay");
    uniformSampler_ = f.GetUniformLocation(program_, "nexusTexture");
    if (uniformSize_ < 0 || uniformSampler_ < 0) return false;
    f.GenVertexArrays(1, &vao_);
    f.GenBuffers(1, &vbo_);
    if (!vao_ || !vbo_) return false;
    f.BindVertexArray(vao_);
    f.BindBuffer(N_GL_ARRAY_BUFFER, vbo_);
    f.BufferData(N_GL_ARRAY_BUFFER, 6 * sizeof(Vertex), nullptr, N_GL_DYNAMIC_DRAW);
    f.EnableVertexAttribArray(0);
    f.EnableVertexAttribArray(1);
    f.VertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), nullptr);
    f.VertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(Vertex), reinterpret_cast<void*>(2 * sizeof(float)));
    glGenTextures(1, &imageTexture_);
    glGenTextures(1, &cursorTexture_);
    if (!imageTexture_ || !cursorTexture_) return false;
    auto makeTexture = [](GLuint t) {
        glBindTexture(GL_TEXTURE_2D, t);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, N_GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, N_GL_CLAMP_TO_EDGE);
    };
    makeTexture(imageTexture_);
    makeTexture(cursorTexture_);
    nexus_system_cursor::Image cursor;
    const bool windowsCursor = nexus_system_cursor::LoadConfiguredArrow(cursor);
    std::vector<uint8_t> pixels = windowsCursor ? std::move(cursor.pixels) : nexus_cursor_art::pixelsBGRA();
    cursorWidth_ = static_cast<int>(windowsCursor ? cursor.width : nexus_cursor_art::kWidth);
    cursorHeight_ = static_cast<int>(windowsCursor ? cursor.height : nexus_cursor_art::kHeight);
    cursorHotX_ = windowsCursor ? cursor.hotX : 0;
    cursorHotY_ = windowsCursor ? cursor.hotY : 0;
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    f.BindBuffer(N_GL_PIXEL_UNPACK_BUFFER, 0);
    glPixelStorei(N_GL_UNPACK_ROW_LENGTH, 0);
    glPixelStorei(N_GL_UNPACK_SKIP_PIXELS, 0);
    glPixelStorei(N_GL_UNPACK_SKIP_ROWS, 0);
    glBindTexture(GL_TEXTURE_2D, cursorTexture_);
    glTexImage2D(GL_TEXTURE_2D, 0, N_GL_RGBA8, cursorWidth_, cursorHeight_, 0,
                 N_GL_BGRA, GL_UNSIGNED_BYTE, pixels.data());
    NexusTrace(windowsCursor ? "SYSTEM_CURSOR_LOADED" : "SYSTEM_CURSOR_FALLBACK");
    NexusTrace("OPENGL_RENDERER_INITIALIZED");
    initialised_ = true;
    return true;
}

bool NexusOpenGLRenderer::Upload(const NexusFrame& frame) {
    if (frame.width == 0 || frame.height == 0 || frame.bgra.size() != size_t(frame.width) * frame.height * 4)
        return false;
    f.ActiveTexture(N_GL_TEXTURE0);
    glBindTexture(GL_TEXTURE_2D, imageTexture_);
    f.BindBuffer(N_GL_PIXEL_UNPACK_BUFFER, 0);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glPixelStorei(N_GL_UNPACK_ROW_LENGTH, 0);
    glPixelStorei(N_GL_UNPACK_SKIP_PIXELS, 0);
    glPixelStorei(N_GL_UNPACK_SKIP_ROWS, 0);
    // NXF1 is top-down BGRA premultiplied alpha from Chromium.
    glTexImage2D(GL_TEXTURE_2D, 0, N_GL_RGBA8, static_cast<GLsizei>(frame.width),
        static_cast<GLsizei>(frame.height), 0, N_GL_BGRA, GL_UNSIGNED_BYTE, frame.bgra.data());
    imageWidth_ = frame.width;
    imageHeight_ = frame.height;
    return true;
}

void NexusOpenGLRenderer::Quad(float x, float y, float width, float height,
                                GLuint texture, float screenWidth, float screenHeight) {
    const Vertex v[6]{
        {x,y,0,0}, {x+width,y,1,0}, {x,y+height,0,1},
        {x,y+height,0,1}, {x+width,y,1,0}, {x+width,y+height,1,1},
    };
    f.BindBuffer(N_GL_ARRAY_BUFFER, vbo_);
    f.BufferData(N_GL_ARRAY_BUFFER, sizeof(v), v, N_GL_DYNAMIC_DRAW);
    f.Uniform2f(uniformSize_, screenWidth, screenHeight);
    glBindTexture(GL_TEXTURE_2D, texture);
    glDrawArrays(GL_TRIANGLES, 0, 6);
}

void NexusOpenGLRenderer::Draw(HDC dc) {
    const HGLRC active = wglGetCurrentContext();
    if (!active || !NexusOverlayVisible()) return;
    const HDC currentDC = wglGetCurrentDC();
    if (!currentDC || (currentDC != dc && WindowFromDC(currentDC) != WindowFromDC(dc))) return;
    HWND window = WindowFromDC(dc);
    if (!window) return;
    RECT rect{};
    if (!GetClientRect(window, &rect)) return;
    const int width = rect.right - rect.left;
    const int height = rect.bottom - rect.top;
    if (width < 16 || height < 16) return;
    if (active != context_) ResetForContext(active);
    if (unsupported_) return;
    if (!initialised_ && !Initialise()) {
        unsupported_ = true; // Avoid repeated shader compilation and logs every frame.
        NexusTrace("OPENGL_RENDERER_UNAVAILABLE");
        return;
    }
    const ScopedGLState saved;
    NexusFrame fresh;
    if (NexusGetNewFrame(lastSequence_, fresh)) {
        if (Upload(fresh)) {
            lastSequence_ = fresh.sequence;
            frame_ = std::move(fresh);
        }
    }
    if (!imageWidth_ || !imageHeight_) return;

    f.BindFramebuffer(N_GL_DRAW_FRAMEBUFFER, 0);
    glDrawBuffer(GL_BACK);
    glViewport(0, 0, width, height);
    glPolygonMode(GL_FRONT_AND_BACK, GL_FILL);
    glDisable(GL_SCISSOR_TEST);
    glDisable(GL_DEPTH_TEST);
    glDisable(GL_STENCIL_TEST);
    glDisable(GL_CULL_FACE);
    glDepthMask(GL_FALSE);
    glColorMask(GL_TRUE, GL_TRUE, GL_TRUE, GL_TRUE);
    glEnable(GL_BLEND);
    f.BlendEquationSeparate(N_GL_FUNC_ADD, N_GL_FUNC_ADD);
    f.BlendFuncSeparate(GL_ONE, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    f.ActiveTexture(N_GL_TEXTURE0);
    f.BindBuffer(N_GL_PIXEL_UNPACK_BUFFER, 0);
    f.UseProgram(program_);
    f.BindVertexArray(vao_);
    f.Uniform1i(uniformSampler_, 0);
    const float x = std::max(8.f, float(width) - float(imageWidth_) - 24.f);
    Quad(x, 24.f, float(imageWidth_), float(imageHeight_), imageTexture_, float(width), float(height));
    static std::atomic_flag firstFrame = ATOMIC_FLAG_INIT;
    if (!firstFrame.test_and_set()) NexusTrace("FRAME_DRAWN");
    const NexusCursorState cursor = NexusGetCursorState();
    if (cursor.valid && cursorTexture_) {
        const float cx = float(cursor.xNorm) * float(width - 1) / 65535.f;
        const float cy = float(cursor.yNorm) * float(height - 1) / 65535.f;
        Quad(cx - float(cursorHotX_), cy - float(cursorHotY_),
             float(cursorWidth_), float(cursorHeight_), cursorTexture_, float(width), float(height));
        static std::atomic_flag firstCursor = ATOMIC_FLAG_INIT;
        if (!firstCursor.test_and_set()) NexusTrace("CURSOR_DRAWN");
    }
}
