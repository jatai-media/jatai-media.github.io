#ifndef JT_BYTECODE_H
#define JT_BYTECODE_H

#include "ast.h"

/*
 * Bytecode em palavras de 32 bits: [opcode][operandos...].
 * Maquina de registradores com dois bancos:
 *   R: valores (int, double, char, bool)
 *   S: objetos com contagem de referencia (JtStr*, JtArr*)
 * Os opcodes sao tipados: os tipos ja foram verificados pelo sema,
 * entao a VM nunca inspeciona tipos em tempo de execucao.
 */
typedef enum {
    OP_LOADI,  /* R[a] = imediato b (int, char, bool) */
    OP_LOADD,  /* R[a] = nums[b] */
    OP_LOADS,  /* S[a] = strs[b] */
    OP_MOVE,   /* R[a] = R[b] */
    OP_MOVES,  /* S[a] = S[b] */
    OP_ADDI,   /* R[a] = R[b] + R[c] */
    OP_SUBI,
    OP_MULI,
    OP_DIVI,   /* R[a] = R[b] / R[c]  (d = linha, para erro de divisao por zero) */
    OP_MODI,   /* idem */
    OP_ADDD,
    OP_SUBD,
    OP_MULD,
    OP_DIVD,
    OP_NEGI,   /* R[a] = -R[b] */
    OP_NEGD,
    OP_NOT,    /* R[a] = !R[b] */
    OP_D2I,    /* R[a] = (int) R[b].d, truncando */
    OP_I2D,    /* R[a] = (double) R[b].i */
    OP_EQI,    /* R[a] = R[b] == R[c]  (int, char, bool) */
    OP_NEI,
    OP_LTI,    /* > e >= sao emitidos como < e <= com operandos trocados */
    OP_LEI,
    OP_EQD,
    OP_NED,
    OP_LTD,
    OP_LED,
    OP_EQS,    /* R[a] = S[b] == S[c] */
    OP_NES,
    OP_JMP,    /* ip = a */
    OP_JMPF,   /* se R[a] == 0, ip = b */
    OP_JMPT,   /* se R[a] != 0, ip = b */
    /* compara e salta numa instrucao so: se R[a] op R[b], ip = c */
    OP_JEQI,
    OP_JNEI,
    OP_JLTI,
    OP_JLEI,
    OP_JEQD,
    OP_JNED,
    OP_JLTD,
    OP_JLED,
    OP_JNLTD,  /* se !(R[a] < R[b]): negacao explicita por causa de NaN */
    OP_JNLED,
    /* laco for: R[a] += c; se R[a] < R[b] (FORLT) ou > (FORGT), ip = d */
    OP_FORLT,
    OP_FORGT,
    /* chamada: CALL f a b d -> novo quadro com R base += a, S base += b
       (os argumentos ja estao la, em ordem); o retorno vai para R/S[d] do chamador */
    OP_CALL,
    OP_RET,    /* retorna R[a] */
    OP_RETS,   /* retorna S[a] */
    OP_RETV,   /* retorno de funcao void */
    OP_NCALL,  /* como CALL, para funcao extern (nativa): NCALL f a b d */
    OP_CALLR,  /* como CALL, com o indice da funcao em R[f]: CALLR f a b d (valor de funcao) */
    /* globais: vivem no quadro do nivel principal, em posicoes fixas (g = posicao absoluta);
       o nivel principal as usa como registradores comuns, as funcoes por estas instrucoes */
    OP_GLOAD,   /* R[a] = global R g */
    OP_GLOADS,  /* S[a] = global S g */
    OP_GSTORE,  /* global R g = R[b] */
    OP_GSTORES, /* global S g = S[b] */
    OP_GASET,   /* global g[R[b]] = R[c]  (d = linha) */
    OP_GASETS,  /* global g[R[b]] = S[c]  (d = linha) */
    OP_GAPUSH,  /* global g.append(R[b]) */
    OP_GAPUSHS, /* global g.append(S[b]) */
    OP_GCONCAT, /* global g = g + S[b] (anexa no lugar quando possivel) */
    OP_SCLEAR,  /* libera S[a] (temporario que segurava uma global) */
    /* arrays (d = linha, para erro de indice) */
    OP_NEWARR, /* S[a] = array com b elementos de R[c..] (d = 0) ou S[c..] (d = 1) */
    OP_ALEN,   /* R[a] = len(S[b]) array */
    OP_SLEN,   /* R[a] = len(S[b]) string */
    OP_AGET,   /* R[a] = S[b][R[c]] */
    OP_AGETS,  /* S[a] = S[b][R[c]] */
    OP_ASET,   /* S[a][R[b]] = R[c] */
    OP_ASETS,  /* S[a][R[b]] = S[c] */
    OP_APUSH,  /* S[a].append(R[b]) */
    OP_APUSHS, /* S[a].append(S[b]) */
    OP_ANEXT,  /* for-in: se R[b] < len(S[a]): R[c] = S[a][R[b]]; R[b]++; ip = d */
    OP_ANEXTS, /* idem, elemento em S[c] */
    OP_AFILL,  /* S[a] = [R[b] ou S[b]] * R[c]; d = elementos sao objetos; e = linha */
    OP_CONCAT, /* S[a] = S[b] .. S[c] */
    OP_TOSTRI, /* S[a] = texto de R[b] */
    OP_TOSTRD,
    OP_TOSTRC,
    OP_TOSTRB,
    OP_WRITEK, /* escreve strs[a] */
    OP_WRITES, /* escreve S[a] */
    OP_WRITEI, /* escreve R[a] */
    OP_WRITED,
    OP_WRITEC,
    OP_WRITEB,
    OP_HALT,
} JtOp;

/* Objetos do banco S: cabecalho comum com contagem de referencia. */
typedef enum { JT_OBJ_STR, JT_OBJ_ARR } JtObjKind;

typedef struct {
    uint32_t rc;
    uint32_t kind;
} JtObj;

#define JT_RC_PINNED UINT32_MAX /* constantes: nunca liberadas */

typedef union {
    int32_t i;
    double d;
    JtObj *o;
} JtValue;

/* String. Imutavel enquanto compartilhada; com uma so referencia, CONCAT
   pode anexar no lugar (cap = espaco reservado, como no std::string). */
typedef struct {
    JtObj h;
    uint32_t len, cap;
    char data[];
} JtStr;

