#ifndef JT_SEMA_H
#define JT_SEMA_H

#include "ast.h"

/*
 * Analise semantica: resolve variaveis e verifica tipos.
 * Tipagem estatica e estrita: nenhuma conversao implicita.
 *
 * Tipagem automatica (o tipo pode ser omitido; continua estatico, sem custo):
 *   x = 10              declara x com o tipo do valor (int); dentro de um bloco
 *                       aninhado, x vale ate o fim da funcao, como no Python
 *   const x = 10 / global x = 10
 *   lista = []          o tipo dos elementos vem do primeiro uso (append, [i] = v...)
 *   fn f(a, b)          funcao com parametros sem tipo e retorno deduzido: cada
 *                       combinacao de tipos dos argumentos gera uma instancia
 *                       (como um template do C++), verificada com tipos concretos
 *
 * Atencao: criar uma instancia acrescenta funcoes e variaveis a prog->funcs e
 * prog->vars, o que pode mover os vetores. Por isso o sema guarda indices, e nao
 * ponteiros, atravessando qualquer chamada que verifique expressoes.
 */

static int jt_sema_lookup(const JtProgram *prog, const char *name, size_t len) {
    for (size_t i = prog->vars.len; i-- > 0;) {
        const JtVarInfo *v = &prog->vars.items[i];
        if (v->in_scope && v->name_len == len && memcmp(v->name, name, len) == 0) return (int)i;
    }
    return -1;
}

static int jt_sema_resolve(const JtProgram *prog, const char *name, size_t len, int line, int col) {
    int v = jt_sema_lookup(prog, name, len);
    if (v < 0) jt_error_at(prog->file, line, col, "variavel nao declarada '%.*s'", (int)len, name);
    return v;
}

/* Funcao com esse nome no modulo dado (-1 = programa principal). Instancias nao
   contam: o nome leva sempre ao modelo. */
static int jt_sema_find_func(const JtProgram *prog, const char *name, size_t len, int module) {
    for (size_t i = 0; i < prog->funcs.len; i++) {
        const JtFunc *f = &prog->funcs.items[i];
        if (f->template_of >= 0) continue;
        if (f->module == module && f->name_len == len && memcmp(f->name, name, len) == 0) return (int)i;
    }
    return -1;
}

static bool jt_sema_is_module(const JtProgram *prog, const char *name, size_t len) {
    for (size_t i = 0; i < prog->modules.len; i++)
        if (prog->modules.items[i].name_len == len && memcmp(prog->modules.items[i].name, name, len) == 0)
            return true;
    return false;
}

static void jt_sema_expr(JtProgram *prog, JtExpr *e);
static void jt_sema_func_body(JtProgram *prog, int fi);

/* ---- listas [] sem tipo: o tipo chega depois ---- */

/* A variavel var, declarada com uma lista vazia (tipo []), passa a ter o tipo t. */
static void jt_sema_fix_array(JtProgram *prog, int var, JtType t) {
    JtVarInfo *v = &prog->vars.items[var];
    if (v->type != TY_ARR_EMPTY || !jt_is_array(t)) return;
    v->type = t;
    JtStmt *d = v->decl;
    if (!d) return;
    d->type = t;
    if (d->init->type == TY_ARR_EMPTY) d->init->type = t;
    /* x = []; y = x: descobrir o tipo de y tambem define o de x */
    if (d->init->kind == EX_VAR && d->init->var.index >= 0) jt_sema_fix_array(prog, d->init->var.index, t);
}

/* Como jt_sema_expr, mas um literal [] vazio (ou variavel com lista ainda sem tipo)
   assume o tipo esperado pelo contexto. */
static void jt_sema_expr_as(JtProgram *prog, JtExpr *e, JtType expected) {
    jt_sema_expr(prog, e);
    if (e->type == TY_ARR_EMPTY && jt_is_array(expected)) {
        e->type = expected;
        if (e->kind == EX_VAR) jt_sema_fix_array(prog, e->var.index, expected);
    }
}

/* Valor que pode ir para uma variavel ou parametro sem tipo? (what: "variavel 'x'"...) */
static void jt_sema_check_value(JtProgram *prog, const JtExpr *e, const char *what, const char *name, size_t len) {
    if (e->type == TY_VOID)
        jt_error_at(prog->file, e->line, e->col, "a expressao nao devolve valor para %s '%.*s'", what, (int)len, name);
    if (e->type == TY_FN)
        jt_error_at(prog->file, e->line, e->col, "valor de funcao nao pode ir para %s '%.*s'", what, (int)len, name);
}

static void jt_sema_unknown_elems(JtProgram *prog, const JtExpr *e) {
    if (e->kind == EX_VAR)
        jt_error_at(prog->file, e->line, e->col,
                    "o tipo dos elementos de '%.*s' ainda nao e conhecido (use append antes, ou declare o tipo: int[] %.*s = [])",
                    (int)e->var.name_len, e->var.name, (int)e->var.name_len, e->var.name);
    jt_error_at(prog->file, e->line, e->col, "o tipo dos elementos de [] nao e conhecido aqui");
}

/* A funcao fi tem exatamente a assinatura sig? */
static bool jt_sema_func_matches(const JtProgram *prog, int fi, const JtSig *sig) {
    const JtFunc *f = &prog->funcs.items[fi];
    if (f->ret != sig->ret || f->params.len != sig->n) return false;
    for (uint32_t k = 0; k < sig->n; k++)
        if (prog->vars.items[f->params.items[k]].type != sig->params[k]) return false;
    return true;
}

static bool jt_sig_equal(const JtSig *a, const JtSig *b) {
    if (a->ret != b->ret || a->n != b->n) return false;
    for (uint32_t k = 0; k < a->n; k++)
        if (a->params[k] != b->params[k]) return false;
    return true;
}

static void jt_sig_text(const JtSig *sig, char *buf, size_t cap) {
    int n = snprintf(buf, cap, "%s(", jt_type_name(sig->ret));
    for (uint32_t k = 0; k < sig->n && n < (int)cap; k++)
        n += snprintf(buf + n, cap - (size_t)n, "%s%s", k ? ", " : "", jt_type_name(sig->params[k]));
    if (n < (int)cap) snprintf(buf + n, cap - (size_t)n, ")");
}

