#ifndef JT_BUILD_H
#define JT_BUILD_H

#include "cpp_gen.h"
#include "parser.h"

#ifdef _WIN32
#include <direct.h>
#include <windows.h>
#define jt_mkdir(p) _mkdir(p)
#define JT_EXE_EXT ".exe"
#define JT_CXX_EXTRA " -static"
#define JT_SHARED_FLAGS "-shared -static -s"
#else
#include <dirent.h>
#include <sys/stat.h>
#define jt_mkdir(p) mkdir((p), 0755)
#define JT_EXE_EXT ""
#define JT_CXX_EXTRA ""
#define JT_SHARED_FLAGS "-shared -fPIC"
#endif

#define JT_BUILD_DIR "build"

/* "dir/arquivo.jat" -> "arquivo" */
static char *jt_stem(const char *path) {
    const char *base = path;
    for (const char *p = path; *p; p++)
        if (*p == '/' || *p == '\\') base = p + 1;
    const char *dot = strrchr(base, '.');
    size_t n = dot && dot != base ? (size_t)(dot - base) : strlen(base);
    char *s = jt_xmalloc(n + 1);
    memcpy(s, base, n);
    s[n] = '\0';
    return s;
}

/* system() com o comando protegido: o cmd.exe tira o primeiro e o ultimo '"' quando o
   comando comeca com aspas (caminho do compilador com espacos); aspas extras em volta evitam isso */
static int jt_system(const char *cmd) {
#ifdef _WIN32
    size_t n = strlen(cmd) + 3;
    char *wrapped = jt_xmalloc(n);
    snprintf(wrapped, n, "\"%s\"", cmd);
    int rc = system(wrapped);
    free(wrapped);
    return rc;
#else
    return system(cmd);
#endif
}

/* ---- bibliotecas nativas ---- */

static void jt_write_abi_wrappers(FILE *f, const JtProgram *prog, int module);


/* <pasta da biblioteca>/bin/<plataforma>/<arquivo> */
static char *jt_module_binary(const JtModule *m) {
    char *name = jt_strdup_n(m->name, m->name_len);
    char *file = jt_lib_file_name(name);
    char *bin = jt_path_join(m->dir, "bin", JT_PLATFORM);
    char *path = jt_path_join(bin, file, NULL);
    free(bin);
    free(file);
    free(name);
    return path;
}

/* biblioteca com extern usada no -build pela DLL (sem .hpp para incluir) */
static bool jt_module_uses_binary(const JtModule *m) { return m->has_extern; }

static bool jt_is_source(const char *name, bool *is_cpp) {
    const char *dot = strrchr(name, '.');
    if (!dot) return false;
    *is_cpp = strcmp(dot, ".cpp") == 0 || strcmp(dot, ".cc") == 0 || strcmp(dot, ".cxx") == 0;
    return *is_cpp || strcmp(dot, ".c") == 0;
}

/* fontes C/C++ na pasta da biblioteca (caminhos separados por \n), ou NULL */
static char *jt_lib_sources(const char *dir) {
    char *list = NULL;
    size_t len = 0;
#ifdef _WIN32
    char *pattern = jt_path_join(dir, "*", NULL);
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    free(pattern);
    if (h == INVALID_HANDLE_VALUE) return NULL;
    do {
        const char *entry = fd.cFileName;
#else
    DIR *d = opendir(dir);
    if (!d) return NULL;
    for (struct dirent *de; (de = readdir(d));) {
        const char *entry = de->d_name;
#endif
        bool is_cpp;
        if (jt_is_source(entry, &is_cpp)) {
            char *path = jt_path_join(dir, entry, NULL);
            list = jt_xrealloc(list, len + strlen(path) + 2);
            len += (size_t)sprintf(list + len, "%s%s", len ? "\n" : "", path);
            free(path);
        }
#ifdef _WIN32
    } while (FindNextFileA(h, &fd));
    FindClose(h);
#else
    }
    closedir(d);
#endif
    return list;
}

