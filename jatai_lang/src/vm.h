#ifndef JT_VM_H
#define JT_VM_H

#include "bytecode.h"

/* Formato de double compartilhado com o C++ gerado (printf/std::format). */
#define JT_DOUBLE_FMT "%.14g"

#define JT_MAX_FRAMES (1u << 20)

typedef struct {
    const uint32_t *ret; /* ip de retorno; NULL = volta para o codigo nativo (callback) */
    size_t rbase, sbase; /* base do quadro do chamador */
    size_t rtop, stop;   /* topo do quadro do chamador */
    uint32_t dst;        /* registrador do chamador que recebe o retorno */
    const char *file;    /* arquivo do chamador */
} JtFrame;

/*
 * Estado da VM. Fica numa estrutura (e nao em variaveis locais do laco de
 * execucao) para a VM ser reentrante: uma funcao nativa (extern) pode chamar
 * de volta uma funcao Jatai, que roda num laco de execucao aninhado sobre os
 * mesmos registradores e a mesma pilha de chamadas.
 */
typedef struct {
    FILE *out;
    const JtChunk *chunk;
    JtValue *Rs;           /* pilha de registradores de valores */
    JtObj **Ss;            /* pilha de registradores de objetos */
    size_t rcap, scap;
    JT_VEC(JtFrame) frames;
    size_t rtop, stop;     /* primeiro registrador livre acima do quadro em execucao */
    const char *file;      /* arquivo da funcao em execucao */
    JtHost host;
    JtValue cb_ret;        /* retorno de um callback */
    JtObj *cb_obj;         /* string devolvida por callback, mantida viva ate o proximo */
} JtVM;

#define STR(o) ((JtStr *)(o))
#define ARR(o) ((JtArr *)(o))

static JtStr *jt_str_from(const char *s, size_t n) {
    JtStr *r = jt_str_new(n);
    memcpy(r->data, s, n);
    return r;
}

/* Substitui S[dst] por o, liberando o valor anterior. */
static inline void jt_sset(JtObj **S, size_t dst, JtObj *o) {
    JtObj *old = S[dst];
    S[dst] = o;
    jt_obj_release(old);
}

/* Array de S[r] pronto para ser alterado: se compartilhado, copia antes (copy-on-write). */
static JtArr *jt_arr_mut(JtObj **S, size_t r) {
    JtArr *a = ARR(S[r]);
    if (a->h.rc == 1) return a;
    JtArr *c = jt_arr_new(a->objs, a->len);
    memcpy(c->data, a->data, a->len * sizeof *a->data);
    c->len = a->len;
    if (c->objs)
        for (uint32_t i = 0; i < c->len; i++) jt_obj_retain(c->data[i].o);
    jt_sset(S, r, &c->h);
    return c;
}

static void jt_arr_push(JtArr *a, JtValue v) {
    if (a->len == a->cap) {
        a->cap = a->cap ? a->cap * 2 : 8;
        a->data = jt_xrealloc(a->data, a->cap * sizeof *a->data);
    }
    a->data[a->len++] = v;
}

/* *slot = *slot + b. Com uma so referencia, anexa no lugar com crescimento
   geometrico (custo amortizado constante, como std::string::append). */
static void jt_concat_into(JtObj **slot, const JtStr *b) {
    JtStr *a = STR(*slot);
    size_t blen = b->len, n = (size_t)a->len + blen;
    if (a->h.rc != 1) {
        JtStr *s = jt_str_new(n);
        memcpy(s->data, a->data, a->len);
        memcpy(s->data + a->len, b->data, blen);
        *slot = &s->h;
        jt_obj_release(&a->h);
        return;
    }
    if (n > a->cap) {
        bool self = b == a;
        size_t cap = (size_t)a->cap * 2 > n ? (size_t)a->cap * 2 : n < 16 ? 16 : n;
        a = jt_xrealloc(a, sizeof(JtStr) + cap + 1);
        a->cap = (uint32_t)cap;
        *slot = &a->h;
        if (self) b = a;
    }
    memcpy(a->data + a->len, b->data, blen);
    a->len = (uint32_t)n;
    a->data[n] = '\0';
}