/* ---- instancias de funcoes sem tipo ---- */

/* "f(a: int, b: string)" para mensagens */
static void jt_sema_instance_text(const JtProgram *prog, int fi, char *buf, size_t cap) {
    const JtFunc *f = &prog->funcs.items[fi];
    int n = snprintf(buf, cap, "%.*s(", (int)f->name_len, f->name);
    for (size_t k = 0; k < f->params.len && n < (int)cap; k++) {
        const JtVarInfo *v = &prog->vars.items[f->params.items[k]];
        n += snprintf(buf + n, cap - (size_t)n, "%s%.*s: %s", k ? ", " : "", (int)v->name_len, v->name,
                      jt_type_name(v->type));
    }
    if (n < (int)cap) snprintf(buf + n, cap - (size_t)n, ")");
}

/*
 * Instancia do modelo ti para os tipos de parametro types (um por parametro; os
 * que ja tinham tipo repetem o proprio). Reaproveita a instancia se ela ja existe;
 * senao copia o corpo e o verifica agora. (line, col): chamada que pediu a
 * instancia, para a nota nos erros.
 */
static int jt_sema_instance(JtProgram *prog, int ti, const JtType *types, int line, int col) {
    {
        const JtFunc *t = &prog->funcs.items[ti];
        for (size_t i = 0; i < t->instances.len; i++) {
            const JtFunc *inst = &prog->funcs.items[t->instances.items[i]];
            bool same = true;
            for (size_t k = 0; k < inst->params.len && same; k++)
                same = prog->vars.items[inst->params.items[k]].type == types[k];
            if (same) return t->instances.items[i];
        }
    }

    JtFunc inst = prog->funcs.items[ti];
    memset(&inst.params, 0, sizeof inst.params);
    memset(&inst.instances, 0, sizeof inst.instances);
    inst.is_template = false;
    inst.is_generic = false;
    inst.template_of = ti;
    inst.checked = false;
    inst.body = jt_clone_block(&prog->funcs.items[ti].body);
    size_t np = prog->funcs.items[ti].params.len;
    for (size_t k = 0; k < np; k++) {
        JtVarInfo v = prog->vars.items[prog->funcs.items[ti].params.items[k]];
        v.type = types[k];
        v.in_scope = false;
        jt_vec_push(&prog->vars, v);
        jt_vec_push(&inst.params, (int)prog->vars.len - 1);
    }
    jt_vec_push(&prog->funcs, inst);
    int ii = (int)prog->funcs.len - 1;
    jt_vec_push(&prog->funcs.items[ti].instances, ii);

    /* line 0: instancia unica verificada sem chamada (fn sem parametro sem tipo) */
    JtErrorNote note = { prog->file, line, col, "", jt_error_notes };
    if (line > 0) {
        char sig[200];
        jt_sema_instance_text(prog, ii, sig, sizeof sig);
        snprintf(note.text, sizeof note.text, "ao verificar %s, chamada aqui", sig);
        jt_error_notes = &note;
    }
    jt_sema_func_body(prog, ii);
    if (line > 0) jt_error_notes = note.prev;
    return ii;
}

/* Retorno de uma funcao chamada: TY_AUTO so se ela ainda esta sendo verificada
   (recursao) e nenhum return disse o tipo ate aqui. */
static JtType jt_sema_call_ret(JtProgram *prog, int fi, int line, int col) {
    const JtFunc *f = &prog->funcs.items[fi];
    if (f->ret == TY_AUTO)
        jt_error_at(prog->file, line, col,
                    "nao foi possivel deduzir o tipo de retorno de '%.*s': a chamada recursiva vem antes de "
                    "qualquer return com valor (coloque o caso base primeiro, ou declare o tipo de retorno)",
                    (int)f->name_len, f->name);
    return f->ret;
}

/* Argumento para um parametro com valor de funcao: o nome de uma funcao do
   arquivo (vira EX_FNREF) ou outro parametro com a mesma assinatura. */
static void jt_sema_fn_arg(JtProgram *prog, JtExpr *a, const JtVarInfo *param) {
    const JtSig sig = prog->sigs.items[param->sig];
    char want[160];
    jt_sig_text(&sig, want, sizeof want);
    if (a->kind != EX_VAR)
        jt_error_at(prog->file, a->line, a->col, "'%.*s' espera uma funcao %s (passe o nome da funcao)",
                    (int)param->name_len, param->name, want);
    int v = jt_sema_lookup(prog, a->var.name, a->var.name_len);
    if (v >= 0) {
        const JtVarInfo *var = &prog->vars.items[v];
        if (var->type != TY_FN || !jt_sig_equal(&prog->sigs.items[var->sig], &sig))
            jt_error_at(prog->file, a->line, a->col, "'%.*s' espera uma funcao %s",
                        (int)param->name_len, param->name, want);
        a->var.index = v;
        a->type = TY_FN;
        return;
    }
    int fi = jt_sema_find_func(prog, a->var.name, a->var.name_len, prog->cur_module);
    if (fi < 0)
        jt_error_at(prog->file, a->line, a->col, "funcao desconhecida '%.*s'", (int)a->var.name_len, a->var.name);
    const JtFunc *f = &prog->funcs.items[fi];
    if (f->is_extern)
        jt_error_at(prog->file, a->line, a->col, "funcao extern '%.*s' nao pode ser passada como valor",
                    (int)f->name_len, f->name);
    for (size_t k = 0; k < f->params.len; k++)
        if (prog->vars.items[f->params.items[k]].type == TY_FN)
            jt_error_at(prog->file, a->line, a->col,
                        "'%.*s' recebe uma funcao como parametro e por isso nao pode ser passada como valor",
                        (int)f->name_len, f->name);
    if (f->is_template) {
        /* funcao sem tipo: a assinatura esperada diz os tipos dos parametros */
        if (f->params.len != sig.n)
            jt_error_at(prog->file, a->line, a->col, "'%.*s' nao tem a assinatura %s esperada por '%.*s'",
                        (int)f->name_len, f->name, want, (int)param->name_len, param->name);
        JtType types[16];
        for (uint32_t k = 0; k < sig.n; k++) {
            JtType pt = prog->vars.items[f->params.items[k]].type;
            if (pt != TY_AUTO && pt != sig.params[k])
                jt_error_at(prog->file, a->line, a->col, "'%.*s' nao tem a assinatura %s esperada por '%.*s'",
                            (int)f->name_len, f->name, want, (int)param->name_len, param->name);
            types[k] = sig.params[k];
        }
        fi = jt_sema_instance(prog, fi, types, a->line, a->col);
        jt_sema_call_ret(prog, fi, a->line, a->col);
        f = &prog->funcs.items[fi];
    }
    if (!jt_sema_func_matches(prog, fi, &sig))
        jt_error_at(prog->file, a->line, a->col, "'%.*s' nao tem a assinatura %s esperada por '%.*s'",
                    (int)f->name_len, f->name, want, (int)param->name_len, param->name);
    a->kind = EX_FNREF;
    a->fnref = fi;
    a->type = TY_FN;
}

