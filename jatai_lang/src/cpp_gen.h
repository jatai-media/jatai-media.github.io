#ifndef JT_CPP_GEN_H
#define JT_CPP_GEN_H

#include "ast.h"

/*
 * Transpilador AST -> C++20. Traducao 1:1, sem runtime embutido:
 * cada instrucao Jatai vira uma instrucao C++ usando so a biblioteca padrao.
 *   int -> int, double -> double, string -> std::string, char -> char, bool -> bool
 *   print/println com {var} -> std::printf direto (sem string intermediaria)
 *   "{var}" fora de print    -> std::format
 * Doubles usam %.14g nos dois modos para a saida ser identica a da VM.
 */

typedef struct {
    FILE *f;
    const JtProgram *prog;
    int hoisted; /* contador dos nomes jt_o<N> (operandos calculados antes, ver jt_cpp_hoist) */
} JtCppGen;

/* Nomes Jatai que colidem com palavras reservadas/macros do C++ ganham '_' no fim. */
static const char *const jt_cpp_reserved[] = {
    "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "break", "case", "catch",
    "char8_t", "char16_t", "char32_t", "class", "compl", "concept", "const", "consteval", "constexpr",
    "constinit", "const_cast", "continue", "co_await", "co_return", "co_yield", "decltype", "default",
    "delete", "do", "dynamic_cast", "else", "enum", "explicit", "export", "extern", "float", "for",
    "friend", "goto", "if", "inline", "long", "mutable", "namespace", "new", "noexcept", "not", "not_eq",
    "nullptr", "operator", "or", "or_eq", "private", "protected", "public", "register",
    "reinterpret_cast", "requires", "return", "short", "signed", "sizeof", "static", "static_assert",
    "static_cast", "struct", "switch", "template", "this", "thread_local", "throw", "try", "typedef",
    "typeid", "typename", "union", "unsigned", "using", "virtual", "void", "volatile", "wchar_t",
    "while", "xor", "xor_eq", "main", "std", "stdin", "stdout", "stderr", "EOF", "NULL", "errno",
};

/* Nomes da biblioteca C que ja existem no escopo global do C++ (<cstdio>, <ctime>...):
   uma variavel global ou funcao do programa com esse nome colidiria. */
static const char *const jt_cpp_libc[] = {
    "time", "clock", "rand", "srand", "abs", "labs", "div", "exit", "abort", "free", "malloc",
    "calloc", "realloc", "printf", "puts", "putchar", "getchar", "gets", "fopen", "fclose", "fgets",
    "fputs", "fprintf", "sprintf", "scanf", "perror", "remove", "rename", "tmpfile", "signal",
    "raise", "sleep", "index", "y0", "y1", "yn", "j0", "j1", "jn", "log", "exp", "sin", "cos", "tan",
    "sqrt", "pow", "floor", "ceil", "round", "fabs", "atoi", "atof", "atol", "system", "getenv",
    "read", "write", "open", "close", "access", "unlink", "link", "dup", "pipe", "select", "stat",
    "qsort", "bsearch", "strlen", "strcmp", "strcpy", "memcpy", "memset", "isalpha", "isdigit",
    "toupper", "tolower", "setjmp", "longjmp", "difftime", "mktime", "localtime", "gmtime",
};

static bool jt_in_list(const char *name, size_t len, const char *const *list, size_t n) {
    for (size_t i = 0; i < n; i++)
        if (jt_str_is(name, len, list[i])) return true;
    return false;
}

/* global_scope: o nome fica no escopo global do C++ (variavel global, funcao do programa) */
static void jt_cpp_name_scoped(JtCppGen *g, const char *name, size_t len, bool global_scope) {
    fwrite(name, 1, len, g->f);
    if (jt_in_list(name, len, jt_cpp_reserved, sizeof jt_cpp_reserved / sizeof *jt_cpp_reserved) ||
        (global_scope && jt_in_list(name, len, jt_cpp_libc, sizeof jt_cpp_libc / sizeof *jt_cpp_libc)))
        fputc('_', g->f);
}

static void jt_cpp_name(JtCppGen *g, const char *name, size_t len) { jt_cpp_name_scoped(g, name, len, false); }

static void jt_cpp_var(JtCppGen *g, int index) {
    const JtVarInfo *v = &g->prog->vars.items[index];
    jt_cpp_name_scoped(g, v->name, v->name_len, v->is_global);
}

/* Instancia de funcao com parametro sem tipo: um nome por combinacao de tipos,
   dobro(x) -> dobro__int, dobro__double (o C++ nao distingue char[] de bool[]
   por sobrecarga, ambos viram std::vector<char>). */
static void jt_cpp_func_name(JtCppGen *g, int fi) {
    const JtFunc *fn = &g->prog->funcs.items[fi];
    if (fn->template_of < 0 || !g->prog->funcs.items[fn->template_of].is_generic) {
        jt_cpp_name_scoped(g, fn->name, fn->name_len, fn->module < 0);
        return;
    }
    const JtFunc *t = &g->prog->funcs.items[fn->template_of];
    fwrite(fn->name, 1, fn->name_len, g->f);
    fputc('_', g->f);
    for (size_t k = 0; k < fn->params.len; k++) {
        if (g->prog->vars.items[t->params.items[k]].type != TY_AUTO) continue;
        JtType ty = g->prog->vars.items[fn->params.items[k]].type;
        if (jt_is_array(ty)) fprintf(g->f, "_%s_arr", jt_type_name(jt_elem_type(ty)));
        else fprintf(g->f, "_%s", jt_type_name(ty));
    }
}

static void jt_cpp_char_esc(FILE *f, unsigned char c, char quote) {
    switch (c) {
    case '\n': fputs("\\n", f); return;
    case '\t': fputs("\\t", f); return;
    case '\r': fputs("\\r", f); return;
    case '\\': fputs("\\\\", f); return;
    }
    if (c == (unsigned char)quote) { fputc('\\', f); fputc(c, f); }
    else if (c < 0x20 || c == 0x7F) fprintf(f, "\\%03o", c);
    else fputc(c, f);
}

/* Literal de string C++. Strings """...""" viram raw string literal R"jt(...)jt",
   que mantem o texto (HTML, CSS...) legivel e com as quebras de linha no .cpp. */
typedef struct {
    bool raw;
    char delim[16]; /* delimitador do raw literal, escolhido para nao aparecer no texto */
} JtCppLit;

static bool jt_mem_contains(const char *s, size_t n, const char *pat) {
    size_t m = strlen(pat);
    for (size_t i = 0; i + m <= n; i++)
        if (memcmp(s + i, pat, m) == 0) return true;
    return false;
}

/* prepara o literal de e (EX_STRING ou EX_INTERP) */
static JtCppLit jt_cpp_lit_for(const JtExpr *e) {
    JtCppLit lit = {0};
    lit.raw = e->multiline;
    if (!lit.raw) return lit;
    for (int k = 0;; k++) {
        char pat[24];
        snprintf(lit.delim, sizeof lit.delim, k ? "jt%d" : "jt", k);
        snprintf(pat, sizeof pat, ")%s\"", lit.delim);
        bool clash = false;
        if (e->kind == EX_STRING) clash = jt_mem_contains(e->str.data, e->str.len, pat);
        else
            for (size_t i = 0; i < e->interp.n && !clash; i++)
                if (!e->interp.parts[i].expr)
                    clash = jt_mem_contains(e->interp.parts[i].text, e->interp.parts[i].len, pat);
        if (!clash) return lit;
    }
}