/* Erro em tempo de execucao: a saida pendente aparece antes da mensagem. */
static void jt_vm_fail(JtVM *vm, const char *fmt, ...) {
    va_list ap;
    fflush(vm->out);
    va_start(ap, fmt);
    vfprintf(stderr, fmt, ap);
    va_end(ap);
    fputc('\n', stderr);
    exit(1);
}

/* garante espaco nas pilhas de registradores */
static void jt_vm_reserve(JtVM *vm, size_t rneed, size_t sneed) {
    if (rneed > vm->rcap) {
        size_t n = vm->rcap * 2 > rneed ? vm->rcap * 2 : rneed;
        vm->Rs = jt_xrealloc(vm->Rs, n * sizeof *vm->Rs);
        memset(vm->Rs + vm->rcap, 0, (n - vm->rcap) * sizeof *vm->Rs);
        vm->rcap = n;
    }
    if (sneed > vm->scap) {
        size_t n = vm->scap * 2 > sneed ? vm->scap * 2 : sneed;
        vm->Ss = jt_xrealloc(vm->Ss, n * sizeof *vm->Ss);
        memset(vm->Ss + vm->scap, 0, (n - vm->scap) * sizeof *vm->Ss);
        vm->scap = n;
    }
}

/*
 * Executa a partir de ip no quadro [rbase, sbase] (topo em vm->rtop/stop).
 * Volta ao encontrar HALT ou ao retornar de um quadro sentinela (ret == NULL),
 * que marca o fim de um callback chamado pelo codigo nativo.
 */
