/*
 * jatai - interpretador (bytecode) e transpilador para C++20.
 *
 *   ./jatai arquivo.jat               interpreta
 *   ./jatai arquivo.jat -build        gera build/arquivo/arquivo(.exe) (via g++);
 *                                     bibliotecas nativas em build/arquivo/bin/
 *   ./jatai arquivo.jat -build -cpp   idem, mantendo build/arquivo/arquivo.cpp
 *   ./jatai -lib library/nome         compila a biblioteca nativa (DLL/.so) de uma biblioteca
 *   ./jatai arquivo.jat -check        so verifica (sintaxe e tipos), sem executar
 *
 * compilar o jatai: gcc -std=c11 -O2 -o jatai main.c -l:libffi.a
 *
 * O -build usa o toolchain portatil de src/toolchain (GCC minimo, ver
 * src/toolchain/LEIAME.md) quando ele existe ao lado do jatai; senao, o g++ do sistema.
 *
 * Na web (WebAssembly/WASI, ver src/web.h) so o modo interpretado existe; as
 * funcoes extern sao implementadas pela pagina.
 */

#include "src/common.h"
#include "src/parser.h"
#include "src/sema.h"
#include "src/bytecode.h"
#include "src/vm.h"
#ifdef __wasm__
#include "src/web.h"
#else
#include "src/build.h"
#include "src/native.h"
#endif

#if defined(_WIN32)
#include <windows.h>
#elif !defined(__wasm__)
#include <unistd.h>
#endif

static void usage(void) {
    fputs("uso:\n"
          "  jatai arquivo.jat               interpreta\n"
          "  jatai arquivo.jat -build        compila para build/<nome>/<nome> (bibliotecas em bin/)\n"
          "  jatai arquivo.jat -build -cpp   idem, mantendo build/<nome>/<nome>.cpp\n"
          "  jatai -lib <pasta>              compila a biblioteca nativa de <pasta>\n"
          "  jatai arquivo.jat -check        so verifica (sintaxe e tipos), sem executar\n",
          stderr);
    exit(1);
}

/* Pasta library/ ao lado do executavel jatai (biblioteca padrao). */
static char *jt_std_library(const char *argv0) {
    char exe[4096] = {0};
#if defined(_WIN32)
    GetModuleFileNameA(NULL, exe, sizeof exe - 1);
#elif !defined(__wasm__)
    if (readlink("/proc/self/exe", exe, sizeof exe - 1) < 0) exe[0] = '\0';
#endif
    if (!exe[0]) snprintf(exe, sizeof exe, "%s", argv0);
    for (char *c = exe; *c; c++)
        if (*c == '\\') *c = '/';
    char *dir = jt_dirname(exe);
    char *lib = jt_path_join(dir, "library", NULL);
    free(dir);
    return lib;
}

int main(int argc, char **argv) {
    const char *path = NULL;
    bool build = false, keep_cpp = false, check = false;

#ifndef __wasm__
    if (argc == 3 && strcmp(argv[1], "-lib") == 0) return jt_build_library(argv[2], jt_std_library(argv[0]));
#endif

    for (int i = 1; i < argc; i++) {
        if (strcmp(argv[i], "-build") == 0) build = true;
        else if (strcmp(argv[i], "-cpp") == 0) keep_cpp = true;
        else if (strcmp(argv[i], "-check") == 0) check = true;
        else if (argv[i][0] == '-') usage();
        else if (!path) path = argv[i];
        else usage();
    }
    if (!path || (keep_cpp && !build) || (check && build)) usage();

    char *src = jt_read_file(path);
    JtProgram prog = jt_parse(path, src, jt_std_library(argv[0]));
    jt_sema(&prog);
    /* os erros de sintaxe e de tipo ja encerraram com a mensagem; chegar aqui e estar ok
       (usado pelo editor da web para marcar erros enquanto se digita) */
    if (check) return 0;

#ifdef __wasm__
    if (build) jt_fatal("-build nao existe na web");
#else
    if (build) return jt_build(&prog, path, keep_cpp);
#endif

    JtChunk chunk = jt_compile(&prog);
    jt_natives_load(&prog, &chunk);

#ifdef _WIN32
    SetConsoleOutputCP(CP_UTF8); /* fontes .jat sao UTF-8 */
#endif
    static char outbuf[1 << 16];
    setvbuf(stdout, outbuf, _IOFBF, sizeof outbuf);

    JtVM vm;
    jt_vm_init(&vm, stdout);
    return jt_vm_run(&vm, &chunk);
}