/* chamada atraves de um parametro com valor de funcao: acao(1, 2) */
static bool jt_sema_call_fnvar(JtProgram *prog, JtExpr *e) {
    if (e->call.qual >= 0) return false;
    int v = jt_sema_lookup(prog, e->call.name, e->call.name_len);
    if (v < 0 || prog->vars.items[v].type != TY_FN) return false;
    const JtSig sig = prog->sigs.items[prog->vars.items[v].sig];
    if (e->call.nargs != sig.n)
        jt_error_at(prog->file, e->line, e->col, "'%.*s' espera %u argumento(s), recebeu %zu",
                    (int)e->call.name_len, e->call.name, sig.n, e->call.nargs);
    for (size_t i = 0; i < e->call.nargs; i++) {
        JtExpr *a = e->call.args[i];
        jt_sema_expr_as(prog, a, sig.params[i]);
        if (a->type != sig.params[i])
            jt_error_at(prog->file, a->line, a->col, "argumento %zu de '%.*s': esperado %s, recebeu %s",
                        i + 1, (int)e->call.name_len, e->call.name, jt_type_name(sig.params[i]),
                        jt_type_name(a->type));
    }
    e->call.fn = -1;
    e->call.fnvar = v;
    e->type = sig.ret;
    return true;
}

static void jt_sema_call(JtProgram *prog, JtExpr *e) {
    if (jt_sema_call_fnvar(prog, e)) return;
    /* modulo.nome(...) procura no modulo; nome(...) procura no proprio arquivo */
    int module = e->call.qual >= 0 ? e->call.qual : prog->cur_module;
    int fi = jt_sema_find_func(prog, e->call.name, e->call.name_len, module);
    if (fi < 0 && e->call.qual >= 0) {
        const JtModule *m = &prog->modules.items[e->call.qual];
        jt_error_at(prog->file, e->line, e->col, "funcao '%.*s' nao existe na biblioteca '%.*s'",
                    (int)e->call.name_len, e->call.name, (int)m->name_len, m->name);
    }
    if (fi < 0)
        jt_error_at(prog->file, e->line, e->col, "funcao desconhecida '%.*s'", (int)e->call.name_len, e->call.name);
    const JtFunc *f = &prog->funcs.items[fi];
    if (e->call.nargs != f->params.len)
        jt_error_at(prog->file, e->line, e->col, "'%.*s' espera %zu argumento(s), recebeu %zu",
                    (int)f->name_len, f->name, f->params.len, e->call.nargs);
    JtType *types = jt_xmalloc((e->call.nargs + 1) * sizeof *types);
    for (size_t i = 0; i < e->call.nargs; i++) {
        JtExpr *a = e->call.args[i];
        f = &prog->funcs.items[fi];
        const JtVarInfo param = prog->vars.items[f->params.items[i]];
        const char *fname = f->name;
        int fname_len = (int)f->name_len;
        if (param.type == TY_FN) {
            jt_sema_fn_arg(prog, a, &param);
            types[i] = TY_FN;
            continue;
        }
        if (param.type == TY_AUTO) {
            /* parametro sem tipo: recebe o tipo do argumento */
            if (a->kind == EX_VAR && jt_sema_lookup(prog, a->var.name, a->var.name_len) < 0 &&
                jt_sema_find_func(prog, a->var.name, a->var.name_len, prog->cur_module) >= 0)
                jt_error_at(prog->file, a->line, a->col,
                            "para receber a funcao '%.*s', o parametro '%.*s' de '%.*s' precisa do tipo da funcao "
                            "(ex.: void(int) %.*s)", (int)a->var.name_len, a->var.name, (int)param.name_len,
                            param.name, fname_len, fname, (int)param.name_len, param.name);
            jt_sema_expr(prog, a);
            if (a->type == TY_ARR_EMPTY) jt_sema_unknown_elems(prog, a);
            jt_sema_check_value(prog, a, "o parametro", param.name, param.name_len);
            types[i] = a->type;
            continue;
        }
        jt_sema_expr_as(prog, a, param.type);
        if (a->type != param.type)
            jt_error_at(prog->file, a->line, a->col, "argumento '%.*s' de '%.*s': esperado %s, recebeu %s",
                        (int)param.name_len, param.name, fname_len, fname,
                        jt_type_name(param.type), jt_type_name(a->type));
        types[i] = param.type;
    }
    if (prog->funcs.items[fi].is_template) fi = jt_sema_instance(prog, fi, types, e->line, e->col);
    free(types);
    e->call.fn = fi;
    e->type = jt_sema_call_ret(prog, fi, e->line, e->col);
}