static void jt_vm_exec(JtVM *vm, const uint32_t *ip, size_t rbase, size_t sbase) {
    const JtChunk *chunk = vm->chunk;
    const uint32_t *code = chunk->code.items;
    JtStr *const *K = chunk->strs.items;
    const double *N = chunk->nums.items;
    FILE *out = vm->out;
    JtValue *R = vm->Rs + rbase;
    JtObj **S = vm->Ss + sbase;
    size_t rtop = vm->rtop, stop = vm->stop;
    const char *cur_file = vm->file;
    char buf[64];
    uint32_t fi;

#if defined(__GNUC__) || defined(__clang__)
    /* Despacho direto via computed goto: um salto indireto por instrucao. */
    static void *const labels[] = {
        [OP_LOADI] = &&L_LOADI,   [OP_LOADD] = &&L_LOADD,   [OP_LOADS] = &&L_LOADS,
        [OP_MOVE] = &&L_MOVE,     [OP_MOVES] = &&L_MOVES,
        [OP_ADDI] = &&L_ADDI,     [OP_SUBI] = &&L_SUBI,     [OP_MULI] = &&L_MULI,
        [OP_DIVI] = &&L_DIVI,     [OP_MODI] = &&L_MODI,
        [OP_ADDD] = &&L_ADDD,     [OP_SUBD] = &&L_SUBD,     [OP_MULD] = &&L_MULD,
        [OP_DIVD] = &&L_DIVD,     [OP_NEGI] = &&L_NEGI,     [OP_NEGD] = &&L_NEGD,
        [OP_NOT] = &&L_NOT,       [OP_EQI] = &&L_EQI,       [OP_NEI] = &&L_NEI,
        [OP_D2I] = &&L_D2I,       [OP_I2D] = &&L_I2D,
        [OP_LTI] = &&L_LTI,       [OP_LEI] = &&L_LEI,       [OP_EQD] = &&L_EQD,
        [OP_NED] = &&L_NED,       [OP_LTD] = &&L_LTD,       [OP_LED] = &&L_LED,
        [OP_EQS] = &&L_EQS,       [OP_NES] = &&L_NES,       [OP_JMP] = &&L_JMP,
        [OP_JMPF] = &&L_JMPF,     [OP_JMPT] = &&L_JMPT,
        [OP_JEQI] = &&L_JEQI,     [OP_JNEI] = &&L_JNEI,     [OP_JLTI] = &&L_JLTI,
        [OP_JLEI] = &&L_JLEI,     [OP_JEQD] = &&L_JEQD,     [OP_JNED] = &&L_JNED,
        [OP_JLTD] = &&L_JLTD,     [OP_JLED] = &&L_JLED,     [OP_JNLTD] = &&L_JNLTD,
        [OP_JNLED] = &&L_JNLED,   [OP_FORLT] = &&L_FORLT,   [OP_FORGT] = &&L_FORGT,
        [OP_CALL] = &&L_CALL,     [OP_RET] = &&L_RET,       [OP_RETS] = &&L_RETS,
        [OP_RETV] = &&L_RETV,     [OP_NCALL] = &&L_NCALL,   [OP_CALLR] = &&L_CALLR,
        [OP_GLOAD] = &&L_GLOAD,   [OP_GLOADS] = &&L_GLOADS, [OP_GSTORE] = &&L_GSTORE,
        [OP_GSTORES] = &&L_GSTORES, [OP_GASET] = &&L_GASET, [OP_GASETS] = &&L_GASETS,
        [OP_GAPUSH] = &&L_GAPUSH, [OP_GAPUSHS] = &&L_GAPUSHS, [OP_GCONCAT] = &&L_GCONCAT,
        [OP_SCLEAR] = &&L_SCLEAR,
        [OP_NEWARR] = &&L_NEWARR, [OP_ALEN] = &&L_ALEN,     [OP_SLEN] = &&L_SLEN,
        [OP_AGET] = &&L_AGET,     [OP_AGETS] = &&L_AGETS,   [OP_ASET] = &&L_ASET,
        [OP_ASETS] = &&L_ASETS,   [OP_APUSH] = &&L_APUSH,   [OP_APUSHS] = &&L_APUSHS,
        [OP_ANEXT] = &&L_ANEXT,   [OP_ANEXTS] = &&L_ANEXTS, [OP_AFILL] = &&L_AFILL,
        [OP_CONCAT] = &&L_CONCAT, [OP_TOSTRI] = &&L_TOSTRI, [OP_TOSTRD] = &&L_TOSTRD,
        [OP_TOSTRC] = &&L_TOSTRC, [OP_TOSTRB] = &&L_TOSTRB, [OP_WRITEK] = &&L_WRITEK,
        [OP_WRITES] = &&L_WRITES, [OP_WRITEI] = &&L_WRITEI, [OP_WRITED] = &&L_WRITED,
        [OP_WRITEC] = &&L_WRITEC, [OP_WRITEB] = &&L_WRITEB, [OP_HALT] = &&L_HALT,
    };
#define DISPATCH() goto *labels[*ip++]
#define CASE(op) L_##op:
    DISPATCH();
#else
#define DISPATCH() goto dispatch
#define CASE(op) case OP_##op:
dispatch:
    switch (*ip++) {
#endif

    CASE(LOADI) { R[ip[0]].i = (int32_t)ip[1]; ip += 2; DISPATCH(); }
    CASE(LOADD) { R[ip[0]].d = N[ip[1]]; ip += 2; DISPATCH(); }
    CASE(LOADS) { jt_sset(S, ip[0], &K[ip[1]]->h); ip += 2; DISPATCH(); }
    CASE(MOVE)  { R[ip[0]] = R[ip[1]]; ip += 2; DISPATCH(); }
    CASE(MOVES) {
        JtObj *o = S[ip[1]];
        jt_obj_retain(o);
        jt_sset(S, ip[0], o);
        ip += 2;
        DISPATCH();
    }
    /* aritmetica inteira com wraparound em 32 bits, sem comportamento indefinido */
#define ARITH_I(op) R[ip[0]].i = (int32_t)((uint32_t)R[ip[1]].i op (uint32_t)R[ip[2]].i); ip += 3; DISPATCH();
#define BINOP(field, res, op) R[ip[0]].res = R[ip[1]].field op R[ip[2]].field; ip += 3; DISPATCH();
    CASE(ADDI) { ARITH_I(+) }
    CASE(SUBI) { ARITH_I(-) }
    CASE(MULI) { ARITH_I(*) }
    CASE(DIVI)
    CASE(MODI) {
        int32_t a = R[ip[1]].i, b = R[ip[2]].i;
        if (b == 0) jt_vm_fail(vm, "%s:%u: erro: divisao por zero", cur_file, ip[3]);
        bool mod = ip[-1] == OP_MODI;
        if (a == INT32_MIN && b == -1) R[ip[0]].i = mod ? 0 : INT32_MIN;
        else R[ip[0]].i = mod ? a % b : a / b;
        ip += 4;
        DISPATCH();
    }
    CASE(ADDD) { BINOP(d, d, +) }
    CASE(SUBD) { BINOP(d, d, -) }
    CASE(MULD) { BINOP(d, d, *) }
    CASE(DIVD) { BINOP(d, d, /) }
    CASE(NEGI) { R[ip[0]].i = (int32_t)(0u - (uint32_t)R[ip[1]].i); ip += 2; DISPATCH(); }
    CASE(NEGD) { R[ip[0]].d = -R[ip[1]].d; ip += 2; DISPATCH(); }
    CASE(NOT)  { R[ip[0]].i = !R[ip[1]].i; ip += 2; DISPATCH(); }
    CASE(D2I)  { R[ip[0]].i = (int32_t)R[ip[1]].d; ip += 2; DISPATCH(); }
    CASE(I2D)  { R[ip[0]].d = (double)R[ip[1]].i; ip += 2; DISPATCH(); }
    CASE(EQI)  { BINOP(i, i, ==) }
    CASE(NEI)  { BINOP(i, i, !=) }
    CASE(LTI)  { BINOP(i, i, <) }
    CASE(LEI)  { BINOP(i, i, <=) }
    CASE(EQD)  { BINOP(d, i, ==) }
    CASE(NED)  { BINOP(d, i, !=) }
    CASE(LTD)  { BINOP(d, i, <) }
    CASE(LED)  { BINOP(d, i, <=) }
#undef ARITH_I
#undef BINOP
    CASE(EQS)
    CASE(NES) {
        const JtStr *a = STR(S[ip[1]]), *b = STR(S[ip[2]]);
        bool eq = a == b || (a->len == b->len && memcmp(a->data, b->data, a->len) == 0);
        R[ip[0]].i = ip[-1] == OP_EQS ? eq : !eq;
        ip += 3;
        DISPATCH();
    }
    CASE(JMP)  { ip = code + ip[0]; DISPATCH(); }
    CASE(JMPF) { ip = R[ip[0]].i ? ip + 2 : code + ip[1]; DISPATCH(); }
    CASE(JMPT) { ip = R[ip[0]].i ? code + ip[1] : ip + 2; DISPATCH(); }
    /* salto comparativo: [op a b alvo] */
#define JCMP(cond) ip = (cond) ? code + ip[2] : ip + 3; DISPATCH();
    CASE(JEQI)  { JCMP(R[ip[0]].i == R[ip[1]].i) }
    CASE(JNEI)  { JCMP(R[ip[0]].i != R[ip[1]].i) }
    CASE(JLTI)  { JCMP(R[ip[0]].i <  R[ip[1]].i) }
    CASE(JLEI)  { JCMP(R[ip[0]].i <= R[ip[1]].i) }
    CASE(JEQD)  { JCMP(R[ip[0]].d == R[ip[1]].d) }
    CASE(JNED)  { JCMP(R[ip[0]].d != R[ip[1]].d) }
    CASE(JLTD)  { JCMP(R[ip[0]].d <  R[ip[1]].d) }
    CASE(JLED)  { JCMP(R[ip[0]].d <= R[ip[1]].d) }
    CASE(JNLTD) { JCMP(!(R[ip[0]].d <  R[ip[1]].d)) }
    CASE(JNLED) { JCMP(!(R[ip[0]].d <= R[ip[1]].d)) }
#undef JCMP
    /* [op i fim passo alvo]; soma em 64 bits para i nunca dar a volta */
    CASE(FORLT) {
        int64_t n = (int64_t)R[ip[0]].i + (int32_t)ip[2];
        if (n < R[ip[1]].i) { R[ip[0]].i = (int32_t)n; ip = code + ip[3]; }
        else ip += 4;
        DISPATCH();
    }
    CASE(FORGT) {
        int64_t n = (int64_t)R[ip[0]].i + (int32_t)ip[2];
        if (n > R[ip[1]].i) { R[ip[0]].i = (int32_t)n; ip = code + ip[3]; }
        else ip += 4;
        DISPATCH();
    }

    /* ---- chamadas ---- */
    CASE(CALLR) { fi = (uint32_t)R[ip[0]].i; goto do_call; }
    CASE(CALL) {
        fi = ip[0];
    do_call:;
        const JtFnInfo *fn = &chunk->fns.items[fi];
        size_t nrb = rbase + ip[1], nsb = sbase + ip[2];
        if (vm->frames.len == JT_MAX_FRAMES)
            jt_vm_fail(vm, "%s: erro: estouro de pilha (recursao profunda demais)", cur_file);
        jt_vm_reserve(vm, nrb + fn->nregs, nsb + fn->nsregs);
        JtFrame fr = { ip + 4, rbase, sbase, rtop, stop, ip[3], cur_file };
        jt_vec_push(&vm->frames, fr);
        rbase = nrb;
        sbase = nsb;
        rtop = nrb + fn->nregs;
        stop = nsb + fn->nsregs;
        R = vm->Rs + rbase;
        S = vm->Ss + sbase;
        cur_file = fn->file;
        ip = code + fn->entry;
        DISPATCH();
    }
    /* funcao extern: argumentos (ja nos registradores, como no CALL) convertidos para a ABI nativa */
    CASE(NCALL) {
        const JtNative *nf = &chunk->natives[ip[0]];
        JtNValue args[JT_MAX_NATIVE_PARAMS], ret = {0};
        uint32_t ri = ip[1], si = ip[2];
        for (uint32_t k = 0; k < nf->nparams; k++) {
            JtType t = nf->params[k];
            if (t == TY_STRING) {
                const JtStr *str = STR(S[si++]);
                args[k].s.p = str->data;
                args[k].s.n = str->len;
            } else if (t == TY_DOUBLE) {
                args[k].d = R[ri++].d;
            } else {
                args[k].i = R[ri++].i; /* int, char, bool e valor de funcao */
            }
        }
        fflush(out); /* a funcao nativa pode escrever na saida ou demorar (sleep) */
        /* a funcao nativa pode chamar callbacks: eles usam os registradores acima deste quadro */
        vm->rtop = rtop;
        vm->stop = stop;
        vm->file = cur_file;
        nf->invoke(nf, args, &ret, &vm->host);
        R = vm->Rs + rbase; /* os callbacks podem ter realocado as pilhas */
        S = vm->Ss + sbase;
        if (nf->ret == TY_STRING) jt_sset(S, ip[3], (JtObj *)ret.o);
        else if (nf->ret == TY_DOUBLE) R[ip[3]].d = ret.d;
        else if (nf->ret != TY_VOID) R[ip[3]].i = ret.i;
        ip += 4;
        DISPATCH();
    }
#define POP_FRAME()                                           \
    const JtFrame fr = vm->frames.items[--vm->frames.len];    \
    rbase = fr.rbase;                                         \
    sbase = fr.sbase;                                         \
    rtop = fr.rtop;                                           \
    stop = fr.stop;                                           \
    cur_file = fr.file;                                       \
    R = vm->Rs + rbase;                                       \
    S = vm->Ss + sbase;                                       \
    ip = fr.ret;                                              \
    if (!ip) { /* fim de um callback: volta para o codigo nativo */ \
        vm->rtop = rtop;                                      \
        vm->stop = stop;                                      \
        vm->file = cur_file;                                  \
    }
    CASE(RET) {
        JtValue v = R[ip[0]];
        POP_FRAME();
        if (!ip) { vm->cb_ret = v; return; }
        R[fr.dst] = v;
        DISPATCH();
    }
    CASE(RETS) {
        JtObj *v = S[ip[0]];
        jt_obj_retain(v);
        POP_FRAME();
        if (!ip) {
            jt_obj_release(vm->cb_obj);
            vm->cb_obj = v;
            return;
        }
        jt_sset(S, fr.dst, v);
        DISPATCH();
    }
    CASE(RETV) {
        POP_FRAME();
        if (!ip) return;
        DISPATCH();
    }
#undef POP_FRAME

    /* ---- globais (posicoes absolutas no quadro do nivel principal) ---- */
    CASE(GLOAD)  { R[ip[0]] = vm->Rs[ip[1]]; ip += 2; DISPATCH(); }
    CASE(GLOADS) {
        JtObj *o = vm->Ss[ip[1]];
        jt_obj_retain(o);
        jt_sset(S, ip[0], o);
        ip += 2;
        DISPATCH();
    }
    CASE(GSTORE) { vm->Rs[ip[0]] = R[ip[1]]; ip += 2; DISPATCH(); }
    CASE(GSTORES) {
        JtObj *o = S[ip[1]];
        jt_obj_retain(o);
        jt_sset(vm->Ss, ip[0], o);
        ip += 2;
        DISPATCH();
    }
    CASE(GCONCAT) { jt_concat_into(&vm->Ss[ip[0]], STR(S[ip[1]])); ip += 2; DISPATCH(); }
    CASE(SCLEAR) { jt_sset(S, ip[0], NULL); ip += 1; DISPATCH(); }

    /* ---- arrays ---- */
    CASE(NEWARR) {
        uint32_t n = ip[1], base = ip[2];
        JtArr *a = jt_arr_new(ip[3], n);
        if (a->objs) {
            for (uint32_t k = 0; k < n; k++) {
                jt_obj_retain(S[base + k]);
                a->data[k].o = S[base + k];
            }
        } else {
            memcpy(a->data, R + base, n * sizeof *a->data);
        }
        a->len = n;
        jt_sset(S, ip[0], &a->h);
        ip += 4;
        DISPATCH();
    }
    CASE(AFILL) {
        int32_t n = R[ip[2]].i;
        if (n < 0) jt_vm_fail(vm, "%s:%u: erro: tamanho de array negativo (%d)", cur_file, ip[4], n);
        JtArr *a = jt_arr_new(ip[3], (uint32_t)n);
        JtValue v;
        if (a->objs) {
            v.o = S[ip[1]];
            if (v.o->rc != JT_RC_PINNED) v.o->rc += (uint32_t)n;
        } else {
            v = R[ip[1]];
        }
        for (int32_t k = 0; k < n; k++) a->data[k] = v;
        a->len = (uint32_t)n;
        jt_sset(S, ip[0], &a->h);
        ip += 5;
        DISPATCH();
    }
    CASE(ALEN) { R[ip[0]].i = (int32_t)ARR(S[ip[1]])->len; ip += 2; DISPATCH(); }
    CASE(SLEN) { R[ip[0]].i = (int32_t)STR(S[ip[1]])->len; ip += 2; DISPATCH(); }
    /* verificacao de limites: [op x arr indice linha] */
#define CHECK_INDEX(arr, i)                                                              \
    if ((uint32_t)(i) >= (arr)->len)                                                     \
        jt_vm_fail(vm, "%s:%u: erro: indice %d fora dos limites (tamanho %u)", cur_file, \
                   ip[3], (i), (arr)->len);
    CASE(AGET) {
        const JtArr *a = ARR(S[ip[1]]);
        int32_t i = R[ip[2]].i;
        CHECK_INDEX(a, i);
        R[ip[0]] = a->data[i];
        ip += 4;
        DISPATCH();
    }
    CASE(AGETS) {
        const JtArr *a = ARR(S[ip[1]]);
        int32_t i = R[ip[2]].i;
        CHECK_INDEX(a, i);
        JtObj *o = a->data[i].o;
        jt_obj_retain(o);
        jt_sset(S, ip[0], o);
        ip += 4;
        DISPATCH();
    }
    /* ASET/ASETS e as versoes para globais (base = S ou as globais) */
#define ARRAY_SET(base, slot, objs)                          \
    {                                                        \
        int32_t i = R[ip[1]].i;                              \
        CHECK_INDEX(ARR(base[slot]), i);                     \
        JtArr *a = jt_arr_mut(base, slot);                   \
        if (objs) {                                          \
            JtObj *o = S[ip[2]];                             \
            jt_obj_retain(o);                                \
            jt_obj_release(a->data[i].o);                    \
            a->data[i].o = o;                                \
        } else {                                             \
            a->data[i] = R[ip[2]];                           \
        }                                                    \
        ip += 4;                                             \
        DISPATCH();                                          \
    }
    CASE(ASET)   ARRAY_SET(S, ip[0], false)
    CASE(ASETS)  ARRAY_SET(S, ip[0], true)
    CASE(GASET)  ARRAY_SET(vm->Ss, ip[0], false)
    CASE(GASETS) ARRAY_SET(vm->Ss, ip[0], true)
#undef ARRAY_SET
#undef CHECK_INDEX
    CASE(APUSH)  { jt_arr_push(jt_arr_mut(S, ip[0]), R[ip[1]]); ip += 2; DISPATCH(); }
    CASE(GAPUSH) { jt_arr_push(jt_arr_mut(vm->Ss, ip[0]), R[ip[1]]); ip += 2; DISPATCH(); }
    CASE(APUSHS)
    CASE(GAPUSHS) {
        JtObj *o = S[ip[1]];
        jt_obj_retain(o);
        JtValue v = { .o = o };
        jt_arr_push(jt_arr_mut(ip[-1] == OP_GAPUSHS ? vm->Ss : S, ip[0]), v);
        ip += 2;
        DISPATCH();
    }
    CASE(ANEXT) {
        const JtArr *a = ARR(S[ip[0]]);
        int32_t i = R[ip[1]].i;
        if ((uint32_t)i < a->len) {
            R[ip[2]] = a->data[i];
            R[ip[1]].i = i + 1;
            ip = code + ip[3];
        } else {
            ip += 4;
        }
        DISPATCH();
    }
    CASE(ANEXTS) {
        const JtArr *a = ARR(S[ip[0]]);
        int32_t i = R[ip[1]].i;
        if ((uint32_t)i < a->len) {
            JtObj *o = a->data[i].o;
            jt_obj_retain(o);
            jt_sset(S, ip[2], o);
            R[ip[1]].i = i + 1;
            ip = code + ip[3];
        } else {
            ip += 4;
        }
        DISPATCH();
    }

    /* ---- strings e saida ---- */
    CASE(CONCAT) {
        if (ip[0] == ip[1]) {
            jt_concat_into(&S[ip[0]], STR(S[ip[2]])); /* x = x + b: anexa no lugar */
        } else {
            const JtStr *a = STR(S[ip[1]]), *b = STR(S[ip[2]]);
            JtStr *s = jt_str_new((size_t)a->len + b->len);
            memcpy(s->data, a->data, a->len);
            memcpy(s->data + a->len, b->data, b->len);
            jt_sset(S, ip[0], &s->h);
        }
        ip += 3;
        DISPATCH();
    }
    CASE(TOSTRI) {
        int n = snprintf(buf, sizeof buf, "%d", R[ip[1]].i);
        jt_sset(S, ip[0], &jt_str_from(buf, (size_t)n)->h);
        ip += 2;
        DISPATCH();
    }
    CASE(TOSTRD) {
        int n = snprintf(buf, sizeof buf, JT_DOUBLE_FMT, R[ip[1]].d);
        jt_sset(S, ip[0], &jt_str_from(buf, (size_t)n)->h);
        ip += 2;
        DISPATCH();
    }
    CASE(TOSTRC) {
        buf[0] = (char)R[ip[1]].i;
        jt_sset(S, ip[0], &jt_str_from(buf, 1)->h);
        ip += 2;
        DISPATCH();
    }
    CASE(TOSTRB) {
        jt_sset(S, ip[0], &(R[ip[1]].i ? jt_str_from("true", 4) : jt_str_from("false", 5))->h);
        ip += 2;
        DISPATCH();
    }
    CASE(WRITEK) { fwrite(K[ip[0]]->data, 1, K[ip[0]]->len, out); ip += 1; DISPATCH(); }
    CASE(WRITES) { fwrite(STR(S[ip[0]])->data, 1, STR(S[ip[0]])->len, out); ip += 1; DISPATCH(); }
    CASE(WRITEI) { fprintf(out, "%d", R[ip[0]].i); ip += 1; DISPATCH(); }
    CASE(WRITED) { fprintf(out, JT_DOUBLE_FMT, R[ip[0]].d); ip += 1; DISPATCH(); }
    CASE(WRITEC) { fputc(R[ip[0]].i, out); ip += 1; DISPATCH(); }
    CASE(WRITEB) { fputs(R[ip[0]].i ? "true" : "false", out); ip += 1; DISPATCH(); }
    CASE(HALT) { return; }

#if !(defined(__GNUC__) || defined(__clang__))
    }
#endif
#undef DISPATCH
#undef CASE
}

