#ifndef JT_AST_H
#define JT_AST_H

#include "common.h"

typedef enum {
    TY_INT,
    TY_DOUBLE,
    TY_STRING,
    TY_CHAR,
    TY_BOOL,
    TY_VOID, /* so como retorno de funcao */
    /* arrays: TY_ARR_INT + tipo do elemento (so um nivel) */
    TY_ARR_INT,
    TY_ARR_DOUBLE,
    TY_ARR_STRING,
    TY_ARR_CHAR,
    TY_ARR_BOOL,
    TY_ARR_EMPTY, /* literal [] antes de o contexto definir o tipo */
    TY_FN,        /* valor de funcao (so em parametros); a assinatura fica em JtVarInfo.sig */
    TY_AUTO,      /* sem tipo escrito: parametro sem tipo (fn), ou retorno ainda nao deduzido */
} JtType;

static bool jt_is_array(JtType t) { return t >= TY_ARR_INT && t <= TY_ARR_BOOL; }
static JtType jt_array_of(JtType elem) { return (JtType)(TY_ARR_INT + elem); }
static JtType jt_elem_type(JtType arr) { return (JtType)(arr - TY_ARR_INT); }

static const char *jt_type_name(JtType t) {
    switch (t) {
    case TY_INT:        return "int";
    case TY_DOUBLE:     return "double";
    case TY_STRING:     return "string";
    case TY_CHAR:       return "char";
    case TY_BOOL:       return "bool";
    case TY_VOID:       return "void";
    case TY_ARR_INT:    return "int[]";
    case TY_ARR_DOUBLE: return "double[]";
    case TY_ARR_STRING: return "string[]";
    case TY_ARR_CHAR:   return "char[]";
    case TY_ARR_BOOL:   return "bool[]";
    case TY_ARR_EMPTY:  return "[]";
    case TY_FN:         return "funcao";
    case TY_AUTO:       return "(sem tipo)";
    }
    return "?";
}

typedef enum {
    EX_INT,
    EX_DOUBLE,
    EX_STRING,
    EX_CHAR,
    EX_BOOL,
    EX_VAR,
    EX_UNARY,
    EX_BINARY,
    EX_INTERP, /* string com {expressao} */
    EX_CALL,   /* funcao(args) */
    EX_ARRAY,  /* [a, b, c] */
    EX_INDEX,  /* base[indice] */
    EX_LEN,    /* len(x) */
    EX_FILL,   /* [valor] * tamanho */
    EX_FNREF,  /* nome de funcao usado como valor (argumento para parametro de funcao) */
    EX_CONV,   /* int(x) / double(x): conversao explicita */
} JtExprKind;

typedef enum {
    OPB_ADD,
    OPB_SUB,
    OPB_MUL,
    OPB_DIV,
    OPB_MOD,
    OPB_EQ,
    OPB_NE,
    OPB_LT,
    OPB_LE,
    OPB_GT,
    OPB_GE,
    OPB_AND,
    OPB_OR,
} JtBinOp;

static const char *const jt_binop_name[] = {
    [OPB_ADD] = "+",  [OPB_SUB] = "-",  [OPB_MUL] = "*", [OPB_DIV] = "/",  [OPB_MOD] = "%",
    [OPB_EQ] = "==",  [OPB_NE] = "!=",  [OPB_LT] = "<",  [OPB_LE] = "<=", [OPB_GT] = ">",
    [OPB_GE] = ">=",  [OPB_AND] = "and", [OPB_OR] = "or",
};

typedef enum {
    OPU_NEG,
    OPU_NOT,
} JtUnOp;

typedef struct JtExpr JtExpr;