static void jt_sema_expr(JtProgram *prog, JtExpr *e) {
    switch (e->kind) {
    case EX_INT:    e->type = TY_INT;    break;
    case EX_DOUBLE: e->type = TY_DOUBLE; break;
    case EX_STRING: e->type = TY_STRING; break;
    case EX_CHAR:   e->type = TY_CHAR;   break;
    case EX_BOOL:   e->type = TY_BOOL;   break;
    case EX_VAR:
        e->var.index = jt_sema_resolve(prog, e->var.name, e->var.name_len, e->line, e->col);
        e->type = prog->vars.items[e->var.index].type;
        break;
    case EX_INTERP:
        for (size_t i = 0; i < e->interp.n; i++) {
            JtInterpPart *part = &e->interp.parts[i];
            if (!part->expr) continue;
            JtExpr *x = part->expr;
            jt_sema_expr(prog, x);
            if (x->type == TY_FN)
                jt_error_at(prog->file, x->line, x->col, "funcao '%.*s' nao pode ser interpolada",
                            (int)part->len, part->text);
            if (jt_is_array(x->type) || x->type == TY_ARR_EMPTY)
                jt_error_at(prog->file, x->line, x->col, "array '%.*s' nao pode ser interpolado",
                            (int)part->len, part->text);
            if (x->type == TY_VOID)
                jt_error_at(prog->file, x->line, x->col, "'%.*s' nao devolve valor para interpolar",
                            (int)part->len, part->text);
        }
        e->type = TY_STRING;
        break;
    case EX_CALL:
        jt_sema_call(prog, e);
        break;
    case EX_ARRAY: {
        if (e->arr.n == 0) {
            e->type = TY_ARR_EMPTY;
            break;
        }
        JtType t = TY_VOID;
        for (size_t i = 0; i < e->arr.n; i++) {
            JtExpr *x = e->arr.items[i];
            jt_sema_expr(prog, x);
            if (x->type == TY_VOID || x->type >= TY_ARR_INT)
                jt_error_at(prog->file, x->line, x->col, "elemento de array nao pode ser %s", jt_type_name(x->type));
            if (i == 0) t = x->type;
            else if (x->type != t)
                jt_error_at(prog->file, x->line, x->col, "elementos do array devem ter o mesmo tipo: %s e %s",
                            jt_type_name(t), jt_type_name(x->type));
        }
        e->type = jt_array_of(t);
        break;
    }
    case EX_INDEX:
        jt_sema_expr(prog, e->idx.base);
        jt_sema_expr(prog, e->idx.index);
        if (e->idx.base->type == TY_ARR_EMPTY) jt_sema_unknown_elems(prog, e->idx.base);
        if (!jt_is_array(e->idx.base->type))
            jt_error_at(prog->file, e->line, e->col, "indexacao espera array, recebeu %s", jt_type_name(e->idx.base->type));
        if (e->idx.index->type != TY_INT)
            jt_error_at(prog->file, e->idx.index->line, e->idx.index->col, "indice deve ser int, recebeu %s",
                        jt_type_name(e->idx.index->type));
        e->type = jt_elem_type(e->idx.base->type);
        break;
    case EX_CONV: {
        JtExpr *x = e->conv.x;
        jt_sema_expr(prog, x);
        bool ok = e->conv.to == TY_INT ? (x->type == TY_INT || x->type == TY_DOUBLE || x->type == TY_CHAR)
                                       : (x->type == TY_INT || x->type == TY_DOUBLE);
        if (!ok)
            jt_error_at(prog->file, e->line, e->col, "%s() nao converte %s", jt_type_name(e->conv.to),
                        jt_type_name(x->type));
        e->type = e->conv.to;
        break;
    }
    case EX_FILL:  /* criado pelo proprio sema a partir de [v] * n; ja verificado */
    case EX_FNREF: /* criado pelo proprio sema (argumento de funcao) */
        break;
    case EX_LEN:
        jt_sema_expr(prog, e->len);
        if (!jt_is_array(e->len->type) && e->len->type != TY_STRING && e->len->type != TY_ARR_EMPTY)
            jt_error_at(prog->file, e->line, e->col, "len espera array ou string, recebeu %s", jt_type_name(e->len->type));
        e->type = TY_INT;
        if (e->len->kind == EX_STRING) {
            /* len("literal") e constante; tambem evita "literal".size() no C++ */
            size_t n = e->len->str.len;
            char *lexeme = jt_xmalloc(24);
            e->kind = EX_INT;
            e->i.value = (int32_t)n;
            e->i.lexeme_len = (size_t)snprintf(lexeme, 24, "%zu", n);
            e->i.lexeme = lexeme;
        }
        break;
    case EX_UNARY: {
        JtExpr *x = e->un.x;
        jt_sema_expr(prog, x);
        if (e->un.op == OPU_NEG && x->type != TY_INT && x->type != TY_DOUBLE)
            jt_error_at(prog->file, e->line, e->col, "operador '-' nao se aplica a %s", jt_type_name(x->type));
        if (e->un.op == OPU_NOT && x->type != TY_BOOL)
            jt_error_at(prog->file, e->line, e->col, "operador 'not' espera bool, recebeu %s", jt_type_name(x->type));
        e->type = x->type;
        break;
    }
    case EX_BINARY: {
        JtExpr *l = e->bin.l, *r = e->bin.r;
        jt_sema_expr(prog, l);
        jt_sema_expr(prog, r);
        const char *op = jt_binop_name[e->bin.op];
        JtType t = l->type;

        /* [valor] * tamanho: array com tamanho elementos iguais a valor */
        if (e->bin.op == OPB_MUL && l->kind == EX_ARRAY) {
            if (l->arr.n != 1)
                jt_error_at(prog->file, e->line, e->col, "use [valor] * tamanho, com um unico elemento");
            if (r->type != TY_INT)
                jt_error_at(prog->file, r->line, r->col, "tamanho do array deve ser int, recebeu %s", jt_type_name(r->type));
            JtExpr *value = l->arr.items[0];
            e->kind = EX_FILL;
            e->type = t;
            e->fill.value = value;
            e->fill.count = r;
            break;
        }
        if (t != r->type)
            jt_error_at(prog->file, e->line, e->col, "tipos incompativeis em '%s': %s e %s",
                        op, jt_type_name(t), jt_type_name(r->type));
        if (t == TY_VOID || t >= TY_ARR_INT)
            jt_error_at(prog->file, e->line, e->col, "operador '%s' nao se aplica a %s", op, jt_type_name(t));

        bool num = t == TY_INT || t == TY_DOUBLE, ok = false;
        switch (e->bin.op) {
        case OPB_ADD: ok = num || t == TY_STRING; e->type = t; break;
        case OPB_SUB:
        case OPB_MUL:
        case OPB_DIV: ok = num; e->type = t; break;
        case OPB_MOD: ok = t == TY_INT; e->type = t; break;
        case OPB_EQ:
        case OPB_NE:  ok = true; e->type = TY_BOOL; break;
        case OPB_LT:
        case OPB_LE:
        case OPB_GT:
        case OPB_GE:  ok = num || t == TY_CHAR; e->type = TY_BOOL; break;
        case OPB_AND:
        case OPB_OR:  ok = t == TY_BOOL; e->type = TY_BOOL; break;
        }
        if (!ok)
            jt_error_at(prog->file, e->line, e->col, "operador '%s' nao se aplica a %s", op, jt_type_name(t));

        /* Literal com literal de string e resolvido aqui: evita ponteiro + ponteiro
           e comparacao de ponteiros no C++ gerado. */
        if (t == TY_STRING && l->kind == EX_STRING && r->kind == EX_STRING) {
            if (e->bin.op == OPB_ADD) {
                char *s = jt_xmalloc(l->str.len + r->str.len + 1);
                memcpy(s, l->str.data, l->str.len);
                memcpy(s + l->str.len, r->str.data, r->str.len);
                s[l->str.len + r->str.len] = '\0';
                e->multiline = l->multiline || r->multiline;
                e->kind = EX_STRING;
                e->str.data = s;
                e->str.len = l->str.len + r->str.len;
            } else {
                bool eq = l->str.len == r->str.len && memcmp(l->str.data, r->str.data, l->str.len) == 0;
                e->kind = EX_BOOL;
                e->b = e->bin.op == OPB_EQ ? eq : !eq;
            }
        }
        break;
    }
    }
}

