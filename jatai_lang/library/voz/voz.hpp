#pragma once
// voz: text-to-speech pela SAPI 5 do Windows (COM).
#include <windows.h>
#include <sapi.h>
#include <cstdio>
#include <functional>
#include <string>
#include <string_view>
#include <vector>

namespace jatai::voz {

namespace detail {

// o mingw-w64 declara, mas nao exporta, a GUID do formato WAV (ver sphelper.h da Microsoft)
inline const GUID wav_format = {0xC31ADBAE, 0x527F, 0x4ff5, {0xA2, 0x30, 0xF6, 0x2B, 0xB6, 0x1F, 0xF7, 0x0C}};

inline std::wstring wide(std::string_view s) {
    if (s.empty()) return {};
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
    std::wstring w((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), w.data(), n);
    return w;
}

inline std::string utf8(const wchar_t *w, int len) {
    if (!w || len <= 0) return {};
    int n = WideCharToMultiByte(CP_UTF8, 0, w, len, nullptr, 0, nullptr, nullptr);
    std::string s((size_t)n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w, len, s.data(), n, nullptr, nullptr);
    return s;
}

// ponteiro COM com Release automatico
template <class T> struct Com {
    T *p = nullptr;
    Com() = default;
    Com(const Com &) = delete;
    Com &operator=(const Com &) = delete;
    ~Com() { if (p) p->Release(); }
    T *operator->() const { return p; }
    explicit operator bool() const { return p != nullptr; }
    void **out() { return reinterpret_cast<void **>(&p); }
};

inline std::wstring token_name(ISpObjectToken *t) {
    LPWSTR s = nullptr;
    std::wstring r;
    if (t && SUCCEEDED(t->GetStringValue(nullptr, &s)) && s) { r = s; CoTaskMemFree(s); }
    return r;
}

// libera o que a SAPI aloca dentro de um evento (equivale a SpClearEvent do sphelper.h)
inline void clear_event(SPEVENT &e) {
    if (e.elParamType == SPET_LPARAM_IS_TOKEN || e.elParamType == SPET_LPARAM_IS_OBJECT)
        reinterpret_cast<IUnknown *>(e.lParam)->Release();
    else if (e.elParamType == SPET_LPARAM_IS_POINTER || e.elParamType == SPET_LPARAM_IS_STRING)
        CoTaskMemFree(reinterpret_cast<void *>(e.lParam));
    e.elParamType = SPET_LPARAM_IS_UNDEFINED;
}

struct State {
    bool tried = false;
    ISpVoice *voice = nullptr;
    std::vector<ISpObjectToken *> tokens; // vozes instaladas
    bool listed = false;
    unsigned stops = 0; // conta chamadas a stop(), para say_words saber que foi interrompido
    // Os objetos COM nao sao liberados no fim do programa de proposito: liberar COM
    // durante o descarregamento da DLL (loader lock) pode travar o processo.
};

inline State &st() {
    static State s;
    return s;
}

inline ISpVoice *voice() {
    State &s = st();
    if (!s.tried) {
        s.tried = true;
        // S_FALSE (ja iniciado) e RPC_E_CHANGED_MODE (thread ja em MTA) tambem servem
        CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        if (FAILED(CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL, IID_ISpVoice,
                                    reinterpret_cast<void **>(&s.voice)))) {
            s.voice = nullptr;
            std::fprintf(stderr, "voz: o servico de fala do Windows (SAPI) nao esta disponivel\n");
        }
    }
    return s.voice;
}

inline void add_category(const wchar_t *id) {
    State &s = st();
    Com<ISpObjectTokenCategory> cat;
    Com<IEnumSpObjectTokens> en;
    if (FAILED(CoCreateInstance(CLSID_SpObjectTokenCategory, nullptr, CLSCTX_ALL,
                                IID_ISpObjectTokenCategory, cat.out())))
        return;
    if (FAILED(cat->SetId(id, FALSE)) || FAILED(cat->EnumTokens(nullptr, nullptr, &en.p)))
        return;
    ULONG n = 0;
    en->GetCount(&n);
    for (ULONG i = 0; i < n; i++) {
        ISpObjectToken *t = nullptr;
        if (FAILED(en->Item(i, &t)) || !t) continue;
        std::wstring name = token_name(t);
        bool dup = name.empty();
        for (ISpObjectToken *o : s.tokens)
            if (!dup && token_name(o) == name) dup = true;
        if (dup) t->Release();
        else s.tokens.push_back(t);
    }
}

inline std::vector<ISpObjectToken *> &tokens() {
    State &s = st();
    if (!s.listed && voice()) {
        s.listed = true;
        add_category(L"HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech\\Voices");
        add_category(L"HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Speech_OneCore\\Voices");
    }
    return s.tokens;
}

inline bool contains_ci(const std::wstring &text, const std::wstring &part) {
    if (part.empty()) return true;
    for (size_t i = 0; i + part.size() <= text.size(); i++) {
        size_t k = 0;
        while (k < part.size() && towlower(text[i + k]) == towlower(part[k])) k++;
        if (k == part.size()) return true;
    }
    return false;
}

} // namespace detail

inline void say(std::string_view texto) {
    if (ISpVoice *v = detail::voice()) v->Speak(detail::wide(texto).c_str(), SPF_IS_NOT_XML, nullptr);
}

inline void say_async(std::string_view texto) {
    if (ISpVoice *v = detail::voice())
        v->Speak(detail::wide(texto).c_str(), SPF_ASYNC | SPF_IS_NOT_XML, nullptr);
}

