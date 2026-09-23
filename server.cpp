// Servidor HTTP estático mínimo para testes locais, com live reload.
// Serve a pasta gerada pelo build (dist/) sem cache e recarrega as páginas
// abertas sempre que o conteúdo dela muda (`npm run live` sobe tudo junto).
//
// Compilar:  g++ -std=c++20 -O2 -static server.cpp -o server.exe -lws2_32
// Executar:  ./server.exe [porta=8080] [pasta=dist]

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
#include <chrono>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>

namespace fs = std::filesystem;

static std::string mime_type(const fs::path& file) {
    static const std::unordered_map<std::string, std::string> types = {
        {".html", "text/html; charset=utf-8"},
        {".css", "text/css; charset=utf-8"},
        {".js", "text/javascript; charset=utf-8"},
        {".json", "application/json"},
        {".png", "image/png"},
        {".jpg", "image/jpeg"},
        {".jpeg", "image/jpeg"},
        {".svg", "image/svg+xml"},
        {".webp", "image/webp"},
        {".ico", "image/x-icon"},
        {".woff2", "font/woff2"},
        {".txt", "text/plain; charset=utf-8"},
    };
    auto it = types.find(file.extension().string());
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

static void send_all(socket_t client, const std::string& data) {
    size_t sent = 0;
    while (sent < data.size()) {
        int n = send(client, data.data() + sent, static_cast<int>(data.size() - sent), 0);
        if (n <= 0) return;
        sent += n;
    }
}

static void respond(socket_t client, int status, const std::string& reason,
                    const std::string& type, const std::string& body,
                    const std::string& extra_headers = "") {
    std::ostringstream head;
    head << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
         << "Content-Type: " << type << "\r\n"
         << "Content-Length: " << body.size() << "\r\n"
         << "Cache-Control: no-store\r\n"
         << "Connection: close\r\n"
         << extra_headers << "\r\n";
    send_all(client, head.str() + body);
}

// ---- Live reload ------------------------------------------------------------
// Toda página HTML recebe um script que consulta /__live a cada 500 ms.
// A resposta é a data da última alteração dentro da pasta servida; quando
// ela muda, a página recarrega.

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

// Enquanto houver arquivos alterados há menos disso, o build ainda está
// escrevendo; responde "busy" para não recarregar uma página pela metade.
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

// ------------------------------------------------------------------------------

static void handle(socket_t client, const fs::path& root) {
    char buffer[8192];
    int n = recv(client, buffer, sizeof(buffer) - 1, 0);
    if (n <= 0) return;

    std::istringstream request(std::string(buffer, n));
    std::string method, target;
    request >> method >> target;

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
        // /canvas → /canvas/ para os caminhos relativos funcionarem.
        if (!path.ends_with('/')) {
            respond(client, 301, "Moved Permanently", "text/plain", "",
                    "Location: " + path + "/\r\n");
            return;
        }
        file /= "index.html";
    }

    std::ifstream in(file, std::ios::binary);
    if (!in) {
        respond(client, 404, "Not Found", "text/plain", "404 Not Found: " + path);
        std::cout << "404 " << path << '\n';
        return;
    }

    std::string body((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
    if (file.extension() == ".html") inject_live_script(body);
    if (method == "HEAD") {
        // Sem corpo.
        respond(client, 200, "OK", mime_type(file), "");
    } else {
        respond(client, 200, "OK", mime_type(file), body);
    }
    std::cout << "200 " << path << '\n';
}

int main(int argc, char* argv[]) {
    std::cout << std::unitbuf;  // log aparece na hora
    int port = argc > 1 ? std::stoi(argv[1]) : 8080;
    fs::path root = fs::weakly_canonical(argc > 2 ? argv[2] : "dist");

    if (!fs::is_directory(root)) {
        std::cerr << "Pasta nao encontrada: " << root.string()
                  << "\nRode 'npm run build' (ou 'npm run watch') antes.\n";
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
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);  // só acessível desta máquina

    if (bind(server, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0 || listen(server, 16) != 0) {
        std::cerr << "Nao foi possivel abrir a porta " << port << '\n';
        return 1;
    }

    std::cout << "Servindo " << root.string() << " em http://localhost:" << port << "/\n"
              << "Ctrl+C para parar.\n";

    while (true) {
        socket_t client = accept(server, nullptr, nullptr);
        if (client == INVALID_SOCKET) continue;
        handle(client, root);
        close_socket(client);
    }
}