static void jt_sema_block(JtProgram *prog, JtBlock *b, int loops, int fi);

static void jt_sema_int_arg(JtProgram *prog, JtExpr *e) {
    jt_sema_expr(prog, e);
    if (e->type != TY_INT)
        jt_error_at(prog->file, e->line, e->col, "range espera int, recebeu %s", jt_type_name(e->type));
}

static void jt_sema_cond(JtProgram *prog, JtExpr *c) {
    jt_sema_expr(prog, c);
    if (c->type != TY_BOOL)
        jt_error_at(prog->file, c->line, c->col, "condicao deve ser bool, recebeu %s", jt_type_name(c->type));
}

/* Declara uma variavel no escopo atual (sem sombreamento). */
static int jt_sema_declare(JtProgram *prog, const JtStmt *s, JtType type) {
    if (jt_sema_lookup(prog, s->name, s->name_len) >= 0)
        jt_error_at(prog->file, s->line, s->col, "variavel '%.*s' ja declarada", (int)s->name_len, s->name);
    if (jt_sema_find_func(prog, s->name, s->name_len, prog->cur_module) >= 0)
        jt_error_at(prog->file, s->line, s->col, "'%.*s' ja e o nome de uma funcao", (int)s->name_len, s->name);
    if (jt_sema_is_module(prog, s->name, s->name_len))
        jt_error_at(prog->file, s->line, s->col, "'%.*s' ja e o nome de uma biblioteca", (int)s->name_len, s->name);
    JtVarInfo v = { s->name, s->name_len, type, 0, true, RO_NONE, false, -1, false, prog->cur_fn, NULL };
    jt_vec_push(&prog->vars, v);
    return (int)prog->vars.len - 1;
}

static void jt_sema_check_writable(JtProgram *prog, const JtStmt *s, int var) {
    const JtVarInfo *v = &prog->vars.items[var];
    const char *what = v->readonly == RO_CONST ? "constante '%.*s' nao pode ser alterada"
                     : v->readonly == RO_LOOP  ? "variavel de laco '%.*s' e somente leitura"
                     : v->readonly == RO_PARAM ? "parametro '%.*s' e somente leitura"
                     : NULL;
    if (what) jt_error_at(prog->file, s->line, s->col, what, (int)v->name_len, v->name);
}

/* nome[i] = v e nome.append(v): o alvo precisa ser um array alteravel */
static void jt_sema_array_target(JtProgram *prog, JtStmt *s) {
    s->target = jt_sema_resolve(prog, s->name, s->name_len, s->line, s->col);
    JtType t = prog->vars.items[s->target].type;
    if (!jt_is_array(t) && t != TY_ARR_EMPTY)
        jt_error_at(prog->file, s->line, s->col, "'%.*s' nao e um array (%s)", (int)s->name_len, s->name, jt_type_name(t));
    jt_sema_check_writable(prog, s, s->target);
    jt_sema_expr(prog, s->init);
    if (t == TY_ARR_EMPTY) {
        /* lista criada com []: o primeiro elemento define o tipo */
        JtType el = s->init->type;
        if (el == TY_VOID || el == TY_FN || el == TY_AUTO || el >= TY_ARR_INT)
            jt_error_at(prog->file, s->init->line, s->init->col, "elemento de array nao pode ser %s", jt_type_name(el));
        t = jt_array_of(el);
        jt_sema_fix_array(prog, s->target, t);
    }
    if (s->init->type != jt_elem_type(t))
        jt_error_at(prog->file, s->init->line, s->init->col, "esperado %s, recebeu %s",
                    jt_type_name(jt_elem_type(t)), jt_type_name(s->init->type));
}

/* nome = expr / const nome = expr / global nome = expr: tipo deduzido do valor */
static void jt_sema_infer_var(JtProgram *prog, JtStmt *s) {
    jt_sema_expr(prog, s->init);
    jt_sema_check_value(prog, s->init, "a variavel", s->name, s->name_len);
    JtType t = s->init->type;
    if (t == TY_ARR_EMPTY && s->is_const)
        jt_error_at(prog->file, s->init->line, s->init->col, "constante '%.*s' nao pode ser uma lista vazia sem tipo",
                    (int)s->name_len, s->name);
    s->type = t;
    if (s->is_global)
        for (size_t i = 0; i < prog->vars.len; i++) {
            const JtVarInfo *g = &prog->vars.items[i];
            if (g->is_global && g->name_len == s->name_len && memcmp(g->name, s->name, s->name_len) == 0)
                jt_error_at(prog->file, s->line, s->col, "variavel '%.*s' ja declarada", (int)s->name_len, s->name);
        }
    s->var = jt_sema_declare(prog, s, t);
    JtVarInfo *v = &prog->vars.items[s->var];
    v->decl = s;
    if (s->is_const) v->readonly = RO_CONST;
    if (s->is_global) {
        v->is_global = true;
        v->owner = -1;
        s->static_init = jt_expr_is_const(s->init);
        if (s->is_const && !s->static_init)
            jt_error_at(prog->file, s->init->line, s->init->col,
                        "global const precisa de um valor constante (sem variaveis nem chamadas)");
    } else if (!s->is_const && prog->sema_depth > 0) {
        v->hoisted = true; /* criada num bloco aninhado: vale ate o fim da funcao */
    }
}