/*
 * jatai -lib <pasta>: compila os fontes C/C++ da biblioteca em
 * <pasta>/bin/<plataforma>/<nome>.dll (ou lib<nome>.so), com o jatai.h no
 * caminho de includes. Bibliotecas em outras linguagens (Rust, Zig...) so
 * precisam colocar o binario nesse mesmo lugar.
 */
static int jt_build_library(const char *dir_arg, const char *lib_root) {
    char *dir = jt_strdup_n(dir_arg, strlen(dir_arg));
    for (size_t n = strlen(dir); n > 1 && (dir[n - 1] == '/' || dir[n - 1] == '\\'); n--) dir[n - 1] = '\0';
    const char *base = dir;
    for (const char *p = dir; *p; p++)
        if (*p == '/' || *p == '\\') base = p + 1;
    char *name = jt_strdup_n(base, strlen(base));

    char *sources = jt_lib_sources(dir);

    /* biblioteca em C++ natural (<nome>.hpp): gera a ponte para o padrao C a partir do .jat */
    JtProgram prog = jt_parse_library(dir, name, lib_root);
    const JtModule *mod = &prog.modules.items[0];
    char *abi = NULL; /* ponte gerada: arquivo temporario, apagado depois de compilar */
    if (mod->hpp_path) {
        const char *tmp = getenv("TEMP");
        if (!tmp) tmp = getenv("TMPDIR");
        if (!tmp) tmp = "/tmp";
        size_t len = strlen(tmp) + strlen(name) + 32;
        abi = jt_xmalloc(len);
        snprintf(abi, len, "%s/jatai_%s_abi.cpp", tmp, name);
        FILE *af = fopen(abi, "wb");
        if (!af) jt_fatal("nao foi possivel criar '%s'", abi);
        jt_write_abi_wrappers(af, &prog, 0);
        fclose(af);
        size_t old = sources ? strlen(sources) : 0;
        sources = jt_xrealloc(sources, old + strlen(abi) + 2);
        sprintf(sources + old, "%s%s", old ? "\n" : "", abi);
    }
    if (!sources) jt_fatal("'%s' nao tem fontes (.c, .cpp) nem %s.hpp", dir, name);
    bool any_cpp = false, any_c = false;
    for (char *p = sources; *p;) {
        char *end = strchr(p, '\n');
        size_t n = end ? (size_t)(end - p) : strlen(p);
        char *one = jt_strdup_n(p, n);
        bool is_cpp;
        jt_is_source(one, &is_cpp);
        if (is_cpp) any_cpp = true;
        else any_c = true;
        free(one);
        p += n + (end ? 1 : 0);
    }
    if (any_cpp && any_c) jt_fatal("'%s' mistura fontes C e C++: use so um dos dois", dir);

    char *bin_dir = jt_path_join(dir, "bin", NULL);
    jt_mkdir(bin_dir);
    char *out_dir = jt_path_join(bin_dir, JT_PLATFORM, NULL);
    jt_mkdir(out_dir);
    char *file = jt_lib_file_name(name);
    char *out = jt_path_join(out_dir, file, NULL);
    char *flags = jt_load_flags(dir, name);

    size_t cap = strlen(sources) * 2 + strlen(out) + (flags ? strlen(flags) : 0) + strlen(lib_root) + 256;
    char *cmd = jt_xmalloc(cap);
    int n = snprintf(cmd, cap, "%s -O2 " JT_SHARED_FLAGS " -I\"%s\" -I\"%s\" -o \"%s\"",
                     any_cpp ? "g++ -std=c++20" : "gcc -std=c11", lib_root, dir, out);
    for (char *p = sources; *p;) {
        char *end = strchr(p, '\n');
        size_t len = end ? (size_t)(end - p) : strlen(p);
        n += snprintf(cmd + n, cap - (size_t)n, " \"%.*s\"", (int)len, p);
        p += len + (end ? 1 : 0);
    }
    if (flags) snprintf(cmd + n, cap - (size_t)n, " %s", flags);
    fprintf(stderr, "jatai: compilando biblioteca '%s' para " JT_PLATFORM "...\n", name);
    int rc = jt_system(cmd);
    if (abi) {
        remove(abi);
        free(abi);
    }
    if (rc != 0) jt_fatal("falha ao compilar a biblioteca '%s' (codigo %d)", name, rc);
    printf("%s\n", out);
    free(cmd);
    free(flags);
    free(out);
    free(file);
    free(out_dir);
    free(bin_dir);
    free(sources);
    free(name);
    free(dir);
    return 0;
}

