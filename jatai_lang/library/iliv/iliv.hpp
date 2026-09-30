// biblioteca iliv do Jatai: janela Win32 com desenho GDI e eventos por callback
//
// O desenho vai para um bitmap em memoria (double buffering) que e copiado
// para a janela ao fim de cada quadro, sem piscar.
#pragma once

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>
// macros antigas do Windows com nomes comuns, que atrapalhariam o programa gerado
#undef near
#undef far
#undef IN
#undef OUT
#undef OPTIONAL

#include <chrono>
#include <cstdio>
#include <functional>
#include <string>
#include <string_view>
#include <thread>

namespace jatai::iliv {

namespace detail {

struct State {
    HWND hwnd = nullptr;
    HDC mem = nullptr;        // bitmap em memoria onde o quadro e desenhado
    HBITMAP bmp = nullptr;
    HGDIOBJ old_bmp = nullptr;
    HFONT font = nullptr;
    int w = 0, h = 0;
    bool running = false;
    int mx = 0, my = 0;
    double dt = 0.0;
    std::function<void()> draw;
    std::function<void(const std::string&)> key;
    std::function<void(int, int)> click, move;
};

inline State& st() {
    static State s;
    return s;
}

inline std::wstring widen(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

struct KeyName {
    int vk;
    const char *name;
};

inline const KeyName *special_keys(size_t& n) {
    static const KeyName keys[] = {
        {VK_LEFT, "left"},   {VK_RIGHT, "right"},   {VK_UP, "up"},       {VK_DOWN, "down"},
        {VK_SPACE, "space"}, {VK_RETURN, "enter"},  {VK_ESCAPE, "escape"}, {VK_TAB, "tab"},
        {VK_BACK, "backspace"}, {VK_SHIFT, "shift"}, {VK_CONTROL, "ctrl"}, {VK_MENU, "alt"},
        {VK_DELETE, "delete"}, {VK_F1, "f1"}, {VK_F2, "f2"}, {VK_F3, "f3"}, {VK_F4, "f4"},
        {VK_F5, "f5"}, {VK_F6, "f6"}, {VK_F7, "f7"}, {VK_F8, "f8"}, {VK_F9, "f9"},
        {VK_F10, "f10"}, {VK_F11, "f11"}, {VK_F12, "f12"},
    };
    n = sizeof keys / sizeof *keys;
    return keys;
}

inline std::string key_name(WPARAM vk) {
    if (vk >= 'A' && vk <= 'Z') return std::string(1, (char)('a' + (vk - 'A')));
    if (vk >= '0' && vk <= '9') return std::string(1, (char)vk);
    size_t n;
    const KeyName *keys = special_keys(n);
    for (size_t i = 0; i < n; i++)
        if ((WPARAM)keys[i].vk == vk) return keys[i].name;
    return "";
}

inline int key_code(std::string_view name) {
    if (name.size() == 1 && name[0] >= 'a' && name[0] <= 'z') return 'A' + (name[0] - 'a');
    if (name.size() == 1 && name[0] >= '0' && name[0] <= '9') return name[0];
    size_t n;
    const KeyName *keys = special_keys(n);
    for (size_t i = 0; i < n; i++)
        if (name == keys[i].name) return keys[i].vk;
    return 0;
}

inline LRESULT CALLBACK window_proc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    State& s = st();
    switch (msg) {
    case WM_CLOSE:
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        s.running = false;
        PostQuitMessage(0);
        return 0;
    case WM_ERASEBKGND:
        return 1; // o quadro inteiro e redesenhado: nada de apagar (evita piscar)
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC dc = BeginPaint(hwnd, &ps);
        if (s.mem) BitBlt(dc, 0, 0, s.w, s.h, s.mem, 0, 0, SRCCOPY);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_KEYDOWN:
    case WM_SYSKEYDOWN:
        if (s.key && !(lp & (1 << 30))) { // ignora a repeticao automatica da tecla segurada
            std::string name = key_name(wp);
            if (!name.empty()) s.key(name);
        }
        break;
    case WM_LBUTTONDOWN:
        if (s.click) s.click((short)LOWORD(lp), (short)HIWORD(lp));
        return 0;
    case WM_MOUSEMOVE:
        s.mx = (short)LOWORD(lp);
        s.my = (short)HIWORD(lp);
        if (s.move) s.move(s.mx, s.my);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

inline void present() {
    State& s = st();
    HDC dc = GetDC(s.hwnd);
    BitBlt(dc, 0, 0, s.w, s.h, s.mem, 0, 0, SRCCOPY);
    ReleaseDC(s.hwnd, dc);
}

inline void release() {
    State& s = st();
    if (s.mem) {
        SelectObject(s.mem, s.old_bmp);
        DeleteObject(s.bmp);
        DeleteDC(s.mem);
    }
    if (s.font) DeleteObject(s.font);
    s.mem = nullptr;
    s.bmp = nullptr;
    s.font = nullptr;
    s.hwnd = nullptr;
}

inline void fill(int x, int y, int w, int h, int cor) {
    State& s = st();
    if (!s.mem) return;
    RECT r{x, y, x + w, y + h};
    HBRUSH b = CreateSolidBrush((COLORREF)cor);
    FillRect(s.mem, &r, b);
    DeleteObject(b);
}

}  // namespace detail

inline void open(int largura, int altura, std::string_view titulo) {
    detail::State& s = detail::st();
    if (s.hwnd) return;
    SetProcessDPIAware(); // pixels de verdade em telas com escala (sem imagem borrada)
    HINSTANCE inst = GetModuleHandleW(nullptr);
    static bool registered = false;
    if (!registered) {
        WNDCLASSW wc{};
        wc.lpfnWndProc = detail::window_proc;
        wc.hInstance = inst;
        wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
        wc.lpszClassName = L"JataiIliv";
        RegisterClassW(&wc);
        registered = true;
    }
    DWORD style = WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX;
    RECT r{0, 0, largura, altura};
    AdjustWindowRect(&r, style, FALSE);
    std::wstring title = detail::widen(titulo);
    s.hwnd = CreateWindowExW(0, L"JataiIliv", title.c_str(), style, CW_USEDEFAULT, CW_USEDEFAULT,
                             r.right - r.left, r.bottom - r.top, nullptr, nullptr, inst, nullptr);
    s.w = largura;
    s.h = altura;
    HDC dc = GetDC(s.hwnd);
    s.mem = CreateCompatibleDC(dc);
    s.bmp = CreateCompatibleBitmap(dc, largura, altura);
    s.old_bmp = SelectObject(s.mem, s.bmp);
    ReleaseDC(s.hwnd, dc);
    s.font = CreateFontW(-18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                         CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Segoe UI");
    SelectObject(s.mem, s.font);
    SetBkMode(s.mem, TRANSPARENT);
    detail::fill(0, 0, largura, altura, 0);
    ShowWindow(s.hwnd, SW_SHOW);
    UpdateWindow(s.hwnd);
    s.running = true;
}

inline void close() {
    detail::State& s = detail::st();
    if (s.hwnd) DestroyWindow(s.hwnd);
    s.running = false;
}

inline void run() {
    using clock = std::chrono::steady_clock;
    detail::State& s = detail::st();
    std::fflush(stdout);
    timeBeginPeriod(1); // sleep com resolucao de 1 ms (o padrao do Windows e ~15.6 ms)
    const auto frame = std::chrono::duration_cast<clock::duration>(std::chrono::duration<double>(1.0 / 60.0));
    auto last = clock::now(), next = last;
    while (s.running) {
        MSG msg;
        while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) s.running = false;
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        if (!s.running) break;
        auto now = clock::now();
        s.dt = std::chrono::duration<double>(now - last).count();
        last = now;
        if (s.draw) s.draw();
        if (!s.running || !s.hwnd) break; // on_draw pode ter fechado a janela
        detail::present();
        std::fflush(stdout);
        next += frame;
        if (next < clock::now()) next = clock::now(); // atrasou: nao tenta compensar quadros perdidos
        std::this_thread::sleep_until(next);
    }
    timeEndPeriod(1);
    detail::release();
}

inline void on_draw(std::function<void()> f) { detail::st().draw = std::move(f); }
inline void on_key(std::function<void(const std::string&)> f) { detail::st().key = std::move(f); }
inline void on_click(std::function<void(int, int)> f) { detail::st().click = std::move(f); }
inline void on_mouse_move(std::function<void(int, int)> f) { detail::st().move = std::move(f); }

// COLORREF do Windows: 0x00BBGGRR
inline int rgb(int r, int g, int b) {
    auto c = [](int v) { return v < 0 ? 0 : v > 255 ? 255 : v; };
    return c(r) | c(g) << 8 | c(b) << 16;
}

inline void clear(int cor) { detail::fill(0, 0, detail::st().w, detail::st().h, cor); }

inline void rect(int x, int y, int largura, int altura, int cor) { detail::fill(x, y, largura, altura, cor); }

inline void circle(int x, int y, int raio, int cor) {
    detail::State& s = detail::st();
    if (!s.mem) return;
    HBRUSH b = CreateSolidBrush((COLORREF)cor);
    HGDIOBJ ob = SelectObject(s.mem, b);
    HGDIOBJ op = SelectObject(s.mem, GetStockObject(NULL_PEN));
    Ellipse(s.mem, x - raio, y - raio, x + raio + 1, y + raio + 1);
    SelectObject(s.mem, op);
    SelectObject(s.mem, ob);
    DeleteObject(b);
}

inline void line(int x1, int y1, int x2, int y2, int cor) {
    detail::State& s = detail::st();
    if (!s.mem) return;
    HPEN p = CreatePen(PS_SOLID, 2, (COLORREF)cor);
    HGDIOBJ op = SelectObject(s.mem, p);
    MoveToEx(s.mem, x1, y1, nullptr);
    LineTo(s.mem, x2, y2);
    SelectObject(s.mem, op);
    DeleteObject(p);
}

inline void text(int x, int y, std::string_view texto, int cor) {
    detail::State& s = detail::st();
    if (!s.mem) return;
    std::wstring w = detail::widen(texto);
    SetTextColor(s.mem, (COLORREF)cor);
    TextOutW(s.mem, x, y, w.c_str(), (int)w.size());
}

inline int width() { return detail::st().w; }
inline int height() { return detail::st().h; }
inline int mouse_x() { return detail::st().mx; }
inline int mouse_y() { return detail::st().my; }
inline double delta() { return detail::st().dt; }

inline bool mouse_down() {
    return detail::st().hwnd && GetForegroundWindow() == detail::st().hwnd && (GetAsyncKeyState(VK_LBUTTON) & 0x8000);
}

// so considera o teclado quando a janela esta em foco
inline bool key_down(std::string_view tecla) {
    int vk = detail::key_code(tecla);
    return vk && detail::st().hwnd && GetForegroundWindow() == detail::st().hwnd && (GetAsyncKeyState(vk) & 0x8000);
}

inline void screenshot(std::string_view caminho) {
    detail::State& s = detail::st();
    if (!s.mem) return;
    BITMAPINFOHEADER bi{};
    bi.biSize = sizeof bi;
    bi.biWidth = s.w;
    bi.biHeight = s.h; // positivo: linhas de baixo para cima, como o BMP espera
    bi.biPlanes = 1;
    bi.biBitCount = 32;
    bi.biCompression = BI_RGB;
    std::string pixels((size_t)s.w * (size_t)s.h * 4, '\0');
    GetDIBits(s.mem, s.bmp, 0, (UINT)s.h, pixels.data(), (BITMAPINFO *)&bi, DIB_RGB_COLORS);
    BITMAPFILEHEADER fh{};
    fh.bfType = 0x4D42; // "BM"
    fh.bfOffBits = sizeof fh + sizeof bi;
    fh.bfSize = fh.bfOffBits + (DWORD)pixels.size();
    std::wstring path = detail::widen(caminho);
    FILE *f = _wfopen(path.c_str(), L"wb");
    if (!f) return;
    std::fwrite(&fh, sizeof fh, 1, f);
    std::fwrite(&bi, sizeof bi, 1, f);
    std::fwrite(pixels.data(), 1, pixels.size(), f);
    std::fclose(f);
}

}  // namespace jatai::iliv