/* fi: funcao atual (indice), ou -1 no nivel principal */
static void jt_sema_return(JtProgram *prog, JtStmt *s, int fi) {
    if (fi < 0) jt_error_at(prog->file, s->line, s->col, "'return' fora de uma funcao");
    JtType ret = prog->funcs.items[fi].ret;
    if (ret == TY_AUTO) {
        /* primeiro return da funcao com retorno deduzido: ele define o tipo */
        if (s->init) {
            jt_sema_expr(prog, s->init);
            if (s->init->type == TY_ARR_EMPTY) jt_sema_unknown_elems(prog, s->init);
            if (s->init->type == TY_VOID)
                jt_error_at(prog->file, s->init->line, s->init->col, "a expressao do return nao devolve valor");
            if (s->init->type == TY_FN)
                jt_error_at(prog->file, s->init->line, s->init->col, "funcao nao pode retornar valor de funcao");
        }
        prog->funcs.items[fi].ret = s->init ? s->init->type : TY_VOID;
        return;
    }
    const JtFunc *fn = &prog->funcs.items[fi];
    if (ret == TY_VOID) {
        if (s->init)
            jt_error_at(prog->file, s->line, s->col, "funcao void '%.*s' nao retorna valor",
                        (int)fn->name_len, fn->name);
        return;
    }
    if (!s->init)
        jt_error_at(prog->file, s->line, s->col, "'%.*s' deve retornar %s",
                    (int)fn->name_len, fn->name, jt_type_name(ret));
    jt_sema_expr_as(prog, s->init, ret);
    fn = &prog->funcs.items[fi];
    if (s->init->type != ret)
        jt_error_at(prog->file, s->init->line, s->init->col, "'%.*s' deve retornar %s, recebeu %s",
                    (int)fn->name_len, fn->name, jt_type_name(ret), jt_type_name(s->init->type));
}

/* loops: quantos lacos envolvem a instrucao (para break/continue).
   fi: funcao atual, ou -1 no nivel principal. */
static void jt_sema_stmt(JtProgram *prog, JtStmt *s, int loops, int fi) {
    switch (s->kind) {
    case ST_CALL:
        jt_sema_expr(prog, s->arg);
        if (s->arg->type != TY_STRING)
            jt_error_at(prog->file, s->arg->line, s->arg->col, "%s espera string, recebeu %s",
                        s->fn == BI_PRINT ? "print" : "println", jt_type_name(s->arg->type));
        break;
    case ST_ASSIGN: {
        int var = jt_sema_lookup(prog, s->name, s->name_len);
        if (var < 0) {
            /* nome novo: a atribuicao declara a variavel, com o tipo do valor */
            s->kind = ST_VAR;
            s->infer = true;
            jt_sema_infer_var(prog, s);
            break;
        }
        s->var = var;
        s->type = prog->vars.items[var].type;
        jt_sema_check_writable(prog, s, var);
        jt_sema_expr_as(prog, s->init, s->type);
        if (s->type == TY_ARR_EMPTY && jt_is_array(s->init->type)) {
            jt_sema_fix_array(prog, s->var, s->init->type); /* lista = [] ... lista = [1, 2] */
            s->type = s->init->type;
        }
        if (s->init->type != s->type)
            jt_error_at(prog->file, s->init->line, s->init->col, "'%.*s' e %s, recebeu %s",
                        (int)s->name_len, s->name, jt_type_name(s->type), jt_type_name(s->init->type));
        break;
    }
    case ST_VAR: {
        if (s->infer) {
            jt_sema_infer_var(prog, s);
            break;
        }
        jt_sema_expr_as(prog, s->init, s->type);
        if (s->init->type != s->type)
            jt_error_at(prog->file, s->init->line, s->init->col, "esperado %s, recebeu %s",
                        jt_type_name(s->type), jt_type_name(s->init->type));
        if (s->is_global) {
            /* ja declarada na pre-passagem (para as funcoes); aqui passa a valer no nivel principal */
            if (jt_sema_lookup(prog, s->name, s->name_len) >= 0)
                jt_error_at(prog->file, s->line, s->col, "variavel '%.*s' ja declarada", (int)s->name_len, s->name);
            s->static_init = jt_expr_is_const(s->init);
            if (s->is_const && !s->static_init)
                jt_error_at(prog->file, s->init->line, s->init->col,
                            "global const precisa de um valor constante (sem variaveis nem chamadas)");
            prog->vars.items[s->var].in_scope = true;
            break;
        }
        s->var = jt_sema_declare(prog, s, s->type);
        if (s->is_const) prog->vars.items[s->var].readonly = RO_CONST;
        break;
    }
    case ST_IF:
        for (size_t i = 0; i < s->nbranches; i++) {
            jt_sema_cond(prog, s->conds[i]);
            jt_sema_block(prog, &s->blocks[i], loops, fi);
        }
        if (s->has_else) jt_sema_block(prog, &s->else_block, loops, fi);
        break;
    case ST_WHILE:
        jt_sema_cond(prog, s->cond);
        jt_sema_block(prog, &s->body, loops + 1, fi);
        break;
    case ST_FOR: {
        /* inicio e fim sao avaliados antes de a variavel do laco existir */
        jt_sema_int_arg(prog, s->start);
        jt_sema_int_arg(prog, s->end);
        s->type = TY_INT;
        s->var = jt_sema_declare(prog, s, TY_INT);
        prog->vars.items[s->var].readonly = RO_LOOP;
        jt_sema_block(prog, &s->body, loops + 1, fi);
        prog->vars.items[s->var].in_scope = false;
        break;
    }
    case ST_BREAK:
    case ST_CONTINUE:
        if (loops == 0)
            jt_error_at(prog->file, s->line, s->col, "'%s' fora de um laco", s->kind == ST_BREAK ? "break" : "continue");
        break;
    case ST_EXPR:
        jt_sema_expr(prog, s->init);
        break;
    case ST_INDEX_SET:
        jt_sema_expr(prog, s->index);
        if (s->index->type != TY_INT)
            jt_error_at(prog->file, s->index->line, s->index->col, "indice deve ser int, recebeu %s",
                        jt_type_name(s->index->type));
        jt_sema_array_target(prog, s);
        break;
    case ST_APPEND:
        jt_sema_array_target(prog, s);
        break;
    case ST_FOREACH: {
        jt_sema_expr(prog, s->iter);
        if (s->iter->type == TY_ARR_EMPTY) jt_sema_unknown_elems(prog, s->iter);
        if (!jt_is_array(s->iter->type))
            jt_error_at(prog->file, s->iter->line, s->iter->col, "for ... in espera array, recebeu %s",
                        jt_type_name(s->iter->type));
        s->type = jt_elem_type(s->iter->type);
        s->var = jt_sema_declare(prog, s, s->type);
        prog->vars.items[s->var].readonly = RO_LOOP;
        jt_sema_block(prog, &s->body, loops + 1, fi);
        prog->vars.items[s->var].in_scope = false;
        /* no C++ o for percorre o proprio vetor: altera-lo no corpo seria indefinido */
        if (s->iter->kind == EX_VAR && jt_block_writes_read_of(&s->body, s->iter))
            jt_error_at(prog->file, s->line, s->col, "array '%.*s' nao pode ser alterado dentro do for que o percorre",
                        (int)s->iter->var.name_len, s->iter->var.name);
        break;
    }
    case ST_RETURN:
        jt_sema_return(prog, s, fi);
        break;
    }
}