static void jt_cpp_lit_open(FILE *f, const JtCppLit *lit) {
    if (lit->raw) fprintf(f, "R\"%s(", lit->delim);
    else fputc('"', f);
}

static void jt_cpp_lit_close(FILE *f, const JtCppLit *lit) {
    if (lit->raw) fprintf(f, ")%s\"", lit->delim);
    else fputc('"', f);
}

/* Texto dentro do literal. fmt_escape: '%' (printf), '{' (std::format) ou 0. */
static void jt_cpp_text(FILE *f, const JtCppLit *lit, const char *s, size_t n, char fmt_escape) {
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (fmt_escape == '%' && c == '%') fputs("%%", f);
        else if (fmt_escape == '{' && (c == '{' || c == '}')) { fputc(c, f); fputc(c, f); }
        else if (lit->raw) fputc(c, f);
        else jt_cpp_char_esc(f, c, '"');
    }
}

static void jt_cpp_string_lit(FILE *f, const JtExpr *e) {
    JtCppLit lit = jt_cpp_lit_for(e);
    jt_cpp_lit_open(f, &lit);
    jt_cpp_text(f, &lit, e->str.data, e->str.len, 0);
    jt_cpp_lit_close(f, &lit);
}

/* Precedencia do C++ (maior liga mais forte). Os parenteses sao decididos
   por ela e nao pela do Jatai: "not a == b" precisa virar "!(a == b)". */
enum { CPREC_OR = 1, CPREC_AND, CPREC_EQ, CPREC_REL, CPREC_ADD, CPREC_MUL, CPREC_UNARY, CPREC_ATOM = 100 };

static const struct { const char *tok; int prec; } jt_cpp_binops[] = {
    [OPB_ADD] = { "+", CPREC_ADD },   [OPB_SUB] = { "-", CPREC_ADD },
    [OPB_MUL] = { "*", CPREC_MUL },   [OPB_DIV] = { "/", CPREC_MUL },   [OPB_MOD] = { "%", CPREC_MUL },
    [OPB_EQ]  = { "==", CPREC_EQ },   [OPB_NE]  = { "!=", CPREC_EQ },
    [OPB_LT]  = { "<", CPREC_REL },   [OPB_LE]  = { "<=", CPREC_REL },
    [OPB_GT]  = { ">", CPREC_REL },   [OPB_GE]  = { ">=", CPREC_REL },
    [OPB_AND] = { "&&", CPREC_AND },  [OPB_OR]  = { "||", CPREC_OR },
};

static int jt_cpp_prec(const JtExpr *e) {
    if (e->kind == EX_UNARY || e->kind == EX_LEN || e->kind == EX_CONV) return CPREC_UNARY; /* casts */
    if (e->kind == EX_BINARY) return jt_cpp_binops[e->bin.op].prec;
    return CPREC_ATOM;
}

static void jt_cpp_expr(JtCppGen *g, const JtExpr *e);
static const char *jt_cpp_type(JtType t);

static void jt_cpp_operand(JtCppGen *g, const JtExpr *e, int parent_prec, bool right) {
    int p = jt_cpp_prec(e);
    bool paren = p < parent_prec || (right && p == parent_prec);
    if (paren) fputc('(', g->f);
    jt_cpp_expr(g, e);
    if (paren) fputc(')', g->f);
}


/*
 * Ordem de avaliacao. O Jatai calcula da esquerda para a direita (ver
 * jt_expr_order_sensitive); o C++ nao garante a ordem entre argumentos de uma
 * chamada nem entre os lados de + - * == etc. (o g++ costuma ir da direita para a
 * esquerda). Quando a ordem muda o resultado, os operandos sensiveis sao
 * calculados antes, em locais de uma lambda:
 *     f(g(), h())  ->  [&] { auto jt_o0 = g(); return f(jt_o0, h()); }()
 * O ultimo sensivel fica no lugar: ele ja e calculado depois dos outros.
 * Devolve quantos operandos de xs[0..n) vao para locais (marcados em hoist).
 */
static size_t jt_cpp_hoist(const JtCppGen *g, JtExpr *const *xs, size_t n, bool *hoist) {
    size_t sens = 0, last = 0;
    bool call = false;
    for (size_t i = 0; i < n; i++) {
        hoist[i] = false;
        if (!jt_expr_order_sensitive(g->prog, xs[i])) continue;
        sens++;
        last = i;
        if (jt_expr_has_effect(g->prog, xs[i])) call = true;
    }
    if (sens < 2 || !call) return 0;
    size_t k = 0;
    for (size_t i = 0; i < last; i++)
        if (jt_expr_order_sensitive(g->prog, xs[i])) { hoist[i] = true; k++; }
    return k;
}

/* abre a lambda e calcula os operandos marcados: "[&] { auto jt_o<N> = x; ... return ".
   Devolve o primeiro N; jt_cpp_hoisted_arg usa os nomes na mesma ordem. */
static int jt_cpp_hoist_open(JtCppGen *g, JtExpr *const *xs, size_t n, const bool *hoist, bool ret) {
    int base = g->hoisted;
    fputs("[&] { ", g->f);
    for (size_t i = 0; i < n; i++) {
        if (!hoist[i]) continue;
        int id = g->hoisted++;
        fprintf(g->f, "auto jt_o%d = ", id);
        jt_cpp_expr(g, xs[i]);
        fputs("; ", g->f);
    }
    if (ret) fputs("return ", g->f);
    return base;
}

/* "a{f()}b{x}": mesma regra, com todas as partes em locais:
   [&] { auto jt_i0 = f(); auto jt_i1 = x; return std::format("a{}b{}", jt_i0, jt_i1); }() */
static bool jt_interp_ordered(const JtCppGen *g, const JtExpr *e) {
    if (e->kind != EX_INTERP) return false;
    size_t sens = 0;
    bool call = false;
    for (size_t i = 0; i < e->interp.n; i++) {
        const JtExpr *x = e->interp.parts[i].expr;
        if (!x || !jt_expr_order_sensitive(g->prog, x)) continue;
        sens++;
        if (jt_expr_has_effect(g->prog, x)) call = true;
    }
    return call && sens > 1;
}

/* "[&] { auto jt_i0 = ...; ... " da forma ordenada */
static void jt_cpp_interp_locals(JtCppGen *g, const JtExpr *e) {
    fputs("[&] { ", g->f);
    size_t k = 0;
    for (size_t i = 0; i < e->interp.n; i++) {
        if (!e->interp.parts[i].expr) continue;
        fprintf(g->f, "auto jt_i%zu = ", k++);
        jt_cpp_expr(g, e->interp.parts[i].expr);
        fputs("; ", g->f);
    }
}

/* argumentos das partes {expr}, separados por ", " (printf: string -> .c_str(), bool -> texto);
   locals: usa jt_i0, jt_i1... da forma ordenada */
static void jt_cpp_interp_args(JtCppGen *g, const JtExpr *e, bool printf_args, bool locals) {
    size_t k = 0;
    for (size_t i = 0; i < e->interp.n; i++) {
        const JtExpr *x = e->interp.parts[i].expr;
        if (!x) continue;
        if (k) fputs(", ", g->f);
        if (locals) fprintf(g->f, "jt_i%zu", k);
        k++;
        if (!printf_args) { if (!locals) jt_cpp_expr(g, x); continue; }
        /* .c_str() e ?: precisam do valor inteiro como operando */
        if (!locals) jt_cpp_operand(g, x, x->type == TY_STRING || x->type == TY_BOOL ? CPREC_ATOM : 0, false);
        if (x->type == TY_STRING) fputs(".c_str()", g->f);
        else if (x->type == TY_BOOL) fputs(" ? \"true\" : \"false\"", g->f);
    }
}