/* Array com semantica de valor (como std::vector): compartilhado ate ser
   alterado, entao copiado (copy-on-write). objs: elementos sao objetos (string). */
typedef struct {
    JtObj h;
    uint32_t len, cap;
    bool objs;
    JtValue *data;
} JtArr;

/* Diagnostico de memoria (gcc -DJT_DEBUG_ALLOC): conta objetos criados e liberados;
   ao fim da execucao, objetos ainda vivos indicam erro na contagem de referencias. */
#ifdef JT_DEBUG_ALLOC
static long long jt_dbg_created[2], jt_dbg_live[2];
#define JT_DBG_NEW(kind) (jt_dbg_created[kind]++, jt_dbg_live[kind]++)
#define JT_DBG_GONE(kind) (jt_dbg_live[kind]--)
#else
#define JT_DBG_NEW(kind) ((void)0)
#define JT_DBG_GONE(kind) ((void)0)
#endif

static JtStr *jt_str_new(size_t len) {
    JT_DBG_NEW(JT_OBJ_STR);
    JtStr *s = jt_xmalloc(sizeof(JtStr) + len + 1);
    s->h.rc = 1;
    s->h.kind = JT_OBJ_STR;
    s->len = (uint32_t)len;
    s->cap = (uint32_t)len;
    s->data[len] = '\0';
    return s;
}

static JtArr *jt_arr_new(bool objs, uint32_t cap) {
    JT_DBG_NEW(JT_OBJ_ARR);
    JtArr *a = jt_xmalloc(sizeof *a);
    a->h.rc = 1;
    a->h.kind = JT_OBJ_ARR;
    a->len = 0;
    a->cap = cap;
    a->objs = objs;
    a->data = cap ? jt_xmalloc(cap * sizeof *a->data) : NULL;
    return a;
}

static inline void jt_obj_retain(JtObj *o) {
    if (o->rc != JT_RC_PINNED) o->rc++;
}

static void jt_obj_release(JtObj *o) {
    if (!o || o->rc == JT_RC_PINNED || --o->rc != 0) return;
    if (o->kind == JT_OBJ_ARR) {
        JtArr *a = (JtArr *)o;
        if (a->objs)
            for (uint32_t i = 0; i < a->len; i++) jt_obj_release(a->data[i].o);
        free(a->data);
    }
    JT_DBG_GONE(o->kind);
    free(o);
}

#define JT_MAX_NATIVE_PARAMS 16

typedef struct {
    uint32_t entry;          /* inicio do codigo da funcao */
    uint32_t nregs, nsregs;  /* tamanho do quadro em cada banco */
    const char *file;        /* arquivo .jat, para mensagens de erro em tempo de execucao */
    uint32_t nparams;        /* assinatura: usada quando uma funcao nativa chama de volta (callback) */
    JtType params[JT_MAX_NATIVE_PARAMS];
    JtType ret;
} JtFnInfo;

/*
 * ABI das funcoes extern carregadas de bibliotecas (a "cola" C++ gerada em
 * native.h segue exatamente esta forma):
 *   void jt_native_<nome>(const JtNValue *args, JtNValue *ret, const JtHost *host)
 */
typedef union {
    int32_t i;                                 /* int, char, bool */
    double d;
    struct { const char *p; uint32_t n; } s;   /* string (argumento) */
    void *o;                                   /* string (retorno, criada por host->new_str) */
} JtNValue;

/* Servicos da VM para o codigo nativo: criar strings e chamar de volta uma
   funcao Jatai (callback) recebida como valor de funcao. */
typedef struct {
    void *(*new_str)(const char *p, size_t n);
    void (*call)(void *vm, int32_t fn, const JtNValue *args, JtNValue *ret);
    void *vm;
} JtHost;

/* Funcao extern carregada de uma biblioteca nativa (ver native.h). A VM so chama
   invoke com os argumentos no formato JtNValue; a conversao para a ABI C e feita
   pelo carregador. */
typedef struct JtNative JtNative;
struct JtNative {
    void (*invoke)(const JtNative *nf, const JtNValue *args, JtNValue *ret, const JtHost *host);
    void *impl;              /* dados do carregador */
    uint32_t nparams;
    JtType params[JT_MAX_NATIVE_PARAMS];
    JtType ret;
};

typedef struct {
    const char *file;
    JT_VEC(uint32_t) code;
    JT_VEC(JtStr *) strs;
    JT_VEC(double) nums;
    JT_VEC(JtFnInfo) fns;    /* indexado como JtProgram.funcs */
    JtNative *natives;       /* indexado como JtProgram.funcs (so as extern); preenchido por native.h */
    uint32_t nregs, nsregs;  /* quadro do nivel principal, que comeca em code[0] */
} JtChunk;

typedef JT_VEC(size_t) JtPatches; /* posicoes de alvos de salto a corrigir */

typedef struct JtLoop {
    JtPatches breaks, continues;
    struct JtLoop *outer;
} JtLoop;

typedef struct {
    JtChunk *chunk;
    JtProgram *prog;
    JtLoop *loop; /* laco mais interno, para break/continue */
    /* Escritas constantes consecutivas sao fundidas aqui e emitidas
       como um unico OP_WRITEK (dobra de constantes). */
    char *pending;
    size_t pending_len, pending_cap;
    uint32_t rvars, svars; /* registradores ocupados por variaveis */
    uint32_t rnext, snext; /* proximo registrador livre (temporarios) */
    uint32_t rmax, smax;   /* tamanho do quadro da funcao sendo compilada */
    bool in_func;          /* compilando uma funcao: globais so por GLOAD/GSTORE... */
    JT_VEC(uint32_t) gtemps; /* temporarios S que receberam uma global (liberados com SCLEAR) */
} JtCompiler;

static void jt_emit(JtCompiler *cc, uint32_t w) { jt_vec_push(&cc->chunk->code, w); }
static void jt_emit2(JtCompiler *cc, uint32_t op, uint32_t a) { jt_emit(cc, op); jt_emit(cc, a); }
static void jt_emit3(JtCompiler *cc, uint32_t op, uint32_t a, uint32_t b) { jt_emit2(cc, op, a); jt_emit(cc, b); }
static void jt_emit4(JtCompiler *cc, uint32_t op, uint32_t a, uint32_t b, uint32_t c) { jt_emit3(cc, op, a, b); jt_emit(cc, c); }