/* Algum break no bloco sai do laco que o contem? (breaks de lacos internos nao contam) */
static bool jt_block_breaks(const JtBlock *b) {
    for (size_t i = 0; i < b->len; i++) {
        const JtStmt *s = &b->items[i];
        if (s->kind == ST_BREAK) return true;
        if (s->kind == ST_IF) {
            for (size_t j = 0; j < s->nbranches; j++)
                if (jt_block_breaks(&s->blocks[j])) return true;
            if (s->has_else && jt_block_breaks(&s->else_block)) return true;
        }
    }
    return false;
}

/* O bloco nunca termina sem return? Contam: return, if/elif/else com return em
   todos os ramos, e "while true" sem break (so sai por return). */
static bool jt_block_returns(const JtBlock *b) {
    for (size_t i = 0; i < b->len; i++) {
        const JtStmt *s = &b->items[i];
        if (s->kind == ST_RETURN) return true;
        if (s->kind == ST_WHILE && s->cond->kind == EX_BOOL && s->cond->b && !jt_block_breaks(&s->body))
            return true;
        if (s->kind == ST_IF && s->has_else) {
            bool all = jt_block_returns(&s->else_block);
            for (size_t j = 0; all && j < s->nbranches; j++) all = jt_block_returns(&s->blocks[j]);
            if (all) return true;
        }
    }
    return false;
}

/* A variavel sai de escopo: uma lista [] que nunca recebeu tipo e um erro. */
static void jt_sema_leave_var(JtProgram *prog, int var) {
    JtVarInfo *v = &prog->vars.items[var];
    if (v->in_scope && v->type == TY_ARR_EMPTY) {
        const JtStmt *d = v->decl;
        jt_error_at(prog->file, d ? d->line : 1, d ? d->col : 1,
                    "nao foi possivel deduzir o tipo dos elementos de '%.*s' (declare o tipo: int[] %.*s = [])",
                    (int)v->name_len, v->name, (int)v->name_len, v->name);
    }
    v->in_scope = false;
}

/* Bloco aninhado: variaveis declaradas nele saem de escopo ao final, menos as
   criadas por atribuicao (x = 10), que valem ate o fim da funcao. */
static void jt_sema_block(JtProgram *prog, JtBlock *b, int loops, int fi) {
    size_t mark = prog->vars.len;
    prog->sema_depth++;
    for (size_t i = 0; i < b->len; i++) jt_sema_stmt(prog, &b->items[i], loops, fi);
    prog->sema_depth--;
    for (size_t i = mark; i < prog->vars.len; i++)
        if (!prog->vars.items[i].hoisted) jt_sema_leave_var(prog, (int)i);
}

/*
 * Funcoes enxergam so os proprios parametros e variaveis locais (como no C++,
 * onde o nivel principal vira o main). Todas as assinaturas sao conhecidas antes
 * dos corpos, entao a ordem de declaracao nao importa e recursao funciona.
 */
/* Globais: declaradas antes de verificar as funcoes, que as enxergam em qualquer ponto. */
static void jt_sema_globals_visible(JtProgram *prog, bool visible) {
    for (size_t i = 0; i < prog->vars.len; i++)
        if (prog->vars.items[i].is_global) prog->vars.items[i].in_scope = visible;
}

/*
 * Verifica o corpo da funcao fi. Pode ser chamada no meio da verificacao de
 * outra funcao (instancia pedida por uma chamada): o escopo de quem chamou e
 * guardado e restaurado.
 */