/* "{x}" fora de print -> std::format. Strings """...""" (paginas inteiras) usam
   std::vformat: o std::format valida o formato em tempo de compilacao, e com
   megabytes de texto isso estoura o limite de avaliacao constante do g++. */
static void jt_cpp_interp_format(JtCppGen *g, const JtExpr *e) {
    FILE *f = g->f;
    JtCppLit lit = jt_cpp_lit_for(e);
    bool ordered = jt_interp_ordered(g, e);
    /* std::make_format_args so aceita lvalues: com alguma parte que nao e variavel,
       os valores passam por uma lambda, cujos parametros tem nome */
    bool lambda = false;
    for (size_t i = 0; i < e->interp.n && e->multiline && !ordered; i++)
        if (e->interp.parts[i].expr && e->interp.parts[i].expr->kind != EX_VAR) lambda = true;
    if (ordered) {
        jt_cpp_interp_locals(g, e);
        fputs("return ", f);
    }
    if (lambda) fputs("[](const auto&... a) { return ", f);
    fputs(e->multiline ? "std::vformat(" : "std::format(", f);
    jt_cpp_lit_open(f, &lit);
    for (size_t i = 0; i < e->interp.n; i++) {
        const JtInterpPart *part = &e->interp.parts[i];
        if (!part->expr) jt_cpp_text(f, &lit, part->text, part->len, '{');
        else fputs(part->expr->type == TY_DOUBLE ? "{:.14g}" : "{}", f);
    }
    jt_cpp_lit_close(f, &lit);
    if (lambda) {
        fputs(", std::make_format_args(a...)); }(", f);
        jt_cpp_interp_args(g, e, false, false);
        fputs(")", f);
        return;
    }
    fputs(e->multiline ? ", std::make_format_args(" : ", ", f);
    jt_cpp_interp_args(g, e, false, ordered);
    fputs(e->multiline ? "))" : ")", f);
    if (ordered) fputs("; }()", f);
}

static void jt_cpp_expr(JtCppGen *g, const JtExpr *e) {
    FILE *f = g->f;
    switch (e->kind) {
    case EX_INT:    fwrite(e->i.lexeme, 1, e->i.lexeme_len, f); break;
    case EX_DOUBLE: fwrite(e->d.lexeme, 1, e->d.lexeme_len, f); break;
    case EX_STRING: jt_cpp_string_lit(f, e); break;
    case EX_CHAR:
        fputc('\'', f);
        jt_cpp_char_esc(f, (unsigned char)e->ch, '\'');
        fputc('\'', f);
        break;
    case EX_BOOL:   fputs(e->b ? "true" : "false", f); break;
    case EX_VAR:    jt_cpp_var(g, e->var.index); break;
    case EX_UNARY: {
        fputc(e->un.op == OPU_NOT ? '!' : '-', f);
        /* operando unario sempre entre parenteses: evita "--x" (decremento) */
        bool paren = e->un.x->kind == EX_UNARY || jt_cpp_prec(e->un.x) < CPREC_UNARY;
        if (paren) fputc('(', f);
        jt_cpp_expr(g, e->un.x);
        if (paren) fputc(')', f);
        break;
    }
    case EX_BINARY: {
        int p = jt_cpp_prec(e);
        JtExpr *xs[2] = { e->bin.l, e->bin.r };
        bool hoist[2];
        /* and/or ja sao da esquerda para a direita no C++ */
        if (e->bin.op != OPB_AND && e->bin.op != OPB_OR && jt_cpp_hoist(g, xs, 2, hoist)) {
            int id = jt_cpp_hoist_open(g, xs, 2, hoist, true);
            fprintf(f, "jt_o%d %s ", id, jt_cpp_binops[e->bin.op].tok);
            jt_cpp_operand(g, e->bin.r, p, true);
            fputs("; }()", f);
            break;
        }
        jt_cpp_operand(g, e->bin.l, p, false);
        fprintf(f, " %s ", jt_cpp_binops[e->bin.op].tok);
        jt_cpp_operand(g, e->bin.r, p, true);
        break;
    }
    case EX_INTERP: jt_cpp_interp_format(g, e); break;
    case EX_CALL: {
        bool *hoist = jt_xmalloc(e->call.nargs + 1);
        size_t nh = jt_cpp_hoist(g, e->call.args, e->call.nargs, hoist);
        int id = nh ? jt_cpp_hoist_open(g, e->call.args, e->call.nargs, hoist, true) : 0;
        if (e->call.qual >= 0) {
            /* modulo.f(...) -> jatai::modulo::f(...) */
            const JtModule *m = &g->prog->modules.items[e->call.qual];
            fputs("jatai::", f);
            jt_cpp_name(g, m->name, m->name_len);
            fputs("::", f);
        }
        if (e->call.fnvar >= 0) jt_cpp_var(g, e->call.fnvar);
        else jt_cpp_func_name(g, e->call.fn);
        fputc('(', f);
        for (size_t i = 0; i < e->call.nargs; i++) {
            if (i) fputs(", ", f);
            if (hoist[i]) fprintf(f, "jt_o%d", id++);
            else jt_cpp_expr(g, e->call.args[i]);
        }
        fputc(')', f);
        if (nh) fputs("; }()", f);
        free(hoist);
        break;
    }
    case EX_ARRAY:
        fprintf(f, "%s{", jt_cpp_type(e->type));
        for (size_t i = 0; i < e->arr.n; i++) {
            if (i) fputs(", ", f);
            jt_cpp_expr(g, e->arr.items[i]);
        }
        fputc('}', f);
        break;
    case EX_INDEX: {
        JtExpr *xs[2] = { e->idx.base, e->idx.index };
        bool hoist[2];
        if (jt_cpp_hoist(g, xs, 2, hoist)) {
            /* a funcao do indice pode mudar o array global: vale o array de antes */
            int id = jt_cpp_hoist_open(g, xs, 2, hoist, true);
            fprintf(f, "jt_o%d[", id);
            jt_cpp_expr(g, e->idx.index);
            fputs("]; }()", f);
            break;
        }
        jt_cpp_operand(g, e->idx.base, CPREC_ATOM, false);
        fputc('[', f);
        jt_cpp_expr(g, e->idx.index);
        fputc(']', f);
        break;
    }
    case EX_LEN:
        fputs("(int)", f);
        jt_cpp_operand(g, e->len, CPREC_ATOM, false);
        fputs(".size()", f);
        break;
    case EX_FNREF:
        jt_cpp_func_name(g, e->fnref);
        break;
    case EX_CONV:
        fprintf(f, "(%s)", jt_cpp_type(e->conv.to));
        jt_cpp_operand(g, e->conv.x, CPREC_UNARY, false);
        break;
    case EX_FILL: {
        /* o construtor recebe (tamanho, valor), mas o Jatai calcula o valor primeiro */
        JtExpr *xs[2] = { e->fill.value, e->fill.count };
        bool hoist[2];
        int id = jt_cpp_hoist(g, xs, 2, hoist) ? jt_cpp_hoist_open(g, xs, 2, hoist, true) : -1;
        fprintf(f, "%s(", jt_cpp_type(e->type));
        jt_cpp_expr(g, e->fill.count);
        fputs(", ", f);
        if (id >= 0) fprintf(f, "jt_o%d); }()", id);
        else {
            jt_cpp_expr(g, e->fill.value);
            fputc(')', f);
        }
        break;
    }
    }
}