static uint32_t jt_const_str(JtCompiler *cc, const char *s, size_t n) {
    JtStr *k = jt_str_new(n);
    memcpy(k->data, s, n);
    k->h.rc = JT_RC_PINNED;
    JT_DBG_GONE(JT_OBJ_STR); /* constante: vive o programa todo, nao conta como vazamento */
    jt_vec_push(&cc->chunk->strs, k);
    return (uint32_t)cc->chunk->strs.len - 1;
}

static uint32_t jt_const_num(JtCompiler *cc, double d) {
    jt_vec_push(&cc->chunk->nums, d);
    return (uint32_t)cc->chunk->nums.len - 1;
}

static void jt_pending_append(JtCompiler *cc, const char *s, size_t n) {
    if (cc->pending_len + n > cc->pending_cap) {
        size_t cap = cc->pending_cap ? cc->pending_cap : 64;
        while (cap < cc->pending_len + n) cap *= 2;
        cc->pending = jt_xrealloc(cc->pending, cap);
        cc->pending_cap = cap;
    }
    memcpy(cc->pending + cc->pending_len, s, n);
    cc->pending_len += n;
}

static void jt_flush_pending(JtCompiler *cc) {
    if (cc->pending_len == 0) return;
    jt_emit2(cc, OP_WRITEK, jt_const_str(cc, cc->pending, cc->pending_len));
    cc->pending_len = 0;
}

static bool jt_is_sreg(JtType t) { return t == TY_STRING || jt_is_array(t) || t == TY_ARR_EMPTY; }

static uint32_t jt_alloc_reg(JtCompiler *cc, JtType t) {
    if (jt_is_sreg(t)) {
        if (cc->snext + 1 > cc->smax) cc->smax = cc->snext + 1;
        return cc->snext++;
    }
    if (cc->rnext + 1 > cc->rmax) cc->rmax = cc->rnext + 1;
    return cc->rnext++;
}

static void jt_compile_into(JtCompiler *cc, const JtExpr *e, uint32_t dst);

/* Devolve os temporarios S a partir de ssave; os que seguravam uma global sao
   liberados (SCLEAR), para ela voltar a ter uma so referencia. */
static void jt_sreset(JtCompiler *cc, uint32_t ssave) {
    size_t keep = 0;
    for (size_t i = 0; i < cc->gtemps.len; i++) {
        if (cc->gtemps.items[i] >= ssave) jt_emit2(cc, OP_SCLEAR, cc->gtemps.items[i]);
        else cc->gtemps.items[keep++] = cc->gtemps.items[i];
    }
    cc->gtemps.len = keep;
    cc->snext = ssave;
}

static bool jt_is_global_in_func(const JtCompiler *cc, const JtVarInfo *v) {
    return cc->in_func && v->is_global;
}

/* Registrador com o valor da variavel: o proprio, ou (global dentro de funcao) um temporario. */
static uint32_t jt_var_reg(JtCompiler *cc, int var) {
    const JtVarInfo *v = &cc->prog->vars.items[var];
    if (!jt_is_global_in_func(cc, v)) return v->reg;
    uint32_t r = jt_alloc_reg(cc, v->type);
    jt_emit3(cc, jt_is_sreg(v->type) ? OP_GLOADS : OP_GLOAD, r, v->reg);
    if (jt_is_sreg(v->type)) jt_vec_push(&cc->gtemps, r);
    return r;
}

/* Registrador onde o valor de e esta; variaveis sao usadas sem copia. */
static uint32_t jt_compile_reg(JtCompiler *cc, const JtExpr *e) {
    if (e->kind == EX_VAR) return jt_var_reg(cc, e->var.index);
    uint32_t r = jt_alloc_reg(cc, e->type);
    jt_compile_into(cc, e, r);
    return r;
}

/* Registrador de um operando seguido de outros (later_call: algum deles chama
   funcao com efeito). Uma global do programa principal e lida direto do registrador dela;
   se a funcao seguinte muda-la, o operando leria o valor novo. Entao ela e
   copiada antes: o Jatai calcula da esquerda para a direita. */
static uint32_t jt_compile_operand(JtCompiler *cc, const JtExpr *e, bool later_call) {
    if (later_call && e->kind == EX_VAR) {
        const JtVarInfo *v = &cc->prog->vars.items[e->var.index];
        if (v->is_global && !jt_is_global_in_func(cc, v)) {
            uint32_t r = jt_alloc_reg(cc, e->type);
            jt_emit3(cc, jt_is_sreg(e->type) ? OP_MOVES : OP_MOVE, r, v->reg);
            if (jt_is_sreg(e->type)) jt_vec_push(&cc->gtemps, r); /* SCLEAR ao liberar */
            return r;
        }
    }
    return jt_compile_reg(cc, e);
}

/* dst = e convertida para string (uma parte de "{e}") */
static void jt_compile_tostr(JtCompiler *cc, uint32_t dst, const JtExpr *e) {
    static const uint32_t ops[] = {
        [TY_INT] = OP_TOSTRI, [TY_DOUBLE] = OP_TOSTRD, [TY_STRING] = OP_MOVES,
        [TY_CHAR] = OP_TOSTRC, [TY_BOOL] = OP_TOSTRB,
    };
    if (e->type == TY_STRING && e->kind != EX_VAR) { jt_compile_into(cc, e, dst); return; }
    uint32_t src = jt_compile_reg(cc, e);
    jt_emit3(cc, ops[e->type], dst, src);
}

/* Argumentos vao para registradores consecutivos no topo do quadro atual;
   eles viram os parametros (R/S[0..]) do quadro da funcao chamada. */
static void jt_compile_call(JtCompiler *cc, const JtExpr *e, uint32_t dst) {
    uint32_t rbase = cc->rnext, sbase = cc->snext;
    for (size_t i = 0; i < e->call.nargs; i++) {
        const JtExpr *a = e->call.args[i];
        jt_compile_into(cc, a, jt_alloc_reg(cc, a->type));
    }
    jt_flush_pending(cc); /* a funcao pode escrever na saida */
    if (e->call.fnvar >= 0) {
        /* chamada atraves de valor de funcao: o indice da funcao esta num registrador */
        uint32_t fr = jt_var_reg(cc, e->call.fnvar);
        jt_emit4(cc, OP_CALLR, fr, rbase, sbase);
    } else {
        bool native = cc->prog->funcs.items[e->call.fn].is_extern;
        jt_emit4(cc, native ? OP_NCALL : OP_CALL, (uint32_t)e->call.fn, rbase, sbase);
    }
    jt_emit(cc, dst);
    cc->rnext = rbase;
    jt_sreset(cc, sbase);
}