static void jt_sema_func_body(JtProgram *prog, int fi) {
    const char *file = prog->file;
    int module = prog->cur_module, cur_fn = prog->cur_fn, depth = prog->sema_depth;
    JT_VEC(int) saved = {0};
    for (size_t i = 0; i < prog->vars.len; i++) {
        if (!prog->vars.items[i].in_scope) continue;
        jt_vec_push(&saved, (int)i);
        prog->vars.items[i].in_scope = false;
    }

    prog->funcs.items[fi].checked = true;
    prog->file = prog->funcs.items[fi].file;
    prog->cur_module = prog->funcs.items[fi].module;
    prog->cur_fn = fi;
    prog->sema_depth = 0;
    jt_sema_globals_visible(prog, prog->cur_module < 0); /* bibliotecas nao veem as globais do programa */
    size_t np = prog->funcs.items[fi].params.len;
    for (size_t j = 0; j < np; j++) prog->vars.items[prog->funcs.items[fi].params.items[j]].in_scope = true;

    size_t mark = prog->vars.len;
    JtBlock *body = &prog->funcs.items[fi].body;
    JtBlock copy = *body; /* o vetor de funcoes pode mudar de lugar; os itens do corpo nao */
    for (size_t i = 0; i < copy.len; i++) jt_sema_stmt(prog, &copy.items[i], 0, fi);
    for (size_t i = mark; i < prog->vars.len; i++) jt_sema_leave_var(prog, (int)i);

    JtFunc *f = &prog->funcs.items[fi];
    for (size_t j = 0; j < f->params.len; j++) prog->vars.items[f->params.items[j]].in_scope = false;
    if (f->ret == TY_AUTO) f->ret = TY_VOID; /* nenhum return com valor */
    if (f->ret != TY_VOID && !jt_block_returns(&f->body))
        jt_error_at(prog->file, f->line, f->col, "funcao '%.*s' pode terminar sem 'return'",
                    (int)f->name_len, f->name);

    jt_sema_globals_visible(prog, false);
    for (size_t i = 0; i < saved.len; i++) prog->vars.items[saved.items[i]].in_scope = true;
    free(saved.items);
    prog->file = file;
    prog->cur_module = module;
    prog->cur_fn = cur_fn;
    prog->sema_depth = depth;
}

static void jt_sema(JtProgram *prog) {
    const char *main_file = prog->file;
    prog->cur_fn = -1;

    /* globais com tipo escrito: conhecidas pelas funcoes desde o inicio */
    for (size_t i = 0; i < prog->body.len; i++) {
        JtStmt *s = &prog->body.items[i];
        if (s->kind != ST_VAR || !s->is_global || s->infer) continue;
        s->var = jt_sema_declare(prog, s, s->type);
        prog->vars.items[s->var].is_global = true;
        prog->vars.items[s->var].owner = -1;
        if (s->is_const) prog->vars.items[s->var].readonly = RO_CONST;
    }
    jt_sema_globals_visible(prog, false);

    size_t nfuncs = prog->funcs.len;
    for (size_t i = 0; i < nfuncs; i++) {
        const JtFunc *f = &prog->funcs.items[i];
        prog->file = f->file;
        if (jt_sema_find_func(prog, f->name, f->name_len, f->module) != (int)i)
            jt_error_at(prog->file, f->line, f->col, "funcao '%.*s' ja declarada", (int)f->name_len, f->name);
        if (f->is_extern && jt_is_array(f->ret))
            jt_error_at(prog->file, f->line, f->col, "funcao extern ainda nao pode retornar array");
        for (size_t j = 0; j < f->params.len; j++) {
            const JtVarInfo *pj = &prog->vars.items[f->params.items[j]];
            if (jt_sema_find_func(prog, pj->name, pj->name_len, f->module) >= 0)
                jt_error_at(prog->file, f->line, f->col, "parametro '%.*s' tem o nome de uma funcao",
                            (int)pj->name_len, pj->name);
            if (f->is_extern && pj->type == TY_FN) {
                const JtSig *sig = &prog->sigs.items[pj->sig];
                bool bad = jt_is_array(sig->ret);
                for (uint32_t k = 0; k < sig->n; k++) bad = bad || jt_is_array(sig->params[k]);
                if (bad)
                    jt_error_at(prog->file, f->line, f->col, "callback de funcao extern ainda nao aceita array ('%.*s')",
                                (int)pj->name_len, pj->name);
            }
            if (f->is_extern && jt_is_array(pj->type))
                jt_error_at(prog->file, f->line, f->col, "funcao extern ainda nao aceita array ('%.*s')",
                            (int)pj->name_len, pj->name);
            for (size_t k = 0; k < j; k++) {
                const JtVarInfo *pk = &prog->vars.items[f->params.items[k]];
                if (pk->name_len == pj->name_len && memcmp(pk->name, pj->name, pj->name_len) == 0)
                    jt_error_at(prog->file, f->line, f->col, "parametro '%.*s' repetido",
                                (int)pj->name_len, pj->name);
            }
        }
    }

    /* nivel principal primeiro: as globais sem tipo escrito recebem o tipo aqui, antes
       de as funcoes que as usam serem verificadas; cada global vale a partir da declaracao */
    prog->file = main_file;
    prog->cur_module = -1;
    prog->sema_depth = 0;
    for (size_t i = 0; i < prog->body.len; i++) jt_sema_stmt(prog, &prog->body.items[i], 0, -1);

    /* corpos das funcoes com tipos escritos; cada funcao enxerga as funcoes do proprio
       arquivo (modulo). Modelos sem parametro sem tipo (fn f() / fn f(int x)) tem uma
       unica instancia possivel: verificada mesmo que ninguem a chame. */
    for (size_t i = 0; i < nfuncs; i++) {
        const JtFunc *f = &prog->funcs.items[i];
        if (f->is_extern || f->checked) continue;
        if (!f->is_template) {
            jt_sema_func_body(prog, (int)i);
        } else if (!f->is_generic && f->instances.len == 0) {
            JtType types[64];
            size_t np = f->params.len < 64 ? f->params.len : 64;
            for (size_t k = 0; k < np; k++) types[k] = prog->vars.items[f->params.items[k]].type;
            jt_sema_instance(prog, (int)i, types, 0, 0);
        }
    }

    /* globais e variaveis do nivel principal criadas com [] e nunca usadas com tipo */
    prog->file = main_file;
    for (size_t i = 0; i < prog->vars.len; i++)
        if (prog->vars.items[i].type == TY_ARR_EMPTY && prog->vars.items[i].owner < 0 && prog->vars.items[i].decl) {
            prog->vars.items[i].in_scope = true;
            jt_sema_leave_var(prog, (int)i);
        }
    jt_compute_effects(prog);
}

#endif
