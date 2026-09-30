// biblioteca file do Jatai: arquivos e pastas (std::filesystem)
//
// Caminhos sao UTF-8 (acentos funcionam no Windows). Arquivos sao lidos e
// gravados como bytes, sem conversao de \n para \r\n.
// Erros (arquivo inexistente, sem permissao...) encerram o programa com uma
// mensagem, como um indice fora dos limites: use exists() antes, se precisar.
#pragma once

#include <algorithm>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>
#include <string_view>
#include <system_error>
#include <vector>

namespace jatai::file {

namespace detail {

namespace fs = std::filesystem;

// std::string com UTF-8 -> caminho (no Windows, sem isso o texto seria lido na pagina de codigo local)
inline fs::path path(std::string_view s) {
    return fs::path(std::u8string(reinterpret_cast<const char8_t *>(s.data()), s.size()));
}

inline std::string utf8(const fs::path& p) {
    std::u8string u = p.u8string();
    return std::string(u.begin(), u.end());
}

[[noreturn]] inline void fail(const char *what, std::string_view caminho, const std::error_code& ec = {}) {
    std::fflush(stdout);
    std::fprintf(stderr, "erro: %s '%.*s'", what, (int)caminho.size(), caminho.data());
    if (ec) std::fprintf(stderr, ": %s", ec.message().c_str());
    std::fputc('\n', stderr);
    std::exit(1);
}

}  // namespace detail

// conteudo inteiro do arquivo
inline std::string read(std::string_view caminho) {
    std::ifstream in(detail::path(caminho), std::ios::binary);
    if (!in) detail::fail("nao foi possivel ler o arquivo", caminho);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

// cria ou substitui o arquivo
inline void write(std::string_view caminho, std::string_view conteudo) {
    std::ofstream out(detail::path(caminho), std::ios::binary | std::ios::trunc);
    if (!out) detail::fail("nao foi possivel gravar o arquivo", caminho);
    out.write(conteudo.data(), (std::streamsize)conteudo.size());
    if (!out) detail::fail("falha ao gravar o arquivo", caminho);
}

// acrescenta no fim do arquivo (cria se nao existir)
inline void append(std::string_view caminho, std::string_view conteudo) {
    std::ofstream out(detail::path(caminho), std::ios::binary | std::ios::app);
    if (!out) detail::fail("nao foi possivel gravar o arquivo", caminho);
    out.write(conteudo.data(), (std::streamsize)conteudo.size());
    if (!out) detail::fail("falha ao gravar o arquivo", caminho);
}

inline bool exists(std::string_view caminho) {
    std::error_code ec;
    return detail::fs::exists(detail::path(caminho), ec);
}

inline bool is_dir(std::string_view caminho) {
    std::error_code ec;
    return detail::fs::is_directory(detail::path(caminho), ec);
}

// tamanho em bytes
inline int size(std::string_view caminho) {
    std::error_code ec;
    auto n = detail::fs::file_size(detail::path(caminho), ec);
    if (ec) detail::fail("nao foi possivel obter o tamanho de", caminho, ec);
    if (n > (std::uintmax_t)INT_MAX) detail::fail("arquivo grande demais para int:", caminho);
    return (int)n;
}

// cria a pasta, e as pastas intermediarias que faltarem
inline void mkdir(std::string_view caminho) {
    std::error_code ec;
    detail::fs::create_directories(detail::path(caminho), ec);
    if (ec) detail::fail("nao foi possivel criar a pasta", caminho, ec);
}

// apaga um arquivo ou uma pasta vazia; se nao existir, nao faz nada
inline void remove(std::string_view caminho) {
    std::error_code ec;
    detail::fs::remove(detail::path(caminho), ec);
    if (ec) detail::fail("nao foi possivel apagar", caminho, ec);
}

// copia um arquivo (substitui o destino se existir)
inline void copy(std::string_view origem, std::string_view destino) {
    std::error_code ec;
    detail::fs::copy_file(detail::path(origem), detail::path(destino),
                          detail::fs::copy_options::overwrite_existing, ec);
    if (ec) detail::fail("nao foi possivel copiar", origem, ec);
}

// renomeia ou move um arquivo ou pasta
inline void rename(std::string_view origem, std::string_view destino) {
    std::error_code ec;
    detail::fs::rename(detail::path(origem), detail::path(destino), ec);
    if (ec) detail::fail("nao foi possivel renomear", origem, ec);
}

// nomes dentro da pasta, em ordem alfabetica, separados por \n (use list() em Jatai)
inline std::string list_raw(std::string_view pasta) {
    std::error_code ec;
    std::vector<std::string> nomes;
    for (detail::fs::directory_iterator it(detail::path(pasta), ec), end; !ec && it != end; it.increment(ec))
        nomes.push_back(detail::utf8(it->path().filename()));
    if (ec) detail::fail("nao foi possivel listar a pasta", pasta, ec);
    std::sort(nomes.begin(), nomes.end());
    std::string r;
    for (size_t i = 0; i < nomes.size(); i++) {
        if (i) r += '\n';
        r += nomes[i];
    }
    return r;
}

}  // namespace jatai::file
