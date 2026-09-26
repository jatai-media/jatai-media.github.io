// Servidor de teste do editor de video (jatai_video), com live reload.
//
// E o mesmo molde do server.cpp da raiz do hub, com o que o editor de video
// pede a mais:
//
//   - os cabecalhos de isolamento (COOP/COEP). Sem eles o navegador nao da
//     SharedArrayBuffer a pagina, e o ONNX Runtime Web - de que o recorte de
//     fundo, o narrador e a deteccao de fala vao depender - roda numa thread
//     so;
//   - os tipos de .wasm, .onnx, .mjs e de midia, que o servidor do hub nao
//     precisava conhecer;
//   - pedidos por faixa (Range): um modelo de sessenta MB ou um video de teste
//     sao lidos aos pedacos, e nao inteiros de uma vez.
//
// Compilar:  npm run video:server:build
//            (g++ -std=c++20 -O2 -static jatai_video/server.cpp -o jatai_video/server.exe -lws2_32)
// Executar:  jatai_video/server.exe [porta=8090] [pasta=jatai_video/dist]
//            ou `npm run video:live`, que compila a pagina, observa e serve.

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
using socket_t = SOCKET;
#define close_socket closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
using socket_t = int;
constexpr socket_t INVALID_SOCKET = -1;
#define close_socket close
#endif

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <unordered_map>

namespace fs = std::filesystem;

static std::string mime_type(const fs::path& file) {
    static const std::unordered_map<std::string, std::string> types = {
        {".html", "text/html; charset=utf-8"},
        {".css", "text/css; charset=utf-8"},
        {".js", "text/javascript; charset=utf-8"},
        {".mjs", "text/javascript; charset=utf-8"},
        {".json", "application/json"},
        {".map", "application/json"},
        {".wasm", "application/wasm"},
        {".onnx", "application/octet-stream"},
        {".png", "image/png"},
        {".jpg", "image/jpeg"},
        {".jpeg", "image/jpeg"},
        {".svg", "image/svg+xml"},
        {".webp", "image/webp"},
        {".ico", "image/x-icon"},
        {".woff2", "font/woff2"},
        {".txt", "text/plain; charset=utf-8"},
        {".mp4", "video/mp4"},
        {".webm", "video/webm"},
        {".mp3", "audio/mpeg"},
        {".wav", "audio/wav"},
    };
    auto ext = file.extension().string();
    std::transform(ext.begin(), ext.end(), ext.begin(), [](unsigned char c) { return (char)std::tolower(c); });
    auto it = types.find(ext);
    return it != types.end() ? it->second : "application/octet-stream";
}

static std::string url_decode(const std::string& in) {
    std::string out;
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] == '%' && i + 2 < in.size() && std::isxdigit(static_cast<unsigned char>(in[i + 1])) &&
            std::isxdigit(static_cast<unsigned char>(in[i + 2]))) {
            out += static_cast<char>(std::stoi(in.substr(i + 1, 2), nullptr, 16));
            i += 2;
        } else {
            out += in[i];
        }
    }
    return out;
}

static bool send_all(socket_t client, const char* data, size_t size) {
    size_t sent = 0;
    while (sent < size) {
        int n = send(client, data + sent, static_cast<int>(std::min<size_t>(size - sent, 1 << 20)), 0);
        if (n <= 0) return false;
        sent += n;
    }
    return true;
}

// Toda resposta leva os cabecalhos de isolamento. O CORP vale para quem
// estiver do outro lado de um COEP - a pagina e daqui mesmo, entao "same-origin".
static const char* ISOLAMENTO =
    "Cross-Origin-Opener-Policy: same-origin\r\n"
    "Cross-Origin-Embedder-Policy: require-corp\r\n"
    "Cross-Origin-Resource-Policy: same-origin\r\n";

static std::string head(int status, const std::string& reason, const std::string& type,
                        uint64_t length, const std::string& extra = "") {
    std::ostringstream h;
    h << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
      << "Content-Type: " << type << "\r\n"
      << "Content-Length: " << length << "\r\n"
      << "Cache-Control: no-store\r\n"
      << "Accept-Ranges: bytes\r\n"
      << ISOLAMENTO
      << "Connection: close\r\n"
      << extra << "\r\n";
    return h.str();
}

