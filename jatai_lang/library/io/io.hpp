// biblioteca io do Jatai: entrada do teclado/pipe e saida de erro
#pragma once

#include <cstdio>
#include <string>
#include <string_view>

#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
extern "C" __declspec(dllimport) int __stdcall SetConsoleOutputCP(unsigned);
#endif

namespace jatai::io {

namespace detail {

inline bool& at_eof() {
    static bool v = false;
    return v;
}

#ifdef _WIN32
// No console do Windows os bytes lidos vem na pagina de codigo do console (850),
// nao em UTF-8: por isso o console e lido em UTF-16 e convertido. Pipes e
// arquivos redirecionados sao lidos como bytes (ja estao em UTF-8).
inline bool stdin_is_console() {
    static const bool console = [] {
        bool c = _isatty(_fileno(stdin)) != 0;
        if (c) _setmode(_fileno(stdin), _O_U16TEXT);
        return c;
    }();
    return console;
}

inline void append_utf8(std::string& r, unsigned cp) {
    if (cp < 0x80) r += (char)cp;
    else if (cp < 0x800) { r += (char)(0xC0 | cp >> 6); r += (char)(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) {
        r += (char)(0xE0 | cp >> 12); r += (char)(0x80 | (cp >> 6 & 0x3F)); r += (char)(0x80 | (cp & 0x3F));
    } else {
        r += (char)(0xF0 | cp >> 18); r += (char)(0x80 | (cp >> 12 & 0x3F));
        r += (char)(0x80 | (cp >> 6 & 0x3F)); r += (char)(0x80 | (cp & 0x3F));
    }
}

// para o texto escrito aparecer com acentos mesmo sem literais acentuados no programa
inline const bool utf8_console = (SetConsoleOutputCP(65001), true);
#endif

// le uma linha sem o \n (e sem \r); false se ja estava no fim da entrada
inline bool read_line(std::string& out) {
    out.clear();
#ifdef _WIN32
    if (stdin_is_console()) {
        bool any = false;
        unsigned high = 0;
        for (wint_t c; (c = std::fgetwc(stdin)) != WEOF;) {
            any = true;
            if (c == L'\n') return true;
            if (c == L'\r') continue;
            if (c >= 0xD800 && c <= 0xDBFF) { high = c; continue; }
            if (c >= 0xDC00 && c <= 0xDFFF && high) {
                append_utf8(out, 0x10000 + ((high - 0xD800) << 10) + (c - 0xDC00));
                high = 0;
                continue;
            }
            append_utf8(out, (unsigned)c);
        }
        return any;
    }
#endif
    bool any = false;
    for (int c; (c = std::fgetc(stdin)) != EOF;) {
        any = true;
        if (c == '\n') break;
        out += (char)c;
    }
    if (!out.empty() && out.back() == '\r') out.pop_back();
    return any;
}

}  // namespace detail

// le uma linha digitada (ou vinda de um pipe); no fim da entrada devolve ""
inline std::string read_line() {
    std::fflush(stdout); // o que foi impresso antes (uma pergunta) aparece antes de esperar
    std::string s;
    if (!detail::read_line(s)) detail::at_eof() = true;
    return s;
}

// mostra a pergunta e le a resposta, como o input() do Python
inline std::string input(std::string_view prompt) {
    std::fwrite(prompt.data(), 1, prompt.size(), stdout);
    return read_line();
}

// true se nao ha mais nada para ler (espera a proxima entrada para saber)
inline bool eof() {
    if (detail::at_eof()) return true;
    std::fflush(stdout);
#ifdef _WIN32
    if (detail::stdin_is_console()) {
        wint_t c = std::fgetwc(stdin);
        if (c == WEOF) return detail::at_eof() = true;
        std::ungetwc(c, stdin);
        return false;
    }
#endif
    int c = std::fgetc(stdin);
    if (c == EOF) return detail::at_eof() = true;
    std::ungetc(c, stdin);
    return false;
}

// le toda a entrada ate o fim (util com pipes: jatai prog.jat < dados.txt)
inline std::string read_all() {
    std::fflush(stdout);
    std::string r;
#ifdef _WIN32
    if (detail::stdin_is_console()) {
        std::string line;
        bool first = true;
        while (detail::read_line(line)) {
            if (!first) r += '\n';
            r += line;
            first = false;
        }
        detail::at_eof() = true;
        return r;
    }
#endif
    char buf[65536];
    for (size_t n; (n = std::fread(buf, 1, sizeof buf, stdin)) > 0;) r.append(buf, n);
    detail::at_eof() = true;
    return r;
}

// saida de erro (stderr): mensagens que nao se misturam com a saida do programa
inline void eprint(std::string_view s) {
    std::fflush(stdout);
    std::fwrite(s.data(), 1, s.size(), stderr);
}

inline void eprintln(std::string_view s) {
    eprint(s);
    std::fputc('\n', stderr);
}

// forca a saida pendente a aparecer agora
inline void flush() { std::fflush(stdout); }

}  // namespace jatai::io
