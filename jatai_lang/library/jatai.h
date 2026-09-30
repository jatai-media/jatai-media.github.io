/*
 * jatai.h - contrato entre o Jatai e bibliotecas nativas (DLL / .so)
 *
 * Uma biblioteca e uma DLL (Windows) ou .so (Linux) com funcoes exportadas no
 * padrao C. Pode ser escrita em C, C++, Rust, Zig... qualquer linguagem que
 * exporte funcoes C. Nao depende da versao do compilador.
 *
 * Para cada funcao "extern" declarada em <nome>.jat, a biblioteca exporta
 * jatai_<nome>_<funcao>, com os tipos:
 *
 *   Jatai            C
 *   int              int32_t
 *   double           double
 *   bool             int32_t (0 ou 1)
 *   char             int32_t (valor do byte)
 *   string (param)   const char *p, size_t n      (dois parametros; texto UTF-8, nao
 *                                                  termina em '\0' necessariamente)
 *   string (retorno) char *                       (criada com jatai_str/jatai_str_new;
 *                                                  o Jatai assume a posse)
 *   void (retorno)   void
 *   funcao (param)   R (*fn)(void *ctx, ...), void *ctx
 *                    (dois parametros: chame fn(ctx, argumentos...))
 *                    um callback que devolve string devolve char *: leia o tamanho com
 *                    jatai_str_len e libere com jatai_str_free
 *
 * Exemplo: extern int contar(string s, char c)  em  text.jat  ->
 *   JATAI_API int32_t jatai_text_contar(const char *s, size_t s_len, int32_t c);
 *
 * Toda biblioteca declara uma vez, em um dos seus arquivos:
 *   JATAI_LIBRARY(nome)
 * que exporta jatai_<nome>_init, chamada pelo Jatai antes de qualquer outra funcao.
 */
#ifndef JATAI_H
#define JATAI_H

#include <stddef.h>
#include <stdint.h>
#include <string.h>

#define JATAI_ABI_VERSION 1

typedef struct jatai_host {
    uint32_t version;
    /* nova string de n bytes (+ '\0' no fim) para devolver ao Jatai */
    char *(*str_new)(size_t n);
    /* libera uma string recebida como retorno de um callback */
    void (*str_free)(char *s);
    /* tamanho (em bytes) de uma string criada pelo Jatai (retorno de callback) */
    size_t (*str_len)(const char *s);
} jatai_host;

#ifdef _WIN32
#define JATAI_EXPORT __declspec(dllexport)
#else
#define JATAI_EXPORT __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
#define JATAI_API extern "C" JATAI_EXPORT
#else
#define JATAI_API JATAI_EXPORT
#endif

/* servicos do Jatai, disponiveis depois de jatai_<nome>_init */
#ifdef __cplusplus
extern "C" {
#endif
extern const jatai_host *jatai_host_ptr;
#ifdef __cplusplus
}
#endif

#define JATAI_LIBRARY(nome)                                                    \
    const jatai_host *jatai_host_ptr;                                          \
    JATAI_API void jatai_##nome##_init(const jatai_host *h) { jatai_host_ptr = h; }

/* string de retorno com n bytes (a preencher) */
static inline char *jatai_str_new(size_t n) { return jatai_host_ptr->str_new(n); }

/* string de retorno copiada de p (n bytes) */
static inline char *jatai_str(const char *p, size_t n) {
    char *s = jatai_host_ptr->str_new(n);
    if (n) memcpy(s, p, n);
    return s;
}

/* string de retorno copiada de um texto terminado em '\0' */
static inline char *jatai_cstr(const char *s) { return jatai_str(s, strlen(s)); }

/* tamanho e liberacao da string devolvida por um callback */
static inline size_t jatai_str_len(const char *s) { return jatai_host_ptr->str_len(s); }
static inline void jatai_str_free(char *s) { jatai_host_ptr->str_free(s); }

#endif