/* Valor inicial em declaracao/atribuicao/return: um literal de array vira so {a, b}. */
static void jt_cpp_init(JtCppGen *g, const JtExpr *e) {
    if (e->kind != EX_ARRAY) { jt_cpp_expr(g, e); return; }
    fputc('{', g->f);
    for (size_t i = 0; i < e->arr.n; i++) {
        if (i) fputs(", ", g->f);
        jt_cpp_expr(g, e->arr.items[i]);
    }
    fputc('}', g->f);
}

static const char *jt_cpp_type(JtType t) {
    switch (t) {
    case TY_INT:        return "int";
    case TY_DOUBLE:     return "double";
    case TY_STRING:     return "std::string";
    case TY_CHAR:       return "char";
    case TY_BOOL:       return "bool";
    case TY_VOID:       return "void";
    case TY_ARR_INT:    return "std::vector<int>";
    case TY_ARR_DOUBLE: return "std::vector<double>";
    case TY_ARR_STRING: return "std::vector<std::string>";
    case TY_ARR_CHAR:   return "std::vector<char>";
    case TY_ARR_BOOL:   return "std::vector<char>"; /* nao vector<bool>: 1 byte por elemento e muito mais rapido */
    case TY_ARR_EMPTY:
    case TY_FN:                /* valor de funcao: ver jt_cpp_fn_param */
    case TY_AUTO:       break; /* nao sobra depois do sema */
    }
    return "?";
}

/* parametros e variavel do for-in: objetos por referencia constante (sem copia) */
static void jt_cpp_ref_type(JtCppGen *g, JtType t) {
    if (t == TY_STRING || jt_is_array(t)) fprintf(g->f, "const %s& ", jt_cpp_type(t));
    else fprintf(g->f, "%s ", jt_cpp_type(t));
}

/* print/println("... {x} ...") -> std::printf("... %d ...", x) */
static void jt_cpp_print_interp(JtCppGen *g, const JtExpr *e, bool newline) {
    FILE *f = g->f;
    JtCppLit lit = jt_cpp_lit_for(e);
    bool ordered = jt_interp_ordered(g, e);
    if (ordered) jt_cpp_interp_locals(g, e);
    fputs("std::printf(", f);
    jt_cpp_lit_open(f, &lit);
    for (size_t i = 0; i < e->interp.n; i++) {
        const JtInterpPart *part = &e->interp.parts[i];
        if (!part->expr) { jt_cpp_text(f, &lit, part->text, part->len, '%'); continue; }
        switch (part->expr->type) {
        case TY_INT:    fputs("%d", f); break;
        case TY_DOUBLE: fputs("%.14g", f); break;
        case TY_CHAR:   fputs("%c", f); break;
        case TY_STRING:
        case TY_BOOL:   fputs("%s", f); break;
        default:        break; /* void e arrays nao sao interpolados (sema) */
        }
    }
    if (newline) fputs(lit.raw ? "\n" : "\\n", f);
    jt_cpp_lit_close(f, &lit);
    fputs(", ", f);
    jt_cpp_interp_args(g, e, true, ordered);
    fputs(ordered ? "); }();\n" : ");\n", f);
}

static void jt_cpp_print(JtCppGen *g, const JtExpr *arg, bool newline) {
    FILE *f = g->f;
    if (arg->kind == EX_INTERP) { jt_cpp_print_interp(g, arg, newline); return; }

    fputs(newline ? "std::puts(" : "std::fputs(", f);
    if (arg->kind == EX_STRING) {
        jt_cpp_expr(g, arg);
    } else {
        jt_cpp_operand(g, arg, 100, false);
        fputs(".c_str()", f);
    }
    fputs(newline ? ");\n" : ", stdout);\n", f);
}

static void jt_cpp_indent(JtCppGen *g, int depth) {
    for (int i = 0; i < depth; i++) fputs("    ", g->f);
}

static void jt_cpp_block(JtCppGen *g, const JtBlock *b, int depth);

/* Nome da variavel auxiliar do fim do range: "<i>_fim", sem colidir com nenhuma variavel. */
static void jt_cpp_end_name(JtCppGen *g, const JtStmt *s) {
    const JtVarInfo *v = &g->prog->vars.items[s->var];
    char name[256];
    int n = snprintf(name, sizeof name, "%.*s_fim", (int)v->name_len, v->name);
    for (;;) {
        bool clash = false;
        for (size_t i = 0; i < g->prog->vars.len && !clash; i++) {
            const JtVarInfo *o = &g->prog->vars.items[i];
            clash = o->name_len == (size_t)n && memcmp(o->name, name, (size_t)n) == 0;
        }
        if (!clash || n + 1 >= (int)sizeof name) break;
        name[n++] = '_';
        name[n] = '\0';
    }
    fputs(name, g->f);
}

/*
 * for i in range(a, b, p) -> for (int i = a; i < b; ++i)
 * O fim so vai para uma variavel auxiliar se o corpo alterar algo que ele le,
 * para manter a semantica do Python (fim avaliado uma vez).
 */
static void jt_cpp_for(JtCppGen *g, const JtStmt *s, int depth) {
    FILE *f = g->f;
    bool hoist = jt_block_writes_read_of(&s->body, s->end);
    fputs("for (int ", f);
    jt_cpp_var(g, s->var);
    fputs(" = ", f);
    jt_cpp_expr(g, s->start);
    if (hoist) {
        fputs(", ", f);
        jt_cpp_end_name(g, s);
        fputs(" = ", f);
        jt_cpp_expr(g, s->end);
    }
    fputs("; ", f);
    jt_cpp_var(g, s->var);
    fputs(s->step > 0 ? " < " : " > ", f);
    if (hoist) jt_cpp_end_name(g, s);
    else jt_cpp_operand(g, s->end, CPREC_REL, true);
    fputs("; ", f);
    if (s->step == 1 || s->step == -1) {
        fputs(s->step > 0 ? "++" : "--", f);
        jt_cpp_var(g, s->var);
    } else {
        jt_cpp_var(g, s->var);
        fprintf(f, s->step > 0 ? " += %ld" : " -= %ld", s->step > 0 ? (long)s->step : -(long)s->step);
    }
    fputs(") {\n", f);
    jt_cpp_block(g, &s->body, depth + 1);
    jt_cpp_indent(g, depth);
    fputs("}\n", f);
}

/* declaracao completa: [const] tipo nome = valor; */
static void jt_cpp_decl(JtCppGen *g, const JtStmt *s) {
    FILE *f = g->f;
    fprintf(f, "%s%s ", s->is_const ? "const " : "", jt_cpp_type(s->type));
    jt_cpp_var(g, s->var);
    JtExpr *xs[2];
    bool hoist[2];
    if (s->init->kind == EX_FILL) {
        xs[0] = s->init->fill.value;
        xs[1] = s->init->fill.count;
    }
    if (s->init->kind == EX_FILL && !jt_cpp_hoist(g, xs, 2, hoist)) {
        /* std::vector<T> nome(tamanho, valor); (se a ordem importa, vai pelo EX_FILL) */
        fputc('(', f);
        jt_cpp_expr(g, s->init->fill.count);
        fputs(", ", f);
        jt_cpp_expr(g, s->init->fill.value);
        fputs(");\n", f);
        return;
    }
    fputs(" = ", f);
    jt_cpp_init(g, s->init);
    fputs(";\n", f);
}

