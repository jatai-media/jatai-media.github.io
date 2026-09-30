#ifndef JT_NATIVE_H
#define JT_NATIVE_H

#include "build.h"
#include "vm.h"

#ifdef _WIN32
#define FFI_STATIC_BUILD /* libffi ligada estaticamente no jatai */
#endif
#include <ffi.h>
#include <stddef.h>
#include <sys/stat.h>

/*
 * Funcoes extern no modo interpretado.
 *
 * Cada biblioteca com funcoes extern tem uma biblioteca nativa ja compilada
 * (bin/<plataforma>/<nome>.dll ou lib<nome>.so) que exporta, no padrao C,
 * jatai_<nome>_init e jatai_<nome>_<funcao> (contrato em library/jatai.h).
 * A VM a carrega e chama cada funcao pela libffi, que monta a chamada C para
 * qualquer assinatura; callbacks (valores de funcao) viram ponteiros de funcao
 * C criados pela libffi (closures) que entram de volta na VM.
 */

#ifdef _WIN32
#include <windows.h>
typedef HMODULE JtLib;
static JtLib jt_lib_open(const char *path) { return LoadLibraryA(path); }
static void *jt_lib_sym(JtLib lib, const char *name) { return (void *)GetProcAddress(lib, name); }
#else
#include <dlfcn.h>
typedef void *JtLib;
static JtLib jt_lib_open(const char *path) { return dlopen(path, RTLD_NOW); }
static void *jt_lib_sym(JtLib lib, const char *name) { return dlsym(lib, name); }
#endif

static long long jt_mtime(const char *path) {
    struct stat st;
    return stat(path, &st) == 0 ? (long long)st.st_mtime : -1;
}

/* ---- jatai_host da VM: strings trocadas com as bibliotecas sao JtStr ---- */

typedef struct {
    uint32_t version;
    char *(*str_new)(size_t n);
    void (*str_free)(char *s);
    size_t (*str_len)(const char *s);
} JtAbiHost; /* mesmo layout de jatai_host (library/jatai.h) */

static JtStr *jt_str_of_data(const char *s) { return (JtStr *)(s - offsetof(JtStr, data)); }
static char *jt_abi_str_new(size_t n) { return jt_str_new(n)->data; }
static void jt_abi_str_free(char *s) { if (s) jt_obj_release(&jt_str_of_data(s)->h); }
static size_t jt_abi_str_len(const char *s) { return jt_str_of_data(s)->len; }
static const JtAbiHost jt_abi_host = { 1, jt_abi_str_new, jt_abi_str_free, jt_abi_str_len };

/* ---- tipos C da ABI ---- */

static ffi_type *jt_abi_ret_type(JtType t) {
    switch (t) {
    case TY_VOID:   return &ffi_type_void;
    case TY_DOUBLE: return &ffi_type_double;
    case TY_STRING: return &ffi_type_pointer;
    default:        return &ffi_type_sint32;
    }
}

/* tipos C de um parametro Jatai, escritos em out; devolve quantos */
static uint32_t jt_abi_param_types(JtType t, ffi_type **out) {
    switch (t) {
    case TY_DOUBLE: out[0] = &ffi_type_double; return 1;
    case TY_STRING: out[0] = &ffi_type_pointer; out[1] = &ffi_type_uint64; return 2; /* p, size_t */
    case TY_FN:     out[0] = &ffi_type_pointer; out[1] = &ffi_type_pointer; return 2; /* fn, ctx */
    default:        out[0] = &ffi_type_sint32; return 1;
    }
}

/* ---- callbacks: closures da libffi que chamam de volta uma funcao Jatai ---- */

typedef struct {
    JtSig sig;
    ffi_cif cif;
    ffi_type *atypes[1 + 2 * 16];
    void *code; /* ponteiro de funcao C para passar a biblioteca */
} JtCallback;

/* ctx passado junto com o ponteiro de funcao: identifica a funcao Jatai */
typedef struct {
    const JtHost *host;
    int32_t fn;
} JtCallbackCtx;