/* [a, b, c]: elementos em registradores consecutivos, depois um NEWARR */
static void jt_compile_array(JtCompiler *cc, const JtExpr *e, uint32_t dst) {
    bool objs = jt_is_sreg(jt_elem_type(e->type));
    uint32_t base = objs ? cc->snext : cc->rnext;
    uint32_t rsave = cc->rnext, ssave = cc->snext;
    for (size_t i = 0; i < e->arr.n; i++) {
        const JtExpr *x = e->arr.items[i];
        jt_compile_into(cc, x, jt_alloc_reg(cc, x->type));
    }
    jt_emit4(cc, OP_NEWARR, dst, (uint32_t)e->arr.n, base);
    jt_emit(cc, objs);
    cc->rnext = rsave;
    jt_sreset(cc, ssave);
}

static void jt_compile_binary(JtCompiler *cc, const JtExpr *e, uint32_t dst) {
    uint32_t rsave = cc->rnext, ssave = cc->snext;
    uint32_t a = jt_compile_operand(cc, e->bin.l, jt_expr_has_effect(cc->prog, e->bin.r));
    uint32_t b = jt_compile_reg(cc, e->bin.r);
    JtType t = e->bin.l->type;
    JtBinOp op = e->bin.op;
    uint32_t code = OP_HALT;

    /* a > b == b < a, a >= b == b <= a */
    if (op == OPB_GT || op == OPB_GE) {
        uint32_t tmp = a; a = b; b = tmp;
        op = op == OPB_GT ? OPB_LT : OPB_LE;
    }

    if (t == TY_STRING) {
        code = op == OPB_ADD ? OP_CONCAT : op == OPB_EQ ? OP_EQS : OP_NES;
    } else if (t == TY_DOUBLE) {
        switch (op) {
        case OPB_ADD: code = OP_ADDD; break;
        case OPB_SUB: code = OP_SUBD; break;
        case OPB_MUL: code = OP_MULD; break;
        case OPB_DIV: code = OP_DIVD; break;
        case OPB_EQ:  code = OP_EQD;  break;
        case OPB_NE:  code = OP_NED;  break;
        case OPB_LT:  code = OP_LTD;  break;
        case OPB_LE:  code = OP_LED;  break;
        default: break;
        }
    } else { /* int, char e bool compartilham R[].i */
        switch (op) {
        case OPB_ADD: code = OP_ADDI; break;
        case OPB_SUB: code = OP_SUBI; break;
        case OPB_MUL: code = OP_MULI; break;
        case OPB_DIV: code = OP_DIVI; break;
        case OPB_MOD: code = OP_MODI; break;
        case OPB_EQ:  code = OP_EQI;  break;
        case OPB_NE:  code = OP_NEI;  break;
        case OPB_LT:  code = OP_LTI;  break;
        case OPB_LE:  code = OP_LEI;  break;
        default: break;
        }
    }

    if (code == OP_DIVI || code == OP_MODI) {
        jt_flush_pending(cc); /* pode falhar: a saida anterior precisa sair antes do erro */
        jt_emit4(cc, code, dst, a, b);
        jt_emit(cc, (uint32_t)e->line);
    } else {
        jt_emit4(cc, code, dst, a, b);
    }
    cc->rnext = rsave;
    jt_sreset(cc, ssave);
}

/* a and b / a or b com curto-circuito: dst = a; se decidido, pula b.
   Os saltos ficam dentro da expressao e nunca pulam escritas, entao o
   texto pendente nao precisa ser descarregado aqui. */
static void jt_compile_logic(JtCompiler *cc, const JtExpr *e, uint32_t dst) {
    jt_compile_into(cc, e->bin.l, dst);
    jt_emit2(cc, e->bin.op == OPB_AND ? OP_JMPF : OP_JMPT, dst);
    size_t patch = cc->chunk->code.len;
    jt_emit(cc, 0);
    jt_compile_into(cc, e->bin.r, dst);
    cc->chunk->code.items[patch] = (uint32_t)cc->chunk->code.len;
}