typedef struct {
    const char *text; /* texto literal (quando expr e NULL) */
    size_t len;
    JtExpr *expr;     /* {expr} interpolada, ou NULL */
} JtInterpPart;
struct JtExpr {
    JtExprKind kind;
    JtType type; /* preenchido pelo sema */
    bool multiline; /* EX_STRING/EX_INTERP vindo de """...""": o C++ usa raw string literal */
    int line, col;
    union {
        struct { int32_t value; const char *lexeme; size_t lexeme_len; } i;
        struct { double value; const char *lexeme; size_t lexeme_len; } d;
        struct { char *data; size_t len; } str;
        char ch;
        bool b;
        struct { const char *name; size_t name_len; int index; } var;
        struct { JtUnOp op; JtExpr *x; } un;
        struct { JtBinOp op; JtExpr *l, *r; } bin;
        struct { JtInterpPart *parts; size_t n; } interp;
        /* qual: modulo de "modulo.nome(...)", ou -1 (funcao do proprio arquivo) */
        /* fnvar: chamada atraves de um parametro com valor de funcao (fn = -1) */
        struct { const char *name; size_t name_len; int fn; int qual; int fnvar; JtExpr **args; size_t nargs; } call;
        int fnref; /* EX_FNREF: indice da funcao */
        struct { JtType to; JtExpr *x; } conv;
        struct { JtExpr **items; size_t n; } arr;
        struct { JtExpr *base, *index; } idx;
        JtExpr *len;
        struct { JtExpr *value, *count; } fill;
    };
};

/* Funcoes nativas, resolvidas em tempo de compilacao pelos dois backends. */
typedef enum {
    BI_PRINT,
    BI_PRINTLN,
} JtBuiltin;

typedef enum {
    ST_CALL,
    ST_VAR,    /* [const] tipo nome = expr */
    ST_ASSIGN, /* nome = expr */
    ST_IF,     /* if / elif / else */
    ST_WHILE,  /* while cond */
    ST_FOR,    /* for nome in range(inicio, fim, passo) */
    ST_BREAK,
    ST_CONTINUE,
    ST_RETURN, /* return [expr]; expr em init (NULL em funcao void) */
    ST_EXPR,   /* chamada de funcao como instrucao; expr em init */
    ST_INDEX_SET, /* nome[index] = init */
    ST_APPEND,    /* nome.append(init) */
    ST_FOREACH,   /* for nome in iter */
} JtStmtKind;

typedef struct JtStmt JtStmt;
typedef JT_VEC(JtStmt) JtBlock;

struct JtStmt {
    JtStmtKind kind;
    int line, col;
    /* ST_CALL */
    JtBuiltin fn;
    JtExpr *arg;
    /* ST_VAR / ST_ASSIGN */
    JtType type;
    const char *name;
    size_t name_len;
    int var;      /* indice em JtProgram.vars */
    JtExpr *init;
    bool is_const; /* ST_VAR declarada com const */
    bool is_global;   /* ST_VAR com global: visivel nas funcoes do arquivo principal */
    bool static_init; /* global com valor constante: inicializada antes de tudo */
    bool infer;       /* ST_VAR sem tipo escrito (x = 10, const x = 10): tipo deduzido do valor */
    /* ST_IF: conds[i] -> blocks[i] (if e cada elif); else_block se has_else */
    JtExpr **conds;
    JtBlock *blocks;
    size_t nbranches;
    bool has_else;
    JtBlock else_block;
    /* ST_WHILE: cond + body. ST_FOR: variavel em name/var, start/end/step + body */
    JtExpr *cond;
    JtExpr *start, *end;
    int32_t step;     /* constante, diferente de zero */
    JtBlock body;
    /* ST_INDEX_SET: nome/var + index + init. ST_FOREACH: variavel em name/var, iter + body */
    JtExpr *index;
    JtExpr *iter;
    int target;       /* ST_INDEX_SET / ST_APPEND: variavel do array alterado */
};

typedef enum {
    RO_NONE,
    RO_CONST, /* declarada com const */
    RO_LOOP,  /* variavel de laco for */
    RO_PARAM, /* parametro de funcao */
} JtReadonly;

typedef struct {
    const char *name;
    size_t name_len;
    JtType type;
    uint32_t reg; /* registrador na VM (banco de strings ou de valores) */
    bool in_scope; /* usado pelo sema: visivel no ponto atual */
    JtReadonly readonly;
    bool is_global;
    int sig;           /* TY_FN: indice em JtProgram.sigs */
    /* Variavel criada por atribuicao (x = 10) dentro de um bloco aninhado: como no
       Python, vale ate o fim da funcao (ou do programa principal), nao so do bloco.
       Os backends a declaram no inicio da funcao, com valor zero. */
    bool hoisted;
    int owner;         /* funcao dona (indice em JtProgram.funcs), ou -1 (nivel principal) */
    JtStmt *decl;      /* ST_VAR que a declarou (lista [] vazia: recebe o tipo quando descoberto) */
} JtVarInfo;

