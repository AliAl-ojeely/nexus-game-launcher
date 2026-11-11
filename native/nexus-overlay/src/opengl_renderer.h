#pragma once
// Experimental x86/x64 OpenGL 3.0+ renderer for the existing Nexus BGRA pipe.
// All GL work occurs on the game's thread with a current WGL context.
#include "frame_pipe.h"
#include <windows.h>
#include <GL/gl.h>
#include <cstdint>
#include <vector>

class NexusOpenGLRenderer final {
public:
    void Draw(HDC dc);
private:
    // OpenGL object names are owned by a specific WGL context, never shared
    // implicitly with another context. On context change, discard stale names.
    HGLRC context_ = nullptr;
    bool initialised_ = false;
    bool unsupported_ = false;
    GLuint program_ = 0;
    GLuint vertexShader_ = 0;
    GLuint fragmentShader_ = 0;
    GLuint vao_ = 0;
    GLuint vbo_ = 0;
    GLuint imageTexture_ = 0;
    GLuint cursorTexture_ = 0;
    GLint uniformSize_ = -1;
    GLint uniformSampler_ = -1;
    uint32_t imageWidth_ = 0;
    uint32_t imageHeight_ = 0;
    uint64_t lastSequence_ = 0;
    NexusFrame frame_;
    int cursorWidth_ = 0;
    int cursorHeight_ = 0;
    int cursorHotX_ = 0;
    int cursorHotY_ = 0;
    void ResetForContext(HGLRC context);
    bool Initialise();
    bool Upload(const NexusFrame& frame);
    void Quad(float x, float y, float w, float h, GLuint texture, float width, float height);
};