static void respond(socket_t client, int status, const std::string& reason,
                    const std::string& type, const std::string& body,
                    const std::string& extra = "") {
    std::string out = head(status, reason, type, body.size(), extra) + body;
    send_all(client, out.data(), out.size());
}

// ---- Live reload ------------------------------------------------------------
// Toda pagina HTML recebe um script que consulta /__live a cada 500 ms. A
// resposta e a data da ultima alteracao dentro da pasta servida; quando ela
// muda, a pagina recarrega.

static const std::string LIVE_SCRIPT = R"(<script>
(() => {
  let known = null;
  setInterval(async () => {
    try {
      const res = await fetch('/__live', { cache: 'no-store' });
      const version = await res.text();
      if (version === 'busy') return;
      if (known !== null && version !== known) location.reload();
      known = version;
    } catch {}
  }, 500);
})();
</script>)";

// Enquanto houver arquivos alterados ha menos disso, o build ainda esta
// escrevendo; responde "busy" para nao recarregar uma pagina pela metade.
constexpr auto SETTLE_TIME = std::chrono::milliseconds(300);

static std::string live_version(const fs::path& root) {
    std::error_code ec;
    auto latest = fs::last_write_time(root, ec);
    if (ec) return "busy";  // pasta sendo recriada pelo build
    for (const auto& entry : fs::recursive_directory_iterator(root, ec)) {
        auto time = entry.last_write_time(ec);
        if (!ec && time > latest) latest = time;
    }
    if (fs::file_time_type::clock::now() - latest < SETTLE_TIME) return "busy";
    return std::to_string(latest.time_since_epoch().count());
}

static void inject_live_script(std::string& html) {
    auto pos = html.rfind("</body>");
    html.insert(pos == std::string::npos ? html.size() : pos, LIVE_SCRIPT);
}

// ---- Faixas -----------------------------------------------------------------

// "bytes=a-b", "bytes=a-" ou "bytes=-n". So a primeira faixa: navegador nenhum
// pede varias para midia ou modelo.
static bool parse_range(const std::string& value, uint64_t size, uint64_t& a, uint64_t& b) {
    if (value.rfind("bytes=", 0) != 0 || size == 0) return false;
    std::string spec = value.substr(6);
    spec = spec.substr(0, spec.find(','));
    auto dash = spec.find('-');
    if (dash == std::string::npos) return false;
    std::string sa = spec.substr(0, dash), sb = spec.substr(dash + 1);
    try {
        if (sa.empty()) {  // os ultimos n bytes
            uint64_t n = std::stoull(sb);
            if (n == 0) return false;
            a = n >= size ? 0 : size - n;
            b = size - 1;
        } else {
            a = std::stoull(sa);
            b = sb.empty() ? size - 1 : std::min<uint64_t>(std::stoull(sb), size - 1);
        }
    } catch (...) {
        return false;
    }
    return a <= b && a < size;
}

static std::string header_value(const std::string& request, const std::string& name) {
    std::istringstream in(request);
    std::string line;
    std::getline(in, line);  // a linha do pedido
    while (std::getline(in, line) && line != "\r") {
        auto colon = line.find(':');
        if (colon == std::string::npos) continue;
        std::string key = line.substr(0, colon);
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return (char)std::tolower(c); });
        if (key != name) continue;
        std::string v = line.substr(colon + 1);
        v.erase(0, v.find_first_not_of(" \t"));
        while (!v.empty() && (v.back() == '\r' || v.back() == ' ')) v.pop_back();
        return v;
    }
    return "";
}

// Manda [a, b] do arquivo aos pedacos, sem carrega-lo inteiro na memoria.
static void send_file_part(socket_t client, const fs::path& file, uint64_t a, uint64_t b) {
    std::ifstream in(file, std::ios::binary);
    in.seekg(static_cast<std::streamoff>(a));
    std::string buf(1 << 16, '\0');
    uint64_t left = b - a + 1;
    while (left > 0 && in) {
        auto chunk = static_cast<std::streamsize>(std::min<uint64_t>(left, buf.size()));
        in.read(buf.data(), chunk);
        auto got = in.gcount();
        if (got <= 0 || !send_all(client, buf.data(), static_cast<size_t>(got))) return;
        left -= static_cast<uint64_t>(got);
    }
}

// ------------------------------------------------------------------------------