static void jt_cpp_stmt(JtCppGen *g, const JtStmt *s, int depth) {
    FILE *f = g->f;
    /* global com valor constante: ja declarada e inicializada fora do main */
    if (s->kind == ST_VAR && s->is_global && s->static_init) return;
    jt_cpp_indent(g, depth);
    switch (s->kind) {
    case ST_CALL:
        jt_cpp_print(g, s->arg, s->fn == BI_PRINTLN);
        break;
    case ST_VAR:
        if (s->is_global || g->prog->vars.items[s->var].hoisted) {
            /* global com valor calculado (ou variavel criada num bloco, que vale ate o
               fim da funcao): declarada antes, recebe o valor aqui, no mesmo ponto em
               que o programa Jatai a declara */
            jt_cpp_var(g, s->var);
            fputs(" = ", f);
            jt_cpp_init(g, s->init);
            fputs(";\n", f);
            break;
        }
        jt_cpp_decl(g, s);
        break;
    case ST_ASSIGN: {
        /* x = x + a + b (strings) -> x += a; x += b; (anexa sem copiar x) */
        JtExprList ops = {0};
        if (s->type == TY_STRING && jt_append_chain(g->prog, s->init, s->var, &ops)) {
            for (size_t i = 0; i < ops.len; i++) {
                if (i) jt_cpp_indent(g, depth);
                jt_cpp_var(g, s->var);
                fputs(" += ", f);
                jt_cpp_expr(g, ops.items[i]);
                fputs(";\n", f);
            }
            free(ops.items);
            break;
        }
        free(ops.items);
        jt_cpp_var(g, s->var);
        fputs(" = ", f);
        jt_cpp_init(g, s->init);
        fputs(";\n", f);
        break;
    }
    case ST_INDEX_SET: {
        /* o C++17 calcula o lado direito antes do indice; o Jatai, o indice antes */
        JtExpr *xs[2] = { s->index, s->init };
        bool hoist[2];
        int id = jt_cpp_hoist(g, xs, 2, hoist) ? jt_cpp_hoist_open(g, xs, 2, hoist, false) : -1;
        jt_cpp_var(g, s->target);
        fputc('[', f);
        if (id >= 0) fprintf(f, "jt_o%d", id);
        else jt_cpp_expr(g, s->index);
        fputs("] = ", f);
        jt_cpp_expr(g, s->init);
        fputs(id >= 0 ? "; }();\n" : ";\n", f);
        break;
    }
    case ST_APPEND:
        jt_cpp_var(g, s->target);
        fputs(".push_back(", f);
        jt_cpp_expr(g, s->init);
        fputs(");\n", f);
        break;
    case ST_FOREACH:
        fputs("for (", f);
        jt_cpp_ref_type(g, s->type);
        jt_cpp_var(g, s->var);
        fputs(" : ", f);
        jt_cpp_expr(g, s->iter);
        fputs(") {\n", f);
        jt_cpp_block(g, &s->body, depth + 1);
        jt_cpp_indent(g, depth);
        fputs("}\n", f);
        break;
    case ST_IF:
        for (size_t i = 0; i < s->nbranches; i++) {
            fputs(i == 0 ? "if (" : " else if (", f);
            jt_cpp_expr(g, s->conds[i]);
            fputs(") {\n", f);
            jt_cpp_block(g, &s->blocks[i], depth + 1);
            jt_cpp_indent(g, depth);
            fputc('}', f);
        }
        if (s->has_else) {
            fputs(" else {\n", f);
            jt_cpp_block(g, &s->else_block, depth + 1);
            jt_cpp_indent(g, depth);
            fputc('}', f);
        }
        fputc('\n', f);
        break;
    case ST_WHILE:
        fputs("while (", f);
        jt_cpp_expr(g, s->cond);
        fputs(") {\n", f);
        jt_cpp_block(g, &s->body, depth + 1);
        jt_cpp_indent(g, depth);
        fputs("}\n", f);
        break;
    case ST_FOR:
        jt_cpp_for(g, s, depth);
        break;
    case ST_EXPR:
        jt_cpp_expr(g, s->init);
        fputs(";\n", f);
        break;
    case ST_RETURN:
        if (s->init) {
            fputs("return ", f);
            jt_cpp_init(g, s->init);
            fputs(";\n", f);
        } else {
            fputs("return;\n", f);
        }
        break;
    case ST_BREAK:
        fputs("break;\n", f);
        break;
    case ST_CONTINUE:
        fputs("continue;\n", f);
        break;
    }
}

static void jt_cpp_block(JtCppGen *g, const JtBlock *b, int depth) {
    for (size_t i = 0; i < b->len; i++) jt_cpp_stmt(g, &b->items[i], depth);
}

/* Variaveis criadas por atribuicao dentro de blocos (valem ate o fim da funcao
   owner, -1 = main): declaradas no inicio, com o valor zero do tipo. */
static void jt_cpp_hoisted_decls(JtCppGen *g, int owner) {
    for (size_t i = 0; i < g->prog->vars.len; i++) {
        const JtVarInfo *v = &g->prog->vars.items[i];
        if (!v->hoisted || v->owner != owner) continue;
        fprintf(g->f, "    %s ", jt_cpp_type(v->type));
        jt_cpp_var(g, (int)i);
        if (v->type == TY_BOOL) fputs(" = false", g->f);
        else if (v->type == TY_INT || v->type == TY_DOUBLE || v->type == TY_CHAR) fputs(" = 0", g->f);
        fputs(";\n", g->f);
    }
}

static bool jt_has_non_ascii(const char *s, size_t n) {
    for (size_t i = 0; i < n; i++)
        if ((unsigned char)s[i] >= 0x80) return true;
    return false;
}

static bool jt_is_interp(const JtExpr *e, const void *ctx) { (void)ctx; return e->kind == EX_INTERP; }
static bool jt_is_array_lit(const JtExpr *e, const void *ctx) { (void)ctx; return e->kind == EX_ARRAY || e->kind == EX_FILL; }

/* Texto nao-ASCII (UTF-8) no programa exige console UTF-8 no Windows. */
static bool jt_is_utf8_text(const JtExpr *e, const void *ctx) {
    (void)ctx;
    if (e->kind == EX_STRING) return jt_has_non_ascii(e->str.data, e->str.len);
    if (e->kind == EX_INTERP)
        for (size_t i = 0; i < e->interp.n; i++)
            if (!e->interp.parts[i].expr && jt_has_non_ascii(e->interp.parts[i].text, e->interp.parts[i].len))
                return true;
    return false;
}

typedef struct {
    bool format, utf8, vector;
} JtCppNeeds;

static void jt_cpp_scan_expr(JtCppNeeds *n, const JtExpr *e, bool printed) {
    if (jt_expr_any(e, jt_is_utf8_text, NULL)) n->utf8 = true;
    if (jt_expr_any(e, jt_is_array_lit, NULL)) n->vector = true;
    if (printed && e->kind == EX_INTERP) { /* vira printf; so as partes podem usar std::format */
        for (size_t i = 0; i < e->interp.n; i++)
            if (e->interp.parts[i].expr && jt_expr_any(e->interp.parts[i].expr, jt_is_interp, NULL)) n->format = true;
        return;
    }
    if (jt_expr_any(e, jt_is_interp, NULL)) n->format = true;  /* {x} fora de print: std::format */
}