inline void say_words(std::string_view texto, std::function<void(const std::string &)> palavra) {
    ISpVoice *v = detail::voice();
    if (!v) return;
    std::wstring w = detail::wide(texto);
    ULONGLONG interest = SPFEI(SPEI_WORD_BOUNDARY) | SPFEI(SPEI_END_INPUT_STREAM);
    v->SetInterest(interest, interest);
    v->SetNotifyWin32Event();

    ULONG stream = 0;
    if (FAILED(v->Speak(w.c_str(), SPF_ASYNC | SPF_IS_NOT_XML, &stream))) { v->SetInterest(0, 0); return; }

    // Os eventos chegam por uma fila; o callback roda nesta thread (a do programa Jatai).
    unsigned stops = detail::st().stops;
    bool done = false;
    while (!done) {
        v->WaitForNotifyEvent(100);
        SPEVENT e;
        ULONG got = 0;
        while (!done && v->GetEvents(1, &e, &got) == S_OK && got == 1) {
            if (e.ulStreamNum == stream) {
                if (e.eEventId == SPEI_WORD_BOUNDARY) {
                    size_t pos = (size_t)e.lParam, len = (size_t)e.wParam;
                    if (pos < w.size()) {
                        if (pos + len > w.size()) len = w.size() - pos;
                        palavra(detail::utf8(w.data() + pos, (int)len));
                        if (detail::st().stops != stops) done = true; // stop() no callback
                    }
                } else if (e.eEventId == SPEI_END_INPUT_STREAM) {
                    done = true;
                }
            }
            detail::clear_event(e);
        }
        // a fala descartada por stop() pode nao gerar o fim do stream
        if (!done && v->WaitUntilDone(0) == S_OK) done = true;
    }
    v->SetInterest(0, 0);
    SPEVENT e;
    ULONG got = 0;
    while (v->GetEvents(1, &e, &got) == S_OK && got == 1) detail::clear_event(e);
}

inline bool speaking() {
    ISpVoice *v = detail::voice();
    return v && v->WaitUntilDone(0) != S_OK;
}

inline void wait() {
    if (ISpVoice *v = detail::voice()) v->WaitUntilDone(INFINITE);
}

inline void stop() {
    detail::st().stops++;
    if (ISpVoice *v = detail::voice()) v->Speak(nullptr, SPF_PURGEBEFORESPEAK, nullptr);
}

inline bool save_wav(std::string_view texto, std::string_view caminho) {
    ISpVoice *v = detail::voice();
    if (!v) return false;
    // voz separada, com as mesmas configuracoes, para nao atrapalhar uma fala em andamento
    detail::Com<ISpVoice> rec;
    detail::Com<ISpStream> file;
    detail::Com<ISpObjectToken> tok;
    if (FAILED(CoCreateInstance(CLSID_SpVoice, nullptr, CLSCTX_ALL, IID_ISpVoice, rec.out()))) return false;
    if (SUCCEEDED(v->GetVoice(&tok.p)) && tok) rec->SetVoice(tok.p);
    long r = 0;
    USHORT vol = 100;
    v->GetRate(&r);
    v->GetVolume(&vol);
    rec->SetRate(r);
    rec->SetVolume(vol);

    if (FAILED(CoCreateInstance(CLSID_SpStream, nullptr, CLSCTX_ALL, IID_ISpStream, file.out()))) return false;
    WAVEFORMATEX fmt{};
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = 1;
    fmt.nSamplesPerSec = 22050;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = 2;
    fmt.nAvgBytesPerSec = 44100;
    std::wstring path = detail::wide(caminho);
    if (FAILED(file->BindToFile(path.c_str(), SPFM_CREATE_ALWAYS, &detail::wav_format, &fmt, 0))) return false;
    bool ok = SUCCEEDED(rec->SetOutput(file.p, TRUE)) &&
              SUCCEEDED(rec->Speak(detail::wide(texto).c_str(), SPF_IS_NOT_XML, nullptr));
    file->Close();
    return ok;
}

inline int voices() { return (int)detail::tokens().size(); }

inline std::string voice_name(int indice) {
    auto &t = detail::tokens();
    if (indice < 0 || indice >= (int)t.size()) return {};
    std::wstring n = detail::token_name(t[(size_t)indice]);
    return detail::utf8(n.data(), (int)n.size());
}

inline bool set_voice(std::string_view parte_do_nome) {
    ISpVoice *v = detail::voice();
    if (!v) return false;
    std::wstring part = detail::wide(parte_do_nome);
    for (ISpObjectToken *t : detail::tokens())
        if (detail::contains_ci(detail::token_name(t), part)) return SUCCEEDED(v->SetVoice(t));
    return false;
}

inline std::string voice() {
    ISpVoice *v = detail::voice();
    detail::Com<ISpObjectToken> tok;
    if (!v || FAILED(v->GetVoice(&tok.p))) return {};
    std::wstring n = detail::token_name(tok.p);
    return detail::utf8(n.data(), (int)n.size());
}

inline void rate(int velocidade) {
    if (ISpVoice *v = detail::voice()) v->SetRate(velocidade < -10 ? -10 : velocidade > 10 ? 10 : velocidade);
}

inline void volume(int nivel) {
    if (ISpVoice *v = detail::voice()) v->SetVolume((USHORT)(nivel < 0 ? 0 : nivel > 100 ? 100 : nivel));
}

} // namespace jatai::voz