/* assinatura de um valor de funcao: void(int, string) */
typedef struct {
    JtType ret;
    uint32_t n;
    JtType params[16];
} JtSig;

typedef struct {
    const char *name;
    size_t name_len;
    JtType ret;
    int line, col;
    JT_VEC(int) params; /* indices em JtProgram.vars */
    JtBlock body;
    int module;         /* indice em JtProgram.modules, ou -1 (programa principal) */
    bool is_extern;     /* implementada em C++ no <modulo>.hpp da biblioteca */
    const char *file;   /* arquivo .jat onde foi declarada */
    bool has_effect;    /* pode mudar globais, escrever na saida ou chamar codigo desconhecido
                           (extern, valor de funcao); calculado por jt_compute_effects */
    /* Tipagem automatica. Funcao com parametro sem tipo ou declarada com "fn"
       (retorno deduzido) e um modelo: o corpo nao e verificado nem compilado.
       Cada combinacao de tipos dos argumentos gera uma instancia (como um
       template do C++), com o corpo copiado e verificado com tipos concretos. */
    bool is_template;
    bool is_generic;    /* modelo com parametro sem tipo (o C++ da nome distinto a cada instancia) */
    int template_of;    /* instancia: indice do modelo; -1 nas demais */
    JT_VEC(int) instances; /* modelo: instancias ja criadas */
    bool checked;       /* corpo ja verificado pelo sema */
} JtFunc;

/* Biblioteca carregada por "import nome": pasta library/<nome>/ com <nome>.jat
   e, se tiver funcoes extern, <nome>.hpp. */
typedef struct {
    const char *name;
    size_t name_len;
    char *dir;
    char *jat_path;
    char *hpp_path;     /* NULL se a biblioteca nao tem .hpp */
    char *flags;        /* conteudo de <nome>.flags (opcoes extras do g++, ex.: -lgdi32), ou NULL */
    bool has_extern;
} JtModule;

typedef struct {
    const char *file;       /* arquivo principal (o sema troca temporariamente para mensagens de erro) */
    JtBlock body;           /* instrucoes do nivel principal (viram o main) */
    JT_VEC(JtFunc) funcs;
    JT_VEC(JtVarInfo) vars; /* todas as variaveis e parametros, de qualquer bloco */
    JT_VEC(JtModule) modules;
    JT_VEC(JtSig) sigs;     /* assinaturas dos parametros com valor de funcao */
    const char *lib_root;   /* pasta library/ ao lado do executavel jatai */
    int cur_module;         /* usado pelo sema: modulo da funcao sendo verificada */
    int cur_fn;             /* usado pelo sema: funcao sendo verificada, ou -1 (nivel principal) */
    int sema_depth;         /* usado pelo sema: blocos abertos dentro da funcao atual */
} JtProgram;

static JtExpr *jt_new_expr(JtExprKind kind, int line, int col) {
    JtExpr *e = jt_xmalloc(sizeof *e);
    memset(e, 0, sizeof *e);
    e->kind = kind;
    e->line = line;
    e->col = col;
    return e;
}

static bool jt_expr_reads_var(const JtExpr *e, int var) {
    switch (e->kind) {
    case EX_VAR:    return e->var.index == var;
    case EX_UNARY:  return jt_expr_reads_var(e->un.x, var);
    case EX_BINARY: return jt_expr_reads_var(e->bin.l, var) || jt_expr_reads_var(e->bin.r, var);
    case EX_INTERP:
        for (size_t i = 0; i < e->interp.n; i++)
            if (e->interp.parts[i].expr && jt_expr_reads_var(e->interp.parts[i].expr, var)) return true;
        return false;
    case EX_CALL:
        for (size_t i = 0; i < e->call.nargs; i++)
            if (jt_expr_reads_var(e->call.args[i], var)) return true;
        return false;
    case EX_ARRAY:
        for (size_t i = 0; i < e->arr.n; i++)
            if (jt_expr_reads_var(e->arr.items[i], var)) return true;
        return false;
    case EX_INDEX: return jt_expr_reads_var(e->idx.base, var) || jt_expr_reads_var(e->idx.index, var);
    case EX_LEN:   return jt_expr_reads_var(e->len, var);
    case EX_FILL:  return jt_expr_reads_var(e->fill.value, var) || jt_expr_reads_var(e->fill.count, var);
    case EX_CONV:  return jt_expr_reads_var(e->conv.x, var);
    default: return false;
    }
}