static void jt_cpp_scan_block(JtCppNeeds *n, const JtBlock *b) {
    for (size_t i = 0; i < b->len; i++) {
        const JtStmt *s = &b->items[i];
        switch (s->kind) {
        case ST_CALL:   jt_cpp_scan_expr(n, s->arg, true); break;
        case ST_VAR:
        case ST_ASSIGN:
        case ST_APPEND: jt_cpp_scan_expr(n, s->init, false); break;
        case ST_INDEX_SET:
            jt_cpp_scan_expr(n, s->index, false);
            jt_cpp_scan_expr(n, s->init, false);
            break;
        case ST_FOREACH:
            jt_cpp_scan_expr(n, s->iter, false);
            jt_cpp_scan_block(n, &s->body);
            break;
        case ST_IF:
            for (size_t j = 0; j < s->nbranches; j++) {
                jt_cpp_scan_expr(n, s->conds[j], false);
                jt_cpp_scan_block(n, &s->blocks[j]);
            }
            if (s->has_else) jt_cpp_scan_block(n, &s->else_block);
            break;
        case ST_WHILE:
            jt_cpp_scan_expr(n, s->cond, false);
            jt_cpp_scan_block(n, &s->body);
            break;
        case ST_FOR:
            jt_cpp_scan_expr(n, s->start, false);
            jt_cpp_scan_expr(n, s->end, false);
            jt_cpp_scan_block(n, &s->body);
            break;
        case ST_EXPR:
            jt_cpp_scan_expr(n, s->init, false);
            break;
        case ST_RETURN:
            if (s->init) jt_cpp_scan_expr(n, s->init, false);
            break;
        case ST_BREAK:
        case ST_CONTINUE:
            break;
        }
    }
}

/* valor de funcao como ponteiro de funcao: void(int, string) acao -> void (*acao)(int, const std::string&) */
static void jt_cpp_fn_param(JtCppGen *g, const JtSig *sig, int var) {
    FILE *f = g->f;
    fprintf(f, "%s (*", jt_cpp_type(sig->ret));
    jt_cpp_var(g, var);
    fputs(")(", f);
    for (uint32_t k = 0; k < sig->n; k++) {
        if (k) fputs(", ", f);
        JtType t = sig->params[k];
        if (t == TY_STRING || jt_is_array(t)) fprintf(f, "const %s&", jt_cpp_type(t));
        else fputs(jt_cpp_type(t), f);
    }
    fputc(')', f);
}

/* tipo nome(tipo a, const std::string& b) -- string por referencia constante (sem copia) */
static void jt_cpp_signature(JtCppGen *g, const JtFunc *fn) {
    FILE *f = g->f;
    fprintf(f, "%s ", jt_cpp_type(fn->ret));
    jt_cpp_func_name(g, (int)(fn - g->prog->funcs.items));
    fputc('(', f);
    for (size_t i = 0; i < fn->params.len; i++) {
        const JtVarInfo *v = &g->prog->vars.items[fn->params.items[i]];
        if (i) fputs(", ", f);
        if (v->type == TY_FN) {
            jt_cpp_fn_param(g, &g->prog->sigs.items[v->sig], fn->params.items[i]);
            continue;
        }
        jt_cpp_ref_type(g, v->type);
        jt_cpp_var(g, fn->params.items[i]);
    }
    fputc(')', f);
}

/* ---- bibliotecas nativas (DLL/.so no padrao C, ver library/jatai.h) ---- */

static bool jt_cpp_is_binary_module(const JtModule *m) { return m->has_extern; }

/* tipo C da ABI para um valor Jatai (parametro de uma posicao) */
static const char *jt_abi_c_type(JtType t) {
    switch (t) {
    case TY_DOUBLE: return "double";
    case TY_STRING: return "char *";
    case TY_VOID:   return "void";
    default:        return "int32_t";
    }
}

/* parametros C de um valor Jatai: string -> (const char *, size_t); funcao -> (fn, void *) */
static void jt_abi_c_params(FILE *f, JtType t, const char *name, int cb_index) {
    if (t == TY_STRING) {
        fprintf(f, "const char *%s, size_t %s_len", name, name);
    } else if (t == TY_FN) {
        fprintf(f, "jt_cb%d_fn %s, void *%s_ctx", cb_index, name, name);
    } else {
        fprintf(f, "%s %s", jt_abi_c_type(t), name);
    }
}

/* tipo C++ que o programa usa para o valor */
static void jt_cpp_value_type(FILE *f, JtType t) {
    if (t == TY_STRING || jt_is_array(t)) fprintf(f, "const %s&", jt_cpp_type(t));
    else fputs(jt_cpp_type(t), f);
}

/* ponteiro de funcao C++ de uma assinatura Jatai: R (*)(P...) */
static void jt_cpp_sig_ptr(FILE *f, const JtSig *sig) {
    fprintf(f, "%s (*)(", jt_cpp_type(sig->ret));
    for (uint32_t k = 0; k < sig->n; k++) {
        if (k) fputs(", ", f);
        jt_cpp_value_type(f, sig->params[k]);
    }
    fputc(')', f);
}

/* callback k: tipo do ponteiro C e ponte (thunk) que chama a funcao Jatai recebida em ctx */
static void jt_cpp_emit_callback(JtCppGen *g, const JtSig *sig, int k) {
    FILE *f = g->f;
    fprintf(f, "typedef %s (*jt_cb%d_fn)(void *", jt_abi_c_type(sig->ret), k);
    for (uint32_t j = 0; j < sig->n; j++) {
        if (sig->params[j] == TY_STRING) fputs(", const char *, size_t", f);
        else fprintf(f, ", %s", jt_abi_c_type(sig->params[j]));
    }
    fputs(");\n", f);
    fprintf(f, "static %s jt_cb%d_thunk(void *ctx", jt_abi_c_type(sig->ret), k);
    for (uint32_t j = 0; j < sig->n; j++) {
        char name[16];
        snprintf(name, sizeof name, "p%u", j);
        fputs(", ", f);
        if (sig->params[j] == TY_STRING) fprintf(f, "const char *%s, size_t %s_len", name, name);
        else fprintf(f, "%s %s", jt_abi_c_type(sig->params[j]), name);
    }
    fputs(") {\n    auto fn = reinterpret_cast<", f);
    jt_cpp_sig_ptr(f, sig);
    fputs(">(ctx);\n    ", f);
    switch (sig->ret) {
    case TY_VOID:   break;
    case TY_STRING: fputs("std::string r = ", f); break;
    case TY_BOOL:   fputs("return (int32_t)", f); break;
    case TY_CHAR:   fputs("return (int32_t)(unsigned char)", f); break;
    default:        fputs("return ", f); break;
    }
    fputs("fn(", f);
    for (uint32_t j = 0; j < sig->n; j++) {
        if (j) fputs(", ", f);
        switch (sig->params[j]) {
        case TY_STRING: fprintf(f, "std::string(p%u, p%u_len)", j, j); break;
        case TY_BOOL:   fprintf(f, "p%u != 0", j); break;
        case TY_CHAR:   fprintf(f, "(char)p%u", j); break;
        default:        fprintf(f, "p%u", j); break;
        }
    }
    fputs(");\n", f);
    if (sig->ret == TY_STRING) fputs("    return jt_abi_str(r);\n", f);
    fputs("}\n", f);
}