static void jt_compile_into(JtCompiler *cc, const JtExpr *e, uint32_t dst) {
    switch (e->kind) {
    case EX_INT:    jt_emit3(cc, OP_LOADI, dst, (uint32_t)e->i.value); break;
    case EX_CHAR:   jt_emit3(cc, OP_LOADI, dst, (uint32_t)(unsigned char)e->ch); break;
    case EX_BOOL:   jt_emit3(cc, OP_LOADI, dst, e->b); break;
    case EX_DOUBLE: jt_emit3(cc, OP_LOADD, dst, jt_const_num(cc, e->d.value)); break;
    case EX_STRING: jt_emit3(cc, OP_LOADS, dst, jt_const_str(cc, e->str.data, e->str.len)); break;
    case EX_VAR: {
        const JtVarInfo *v = &cc->prog->vars.items[e->var.index];
        if (jt_is_global_in_func(cc, v)) {
            jt_emit3(cc, jt_is_sreg(e->type) ? OP_GLOADS : OP_GLOAD, dst, v->reg);
            break;
        }
        if (v->reg != dst) jt_emit3(cc, jt_is_sreg(e->type) ? OP_MOVES : OP_MOVE, dst, v->reg);
        break;
    }
    case EX_UNARY: {
        uint32_t rsave = cc->rnext;
        uint32_t x = jt_compile_reg(cc, e->un.x);
        uint32_t op = e->un.op == OPU_NOT ? OP_NOT : e->type == TY_INT ? OP_NEGI : OP_NEGD;
        jt_emit3(cc, op, dst, x);
        cc->rnext = rsave;
        break;
    }
    case EX_BINARY:
        if (e->bin.op == OPB_AND || e->bin.op == OPB_OR) jt_compile_logic(cc, e, dst);
        else jt_compile_binary(cc, e, dst);
        break;
    case EX_CALL:
        jt_compile_call(cc, e, dst);
        break;
    case EX_FNREF:
        jt_emit3(cc, OP_LOADI, dst, (uint32_t)e->fnref);
        break;
    case EX_CONV: {
        uint32_t rsave = cc->rnext;
        uint32_t x = jt_compile_reg(cc, e->conv.x);
        JtType from = e->conv.x->type;
        if (from == TY_DOUBLE && e->conv.to == TY_INT) jt_emit3(cc, OP_D2I, dst, x);
        else if (from != TY_DOUBLE && e->conv.to == TY_DOUBLE) jt_emit3(cc, OP_I2D, dst, x);
        else if (x != dst) jt_emit3(cc, OP_MOVE, dst, x); /* int(int), int(char), double(double) */
        cc->rnext = rsave;
        break;
    }
    case EX_ARRAY:
        jt_compile_array(cc, e, dst);
        break;
    case EX_INDEX: {
        uint32_t rsave = cc->rnext, ssave = cc->snext;
        uint32_t a = jt_compile_operand(cc, e->idx.base, jt_expr_has_effect(cc->prog, e->idx.index));
        uint32_t i = jt_compile_reg(cc, e->idx.index);
        jt_flush_pending(cc); /* pode falhar: indice fora dos limites */
        jt_emit4(cc, jt_is_sreg(e->type) ? OP_AGETS : OP_AGET, dst, a, i);
        jt_emit(cc, (uint32_t)e->line);
        cc->rnext = rsave;
        jt_sreset(cc, ssave);
        break;
    }
    case EX_FILL: {
        uint32_t rsave = cc->rnext, ssave = cc->snext;
        bool objs = jt_is_sreg(e->fill.value->type);
        uint32_t v = jt_compile_operand(cc, e->fill.value, jt_expr_has_effect(cc->prog, e->fill.count));
        uint32_t n = jt_compile_reg(cc, e->fill.count);
        jt_flush_pending(cc); /* pode falhar: tamanho negativo */
        jt_emit4(cc, OP_AFILL, dst, v, n);
        jt_emit(cc, objs);
        jt_emit(cc, (uint32_t)e->line);
        cc->rnext = rsave;
        jt_sreset(cc, ssave);
        break;
    }
    case EX_LEN: {
        uint32_t ssave = cc->snext;
        uint32_t x = jt_compile_reg(cc, e->len);
        jt_emit3(cc, e->len->type == TY_STRING ? OP_SLEN : OP_ALEN, dst, x);
        jt_sreset(cc, ssave);
        break;
    }
    case EX_INTERP: {
        /* globais lidas dentro de funcao ocupam temporarios R e S: todos sao devolvidos
           (argumentos de chamada precisam ficar em registradores consecutivos) */
        uint32_t rsave = cc->rnext, ssave = cc->snext;
        uint32_t tmp = jt_alloc_reg(cc, TY_STRING);
        uint32_t rpart = cc->rnext, spart = cc->snext;
        for (size_t i = 0; i < e->interp.n; i++) {
            const JtInterpPart *part = &e->interp.parts[i];
            uint32_t target = i == 0 ? dst : tmp;
            if (part->expr) jt_compile_tostr(cc, target, part->expr);
            else jt_emit3(cc, OP_LOADS, target, jt_const_str(cc, part->text, part->len));
            cc->rnext = rpart; /* temporarios da parte ja foram usados */
            jt_sreset(cc, spart);
            if (i > 0) jt_emit4(cc, OP_CONCAT, dst, dst, tmp);
        }
        cc->rnext = rsave;
        jt_sreset(cc, ssave);
        break;
    }
    }
}

static void jt_compile_print(JtCompiler *cc, const JtExpr *arg, bool newline) {
    static const uint32_t write_ops[] = {
        [TY_INT] = OP_WRITEI, [TY_DOUBLE] = OP_WRITED, [TY_STRING] = OP_WRITES,
        [TY_CHAR] = OP_WRITEC, [TY_BOOL] = OP_WRITEB,
    };
    switch (arg->kind) {
    case EX_STRING:
        jt_pending_append(cc, arg->str.data, arg->str.len);
        break;
    case EX_INTERP:
        /* com chamada com efeito (ex.: uma funcao que tambem escreve), monta a linha
           inteira antes de escrever, como o printf do C++ */
        if (jt_expr_has_effect(cc->prog, arg)) goto whole;
        /* escreve parte a parte, sem montar string intermediaria */
        for (size_t i = 0; i < arg->interp.n; i++) {
            const JtInterpPart *part = &arg->interp.parts[i];
            if (!part->expr) {
                jt_pending_append(cc, part->text, part->len);
                continue;
            }
            jt_flush_pending(cc);
            uint32_t rsave = cc->rnext, ssave = cc->snext;
            jt_emit2(cc, write_ops[part->expr->type], jt_compile_reg(cc, part->expr));
            cc->rnext = rsave;
            jt_sreset(cc, ssave);
        }
        break;
    default:
    whole:
        jt_flush_pending(cc);
        jt_emit2(cc, OP_WRITES, jt_compile_reg(cc, arg));
        break;
    }
    if (newline) jt_pending_append(cc, "\n", 1);
}

/* and/or e interpolacao escrevem no destino antes de terminar de ler os operandos. */
static bool jt_writes_dst_early(const JtExpr *e) {
    return e->kind == EX_INTERP ||
           (e->kind == EX_BINARY && (e->bin.op == OPB_AND || e->bin.op == OPB_OR));
}

static void jt_compile_block(JtCompiler *cc, const JtBlock *b);

/*
 * O texto pendente e descarregado antes de todo salto e de todo rotulo,
 * para nunca atravessar uma fronteira de controle de fluxo.
 */
static size_t jt_emit_jump(JtCompiler *cc, uint32_t op, uint32_t reg) {
    jt_flush_pending(cc);
    jt_emit(cc, op);
    if (op != OP_JMP) jt_emit(cc, reg);
    jt_emit(cc, 0);
    return cc->chunk->code.len - 1; /* posicao do alvo, corrigida depois */
}

static size_t jt_label(JtCompiler *cc) {
    jt_flush_pending(cc);
    return cc->chunk->code.len;
}

static void jt_patch_here(JtCompiler *cc, size_t at) {
    cc->chunk->code.items[at] = (uint32_t)jt_label(cc);
}

static void jt_patch_list(JtCompiler *cc, JtPatches *list, size_t target) {
    for (size_t i = 0; i < list->len; i++) cc->chunk->code.items[list->items[i]] = (uint32_t)target;
    free(list->items);
    memset(list, 0, sizeof *list);
}

static JtBinOp jt_negate_cmp(JtBinOp op) {
    switch (op) {
    case OPB_EQ: return OPB_NE;
    case OPB_NE: return OPB_EQ;
    case OPB_LT: return OPB_GE;
    case OPB_LE: return OPB_GT;
    case OPB_GT: return OPB_LE;
    default:     return OPB_LT; /* OPB_GE */
    }
}

