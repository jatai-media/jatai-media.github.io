// biblioteca http do Jatai: servidor HTTP/1.1 simples (um pedido por vez)
//
// Cada pedido e lido inteiro, passa pela rota (callback Jatai) ou pela pasta de
// arquivos estaticos, e a resposta e enviada com "Connection: close". Um pedido
// por vez: suficiente para servir paginas e APIs pequenas, e seguro para a VM,
// que nao e thread-safe.
#pragma once

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#undef near
#undef far
#undef IN
#undef OUT
#undef OPTIONAL
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iterator>
#include <string>
#include <string_view>
#include <vector>

namespace jatai::http {

namespace detail {

#ifdef _WIN32
using Socket = SOCKET;
const Socket bad_socket = INVALID_SOCKET;
inline void close_socket(Socket s) { closesocket(s); }
#else
using Socket = int;
const Socket bad_socket = -1;
inline void close_socket(Socket s) { ::close(s); }
#endif

inline void net_init() {
#ifdef _WIN32
    static bool done = false;
    if (!done) {
        WSADATA d;
        WSAStartup(MAKEWORD(2, 2), &d);
        done = true;
    }
#endif
}

struct Route {
    std::string pattern;
    bool prefix; // termina em *
    std::function<std::string(const std::string&)> handler;
};

struct StaticDir {
    std::string prefix, folder;
};

struct Request {
    std::string method, path, query, body, client;
    std::vector<std::pair<std::string, std::string>> headers; // nomes em minusculas
};

struct Response {
    int status = 200;
    std::string type = "text/html; charset=utf-8";
    std::vector<std::pair<std::string, std::string>> headers;
};

struct State {
    std::vector<Route> routes;
    std::vector<StaticDir> dirs;
    Request req;
    Response res;
    bool running = false;
};

inline State& st() {
    static State s;
    return s;
}

inline std::string lower(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

inline std::string url_decode(std::string_view s) {
    std::string r;
    for (size_t i = 0; i < s.size(); i++) {
        if (s[i] == '+') r += ' ';
        else if (s[i] == '%' && i + 2 < s.size() && std::isxdigit((unsigned char)s[i + 1]) &&
                 std::isxdigit((unsigned char)s[i + 2])) {
            r += (char)std::stoi(std::string(s.substr(i + 1, 2)), nullptr, 16);
            i += 2;
        } else r += s[i];
    }
    return r;
}

inline const char *reason(int code) {
    switch (code) {
    case 200: return "OK";
    case 201: return "Created";
    case 204: return "No Content";
    case 301: return "Moved Permanently";
    case 302: return "Found";
    case 304: return "Not Modified";
    case 400: return "Bad Request";
    case 401: return "Unauthorized";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 500: return "Internal Server Error";
    default:  return "";
    }
}

inline std::string mime(const std::string& ext) {
    static const std::pair<const char *, const char *> types[] = {
        {".html", "text/html; charset=utf-8"}, {".htm", "text/html; charset=utf-8"},
        {".css", "text/css; charset=utf-8"},   {".js", "text/javascript; charset=utf-8"},
        {".json", "application/json"},         {".txt", "text/plain; charset=utf-8"},
        {".svg", "image/svg+xml"},             {".png", "image/png"},
        {".jpg", "image/jpeg"},                {".jpeg", "image/jpeg"},
        {".gif", "image/gif"},                 {".ico", "image/x-icon"},
        {".webp", "image/webp"},               {".wasm", "application/wasm"},
        {".pdf", "application/pdf"},           {".xml", "application/xml"},
    };
    std::string e = lower(ext);
    for (auto& t : types)
        if (e == t.first) return t.second;
    return "application/octet-stream";
}

inline std::filesystem::path u8path(std::string_view s) {
    return std::filesystem::path(std::u8string(reinterpret_cast<const char8_t *>(s.data()), s.size()));
}

inline bool send_all(Socket s, const std::string& data) {
    size_t sent = 0;
    while (sent < data.size()) {
        int n = ::send(s, data.data() + sent, (int)std::min<size_t>(data.size() - sent, 1 << 20), 0);
        if (n <= 0) return false;
        sent += (size_t)n;
    }
    return true;
}

inline void respond(Socket s, int code, const std::string& type, const std::string& body,
                    const std::vector<std::pair<std::string, std::string>>& extra, bool head) {
    std::string h = "HTTP/1.1 " + std::to_string(code) + " " + reason(code) + "\r\n";
    h += "Content-Type: " + type + "\r\n";
    h += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    h += "Connection: close\r\n";
    for (auto& [k, v] : extra) h += k + ": " + v + "\r\n";
    h += "\r\n";
    send_all(s, h);
    if (!head) send_all(s, body);
}

inline std::string not_found_page(const std::string& path) {
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>404</title></head>"
           "<body style=\"font-family:sans-serif\"><h1>404</h1><p>Página não encontrada: " + path +
           "</p></body></html>";
}

// le cabecalhos e corpo; false se a conexao nao trouxe um pedido valido
inline bool read_request(Socket s, Request& req) {
    std::string data;
    char buf[8192];
    size_t end = std::string::npos;
    while ((end = data.find("\r\n\r\n")) == std::string::npos) {
        if (data.size() > (1 << 16)) return false; // cabecalho grande demais
        int n = ::recv(s, buf, sizeof buf, 0);
        if (n <= 0) return false;
        data.append(buf, (size_t)n);
    }
    std::string head = data.substr(0, end);
    req.body = data.substr(end + 4);

    size_t line_end = head.find("\r\n");
    std::string first = head.substr(0, line_end);
    size_t a = first.find(' '), b = first.find(' ', a + 1);
    if (a == std::string::npos || b == std::string::npos) return false;
    req.method = first.substr(0, a);
    std::string target = first.substr(a + 1, b - a - 1);
    size_t q = target.find('?');
    req.path = url_decode(target.substr(0, q));
    req.query = q == std::string::npos ? "" : target.substr(q + 1);

    req.headers.clear();
    size_t pos = line_end == std::string::npos ? head.size() : line_end + 2;
    while (pos < head.size()) {
        size_t e = head.find("\r\n", pos);
        if (e == std::string::npos) e = head.size();
        std::string line = head.substr(pos, e - pos);
        size_t c = line.find(':');
        if (c != std::string::npos) {
            std::string v = line.substr(c + 1);
            v.erase(0, v.find_first_not_of(" \t"));
            req.headers.push_back({lower(line.substr(0, c)), v});
        }
        pos = e + 2;
    }

    size_t length = 0;
    for (auto& [k, v] : req.headers)
        if (k == "content-length") length = (size_t)std::strtoull(v.c_str(), nullptr, 10);
    if (length > (64u << 20)) return false; // corpo maior que 64 MB
    while (req.body.size() < length) {
        int n = ::recv(s, buf, sizeof buf, 0);
        if (n <= 0) break;
        req.body.append(buf, (size_t)n);
    }
    if (req.body.size() > length) req.body.resize(length);
    return true;
}

// rota mais especifica: exata vence prefixo; entre prefixos, o mais longo
inline const Route *find_route(const std::string& path) {
    const Route *best = nullptr;
    size_t best_len = 0;
    for (auto& r : st().routes) {
        if (!r.prefix && r.pattern == path) return &r;
        if (r.prefix && path.compare(0, r.pattern.size(), r.pattern) == 0 && r.pattern.size() >= best_len) {
            best = &r;
            best_len = r.pattern.size();
        }
    }
    return best;
}

// arquivo estatico; false se nenhuma pasta atende o caminho
inline bool serve_static(Socket s, const std::string& path, bool head) {
    for (auto& d : st().dirs) {
        if (path.compare(0, d.prefix.size(), d.prefix) != 0) continue;
        std::string rest = path.substr(d.prefix.size());
        if (rest.find("..") != std::string::npos) {
            respond(s, 403, "text/plain; charset=utf-8", "proibido", {}, head);
            return true;
        }
        while (!rest.empty() && rest[0] == '/') rest.erase(0, 1);
        std::filesystem::path file = u8path(d.folder) / u8path(rest);
        std::error_code ec;
        if (std::filesystem::is_directory(file, ec)) file /= "index.html";
        std::ifstream in(file, std::ios::binary);
        if (!in) continue;
        std::string data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        respond(s, 200, mime(file.extension().string()), data, {}, head);
        return true;
    }
    return false;
}

inline void handle(Socket s, const std::string& client) {
    State& g = st();
    g.req = Request{};
    g.res = Response{};
    if (!read_request(s, g.req)) {
        respond(s, 400, "text/plain; charset=utf-8", "pedido invalido", {}, false);
        return;
    }
    g.req.client = client;
    bool head = g.req.method == "HEAD";
    if (const Route *r = find_route(g.req.path)) {
        std::string body = r->handler(g.req.path);
        respond(s, g.res.status, g.res.type, body, g.res.headers, head);
    } else if (!serve_static(s, g.req.path, head)) {
        respond(s, 404, "text/html; charset=utf-8", not_found_page(g.req.path), {}, head);
    }
    std::fflush(stdout); // o que o handler imprimiu aparece na hora
}

inline void serve_on(const char *host, int porta) {
    net_init();
    Socket srv = ::socket(AF_INET, SOCK_STREAM, 0);
    if (srv == bad_socket) {
        std::fprintf(stderr, "http: nao foi possivel criar o socket\n");
        return;
    }
    int yes = 1;
    ::setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, (const char *)&yes, sizeof yes);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons((unsigned short)porta);
    ::inet_pton(AF_INET, host, &addr.sin_addr);
    if (::bind(srv, (sockaddr *)&addr, sizeof addr) != 0 || ::listen(srv, 64) != 0) {
        std::fflush(stdout);
        std::fprintf(stderr, "http: porta %d indisponivel (ja esta em uso?)\n", porta);
        close_socket(srv);
        return;
    }
    State& g = st();
    g.running = true;
    std::fflush(stdout);
    while (g.running) {
        sockaddr_in peer{};
#ifdef _WIN32
        int len = sizeof peer;
#else
        socklen_t len = sizeof peer;
#endif
        Socket c = ::accept(srv, (sockaddr *)&peer, &len);
        if (c == bad_socket) continue;
        char ip[INET_ADDRSTRLEN] = "";
        ::inet_ntop(AF_INET, &peer.sin_addr, ip, sizeof ip);
        handle(c, ip);
        close_socket(c);
    }
    close_socket(srv);
}

}  // namespace detail

// IP da rede local: "conecta" um socket UDP a um endereco externo (nenhum pacote e
// enviado) e pergunta ao sistema qual endereco local ele usaria
inline std::string my_ip() {
    detail::net_init();
    detail::Socket s = ::socket(AF_INET, SOCK_DGRAM, 0);
    if (s == detail::bad_socket) return "127.0.0.1";
    sockaddr_in remote{};
    remote.sin_family = AF_INET;
    remote.sin_port = htons(80);
    ::inet_pton(AF_INET, "8.8.8.8", &remote.sin_addr);
    std::string result = "127.0.0.1";
    if (::connect(s, (sockaddr *)&remote, sizeof remote) == 0) {
        sockaddr_in local{};
#ifdef _WIN32
        int len = sizeof local;
#else
        socklen_t len = sizeof local;
#endif
        char ip[INET_ADDRSTRLEN] = "";
        if (::getsockname(s, (sockaddr *)&local, &len) == 0 && ::inet_ntop(AF_INET, &local.sin_addr, ip, sizeof ip))
            result = ip;
    }
    detail::close_socket(s);
    return result;
}

inline void route(std::string_view caminho, std::function<std::string(const std::string&)> handler) {
    std::string p(caminho);
    bool prefix = !p.empty() && p.back() == '*';
    if (prefix) p.pop_back();
    detail::st().routes.push_back({p, prefix, std::move(handler)});
}

inline void static_dir(std::string_view prefixo, std::string_view pasta) {
    detail::st().dirs.push_back({std::string(prefixo), std::string(pasta)});
}

inline void serve(int porta) {
    std::printf("servindo em http://%s:%d (Ctrl+C para parar)\n", my_ip().c_str(), porta);
    detail::serve_on("0.0.0.0", porta);
}

inline void serve_local(int porta) {
    std::printf("servindo em http://127.0.0.1:%d (Ctrl+C para parar)\n", porta);
    detail::serve_on("127.0.0.1", porta);
}

// termina serve() depois de responder o pedido atual
inline void stop() { detail::st().running = false; }

inline std::string method() { return detail::st().req.method; }
inline std::string path() { return detail::st().req.path; }
inline std::string body() { return detail::st().req.body; }
inline std::string client_ip() { return detail::st().req.client; }

inline std::string query(std::string_view nome) {
    std::string_view q = detail::st().req.query;
    while (!q.empty()) {
        size_t amp = q.find('&');
        std::string_view part = q.substr(0, amp);
        size_t eq = part.find('=');
        if (detail::url_decode(part.substr(0, eq)) == nome)
            return eq == std::string_view::npos ? "" : detail::url_decode(part.substr(eq + 1));
        if (amp == std::string_view::npos) break;
        q.remove_prefix(amp + 1);
    }
    return "";
}

inline std::string header(std::string_view nome) {
    std::string n = detail::lower(std::string(nome));
    for (auto& [k, v] : detail::st().req.headers)
        if (k == n) return v;
    return "";
}

inline void status(int codigo) { detail::st().res.status = codigo; }
inline void content_type(std::string_view tipo) { detail::st().res.type = std::string(tipo); }
inline void set_header(std::string_view nome, std::string_view valor) {
    detail::st().res.headers.push_back({std::string(nome), std::string(valor)});
}

}  // namespace jatai::http