/* host->call: codigo nativo chamando uma funcao Jatai (callback) */
static void jt_host_call(void *vmp, int32_t fi, const JtNValue *args, JtNValue *ret) {
    JtVM *vm = vmp;
    const JtFnInfo *fn = &vm->chunk->fns.items[fi];
    size_t nrb = vm->rtop, nsb = vm->stop;
    if (vm->frames.len == JT_MAX_FRAMES)
        jt_vm_fail(vm, "%s: erro: estouro de pilha (recursao profunda demais)", vm->file);
    jt_vm_reserve(vm, nrb + fn->nregs, nsb + fn->nsregs);

    uint32_t ri = 0, si = 0;
    for (uint32_t k = 0; k < fn->nparams; k++) {
        JtType t = fn->params[k];
        if (t == TY_STRING) jt_sset(vm->Ss, nsb + si++, &jt_str_from(args[k].s.p, args[k].s.n)->h);
        else if (t == TY_DOUBLE) vm->Rs[nrb + ri++].d = args[k].d;
        else vm->Rs[nrb + ri++].i = args[k].i;
    }

    JtFrame sentinel = { NULL, 0, 0, vm->rtop, vm->stop, 0, vm->file };
    jt_vec_push(&vm->frames, sentinel);
    vm->rtop = nrb + fn->nregs;
    vm->stop = nsb + fn->nsregs;
    vm->file = fn->file;
    jt_vm_exec(vm, vm->chunk->code.items + fn->entry, nrb, nsb);

    if (fn->ret == TY_STRING) {
        const JtStr *s = STR(vm->cb_obj);
        ret->s.p = s->data; /* valido ate o proximo callback que devolva string */
        ret->s.n = s->len;
    } else if (fn->ret == TY_DOUBLE) {
        ret->d = vm->cb_ret.d;
    } else if (fn->ret != TY_VOID) {
        ret->i = vm->cb_ret.i;
    }
}