typedef JT_VEC(const JtExpr *) JtExprList;

typedef bool (*JtExprPred)(const JtExpr *e, const void *ctx);

/* pred(e, ctx) vale para e ou alguma subexpressao? */
static bool jt_expr_any(const JtExpr *e, JtExprPred pred, const void *ctx) {
    if (pred(e, ctx)) return true;
    switch (e->kind) {
    case EX_UNARY:  return jt_expr_any(e->un.x, pred, ctx);
    case EX_BINARY: return jt_expr_any(e->bin.l, pred, ctx) || jt_expr_any(e->bin.r, pred, ctx);
    case EX_INDEX:  return jt_expr_any(e->idx.base, pred, ctx) || jt_expr_any(e->idx.index, pred, ctx);
    case EX_LEN:    return jt_expr_any(e->len, pred, ctx);
    case EX_CONV:   return jt_expr_any(e->conv.x, pred, ctx);
    case EX_FILL:   return jt_expr_any(e->fill.value, pred, ctx) || jt_expr_any(e->fill.count, pred, ctx);
    case EX_CALL:
        for (size_t i = 0; i < e->call.nargs; i++)
            if (jt_expr_any(e->call.args[i], pred, ctx)) return true;
        return false;
    case EX_ARRAY:
        for (size_t i = 0; i < e->arr.n; i++)
            if (jt_expr_any(e->arr.items[i], pred, ctx)) return true;
        return false;
    case EX_INTERP:
        for (size_t i = 0; i < e->interp.n; i++)
            if (e->interp.parts[i].expr && jt_expr_any(e->interp.parts[i].expr, pred, ctx)) return true;
        return false;
    default: return false;
    }
}

static bool jt_is_effect_call(const JtExpr *e, const void *ctx) {
    const JtProgram *prog = ctx;
    return e->kind == EX_CALL && (e->call.fnvar >= 0 || prog->funcs.items[e->call.fn].has_effect);
}

/* e chama alguma funcao com efeito (muda globais, escreve, ou desconhecida)? */
static bool jt_expr_has_effect(const JtProgram *prog, const JtExpr *e) {
    return jt_expr_any(e, jt_is_effect_call, prog);
}

static bool jt_is_effect_or_global(const JtExpr *e, const void *ctx) {
    const JtProgram *prog = ctx;
    if (e->kind == EX_VAR) {
        const JtVarInfo *v = &prog->vars.items[e->var.index];
        return v->is_global && v->readonly != RO_CONST;
    }
    return jt_is_effect_call(e, ctx);
}

/*
 * Ordem de avaliacao: o Jatai calcula sempre da esquerda para a direita. So
 * chamadas com efeito mudam estado no meio de uma expressao, e so globais (as
 * funcoes nao enxergam as variaveis locais de quem chama). Entao o valor de e
 * depende do momento em que e calculado so se e chama uma funcao com efeito ou
 * le uma global que nao e const.
 */
static bool jt_expr_order_sensitive(const JtProgram *prog, const JtExpr *e) {
    return jt_expr_any(e, jt_is_effect_or_global, prog);
}

static bool jt_block_has_effect(const JtProgram *prog, const JtBlock *b);

static bool jt_opt_effect(const JtProgram *prog, const JtExpr *e) { return e && jt_expr_has_effect(prog, e); }