/* ---- ponte C++ natural -> padrao C (jatai -lib de biblioteca com <nome>.hpp) ---- */

/* ponteiro de funcao C de um callback: R (*nome)(void *ctx, ...) */
static void jt_abi_fnptr(FILE *f, const JtSig *sig, const char *name) {
    fprintf(f, "%s (*%s)(void *", jt_abi_c_type(sig->ret), name);
    for (uint32_t j = 0; j < sig->n; j++) {
        if (sig->params[j] == TY_STRING) fputs(", const char *, size_t", f);
        else fprintf(f, ", %s", jt_abi_c_type(sig->params[j]));
    }
    fputc(')', f);
}

/* callback recebido da VM/programa (fn + ctx) como std::function para o C++ natural */
static void jt_abi_callback_arg(FILE *f, const JtSig *sig, size_t k) {
    const char *ret = sig->ret == TY_STRING ? "std::string" : jt_cpp_type(sig->ret);
    fprintf(f, "std::function<%s(", ret);
    for (uint32_t j = 0; j < sig->n; j++) {
        if (j) fputs(", ", f);
        if (sig->params[j] == TY_STRING) fputs("const std::string&", f);
        else fputs(jt_cpp_type(sig->params[j]), f);
    }
    fprintf(f, ")>([a%zu, a%zu_ctx](", k, k);
    for (uint32_t j = 0; j < sig->n; j++) {
        if (j) fputs(", ", f);
        if (sig->params[j] == TY_STRING) fprintf(f, "const std::string& p%u", j);
        else fprintf(f, "%s p%u", jt_cpp_type(sig->params[j]), j);
    }
    fprintf(f, ") -> %s {\n        ", ret);
    switch (sig->ret) {
    case TY_VOID:   break;
    case TY_STRING: fputs("char *r = ", f); break;
    case TY_BOOL:   fputs("return 0 != ", f); break;
    case TY_CHAR:   fputs("return (char)", f); break;
    default:        fputs("return ", f); break;
    }
    fprintf(f, "a%zu(a%zu_ctx", k, k);
    for (uint32_t j = 0; j < sig->n; j++) {
        switch (sig->params[j]) {
        case TY_STRING: fprintf(f, ", p%u.data(), p%u.size()", j, j); break;
        case TY_BOOL:   fprintf(f, ", p%u ? 1 : 0", j); break;
        case TY_CHAR:   fprintf(f, ", (int32_t)(unsigned char)p%u", j); break;
        default:        fprintf(f, ", p%u", j); break;
        }
    }
    fputs(");\n", f);
    if (sig->ret == TY_STRING)
        fputs("        std::string s(r, jatai_str_len(r));\n        jatai_str_free(r);\n        return s;\n", f);
    fputs("    })", f);
}