/*
 * Emite codigo que salta (alvos em out) quando e == when; senao segue adiante.
 * Comparacoes viram um unico salto comparativo, not inverte o sentido e
 * and/or viram saltos em curto-circuito, sem materializar bool nenhum.
 */
static void jt_cond_jump(JtCompiler *cc, const JtExpr *e, bool when, JtPatches *out) {
    uint32_t rsave = cc->rnext, ssave = cc->snext;

    if (e->kind == EX_UNARY && e->un.op == OPU_NOT) {
        jt_cond_jump(cc, e->un.x, !when, out);
        return;
    }
    if (e->kind == EX_BOOL) {
        if (e->b == when) jt_vec_push(out, jt_emit_jump(cc, OP_JMP, 0));
        return;
    }
    if (e->kind == EX_BINARY && (e->bin.op == OPB_AND || e->bin.op == OPB_OR)) {
        if ((e->bin.op == OPB_AND) != when) {
            /* and falso / or verdadeiro: qualquer lado decide */
            jt_cond_jump(cc, e->bin.l, when, out);
            jt_cond_jump(cc, e->bin.r, when, out);
        } else {
            /* and verdadeiro / or falso: o lado esquerdo pode encerrar sem saltar */
            JtPatches skip = {0};
            jt_cond_jump(cc, e->bin.l, !when, &skip);
            jt_cond_jump(cc, e->bin.r, when, out);
            jt_patch_list(cc, &skip, jt_label(cc));
        }
        return;
    }
    if (e->kind == EX_BINARY && e->bin.op >= OPB_EQ && e->bin.op <= OPB_GE && e->bin.l->type != TY_STRING) {
        uint32_t a = jt_compile_operand(cc, e->bin.l, jt_expr_has_effect(cc->prog, e->bin.r));
        uint32_t b = jt_compile_reg(cc, e->bin.r);
        JtBinOp op = e->bin.op;
        bool dbl = e->bin.l->type == TY_DOUBLE;
        /* em double, !(a < b) nao e (a >= b) quando ha NaN: usa saltos negados */
        if (!when && !dbl) op = jt_negate_cmp(op);
        if (op == OPB_GT || op == OPB_GE) {
            uint32_t t = a; a = b; b = t;
            op = op == OPB_GT ? OPB_LT : OPB_LE;
        }
        static const uint32_t ints[] = { [OPB_EQ] = OP_JEQI, [OPB_NE] = OP_JNEI, [OPB_LT] = OP_JLTI, [OPB_LE] = OP_JLEI };
        static const uint32_t dbl_t[] = { [OPB_EQ] = OP_JEQD, [OPB_NE] = OP_JNED, [OPB_LT] = OP_JLTD, [OPB_LE] = OP_JLED };
        static const uint32_t dbl_f[] = { [OPB_EQ] = OP_JNED, [OPB_NE] = OP_JEQD, [OPB_LT] = OP_JNLTD, [OPB_LE] = OP_JNLED };
        uint32_t code = !dbl ? ints[op] : when ? dbl_t[op] : dbl_f[op];
        jt_flush_pending(cc);
        jt_emit4(cc, code, a, b, 0);
        jt_vec_push(out, cc->chunk->code.len - 1);
    } else {
        uint32_t r = jt_compile_reg(cc, e);
        jt_vec_push(out, jt_emit_jump(cc, when ? OP_JMPT : OP_JMPF, r));
    }
    cc->rnext = rsave;
    jt_sreset(cc, ssave);
}

/*
 *   se !cond1 -> L1; bloco1; JMP -> FIM
 * L1: se !cond2 -> L2; bloco2; JMP -> FIM
 * L2: else
 * FIM:
 */
static void jt_compile_if(JtCompiler *cc, const JtStmt *s) {
    JtPatches ends = {0};
    for (size_t i = 0; i < s->nbranches; i++) {
        JtPatches next = {0};
        jt_cond_jump(cc, s->conds[i], false, &next);
        jt_compile_block(cc, &s->blocks[i]);
        if (i + 1 < s->nbranches || s->has_else) jt_vec_push(&ends, jt_emit_jump(cc, OP_JMP, 0));
        jt_patch_list(cc, &next, jt_label(cc));
    }
    if (s->has_else) jt_compile_block(cc, &s->else_block);
    jt_patch_list(cc, &ends, jt_label(cc));
}

static void jt_loop_begin(JtCompiler *cc, JtLoop *loop) {
    memset(loop, 0, sizeof *loop);
    loop->outer = cc->loop;
    cc->loop = loop;
}

/*
 *   JMP -> TESTE
 * CORPO: bloco
 * TESTE: (continue) se cond -> CORPO
 * FIM: (break)
 * Um unico salto condicional por iteracao.
 */
static void jt_compile_while(JtCompiler *cc, const JtStmt *s) {
    JtLoop loop;
    jt_loop_begin(cc, &loop);
    size_t to_test = jt_emit_jump(cc, OP_JMP, 0);
    size_t body = jt_label(cc);
    jt_compile_block(cc, &s->body);
    jt_patch_list(cc, &loop.continues, jt_label(cc));
    jt_patch_here(cc, to_test);
    JtPatches back = {0};
    jt_cond_jump(cc, s->cond, true, &back);
    jt_patch_list(cc, &back, body);
    jt_patch_list(cc, &loop.breaks, jt_label(cc));
    cc->loop = loop.outer;
}

/*
 *   i = inicio; FIM = fim           (fim avaliado uma vez, como no Python)
 *   se !(i < FIM) -> SAIDA
 * CORPO: bloco
 *   (continue) FORLT i FIM passo -> CORPO   (i += passo; testa; salta)
 * SAIDA: (break)
 */