static void jt_callback_entry(ffi_cif *cif, void *ret, void **args, void *user) {
    (void)cif;
    const JtCallback *cb = user;
    const JtCallbackCtx *ctx = *(JtCallbackCtx **)args[0];
    JtNValue x[16] = {{0}}, r = {0};
    uint32_t k = 1;
    for (uint32_t j = 0; j < cb->sig.n; j++) {
        switch (cb->sig.params[j]) {
        case TY_DOUBLE: x[j].d = *(double *)args[k++]; break;
        case TY_STRING:
            x[j].s.p = *(const char **)args[k];
            x[j].s.n = (uint32_t)*(uint64_t *)args[k + 1];
            k += 2;
            break;
        default: x[j].i = *(int32_t *)args[k++]; break;
        }
    }
    ctx->host->call(ctx->host->vm, ctx->fn, x, &r);
    switch (cb->sig.ret) {
    case TY_VOID: break;
    case TY_DOUBLE: *(double *)ret = r.d; break;
    case TY_STRING: *(char **)ret = jt_str_from(r.s.p, r.s.n)->data; break; /* a biblioteca libera */
    default: *(ffi_arg *)ret = (ffi_arg)(ffi_sarg)r.i; break;
    }
}

static JtCallback *jt_callback_new(const JtSig *sig) {
    JtCallback *cb = calloc(1, sizeof *cb);
    cb->sig = *sig;
    uint32_t n = 0;
    cb->atypes[n++] = &ffi_type_pointer; /* ctx */
    for (uint32_t j = 0; j < sig->n; j++) n += jt_abi_param_types(sig->params[j], cb->atypes + n);
    if (ffi_prep_cif(&cb->cif, FFI_DEFAULT_ABI, n, jt_abi_ret_type(sig->ret), cb->atypes) != FFI_OK)
        jt_fatal("libffi: assinatura de callback invalida");
    ffi_closure *closure = ffi_closure_alloc(sizeof(ffi_closure), &cb->code);
    if (!closure || ffi_prep_closure_loc(closure, &cb->cif, jt_callback_entry, cb, cb->code) != FFI_OK)
        jt_fatal("libffi: nao foi possivel criar o callback");
    return cb;
}

/* um ctx por funcao Jatai, criado na primeira vez e mantido (a biblioteca pode guardar o callback) */
static JtCallbackCtx **jt_callback_ctxs;
static size_t jt_callback_nctx;

static JtCallbackCtx *jt_callback_ctx(const JtHost *host, int32_t fn) {
    if ((size_t)fn >= jt_callback_nctx) {
        size_t n = (size_t)fn + 16;
        jt_callback_ctxs = jt_xrealloc(jt_callback_ctxs, n * sizeof *jt_callback_ctxs);
        memset(jt_callback_ctxs + jt_callback_nctx, 0, (n - jt_callback_nctx) * sizeof *jt_callback_ctxs);
        jt_callback_nctx = n;
    }
    if (!jt_callback_ctxs[fn]) {
        jt_callback_ctxs[fn] = jt_xmalloc(sizeof(JtCallbackCtx));
        jt_callback_ctxs[fn]->host = host;
        jt_callback_ctxs[fn]->fn = fn;
    }
    return jt_callback_ctxs[fn];
}

/* ---- chamadas de funcoes extern ---- */

typedef struct {
    void *fn;
    ffi_cif cif;
    ffi_type *atypes[2 * JT_MAX_NATIVE_PARAMS];
    JtCallback *callbacks[JT_MAX_NATIVE_PARAMS]; /* para parametros com valor de funcao */
} JtFfiFn;

static void jt_ffi_invoke(const JtNative *nf, const JtNValue *a, JtNValue *ret, const JtHost *host) {
    const JtFfiFn *f = nf->impl;
    union { int32_t i; double d; const void *p; uint64_t z; } st[2 * JT_MAX_NATIVE_PARAMS];
    void *av[2 * JT_MAX_NATIVE_PARAMS];
    uint32_t k = 0;
    for (uint32_t j = 0; j < nf->nparams; j++) {
        switch (nf->params[j]) {
        case TY_DOUBLE: st[k].d = a[j].d; av[k] = &st[k]; k++; break;
        case TY_STRING:
            st[k].p = a[j].s.p; av[k] = &st[k]; k++;
            st[k].z = a[j].s.n; av[k] = &st[k]; k++;
            break;
        case TY_FN:
            st[k].p = f->callbacks[j]->code; av[k] = &st[k]; k++;
            st[k].p = jt_callback_ctx(host, a[j].i); av[k] = &st[k]; k++;
            break;
        default: st[k].i = a[j].i; av[k] = &st[k]; k++; break;
        }
    }
    union { ffi_arg i; double d; void *p; } r;
    ffi_call((ffi_cif *)&f->cif, FFI_FN(f->fn), &r, av);
    switch (nf->ret) {
    case TY_VOID: break;
    case TY_DOUBLE: ret->d = r.d; break;
    case TY_STRING: ret->o = r.p ? &jt_str_of_data(r.p)->h : &jt_str_new(0)->h; break;
    default: ret->i = (int32_t)r.i; break;
    }
}

