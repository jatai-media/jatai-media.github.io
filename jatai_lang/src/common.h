#ifndef JT_COMMON_H
#define JT_COMMON_H

#include <setjmp.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Vetor dinamico generico: struct { T *items; size_t len, cap; } */
#define JT_VEC(T) struct { T *items; size_t len, cap; }

#define jt_vec_push(v, x)                                                        \
    do {                                                                         \
        if ((v)->len == (v)->cap) {                                              \
            (v)->cap = (v)->cap ? (v)->cap * 2 : 16;                             \
            (v)->items = jt_xrealloc((v)->items, (v)->cap * sizeof(*(v)->items)); \
        }                                                                        \
        (v)->items[(v)->len++] = (x);                                            \
    } while (0)

static void jt_fatal(const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    fputs("jatai: ", stderr);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    va_end(ap);
    exit(1);
}

/* Quando definido, jt_error_at volta para ele (sem imprimir) em vez de encerrar:
   usado para tentar ler "{...}" de uma string como expressao. */
static jmp_buf *jt_error_trap;

/* Contexto impresso depois de um erro: funcao sem tipo sendo verificada para
   certos tipos de argumento, e onde ela foi chamada (pilha, a mais interna primeiro). */
typedef struct JtErrorNote {
    const char *file;
    int line, col;
    char text[256];
    struct JtErrorNote *prev;
} JtErrorNote;

static JtErrorNote *jt_error_notes;

static void jt_error_at(const char *file, int line, int col, const char *fmt, ...) {
    if (jt_error_trap) longjmp(*jt_error_trap, 1);
    va_list ap;
    va_start(ap, fmt);
    fprintf(stderr, "%s:%d:%d: erro: ", file, line, col);
    vfprintf(stderr, fmt, ap);
    fputc('\n', stderr);
    va_end(ap);
    for (const JtErrorNote *n = jt_error_notes; n; n = n->prev)
        fprintf(stderr, "%s:%d:%d: nota: %s\n", n->file, n->line, n->col, n->text);
    exit(1);
}

static void *jt_xrealloc(void *p, size_t n) {
    p = realloc(p, n);
    if (!p) jt_fatal("sem memoria");
    return p;
}

static void *jt_xmalloc(size_t n) { return jt_xrealloc(NULL, n); }

static bool jt_str_is(const char *s, size_t n, const char *lit) {
    return strlen(lit) == n && memcmp(s, lit, n) == 0;
}

/* ---- caminhos ---- */

static char *jt_strdup_n(const char *s, size_t n) {
    char *r = jt_xmalloc(n + 1);
    memcpy(r, s, n);
    r[n] = '\0';
    return r;
}

/* "a/b/c.jat" -> "a/b"; sem separador -> "." */
static char *jt_dirname(const char *path) {
    const char *last = NULL;
    for (const char *p = path; *p; p++)
        if (*p == '/' || *p == '\\') last = p;
    if (!last) return jt_strdup_n(".", 1);
    return jt_strdup_n(path, (size_t)(last - path));
}

/* junta partes com '/', ignorando partes NULL */
static char *jt_path_join(const char *a, const char *b, const char *c) {
    size_t n = strlen(a) + strlen(b) + (c ? strlen(c) : 0) + 3;
    char *r = jt_xmalloc(n);
    if (c) snprintf(r, n, "%s/%s/%s", a, b, c);
    else snprintf(r, n, "%s/%s", a, b);
    return r;
}

static bool jt_file_exists(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) return false;
    fclose(f);
    return true;
}

static char *jt_read_file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (!f) jt_fatal("nao foi possivel abrir '%s'", path);
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = jt_xmalloc((size_t)n + 1);
    if (fread(buf, 1, (size_t)n, f) != (size_t)n) jt_fatal("falha ao ler '%s'", path);
    buf[n] = '\0';
    fclose(f);
    return buf;
}

#if defined(_WIN32)
#define JT_OS_NAME "windows"
#elif defined(__APPLE__)
#define JT_OS_NAME "macos"
#else
#define JT_OS_NAME "linux"
#endif

#if defined(__x86_64__) || defined(_M_X64)
#define JT_ARCH_NAME "x64"
#elif defined(__aarch64__) || defined(_M_ARM64)
#define JT_ARCH_NAME "arm64"
#else
#define JT_ARCH_NAME "x86"
#endif

/* pasta dos binarios de bibliotecas nativas: bin/windows-x64/, bin/linux-x64/... */
#define JT_PLATFORM JT_OS_NAME "-" JT_ARCH_NAME

/* nome do arquivo da biblioteca nativa na plataforma: iliv.dll / libiliv.so / libiliv.dylib */
static char *jt_lib_file_name(const char *name) {
    size_t n = strlen(name) + 16;
    char *s = jt_xmalloc(n);
#if defined(_WIN32)
    snprintf(s, n, "%s.dll", name);
#elif defined(__APPLE__)
    snprintf(s, n, "lib%s.dylib", name);
#else
    snprintf(s, n, "lib%s.so", name);
#endif
    return s;
}

/* Opcoes extras do g++ de uma biblioteca (bibliotecas do sistema, ex.: -lgdi32):
   <nome>.flags vale sempre; <nome>.windows.flags / .linux.flags / .macos.flags so
   no sistema correspondente. NULL se nao houver nenhuma. */
static char *jt_load_flags(const char *dir, const char *n) {
    const char *suffixes[] = { ".flags", "." JT_OS_NAME ".flags" };
    char *all = NULL;
    for (int i = 0; i < 2; i++) {
        size_t len = strlen(dir) + strlen(n) + strlen(suffixes[i]) + 2;
        char *path = jt_xmalloc(len);
        snprintf(path, len, "%s/%s%s", dir, n, suffixes[i]);
        if (jt_file_exists(path)) {
            char *text = jt_read_file(path);
            for (char *c = text; *c; c++)
                if (*c == '\n' || *c == '\r' || *c == '\t') *c = ' ';
            size_t old = all ? strlen(all) : 0;
            all = jt_xrealloc(all, old + strlen(text) + 2);
            if (old) all[old++] = ' ';
            strcpy(all + old, text);
            free(text);
        }
        free(path);
    }
    return all;
}

#endif