static void jt_cpp_emit_binary_libs(JtCppGen *g) {
    FILE *f = g->f;
    const JtProgram *prog = g->prog;
    bool any = false;
    for (size_t i = 0; i < prog->modules.len; i++) any = any || jt_cpp_is_binary_module(&prog->modules.items[i]);
    if (!any) return;

    fputs("\n// bibliotecas nativas: strings trocadas no padrao C (library/jatai.h)\n"
          "struct jatai_host {\n"
          "    uint32_t version;\n"
          "    char *(*str_new)(size_t n);\n"
          "    void (*str_free)(char *s);\n"
          "    size_t (*str_len)(const char *s);\n"
          "};\n"
          "static char *jt_abi_str_new(size_t n) {\n"
          "    size_t *b = (size_t *)std::malloc(sizeof(size_t) + n + 1);\n"
          "    b[0] = n;\n"
          "    char *s = (char *)(b + 1);\n"
          "    s[n] = '\\0';\n"
          "    return s;\n"
          "}\n"
          "static void jt_abi_str_free(char *s) { if (s) std::free((size_t *)s - 1); }\n"
          "static size_t jt_abi_str_len(const char *s) { return ((const size_t *)s)[-1]; }\n"
          "static const jatai_host jt_abi_host = {1, jt_abi_str_new, jt_abi_str_free, jt_abi_str_len};\n"
          "// string devolvida por uma biblioteca: copia e libera\n"
          "static std::string jt_abi_take(char *s) {\n"
          "    if (!s) return std::string();\n"
          "    std::string r(s, jt_abi_str_len(s));\n"
          "    jt_abi_str_free(s);\n"
          "    return r;\n"
          "}\n"
          "static char *jt_abi_str(const std::string& r) {\n"
          "    char *s = jt_abi_str_new(r.size());\n"
          "    std::memcpy(s, r.data(), r.size());\n"
          "    return s;\n"
          "}\n", f);

    /* carregamento das bibliotecas: <pasta do executavel>/bin/<arquivo> */
    fputs("#ifdef _WIN32\n"
          "extern \"C\" __declspec(dllimport) void *__stdcall LoadLibraryExW(const wchar_t *, void *, unsigned long);\n"
          "extern \"C\" __declspec(dllimport) void *__stdcall GetProcAddress(void *, const char *);\n"
          "extern \"C\" __declspec(dllimport) unsigned long __stdcall GetModuleFileNameW(void *, wchar_t *, unsigned long);\n"
          "static void *jt_abi_open(const char *file) {\n"
          "    wchar_t exe[4096];\n"
          "    unsigned long n = GetModuleFileNameW(nullptr, exe, 4096);\n"
          "    while (n > 0 && exe[n - 1] != L'\\\\' && exe[n - 1] != L'/') n--;\n"
          "    std::wstring path(exe, n);\n"
          "    path += L\"bin\\\\\";\n"
          "    for (const char *c = file; *c; c++) path += (wchar_t)*c;\n"
          "    return LoadLibraryExW(path.c_str(), nullptr, 0x00000008); // dependencias da DLL: na pasta dela\n"
          "}\n"
          "static void *jt_abi_sym(void *lib, const char *name) { return GetProcAddress(lib, name); }\n"
          "#else\n"
          "#include <dlfcn.h>\n"
          "#include <unistd.h>\n"
          "static void *jt_abi_open(const char *file) {\n"
          "    char exe[4096];\n"
          "    ssize_t n = readlink(\"/proc/self/exe\", exe, sizeof exe - 1);\n"
          "    while (n > 0 && exe[n - 1] != '/') n--;\n"
          "    std::string path(exe, n > 0 ? (size_t)n : 0);\n"
          "    path += \"bin/\";\n"
          "    path += file;\n"
          "    return dlopen(path.c_str(), RTLD_NOW);\n"
          "}\n"
          "static void *jt_abi_sym(void *lib, const char *name) { return dlsym(lib, name); }\n"
          "#endif\n"
          "static void *jt_abi_need(void *lib, const char *file, const char *name) {\n"
          "    void *p = lib ? jt_abi_sym(lib, name) : nullptr;\n"
          "    if (!p) {\n"
          "        std::fprintf(stderr, lib ? \"erro: bin/%s nao exporta %s\\n\" : \"erro: nao foi possivel carregar bin/%s\\n\",\n"
          "                     file, name);\n"
          "        std::exit(1);\n"
          "    }\n"
          "    return p;\n"
          "}\n", f);

    /* callbacks: uma ponte por assinatura usada em parametros extern */
    for (size_t i = 0; i < prog->funcs.len; i++) {
        const JtFunc *fn = &prog->funcs.items[i];
        if (!fn->is_extern || !jt_cpp_is_binary_module(&prog->modules.items[fn->module])) continue;
        for (size_t k = 0; k < fn->params.len; k++) {
            const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
            if (pv->type == TY_FN) jt_cpp_emit_callback(g, &prog->sigs.items[pv->sig], pv->sig);
        }
    }

    for (size_t mi = 0; mi < prog->modules.len; mi++) {
        const JtModule *m = &prog->modules.items[mi];
        if (!jt_cpp_is_binary_module(m)) continue;
        int nl = (int)m->name_len;

        /* funcoes exportadas pela biblioteca: ponteiros preenchidos por jt_abi_load() */
        fputc('\n', f);
        fprintf(f, "static void (*jatai_%.*s_init)(const jatai_host *h);\n", nl, m->name);
        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != (int)mi || !fn->is_extern) continue;
            fprintf(f, "static %s (*jatai_%.*s_%.*s)(", jt_abi_c_type(fn->ret), nl, m->name, (int)fn->name_len, fn->name);
            for (size_t k = 0; k < fn->params.len; k++) {
                const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
                char name[32];
                snprintf(name, sizeof name, "a%zu", k);
                if (k) fputs(", ", f);
                jt_abi_c_params(f, pv->type, name, pv->sig);
            }
            if (!fn->params.len) fputs("void", f);
            fputs(");\n", f);
        }

        /* wrappers com tipos C++: o programa chama jatai::<modulo>::<funcao> como sempre */
        fputs("namespace jatai::", f);
        jt_cpp_name(g, m->name, m->name_len);
        fputs(" {\n", f);
        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != (int)mi || !fn->is_extern) continue;
            fprintf(f, "inline %s ", jt_cpp_type(fn->ret));
            jt_cpp_name(g, fn->name, fn->name_len);
            fputc('(', f);
            for (size_t k = 0; k < fn->params.len; k++) {
                const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
                if (k) fputs(", ", f);
                if (pv->type == TY_FN) {
                    const JtSig *sig = &prog->sigs.items[pv->sig];
                    fprintf(f, "%s (*a%zu)(", jt_cpp_type(sig->ret), k);
                    for (uint32_t j = 0; j < sig->n; j++) {
                        if (j) fputs(", ", f);
                        jt_cpp_value_type(f, sig->params[j]);
                    }
                    fputc(')', f);
                } else {
                    jt_cpp_value_type(f, pv->type);
                    fprintf(f, " a%zu", k);
                }
            }
            fputs(") {\n    ", f);
            switch (fn->ret) {
            case TY_VOID:   break;
            case TY_STRING: fputs("return jt_abi_take(", f); break;
            case TY_BOOL:   fputs("return 0 != ", f); break;
            case TY_CHAR:   fputs("return (char)", f); break;
            default:        fputs("return ", f); break;
            }
            fprintf(f, "jatai_%.*s_%.*s(", nl, m->name, (int)fn->name_len, fn->name);
            for (size_t k = 0; k < fn->params.len; k++) {
                const JtVarInfo *pv = &prog->vars.items[fn->params.items[k]];
                if (k) fputs(", ", f);
                switch (pv->type) {
                case TY_STRING: fprintf(f, "a%zu.data(), a%zu.size()", k, k); break;
                case TY_BOOL:   fprintf(f, "a%zu ? 1 : 0", k); break;
                case TY_CHAR:   fprintf(f, "(int32_t)(unsigned char)a%zu", k); break;
                case TY_FN:     fprintf(f, "&jt_cb%d_thunk, reinterpret_cast<void *>(a%zu)", pv->sig, k); break;
                default:        fprintf(f, "a%zu", k); break;
                }
            }
            fputs(fn->ret == TY_STRING ? "));\n}\n" : ");\n}\n", f);
        }
        fputs("}\n", f);
    }
}