static bool jt_stmt_has_effect(const JtProgram *prog, const JtStmt *s) {
    switch (s->kind) {
    case ST_CALL: return true; /* print */
    case ST_ASSIGN:
        return prog->vars.items[s->var].is_global || jt_opt_effect(prog, s->init);
    case ST_INDEX_SET:
        return prog->vars.items[s->target].is_global || jt_opt_effect(prog, s->index) || jt_opt_effect(prog, s->init);
    case ST_APPEND:
        return prog->vars.items[s->target].is_global || jt_opt_effect(prog, s->init);
    case ST_VAR: case ST_RETURN: case ST_EXPR:
        return jt_opt_effect(prog, s->init);
    case ST_IF:
        for (size_t i = 0; i < s->nbranches; i++)
            if (jt_opt_effect(prog, s->conds[i]) || jt_block_has_effect(prog, &s->blocks[i])) return true;
        return s->has_else && jt_block_has_effect(prog, &s->else_block);
    case ST_WHILE:
        return jt_opt_effect(prog, s->cond) || jt_block_has_effect(prog, &s->body);
    case ST_FOR:
        return jt_opt_effect(prog, s->start) || jt_opt_effect(prog, s->end) || jt_block_has_effect(prog, &s->body);
    case ST_FOREACH:
        return jt_opt_effect(prog, s->iter) || jt_block_has_effect(prog, &s->body);
    default: return false;
    }
}

static bool jt_block_has_effect(const JtProgram *prog, const JtBlock *b) {
    for (size_t i = 0; i < b->len; i++)
        if (jt_stmt_has_effect(prog, &b->items[i])) return true;
    return false;
}

/* JtFunc.has_effect de todas as funcoes: parte de "sem efeito" e marca ate
   estabilizar (assim a recursao, como em fibonacci, nao estraga a analise). */
static void jt_compute_effects(JtProgram *prog) {
    for (size_t i = 0; i < prog->funcs.len; i++) prog->funcs.items[i].has_effect = prog->funcs.items[i].is_extern;
    for (bool changed = true; changed;) {
        changed = false;
        for (size_t i = 0; i < prog->funcs.len; i++) {
            JtFunc *f = &prog->funcs.items[i];
            if (f->is_template) continue; /* corpo nunca verificado: so as instancias contam */
            if (f->has_effect || !jt_block_has_effect(prog, &f->body)) continue;
            f->has_effect = true;
            changed = true;
        }
    }
}

/* ---- copia profunda (instancias de funcoes sem tipo: cada uma verifica a sua copia) ---- */

static JtExpr *jt_clone_expr(const JtExpr *e);

static JtExpr **jt_clone_exprs(JtExpr *const *xs, size_t n) {
    if (!n) return NULL;
    JtExpr **r = jt_xmalloc(n * sizeof *r);
    for (size_t i = 0; i < n; i++) r[i] = jt_clone_expr(xs[i]);
    return r;
}

static JtExpr *jt_clone_expr(const JtExpr *e) {
    if (!e) return NULL;
    JtExpr *c = jt_xmalloc(sizeof *c);
    *c = *e;
    switch (e->kind) {
    case EX_UNARY:  c->un.x = jt_clone_expr(e->un.x); break;
    case EX_BINARY:
        c->bin.l = jt_clone_expr(e->bin.l);
        c->bin.r = jt_clone_expr(e->bin.r);
        break;
    case EX_INTERP:
        c->interp.parts = jt_xmalloc(e->interp.n * sizeof *c->interp.parts);
        for (size_t i = 0; i < e->interp.n; i++) {
            c->interp.parts[i] = e->interp.parts[i];
            c->interp.parts[i].expr = jt_clone_expr(e->interp.parts[i].expr);
        }
        break;
    case EX_CALL:  c->call.args = jt_clone_exprs(e->call.args, e->call.nargs); break;
    case EX_ARRAY: c->arr.items = jt_clone_exprs(e->arr.items, e->arr.n); break;
    case EX_INDEX:
        c->idx.base = jt_clone_expr(e->idx.base);
        c->idx.index = jt_clone_expr(e->idx.index);
        break;
    case EX_LEN:  c->len = jt_clone_expr(e->len); break;
    case EX_CONV: c->conv.x = jt_clone_expr(e->conv.x); break;
    case EX_FILL:
        c->fill.value = jt_clone_expr(e->fill.value);
        c->fill.count = jt_clone_expr(e->fill.count);
        break;
    default: break;
    }
    return c;
}

static JtBlock jt_clone_block(const JtBlock *b);