/* fontes da biblioteca (.c/.cpp) mais novas que o binario? (aviso para recompilar) */
static bool jt_sources_newer(const JtModule *m, long long built) {
    char *list = jt_lib_sources(m->dir);
    bool newer = false;
    for (char *p = list; p && *p && !newer;) {
        char *end = strchr(p, '\n');
        if (end) *end = '\0';
        newer = jt_mtime(p) > built;
        p = end ? end + 1 : p + strlen(p);
    }
    free(list);
    return newer;
}

static void jt_natives_load(const JtProgram *prog, JtChunk *chunk) {
    chunk->natives = calloc(prog->funcs.len + 1, sizeof *chunk->natives);

    for (size_t mi = 0; mi < prog->modules.len; mi++) {
        const JtModule *m = &prog->modules.items[mi];
        if (!m->has_extern) continue;
        char *name = jt_strdup_n(m->name, m->name_len);
        char *bin = jt_module_binary(m);
        long long built = jt_mtime(bin);
        if (built < 0)
            jt_fatal("biblioteca '%s' nao esta compilada para " JT_PLATFORM " (falta %s).\n"
                     "       compile com: jatai -lib %s", name, bin, m->dir);
        if (jt_sources_newer(m, built) || jt_mtime(m->jat_path) > built ||
            (m->hpp_path && jt_mtime(m->hpp_path) > built))
            fprintf(stderr, "jatai: aviso: os fontes de '%s' sao mais novos que o binario; "
                            "recompile com: jatai -lib %s\n", name, m->dir);

        JtLib lib = jt_lib_open(bin);
        if (!lib) jt_fatal("nao foi possivel carregar '%s'", bin);
        char sym[300];
        snprintf(sym, sizeof sym, "jatai_%s_init", name);
        void (*init)(const JtAbiHost *) = (void (*)(const JtAbiHost *))jt_lib_sym(lib, sym);
        if (!init) jt_fatal("'%s' nao exporta %s (use JATAI_LIBRARY(%s))", bin, sym, name);
        init(&jt_abi_host);

        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != (int)mi || !fn->is_extern) continue;
            if (fn->params.len > JT_MAX_NATIVE_PARAMS)
                jt_fatal("funcao extern '%s.%.*s' tem parametros demais (maximo %d)",
                         name, (int)fn->name_len, fn->name, JT_MAX_NATIVE_PARAMS);
            snprintf(sym, sizeof sym, "jatai_%s_%.*s", name, (int)fn->name_len, fn->name);
            JtFfiFn *f = calloc(1, sizeof *f);
            f->fn = jt_lib_sym(lib, sym);
            if (!f->fn) jt_fatal("'%s' nao exporta %s", bin, sym);

            JtNative *nat = &chunk->natives[i];
            nat->invoke = jt_ffi_invoke;
            nat->impl = f;
            nat->nparams = (uint32_t)fn->params.len;
            nat->ret = fn->ret;
            uint32_t n = 0;
            for (size_t k = 0; k < fn->params.len; k++) {
                const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
                nat->params[k] = pv->type;
                n += jt_abi_param_types(pv->type, f->atypes + n);
                if (pv->type == TY_FN) f->callbacks[k] = jt_callback_new(&prog->sigs.items[pv->sig]);
            }
            if (ffi_prep_cif(&f->cif, FFI_DEFAULT_ABI, n, jt_abi_ret_type(fn->ret), f->atypes) != FFI_OK)
                jt_fatal("libffi: assinatura invalida para %s", sym);
        }
        free(bin);
        free(name);
    }
}

#endif