static void jt_compile_for(JtCompiler *cc, const JtStmt *s) {
    uint32_t rvars = cc->rvars;
    JtVarInfo *v = &cc->prog->vars.items[s->var];
    v->reg = jt_alloc_reg(cc, TY_INT);
    uint32_t end = jt_alloc_reg(cc, TY_INT);
    cc->rvars += 2;
    jt_compile_into(cc, s->start, v->reg);
    jt_compile_into(cc, s->end, end);
    cc->rnext = cc->rvars;

    jt_flush_pending(cc);
    if (s->step > 0) jt_emit4(cc, OP_JLEI, end, v->reg, 0); /* fim <= i: nao entra */
    else jt_emit4(cc, OP_JLEI, v->reg, end, 0);             /* i <= fim: nao entra */
    size_t skip = cc->chunk->code.len - 1;

    JtLoop loop;
    jt_loop_begin(cc, &loop);
    size_t body = jt_label(cc);
    jt_compile_block(cc, &s->body);
    jt_patch_list(cc, &loop.continues, jt_label(cc));
    jt_emit4(cc, s->step > 0 ? OP_FORLT : OP_FORGT, v->reg, end, (uint32_t)s->step);
    jt_emit(cc, (uint32_t)body);
    jt_patch_here(cc, skip);
    jt_patch_list(cc, &loop.breaks, jt_label(cc));
    cc->loop = loop.outer;
    cc->rvars = cc->rnext = rvars;
}

/*
 *   A = array (referencia: o copy-on-write o torna um instantaneo); I = 0
 *   JMP -> PROXIMO
 * CORPO: bloco
 * PROXIMO: (continue) ANEXT A I x -> CORPO   (se I < len: x = A[I]; I++; salta)
 * SAIDA: (break)
 */
static void jt_compile_foreach(JtCompiler *cc, const JtStmt *s) {
    uint32_t rvars = cc->rvars, svars = cc->svars;
    JtVarInfo *v = &cc->prog->vars.items[s->var];
    uint32_t arr = jt_alloc_reg(cc, s->iter->type);
    cc->svars++;
    uint32_t idx = jt_alloc_reg(cc, TY_INT);
    cc->rvars++;
    v->reg = jt_alloc_reg(cc, v->type);
    if (jt_is_sreg(v->type)) cc->svars++;
    else cc->rvars++;
    jt_compile_into(cc, s->iter, arr);
    jt_emit3(cc, OP_LOADI, idx, 0);
    cc->rnext = cc->rvars;
    jt_sreset(cc, cc->svars);

    JtLoop loop;
    jt_loop_begin(cc, &loop);
    size_t to_next = jt_emit_jump(cc, OP_JMP, 0);
    size_t body = jt_label(cc);
    jt_compile_block(cc, &s->body);
    jt_patch_list(cc, &loop.continues, jt_label(cc));
    jt_patch_here(cc, to_next);
    jt_emit4(cc, jt_is_sreg(v->type) ? OP_ANEXTS : OP_ANEXT, arr, idx, v->reg);
    jt_emit(cc, (uint32_t)body);
    jt_patch_list(cc, &loop.breaks, jt_label(cc));
    cc->loop = loop.outer;
    cc->rvars = cc->rnext = rvars;
    cc->svars = svars;
    jt_sreset(cc, svars);
}

static void jt_compile_stmt(JtCompiler *cc, const JtStmt *s) {
    switch (s->kind) {
    case ST_FOREACH:
        jt_compile_foreach(cc, s);
        break;
    case ST_INDEX_SET: {
        const JtVarInfo *v = &cc->prog->vars.items[s->target];
        bool g = jt_is_global_in_func(cc, v), objs = jt_is_sreg(s->init->type);
        uint32_t i = jt_compile_operand(cc, s->index, jt_expr_has_effect(cc->prog, s->init));
        uint32_t x = jt_compile_reg(cc, s->init);
        jt_flush_pending(cc);
        jt_emit4(cc, g ? (objs ? OP_GASETS : OP_GASET) : (objs ? OP_ASETS : OP_ASET), v->reg, i, x);
        jt_emit(cc, (uint32_t)s->line);
        break;
    }
    case ST_APPEND: {
        const JtVarInfo *v = &cc->prog->vars.items[s->target];
        bool g = jt_is_global_in_func(cc, v), objs = jt_is_sreg(s->init->type);
        uint32_t x = jt_compile_reg(cc, s->init);
        jt_emit3(cc, g ? (objs ? OP_GAPUSHS : OP_GAPUSH) : (objs ? OP_APUSHS : OP_APUSH), v->reg, x);
        break;
    }
    case ST_IF:
        jt_compile_if(cc, s);
        break;
    case ST_WHILE:
        jt_compile_while(cc, s);
        break;
    case ST_FOR:
        jt_compile_for(cc, s);
        break;
    case ST_BREAK:
        jt_vec_push(&cc->loop->breaks, jt_emit_jump(cc, OP_JMP, 0));
        break;
    case ST_CONTINUE:
        jt_vec_push(&cc->loop->continues, jt_emit_jump(cc, OP_JMP, 0));
        break;
    case ST_CALL:
        jt_compile_print(cc, s->arg, s->fn == BI_PRINTLN);
        break;
    case ST_EXPR:
        /* resultado descartado: vai para um temporario (void nao escreve nada) */
        if (s->init->type == TY_VOID) jt_compile_call(cc, s->init, 0);
        else jt_compile_reg(cc, s->init);
        break;
    case ST_RETURN:
        if (!s->init) {
            jt_flush_pending(cc);
            jt_emit(cc, OP_RETV);
        } else {
            uint32_t r = jt_compile_reg(cc, s->init);
            jt_flush_pending(cc);
            jt_emit2(cc, jt_is_sreg(s->init->type) ? OP_RETS : OP_RET, r);
        }
        break;
    case ST_ASSIGN: {
        const JtVarInfo *v = &cc->prog->vars.items[s->var];
        bool g = jt_is_global_in_func(cc, v);
        JtExprList ops = {0};
        if (v->type == TY_STRING && jt_append_chain(cc->prog, s->init, s->var, &ops)) {
            /* x = x + a + b: CONCAT x x a; CONCAT x x b (anexa no lugar) */
            for (size_t i = 0; i < ops.len; i++) {
                uint32_t r = jt_compile_reg(cc, ops.items[i]);
                if (g) jt_emit3(cc, OP_GCONCAT, v->reg, r);
                else jt_emit4(cc, OP_CONCAT, v->reg, v->reg, r);
                cc->rnext = cc->rvars;
                jt_sreset(cc, cc->svars);
            }
            free(ops.items);
            break;
        }
        free(ops.items);
        if (g) {
            /* global dentro de funcao: calcula num temporario e grava */
            uint32_t tmp = jt_compile_reg(cc, s->init);
            jt_emit3(cc, jt_is_sreg(v->type) ? OP_GSTORES : OP_GSTORE, v->reg, tmp);
            break;
        }
        if (jt_writes_dst_early(s->init) && jt_expr_reads_var(s->init, s->var)) {
            uint32_t tmp = jt_alloc_reg(cc, v->type);
            jt_compile_into(cc, s->init, tmp);
            jt_emit3(cc, jt_is_sreg(v->type) ? OP_MOVES : OP_MOVE, v->reg, tmp);
        } else {
            jt_compile_into(cc, s->init, v->reg);
        }
        break;
    }
    case ST_VAR: {
        JtVarInfo *v = &cc->prog->vars.items[s->var];
        if (v->is_global || v->hoisted) {
            /* registrador ja reservado no inicio; valor constante ja gravado no prologo */
            if (!s->static_init) jt_compile_into(cc, s->init, v->reg);
            break;
        }
        v->reg = jt_alloc_reg(cc, v->type);
        if (jt_is_sreg(v->type)) cc->svars++;
        else cc->rvars++;
        jt_compile_into(cc, s->init, v->reg);
        break;
    }
    }
    cc->rnext = cc->rvars;
    jt_sreset(cc, cc->svars);
}