static JtStmt jt_clone_stmt(const JtStmt *s) {
    JtStmt c = *s;
    c.arg = jt_clone_expr(s->arg);
    c.init = jt_clone_expr(s->init);
    c.cond = jt_clone_expr(s->cond);
    c.start = jt_clone_expr(s->start);
    c.end = jt_clone_expr(s->end);
    c.index = jt_clone_expr(s->index);
    c.iter = jt_clone_expr(s->iter);
    c.body = jt_clone_block(&s->body);
    c.else_block = jt_clone_block(&s->else_block);
    if (s->nbranches) {
        c.conds = jt_clone_exprs(s->conds, s->nbranches);
        c.blocks = jt_xmalloc(s->nbranches * sizeof *c.blocks);
        for (size_t i = 0; i < s->nbranches; i++) c.blocks[i] = jt_clone_block(&s->blocks[i]);
    }
    return c;
}

static JtBlock jt_clone_block(const JtBlock *b) {
    JtBlock c = {0};
    for (size_t i = 0; i < b->len; i++) {
        JtStmt s = jt_clone_stmt(&b->items[i]);
        jt_vec_push(&c, s);
    }
    return c;
}

/* Expressao so com literais (sem variaveis, chamadas ou interpolacao)? */
static bool jt_expr_is_const(const JtExpr *e) {
    switch (e->kind) {
    case EX_INT: case EX_DOUBLE: case EX_STRING: case EX_CHAR: case EX_BOOL: return true;
    case EX_UNARY:  return jt_expr_is_const(e->un.x);
    case EX_CONV:   return jt_expr_is_const(e->conv.x);
    case EX_BINARY: return jt_expr_is_const(e->bin.l) && jt_expr_is_const(e->bin.r);
    case EX_FILL:   return jt_expr_is_const(e->fill.value) && jt_expr_is_const(e->fill.count);
    case EX_ARRAY:
        for (size_t i = 0; i < e->arr.n; i++)
            if (!jt_expr_is_const(e->arr.items[i])) return false;
        return true;
    default: return false;
    }
}

/*
 * x = x + a + b (strings): a expressao so acrescenta ao fim de x? Entao os
 * operandos a, b... vao para out e a atribuicao pode anexar no lugar (x += a),
 * sem copiar x inteira a cada vez. Exige que nenhum operando leia x e, se x e
 * global, que nenhum chame funcao com efeito (ela poderia mudar x no meio).
 */
static bool jt_append_chain(const JtProgram *prog, const JtExpr *e, int var, JtExprList *out) {
    if (e->type != TY_STRING || e->kind != EX_BINARY || e->bin.op != OPB_ADD) return false;
    const JtExpr *l = e->bin.l;
    if (l->kind == EX_VAR) {
        if (l->var.index != var) return false;
    } else if (!jt_append_chain(prog, l, var, out)) {
        return false;
    }
    if (jt_expr_reads_var(e->bin.r, var) ||
        (prog->vars.items[var].is_global && jt_expr_has_effect(prog, e->bin.r)))
        return false;
    jt_vec_push(out, e->bin.r);
    return true;
}

/* Alguma atribuicao dentro do bloco (em qualquer nivel) muda uma variavel lida por e? */
static bool jt_block_writes_read_of(const JtBlock *b, const JtExpr *e) {
    for (size_t i = 0; i < b->len; i++) {
        const JtStmt *s = &b->items[i];
        switch (s->kind) {
        case ST_ASSIGN:
            if (jt_expr_reads_var(e, s->var)) return true;
            break;
        case ST_INDEX_SET:
        case ST_APPEND:
            if (jt_expr_reads_var(e, s->target)) return true;
            break;
        case ST_FOREACH:
            if (jt_block_writes_read_of(&s->body, e)) return true;
            break;
        case ST_IF:
            for (size_t j = 0; j < s->nbranches; j++)
                if (jt_block_writes_read_of(&s->blocks[j], e)) return true;
            if (s->has_else && jt_block_writes_read_of(&s->else_block, e)) return true;
            break;
        case ST_WHILE:
        case ST_FOR:
            if (jt_block_writes_read_of(&s->body, e)) return true;
            break;
        default:
            break;
        }
    }
    return false;
}

#endif