static void handle(socket_t client, const fs::path& root) {
    char buffer[16384];
    int n = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (n <= 0) return;

    std::string request(buffer, n);
    std::istringstream line(request);
    std::string method, target;
    line >> method >> target;

    if (method != "GET" && method != "HEAD") {
        respond(client, 405, "Method Not Allowed", "text/plain", "405 Method Not Allowed");
        return;
    }

    std::string path = url_decode(target.substr(0, target.find_first_of("?#")));

    if (path == "/__live") {
        respond(client, 200, "OK", "text/plain", live_version(root));
        return;
    }

    // Resolve dentro da raiz e bloqueia "../" para fora dela.
    fs::path file = fs::weakly_canonical(root / fs::path(path).relative_path());
    auto [end, _] = std::mismatch(root.begin(), root.end(), file.begin(), file.end());
    if (end != root.end()) {
        respond(client, 403, "Forbidden", "text/plain", "403 Forbidden");
        return;
    }

    if (fs::is_directory(file)) {
        if (!path.ends_with('/')) {
            respond(client, 301, "Moved Permanently", "text/plain", "", "Location: " + path + "/\r\n");
            return;
        }
        file /= "index.html";
    }

    std::error_code ec;
    if (!fs::is_regular_file(file, ec)) {
        respond(client, 404, "Not Found", "text/plain", "404 Not Found: " + path);
        std::cout << "404 " << path << '\n';
        return;
    }

    const std::string type = mime_type(file);

    // HTML e pequeno e ganha o script do live reload: vai inteiro.
    if (file.extension() == ".html") {
        std::ifstream in(file, std::ios::binary);
        std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
        inject_live_script(body);
        if (method == "HEAD") respond(client, 200, "OK", type, "");
        else respond(client, 200, "OK", type, body);
        std::cout << "200 " << path << '\n';
        return;
    }

    const uint64_t size = fs::file_size(file, ec);
    uint64_t a = 0, b = size ? size - 1 : 0;
    const std::string range = header_value(request, "range");

    if (!range.empty()) {
        if (!parse_range(range, size, a, b)) {
            respond(client, 416, "Range Not Satisfiable", "text/plain", "",
                    "Content-Range: bytes */" + std::to_string(size) + "\r\n");
            return;
        }
        std::string h = head(206, "Partial Content", type, b - a + 1,
                             "Content-Range: bytes " + std::to_string(a) + "-" + std::to_string(b) +
                             "/" + std::to_string(size) + "\r\n");
        if (!send_all(client, h.data(), h.size())) return;
        if (method == "GET") send_file_part(client, file, a, b);
        std::cout << "206 " << path << " [" << a << "-" << b << "]\n";
        return;
    }

    std::string h = head(200, "OK", type, size);
    if (!send_all(client, h.data(), h.size())) return;
    if (method == "GET" && size) send_file_part(client, file, 0, size - 1);
    std::cout << "200 " << path << '\n';
}

int main(int argc, char* argv[]) {
    std::cout << std::unitbuf;  // log aparece na hora
    int port = argc > 1 ? std::stoi(argv[1]) : 8090;
    fs::path root = fs::weakly_canonical(argc > 2 ? argv[2] : "jatai_video/dist");

    if (!fs::is_directory(root)) {
        std::cerr << "Pasta nao encontrada: " << root.string()
                  << "\nRode 'npm run video:build' (ou 'npm run video:live') antes.\n";
        return 1;
    }

#ifdef _WIN32
    WSADATA wsa;
    WSAStartup(MAKEWORD(2, 2), &wsa);
#endif

    socket_t server = socket(AF_INET, SOCK_STREAM, 0);
    int yes = 1;
    setsockopt(server, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<const char*>(&yes), sizeof(yes));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<unsigned short>(port));
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // so acessivel desta maquina

    if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 || listen(server, 32) != 0) {
        std::cerr << "Nao foi possivel abrir a porta " << port << '\n';
        return 1;
    }

    std::cout << "Editor de video: servindo " << root.string() << " em http://localhost:" << port << "/\n"
              << "Ctrl+C para parar.\n";

    // Um pedido por thread: um modelo de sessenta MB descendo nao pode segurar
    // a pagina, que pede os seus arquivos ao mesmo tempo.
    while (true) {
        socket_t client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        std::thread([client, root] {
            handle(client, root);
            close_socket(client);
        }).detach();
    }
}