/* jt_abi_load(): carrega cada biblioteca de bin/ e resolve as funcoes (antes do main) */
static void jt_cpp_emit_binary_loader(JtCppGen *g) {
    FILE *f = g->f;
    const JtProgram *prog = g->prog;
    bool any = false;
    for (size_t i = 0; i < prog->modules.len; i++) any = any || jt_cpp_is_binary_module(&prog->modules.items[i]);
    if (!any) return;
    fputs("\nstatic void jt_abi_load() {\n", f);
    for (size_t mi = 0; mi < prog->modules.len; mi++) {
        const JtModule *m = &prog->modules.items[mi];
        if (!jt_cpp_is_binary_module(m)) continue;
        int nl = (int)m->name_len;
        char *name = jt_strdup_n(m->name, m->name_len);
        char *file = jt_lib_file_name(name);
        fprintf(f, "    {\n        void *lib = jt_abi_open(\"%s\");\n", file);
        fprintf(f, "        jatai_%.*s_init = reinterpret_cast<decltype(jatai_%.*s_init)>(jt_abi_need(lib, \"%s\", \"jatai_%.*s_init\"));\n",
                nl, m->name, nl, m->name, file, nl, m->name);
        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != (int)mi || !fn->is_extern) continue;
            int fl = (int)fn->name_len;
            fprintf(f, "        jatai_%.*s_%.*s = reinterpret_cast<decltype(jatai_%.*s_%.*s)>(jt_abi_need(lib, \"%s\", \"jatai_%.*s_%.*s\"));\n",
                    nl, m->name, fl, fn->name, nl, m->name, fl, fn->name, file, nl, m->name, fl, fn->name);
        }
        fprintf(f, "        jatai_%.*s_init(&jt_abi_host);\n    }\n", nl, m->name);
        free(file);
        free(name);
    }
    fputs("}\n", f);
}

static void jt_cpp_emit_binary_init(JtCppGen *g) {
    for (size_t mi = 0; mi < g->prog->modules.len; mi++)
        if (jt_cpp_is_binary_module(&g->prog->modules.items[mi])) {
            fputs("    jt_abi_load();\n", g->f);
            return;
        }
}

static void jt_cpp_emit(FILE *f, const JtProgram *prog) {
    JtCppGen g = { f, prog, 0 };
    JtCppNeeds need = {0};
    bool need_string = false;
    for (size_t i = 0; i < prog->vars.len; i++) {
        JtType t = prog->vars.items[i].type;
        if (t == TY_STRING || t == TY_ARR_STRING) need_string = true;
        if (jt_is_array(t)) need.vector = true;
    }
    for (size_t i = 0; i < prog->funcs.len; i++) {
        if (prog->funcs.items[i].is_template) continue;
        JtType t = prog->funcs.items[i].ret;
        if (t == TY_STRING || t == TY_ARR_STRING) need_string = true;
        if (jt_is_array(t)) need.vector = true;
        jt_cpp_scan_block(&need, &prog->funcs.items[i].body);
    }
    jt_cpp_scan_block(&need, &prog->body);

    fprintf(f, "// gerado por jatai a partir de %s\n", prog->file);
    fputs("#include <cstdio>\n", f);
    if (need.format) fputs("#include <format>\n", f);
    if (need_string || need.format) fputs("#include <string>\n", f);
    if (need.vector) fputs("#include <vector>\n", f);
    bool any_binary = false;
    for (size_t i = 0; i < prog->modules.len; i++) any_binary = any_binary || jt_cpp_is_binary_module(&prog->modules.items[i]);
    if (any_binary) {
        fputs("#include <cstdint>\n#include <cstdlib>\n#include <cstring>\n", f);
        if (!(need_string || need.format)) fputs("#include <string>\n", f);
    }
    if (need.utf8)
        fputs("\n#ifdef _WIN32\n"
              "extern \"C\" __declspec(dllimport) int __stdcall SetConsoleOutputCP(unsigned);\n"
              "#endif\n", f);

    /* bibliotecas: funcoes extern vem da DLL/.so ja compilada */
    jt_cpp_emit_binary_libs(&g);

    /* variaveis globais */
    bool any_global = false;
    for (size_t i = 0; i < prog->body.len; i++) {
        const JtStmt *st = &prog->body.items[i];
        if (st->kind != ST_VAR || !st->is_global) continue;
        if (!any_global) fputc('\n', f);
        any_global = true;
        if (st->static_init) {
            jt_cpp_decl(&g, st);
        } else {
            fprintf(f, "%s ", jt_cpp_type(st->type));
            jt_cpp_var(&g, st->var);
            fputs(";\n", f);
        }
    }

    /* prototipos: funcoes podem ser usadas antes da definicao e ser recursivas.
       Funcoes de biblioteca ficam em namespace jatai::<biblioteca>. */
    for (int mod = 0; mod <= (int)prog->modules.len; mod++) {
        int module = mod == (int)prog->modules.len ? -1 : mod;
        bool opened = false;
        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != module || fn->is_extern || fn->is_template) continue;
            if (!opened) {
                fputc('\n', f);
                if (module >= 0) {
                    fputs("namespace jatai::", f);
                    jt_cpp_name(&g, prog->modules.items[module].name, prog->modules.items[module].name_len);
                    fputs(" {\n", f);
                }
                opened = true;
            }
            jt_cpp_signature(&g, fn);
            fputs(";\n", f);
        }
        if (opened && module >= 0) fputs("}\n", f);
    }
    for (int mod = 0; mod <= (int)prog->modules.len; mod++) {
        int module = mod == (int)prog->modules.len ? -1 : mod;
        bool opened = false;
        for (size_t i = 0; i < prog->funcs.len; i++) {
            const JtFunc *fn = &prog->funcs.items[i];
            if (fn->module != module || fn->is_extern || fn->is_template) continue;
            fputc('\n', f);
            if (!opened && module >= 0) {
                fputs("namespace jatai::", f);
                jt_cpp_name(&g, prog->modules.items[module].name, prog->modules.items[module].name_len);
                fputs(" {\n\n", f);
            }
            opened = true;
            jt_cpp_signature(&g, fn);
            fputs(" {\n", f);
            jt_cpp_hoisted_decls(&g, (int)i);
            jt_cpp_block(&g, &fn->body, 1);
            fputs("}\n", f);
        }
        if (opened && module >= 0) fputs("\n}\n", f);
    }

    jt_cpp_emit_binary_loader(&g);
    fputs("\nint main() {\n", f);
    if (need.utf8)
        fputs("#ifdef _WIN32\n"
              "    SetConsoleOutputCP(65001); // UTF-8\n"
              "#endif\n", f);
    jt_cpp_emit_binary_init(&g);
    jt_cpp_hoisted_decls(&g, -1);
    jt_cpp_block(&g, &prog->body, 1);
    fputs("    return 0;\n}\n", f);
}

#endif
