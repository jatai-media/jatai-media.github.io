#ifndef JT_WEB_H
#define JT_WEB_H

/*
 * Jatai na web (WebAssembly + WASI): a VM roda no navegador e as funcoes extern
 * das bibliotecas sao implementadas pela pagina, em JavaScript. E o mesmo papel
 * das DLLs no Windows (native.h), com a pagina no lugar da biblioteca nativa.
 *
 * Para cada chamada extern, a VM chama a funcao importada jatai.call:
 *
 *   call(modulo, funcao, args, tipos, n, tipo_retorno, ret)
 *
 *   modulo, funcao  textos terminados em '\0' ("editor", "add_text")
 *   args            n valores JtNValue (8 bytes cada): int/char/bool em i32,
 *                   double em f64, string como ponteiro (u32) + tamanho (u32)
 *   tipos           n bytes com o JtType de cada argumento
 *   ret             onde gravar o retorno; uma string e criada com a funcao
 *                   exportada jt_web_str_new(n) e o ponteiro dela vai em ret
 *
 * Os arquivos (o script e as bibliotecas .jat) vem do sistema de arquivos
 * virtual que a pagina monta para o WASI.
 */

#include <stddef.h>

#include "vm.h"

__attribute__((import_module("jatai"), import_name("call")))
extern void jt_js_call(const char *mod, const char *fn, const JtNValue *args, const uint8_t *types,
                       uint32_t n, uint32_t ret_type, JtNValue *ret);

static JtStr *jt_web_str_of_data(char *s) { return (JtStr *)(s - offsetof(JtStr, data)); }

/* string nova para o JavaScript preencher (retorno de funcao extern) */
__attribute__((export_name("jt_web_str_new")))
char *jt_web_str_new(uint32_t n) { return jt_str_new(n)->data; }

typedef struct {
    char *mod, *fn;
    bool callback; /* tem parametro funcao: ainda nao existe na web */
} JtWebFn;

static void jt_web_invoke(const JtNative *nf, const JtNValue *a, JtNValue *ret, const JtHost *host) {
    (void)host;
    const JtWebFn *f = nf->impl;
    /* o erro vem na chamada, e nao ao carregar: importar voz ou iliv por causa de
       uma funcao sem callback tem de funcionar */
    if (f->callback)
        jt_fatal("'%s.%s': callbacks em funcoes extern ainda nao funcionam na web", f->mod, f->fn);
    uint8_t types[JT_MAX_NATIVE_PARAMS];
    for (uint32_t k = 0; k < nf->nparams; k++) types[k] = (uint8_t)nf->params[k];
    fflush(stdout); /* o que o script ja escreveu aparece antes do efeito da chamada */
    jt_js_call(f->mod, f->fn, a, types, nf->nparams, (uint32_t)nf->ret, ret);
    if (nf->ret == TY_STRING) ret->o = ret->o ? &jt_web_str_of_data(ret->o)->h : &jt_str_new(0)->h;
}

static void jt_natives_load(const JtProgram *prog, JtChunk *chunk) {
    chunk->natives = calloc(prog->funcs.len + 1, sizeof *chunk->natives);
    for (size_t i = 0; i < prog->funcs.len; i++) {
        const JtFunc *fn = &prog->funcs.items[i];
        if (!fn->is_extern) continue;
        const JtModule *m = &prog->modules.items[fn->module];
        if (fn->params.len > JT_MAX_NATIVE_PARAMS)
            jt_fatal("funcao extern '%.*s.%.*s' tem parametros demais (maximo %d)",
                     (int)m->name_len, m->name, (int)fn->name_len, fn->name, JT_MAX_NATIVE_PARAMS);
        JtWebFn *f = calloc(1, sizeof *f);
        f->mod = jt_strdup_n(m->name, m->name_len);
        f->fn = jt_strdup_n(fn->name, fn->name_len);
        JtNative *nat = &chunk->natives[i];
        nat->invoke = jt_web_invoke;
        nat->impl = f;
        nat->nparams = (uint32_t)fn->params.len;
        nat->ret = fn->ret;
        for (size_t k = 0; k < fn->params.len; k++) {
            const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
            if (pv->type == TY_FN) f->callback = true;
            nat->params[k] = pv->type;
        }
    }
}

#endif