static void jt_write_abi_wrappers(FILE *f, const JtProgram *prog, int module) {
    JtCppGen g = { f, prog, 0 };
    const JtModule *m = &prog->modules.items[module];
    int nl = (int)m->name_len;
    fprintf(f, "// gerado por jatai -lib: exporta as funcoes extern de %.*s.jat no padrao C,\n"
               "// chamando a implementacao C++ de %.*s.hpp. Nao edite.\n", nl, m->name, nl, m->name);
    fputs("#include \"jatai.h\"\n\n"
          "#include <cstdint>\n#include <functional>\n#include <string>\n#include <string_view>\n\n"
          "// string recebida: vira std::string_view (sem copia) ou std::string, conforme o .hpp pedir\n"
          "struct JtStrArg {\n"
          "    const char *p;\n"
          "    size_t n;\n"
          "    operator std::string_view() const { return {p, n}; }\n"
          "    operator std::string() const { return std::string(p, n); }\n"
          "};\n\n", f);
    fprintf(f, "#include \"%.*s.hpp\"\n\nJATAI_LIBRARY(%.*s)\n", nl, m->name, nl, m->name);

    for (size_t i = 0; i < prog->funcs.len; i++) {
        const JtFunc *fn = &prog->funcs.items[i];
        if (fn->module != module || !fn->is_extern) continue;
        fprintf(f, "\nJATAI_API %s jatai_%.*s_%.*s(", jt_abi_c_type(fn->ret), nl, m->name, (int)fn->name_len, fn->name);
        for (size_t k = 0; k < fn->params.len; k++) {
            const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
            char name[32];
            snprintf(name, sizeof name, "a%zu", k);
            if (k) fputs(", ", f);
            if (pv->type == TY_STRING) fprintf(f, "const char *%s, size_t %s_len", name, name);
            else if (pv->type == TY_FN) {
                jt_abi_fnptr(f, &prog->sigs.items[pv->sig], name);
                fprintf(f, ", void *%s_ctx", name);
            } else fprintf(f, "%s %s", jt_abi_c_type(pv->type), name);
        }
        if (!fn->params.len) fputs("void", f);
        fputs(") {\n    ", f);
        switch (fn->ret) {
        case TY_VOID:   break;
        case TY_STRING: fputs("std::string r = ", f); break;
        case TY_BOOL:   fputs("return 0 != ", f); break;
        case TY_CHAR:   fputs("return (int32_t)(unsigned char)", f); break;
        default:        fputs("return ", f); break;
        }
        fputs("jatai::", f);
        jt_cpp_name(&g, m->name, m->name_len);
        fputs("::", f);
        jt_cpp_name(&g, fn->name, fn->name_len);
        fputc('(', f);
        for (size_t k = 0; k < fn->params.len; k++) {
            const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
            if (k) fputs(", ", f);
            switch (pv->type) {
            case TY_STRING: fprintf(f, "JtStrArg{a%zu, a%zu_len}", k, k); break;
            case TY_BOOL:   fprintf(f, "a%zu != 0", k); break;
            case TY_CHAR:   fprintf(f, "(char)a%zu", k); break;
            case TY_FN:     jt_abi_callback_arg(f, &prog->sigs.items[pv->sig], k); break;
            default:        fprintf(f, "a%zu", k); break;
            }
        }
        fputs(");\n", f);
        if (fn->ret == TY_STRING) fputs("    return jatai_str(r.data(), r.size());\n", f);
        fputs("}\n", f);
    }
}

static void jt_copy_file(const char *from, const char *to) {
    FILE *in = fopen(from, "rb");
    if (!in) jt_fatal("nao foi possivel ler '%s'", from);
    FILE *out = fopen(to, "wb");
    if (!out) jt_fatal("nao foi possivel criar '%s'", to);
    char buf[65536];
    for (size_t n; (n = fread(buf, 1, sizeof buf, in)) > 0;) fwrite(buf, 1, n, out);
    fclose(in);
    fclose(out);
}

/* ---- -build ---- */

/*
 * Compilador do -build: o toolchain portatil em <pasta do jatai>/src/toolchain
 * (ver src/toolchain/LEIAME.md), se existir; senao o g++ do sistema.
 * O bin/ do toolchain entra no PATH para o g++ achar o as e o ld.
 */