/* Registradores das variaveis do bloco sao liberados ao final dele. */
static void jt_compile_block(JtCompiler *cc, const JtBlock *b) {
    uint32_t rvars = cc->rvars, svars = cc->svars;
    for (size_t i = 0; i < b->len; i++) jt_compile_stmt(cc, &b->items[i]);
    cc->rvars = cc->rnext = rvars;
    cc->svars = svars;
    jt_sreset(cc, svars);
}

static void jt_compile_reset_frame(JtCompiler *cc) {
    cc->rvars = cc->svars = cc->rnext = cc->snext = 0;
    cc->rmax = cc->smax = 0;
}

/* Registrador reservado para o quadro todo, com o valor zero do tipo ("", [], 0). */
static void jt_compile_zeroed_var(JtCompiler *cc, JtVarInfo *v) {
    v->reg = jt_alloc_reg(cc, v->type);
    if (jt_is_sreg(v->type)) cc->svars++;
    else cc->rvars++;
    if (v->type == TY_STRING) jt_emit3(cc, OP_LOADS, v->reg, jt_const_str(cc, "", 0));
    else if (jt_is_array(v->type)) {
        jt_emit4(cc, OP_NEWARR, v->reg, 0, 0);
        jt_emit(cc, jt_is_sreg(jt_elem_type(v->type)));
    } else if (v->type == TY_DOUBLE) jt_emit3(cc, OP_LOADD, v->reg, jt_const_num(cc, 0.0));
    else jt_emit3(cc, OP_LOADI, v->reg, 0);
    cc->rnext = cc->rvars;
    cc->snext = cc->svars;
}

/* Variaveis criadas por atribuicao dentro de blocos (valem ate o fim da funcao
   owner, -1 = nivel principal): registradores reservados no inicio do quadro. */
static void jt_compile_hoisted(JtCompiler *cc, int owner) {
    for (size_t i = 0; i < cc->prog->vars.len; i++) {
        JtVarInfo *v = &cc->prog->vars.items[i];
        if (v->hoisted && v->owner == owner) jt_compile_zeroed_var(cc, v);
    }
}

/* Parametros ocupam os primeiros registradores de cada banco, na ordem. */
static void jt_compile_func(JtCompiler *cc, const JtFunc *f, int fi, JtFnInfo *info) {
    jt_compile_reset_frame(cc);
    cc->in_func = true;
    info->entry = (uint32_t)cc->chunk->code.len;
    info->file = f->file;
    info->ret = f->ret;
    info->nparams = (uint32_t)f->params.len;
    for (size_t i = 0; i < f->params.len && i < JT_MAX_NATIVE_PARAMS; i++)
        info->params[i] = cc->prog->vars.items[f->params.items[i]].type;
    for (size_t i = 0; i < f->params.len; i++) {
        JtVarInfo *v = &cc->prog->vars.items[f->params.items[i]];
        v->reg = jt_alloc_reg(cc, v->type);
        if (jt_is_sreg(v->type)) cc->svars++;
        else cc->rvars++;
    }
    cc->rnext = cc->rvars;
    cc->snext = cc->svars;
    jt_compile_hoisted(cc, fi);
    jt_compile_block(cc, &f->body);
    jt_flush_pending(cc);
    if (f->ret == TY_VOID) jt_emit(cc, OP_RETV); /* o sema garante return nas demais */
    info->nregs = cc->rmax;
    info->nsregs = cc->smax;
}

static JtChunk jt_compile(JtProgram *prog) {
    JtChunk chunk = {0};
    chunk.file = prog->file;
    JtCompiler cc = {0};
    cc.chunk = &chunk;
    cc.prog = prog;

    /* nivel principal primeiro: comeca em code[0] */
    jt_compile_reset_frame(&cc);

    /* globais: posicoes fixas reservadas antes de tudo (funcoes chamadas antes da
       declaracao ja podem usa-las), com o valor padrao ou o valor constante */
    for (size_t i = 0; i < prog->body.len; i++) {
        const JtStmt *st = &prog->body.items[i];
        if (st->kind != ST_VAR || !st->is_global) continue;
        JtVarInfo *v = &prog->vars.items[st->var];
        if (!st->static_init) {
            jt_compile_zeroed_var(&cc, v);
            continue;
        }
        v->reg = jt_alloc_reg(&cc, v->type);
        if (jt_is_sreg(v->type)) cc.svars++;
        else cc.rvars++;
        jt_compile_into(&cc, st->init, v->reg);
        cc.rnext = cc.rvars;
        cc.snext = cc.svars;
    }
    jt_compile_hoisted(&cc, -1);
    jt_compile_block(&cc, &prog->body);
    jt_flush_pending(&cc);
    jt_emit(&cc, OP_HALT);
    chunk.nregs = cc.rmax;
    chunk.nsregs = cc.smax;

    /* CALL usa o indice da funcao, entao a ordem de compilacao nao importa */
    for (size_t i = 0; i < prog->funcs.len; i++) {
        JtFnInfo info = {0};
        jt_vec_push(&chunk.fns, info);
    }
    for (size_t i = 0; i < prog->funcs.len; i++)
        if (!prog->funcs.items[i].is_extern && !prog->funcs.items[i].is_template)
            jt_compile_func(&cc, &prog->funcs.items[i], (int)i, &chunk.fns.items[i]);

    free(cc.pending);
    free(cc.gtemps.items);
    return chunk;
}

#endif
