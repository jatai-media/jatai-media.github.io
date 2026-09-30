// biblioteca text do Jatai: implementacao C++ das funcoes extern de text.jat
//
// Parametros sao std::string_view: nenhuma copia, nem no modo interpretado
// nem no C++ gerado. Posicoes (find, slice) sao em bytes, como len().
#pragma once

#include <charconv>
#include <string>
#include <string_view>

namespace jatai::text {

namespace detail {

inline bool is_space(unsigned char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }

// Minusculas/maiusculas em UTF-8: ASCII e o bloco Latin-1 (a-z, a acentuadas, c cedilha...).
// Em UTF-8 essas letras sao 0xC3 seguido de 0x80-0x9E (maiusculas) ou 0xA0-0xBE (minusculas);
// 0xC3 0x97 (x de multiplicacao) e 0xC3 0xB7 (divisao) nao sao letras.
inline void to_upper(std::string& r, size_t from, size_t to) {
    for (size_t i = from; i < to; i++) {
        unsigned char c = (unsigned char)r[i];
        if (c >= 'a' && c <= 'z') r[i] = (char)(c - 32);
        else if (c == 0xC3 && i + 1 < to) {
            unsigned char d = (unsigned char)r[i + 1];
            if (d >= 0xA0 && d <= 0xBE && d != 0xB7) r[i + 1] = (char)(d - 0x20);
            i++;
        }
    }
}

inline void to_lower(std::string& r, size_t from, size_t to) {
    for (size_t i = from; i < to; i++) {
        unsigned char c = (unsigned char)r[i];
        if (c >= 'A' && c <= 'Z') r[i] = (char)(c + 32);
        else if (c == 0xC3 && i + 1 < to) {
            unsigned char d = (unsigned char)r[i + 1];
            if (d >= 0x80 && d <= 0x9E && d != 0x97) r[i + 1] = (char)(d + 0x20);
            i++;
        }
    }
}

// tamanho em bytes do caractere UTF-8 que comeca em s[i]
inline size_t char_size(std::string_view s, size_t i) {
    unsigned char c = (unsigned char)s[i];
    size_t n = c < 0x80 ? 1 : c >> 5 == 6 ? 2 : c >> 4 == 14 ? 3 : c >> 3 == 30 ? 4 : 1;
    return i + n <= s.size() ? n : 1;
}

// conectivos de nomes em portugues, que ficam em minusculo no meio do nome
inline bool is_particle(std::string_view w) {
    return w == "da" || w == "de" || w == "do" || w == "das" || w == "dos" || w == "e";
}

inline int to_index(size_t pos) { return pos == std::string_view::npos ? -1 : (int)pos; }

}  // namespace detail

inline std::string upper(std::string_view s) {
    std::string r(s);
    detail::to_upper(r, 0, r.size());
    return r;
}

inline std::string lower(std::string_view s) {
    std::string r(s);
    detail::to_lower(r, 0, r.size());
    return r;
}

// "  jOAO   da  SILVA-souza " -> "Joao da Silva-Souza": espacos normalizados, primeira
// letra de cada palavra (e depois de hifen ou apostrofo) maiuscula, conectivos em minusculo
inline std::string name(std::string_view s) {
    std::string r;
    size_t i = 0;
    bool first = true;
    while (i < s.size()) {
        while (i < s.size() && detail::is_space((unsigned char)s[i])) i++;
        size_t start = i;
        while (i < s.size() && !detail::is_space((unsigned char)s[i])) i++;
        if (start == i) break;
        std::string word(s.substr(start, i - start));
        detail::to_lower(word, 0, word.size());
        if (!first) r += ' ';
        size_t at = r.size();
        r += word;
        if (first || !detail::is_particle(word)) {
            bool cap = true;
            for (size_t k = at; k < r.size();) {
                size_t n = detail::char_size(r, k);
                if (cap) detail::to_upper(r, k, k + n);
                cap = r[k] == '-' || r[k] == '\'';
                k += n;
            }
        }
        first = false;
    }
    return r;
}

// primeira letra maiuscula, o resto como esta
inline std::string capitalize(std::string_view s) {
    std::string r(s);
    if (!r.empty()) detail::to_upper(r, 0, detail::char_size(r, 0));
    return r;
}

inline std::string trim_left(std::string_view s) {
    size_t i = 0;
    while (i < s.size() && detail::is_space((unsigned char)s[i])) i++;
    return std::string(s.substr(i));
}

inline std::string trim_right(std::string_view s) {
    size_t n = s.size();
    while (n > 0 && detail::is_space((unsigned char)s[n - 1])) n--;
    return std::string(s.substr(0, n));
}

inline std::string trim(std::string_view s) {
    size_t i = 0, n = s.size();
    while (i < n && detail::is_space((unsigned char)s[i])) i++;
    while (n > i && detail::is_space((unsigned char)s[n - 1])) n--;
    return std::string(s.substr(i, n - i));
}

inline bool contains(std::string_view s, std::string_view sub) { return s.find(sub) != std::string_view::npos; }
inline bool starts_with(std::string_view s, std::string_view p) { return s.substr(0, p.size()) == p; }
inline bool ends_with(std::string_view s, std::string_view p) {
    return s.size() >= p.size() && s.substr(s.size() - p.size()) == p;
}

inline int find(std::string_view s, std::string_view sub) { return detail::to_index(s.find(sub)); }

inline int find_from(std::string_view s, std::string_view sub, int from) {
    if (from < 0) from = 0;
    if ((size_t)from > s.size()) return -1;
    return detail::to_index(s.find(sub, (size_t)from));
}

inline int count(std::string_view s, std::string_view sub) {
    if (sub.empty()) return 0;
    int n = 0;
    for (size_t p = s.find(sub); p != std::string_view::npos; p = s.find(sub, p + sub.size())) n++;
    return n;
}

inline std::string replace(std::string_view s, std::string_view from, std::string_view to) {
    if (from.empty()) return std::string(s);
    std::string r;
    size_t i = 0;
    for (size_t p = s.find(from); p != std::string_view::npos; p = s.find(from, i)) {
        r.append(s.substr(i, p - i));
        r.append(to);
        i = p + from.size();
    }
    r.append(s.substr(i));
    return r;
}

// bytes [inicio, fim), com os limites ajustados ao tamanho da string
inline std::string slice(std::string_view s, int start, int end) {
    int n = (int)s.size();
    if (start < 0) start = 0;
    if (start > n) start = n;
    if (end > n) end = n;
    if (end < start) end = start;
    return std::string(s.substr((size_t)start, (size_t)(end - start)));
}

inline std::string repeat(std::string_view s, int times) {
    std::string r;
    if (times > 0) r.reserve(s.size() * (size_t)times);
    for (int i = 0; i < times; i++) r.append(s);
    return r;
}

// quantidade de caracteres (UTF-8), nao de bytes: length("acao") com cedilha e til = 4
inline int length(std::string_view s) {
    int n = 0;
    for (unsigned char c : s)
        if ((c & 0xC0) != 0x80) n++;
    return n;
}

inline bool is_int(std::string_view s) {
    std::string t = trim(s);
    int v;
    auto [p, ec] = std::from_chars(t.data(), t.data() + t.size(), v);
    return !t.empty() && ec == std::errc() && p == t.data() + t.size();
}

// texto -> numero (espacos nas pontas sao ignorados); texto invalido da 0
inline int to_int(std::string_view s) {
    std::string t = trim(s);
    int v = 0;
    auto [p, ec] = std::from_chars(t.data(), t.data() + t.size(), v);
    return ec == std::errc() && p == t.data() + t.size() ? v : 0;
}

inline double to_double(std::string_view s) {
    std::string t = trim(s);
    double v = 0.0;
    auto [p, ec] = std::from_chars(t.data(), t.data() + t.size(), v);
    return ec == std::errc() && p == t.data() + t.size() ? v : 0.0;
}

}  // namespace jatai::text