static const char *jt_cxx(const char *lib_root) {
    static char cxx[4096];
    if (cxx[0]) return cxx;
    snprintf(cxx, sizeof cxx, "g++");
    if (!lib_root) return cxx;
    char *base = jt_dirname(lib_root);
    char *tc = jt_path_join(base, "src", "toolchain");
    char *bin = jt_path_join(tc, "bin", NULL);
    char *gxx = jt_path_join(bin, "g++" JT_EXE_EXT, NULL);
    if (jt_file_exists(gxx)) {
        snprintf(cxx, sizeof cxx, "\"%s\"", gxx);
        const char *old = getenv("PATH");
        size_t len = strlen(bin) + (old ? strlen(old) : 0) + 8;
        char *path = jt_xmalloc(len);
#ifdef _WIN32
        snprintf(path, len, "%s;%s", bin, old ? old : "");
        _putenv_s("PATH", path);
#else
        snprintf(path, len, "%s:%s", bin, old ? old : "");
        setenv("PATH", path, 1);
#endif
        free(path);
    }
    free(gxx);
    free(bin);
    free(tc);
    free(base);
    return cxx;
}

/*
 * Transpila e compila com g++ em uma pasta por programa:
 *   build/<nome>/<nome>(.exe)   executavel
 *   build/<nome>/<nome>.cpp     C++ gerado (so com keep_cpp)
 *   build/<nome>/bin/           bibliotecas nativas usadas, carregadas pelo programa ao iniciar
 */
static int jt_build(const JtProgram *prog, const char *src_path, bool keep_cpp) {
    char *stem = jt_stem(src_path);
    char out_dir[1024], bin_dir[1100], cpp_path[1200], exe_path[1200], cmd[16384];
    snprintf(out_dir, sizeof out_dir, JT_BUILD_DIR "/%s", stem);
    snprintf(bin_dir, sizeof bin_dir, "%s/bin", out_dir);
    snprintf(cpp_path, sizeof cpp_path, "%s/%s.cpp", out_dir, stem);
    snprintf(exe_path, sizeof exe_path, "%s/%s" JT_EXE_EXT, out_dir, stem);
    free(stem);

    jt_mkdir(JT_BUILD_DIR); /* ja existir nao e erro */
    jt_mkdir(out_dir);

    FILE *f = fopen(cpp_path, "wb");
    if (!f) jt_fatal("nao foi possivel criar '%s'", cpp_path);
    jt_cpp_emit(f, prog);
    fclose(f);

    /* bibliotecas com .hpp: includes e flags; bibliotecas binarias: liga com a DLL/.so
       ja compilada e a copia para build/, ao lado do executavel */
    /* sem LTO: o plugin de LTO nao faz parte do toolchain portatil */
    int n = snprintf(cmd, sizeof cmd, "%s -std=c++20 -O2 -fno-use-linker-plugin" JT_CXX_EXTRA, jt_cxx(prog->lib_root));
    n += snprintf(cmd + n, sizeof cmd - (size_t)n, " -o \"%s\" \"%s\"", exe_path, cpp_path);
    for (size_t i = 0; i < prog->modules.len; i++) {
        const JtModule *m = &prog->modules.items[i];
        if (jt_module_uses_binary(m)) {
            char *bin = jt_module_binary(m);
            if (!jt_file_exists(bin))
                jt_fatal("biblioteca '%.*s' nao esta compilada para " JT_PLATFORM " (falta %s).\n"
                         "       compile com: jatai -lib %s", (int)m->name_len, m->name, bin, m->dir);
            char *file = jt_lib_file_name(jt_strdup_n(m->name, m->name_len));
            char *copy = jt_path_join(bin_dir, file, NULL);
            jt_mkdir(bin_dir);
            jt_copy_file(bin, copy);
            free(copy);
            free(file);
            free(bin);
        }
    }
#ifndef _WIN32
    n += snprintf(cmd + n, sizeof cmd - (size_t)n, " -ldl"); /* dlopen (glibc antiga) */
#endif
    int rc = jt_system(cmd);

    if (!keep_cpp) remove(cpp_path);
    if (rc != 0) jt_fatal("g++ falhou (codigo %d)", rc);

    printf("%s\n", exe_path);
    if (keep_cpp) printf("%s\n", cpp_path);
    return 0;
}

#endif