static void *jt_host_new_str(const char *p, size_t n) { return &jt_str_from(p, n)->h; }

static void jt_vm_init(JtVM *vm, FILE *out) {
    memset(vm, 0, sizeof *vm);
    vm->out = out;
    vm->host.new_str = jt_host_new_str;
    vm->host.call = jt_host_call;
    vm->host.vm = vm;
}

static int jt_vm_run(JtVM *vm, const JtChunk *chunk) {
    vm->chunk = chunk;
    vm->rcap = chunk->nregs + 256;
    vm->scap = chunk->nsregs + 256;
    vm->Rs = calloc(vm->rcap, sizeof *vm->Rs);
    vm->Ss = calloc(vm->scap, sizeof *vm->Ss);
    vm->rtop = chunk->nregs;
    vm->stop = chunk->nsregs;
    vm->file = chunk->file;
    jt_vm_exec(vm, chunk->code.items, 0, 0);
    fflush(vm->out);
    for (size_t i = 0; i < vm->scap; i++) jt_obj_release(vm->Ss[i]);
    jt_obj_release(vm->cb_obj);
    free(vm->Ss);
    free(vm->Rs);
    free(vm->frames.items);
#ifdef JT_DEBUG_ALLOC
    fprintf(stderr, "[memoria] strings: %lld criadas, %lld vivas | arrays: %lld criados, %lld vivos\n",
            jt_dbg_created[JT_OBJ_STR], jt_dbg_live[JT_OBJ_STR], jt_dbg_created[JT_OBJ_ARR], jt_dbg_live[JT_OBJ_ARR]);
#endif
    return 0;
}

#endif
