#ifndef JT_PARSER_H
#define JT_PARSER_H

#include "ast.h"
#include "lexer.h"

typedef struct {
    JtLexer lx;
    JtToken tok;
    JtProgram *prog;
    int depth;              /* blocos abertos: funcoes so no nivel 0 */
    int module;             /* modulo sendo lido, ou -1 (programa principal) */
    const char *dir;        /* pasta do arquivo sendo lido */
    JT_VEC(int) imports;    /* modulos visiveis neste arquivo */
} JtParser;

/* Modulo importado neste arquivo com esse nome, ou -1. */
static int jt_imported(const JtParser *p, const char *name, size_t len) {
    for (size_t i = 0; i < p->imports.len; i++) {
        const JtModule *m = &p->prog->modules.items[p->imports.items[i]];
        if (m->name_len == len && memcmp(m->name, name, len) == 0) return p->imports.items[i];
    }
    return -1;
}

static void jt_advance(JtParser *p) { p->tok = jt_lex_next(&p->lx); }

static void jt_expect(JtParser *p, JtTokKind k, const char *what) {
    if (p->tok.kind != k)
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado %s", what);
    jt_advance(p);
}

static bool jt_tok_is(const JtToken *t, const char *lit) { return jt_str_is(t->start, t->len, lit); }

static bool jt_tok_type(const JtToken *t, JtType *out) {
    if (t->kind != TK_IDENT) return false;
    if (jt_tok_is(t, "int"))    { *out = TY_INT;    return true; }
    if (jt_tok_is(t, "double")) { *out = TY_DOUBLE; return true; }
    if (jt_tok_is(t, "string")) { *out = TY_STRING; return true; }
    if (jt_tok_is(t, "char"))   { *out = TY_CHAR;   return true; }
    if (jt_tok_is(t, "bool"))   { *out = TY_BOOL;   return true; }
    return false;
}

/* depois do tipo base: "[]" transforma em array */
static JtType jt_parse_type_suffix(JtParser *p, JtType base) {
    if (p->tok.kind != TK_LBRACKET) return base;
    jt_advance(p);
    jt_expect(p, TK_RBRACKET, "']'");
    if (p->tok.kind == TK_LBRACKET)
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "arrays de arrays ainda nao sao suportados");
    return jt_array_of(base);
}

static bool jt_at_keyword(JtParser *p, const char *kw) {
    return p->tok.kind == TK_IDENT && jt_tok_is(&p->tok, kw);
}

static bool jt_is_reserved(const JtToken *t) {
    JtType ty;
    return jt_tok_type(t, &ty) || jt_tok_is(t, "true") || jt_tok_is(t, "false") || jt_tok_is(t, "const") ||
           jt_tok_is(t, "and") || jt_tok_is(t, "or") || jt_tok_is(t, "not") ||
           jt_tok_is(t, "if") || jt_tok_is(t, "elif") || jt_tok_is(t, "else") ||
           jt_tok_is(t, "while") || jt_tok_is(t, "for") || jt_tok_is(t, "in") || jt_tok_is(t, "range") ||
           jt_tok_is(t, "break") || jt_tok_is(t, "continue") ||
           jt_tok_is(t, "void") || jt_tok_is(t, "return") || jt_tok_is(t, "len") || jt_tok_is(t, "fn") ||
           jt_tok_is(t, "import") || jt_tok_is(t, "extern") || jt_tok_is(t, "global") ||
           jt_tok_is(t, "print") || jt_tok_is(t, "println");
}

static JtExpr *jt_parse_expr(JtParser *p);

/* Em s (ate end), um marcador de interpolacao? Devolve o fim do marcador e o codigo
   da expressao.
   "..."     : {expr}
   """...""" : {{expr}} (espacos opcionais: {{ expr }}); chave simples e sempre texto,
               para HTML/CSS/JS colarem sem escapar nada */
static const char *jt_interp_marker(const char *s, const char *end, bool triple,
                                    const char **code, size_t *code_len) {
    if (!triple) {
        const char *close = jt_interp_span(s, end);
        if (!close) return NULL;
        *code = s + 1;
        *code_len = (size_t)(close - *code);
        return close + 1;
    }
    if (end - s < 4 || s[0] != '{' || s[1] != '{') return NULL;
    const char *q = s + 2;
    while (q < end && *q == ' ') q++;
    if (q >= end || !jt_is_ident_start(*q)) return NULL;
    const char *close = jt_interp_close(s + 1, end);
    if (!close || close + 1 >= end || close[1] != '}') return NULL;
    *code = q;
    *code_len = (size_t)(close - q);
    return close + 2;
}

/* Le code como uma expressao completa; NULL se nao for (o marcador fica como texto,
   ex.: CSS "a {color: red}"). line/col: onde o codigo comeca no fonte. */
static JtExpr *jt_parse_interp_expr(JtParser *p, const char *code, size_t len, int line, int col) {
    char *buf = jt_xmalloc(len + 1); /* fica viva: os nomes da expressao apontam para ela */
    memcpy(buf, code, len);
    buf[len] = '\0';
    JtParser sub = *p;
    jt_lexer_init(&sub.lx, p->lx.file, buf);
    sub.lx.at_line_start = false;
    sub.lx.line = line;
    sub.lx.col_base = col - 1;

    jmp_buf trap;
    jmp_buf *prev = jt_error_trap;
    JtExpr *volatile e = NULL;
    jt_error_trap = &trap;
    if (setjmp(trap) == 0) {
        jt_advance(&sub);
        JtExpr *x = jt_parse_expr(&sub);
        if (sub.tok.kind == TK_NEWLINE || sub.tok.kind == TK_EOF) e = x;
    }
    jt_error_trap = prev;
    if (!e) free(buf);
    return e;
}

/* Separa "texto {expr} texto" em partes. {...} so interpola se comecar com um nome
   e for uma expressao valida; qualquer outra chave e texto literal. */
static JtExpr *jt_parse_string(JtParser *p, const JtToken *t) {
    JT_VEC(JtInterpPart) parts = {0};
    const char *s = t->str, *end = t->str + t->str_len, *text = s;
    int line = t->line + (t->triple ? 1 : 0); /* """ costuma abrir e quebrar a linha */
    while (s < end) {
        const char *code;
        size_t code_len;
        const char *after = jt_interp_marker(s, end, t->triple, &code, &code_len);
        JtExpr *x = NULL;
        if (after) {
            /* coluna exata so em "..." (em """...""" o recuo foi removido) */
            int col = t->triple ? 1 : t->col + 1 + (int)(code - t->str);
            x = jt_parse_interp_expr(p, code, code_len, line, col);
        }
        if (x) {
            if (s > text) {
                JtInterpPart lit = { text, (size_t)(s - text), NULL };
                jt_vec_push(&parts, lit);
            }
            JtInterpPart part = { code, code_len, x };
            jt_vec_push(&parts, part);
            s = text = after;
            continue;
        }
        if (*s == '\n') line++;
        s++;
    }

    if (parts.len == 0) {
        JtExpr *e = jt_new_expr(EX_STRING, t->line, t->col);
        e->str.data = t->str;
        e->str.len = t->str_len;
        e->multiline = t->triple;
        return e;
    }
    if (end > text) {
        JtInterpPart lit = { text, (size_t)(end - text), NULL };
        jt_vec_push(&parts, lit);
    }
    JtExpr *e = jt_new_expr(EX_INTERP, t->line, t->col);
    e->interp.parts = parts.items;
    e->interp.n = parts.len;
    e->multiline = t->triple;
    return e;
}

/* nome( [expr (, expr)*] ) -- o token atual e o '(' */
static JtExpr *jt_parse_call(JtParser *p, const JtToken *name) {
    JtExpr *e = jt_new_expr(EX_CALL, name->line, name->col);
    e->call.name = name->start;
    e->call.name_len = name->len;
    e->call.fn = -1;
    e->call.qual = -1;
    e->call.fnvar = -1;
    JT_VEC(JtExpr *) args = {0};
    jt_expect(p, TK_LPAREN, "'('");
    if (p->tok.kind != TK_RPAREN) {
        for (;;) {
            JtExpr *a = jt_parse_expr(p);
            jt_vec_push(&args, a);
            if (p->tok.kind != TK_COMMA) break;
            jt_advance(p);
        }
    }
    jt_expect(p, TK_RPAREN, "')'");
    e->call.args = args.items;
    e->call.nargs = args.len;
    return e;
}

/* modulo.funcao(args) -- o token atual e o '.' depois do nome do modulo */
static JtExpr *jt_parse_qualified_call(JtParser *p, int module, const JtToken *mod_tok) {
    jt_advance(p); /* '.' */
    JtToken name = p->tok;
    if (name.kind != TK_IDENT)
        jt_error_at(p->lx.file, name.line, name.col, "esperado nome de funcao depois de '%.*s.'",
                    (int)mod_tok->len, mod_tok->start);
    jt_advance(p);
    if (p->tok.kind != TK_LPAREN)
        jt_error_at(p->lx.file, name.line, name.col, "'%.*s.%.*s' deve ser chamada com (...)",
                    (int)mod_tok->len, mod_tok->start, (int)name.len, name.start);
    JtExpr *e = jt_parse_call(p, &name);
    e->call.qual = module;
    e->line = mod_tok->line;
    e->col = mod_tok->col;
    return e;
}

static JtExpr *jt_parse_atom(JtParser *p) {
    JtToken t = p->tok;
    JtExpr *e = NULL;
    switch (t.kind) {
    case TK_LBRACKET: {
        /* [a, b, c] */
        e = jt_new_expr(EX_ARRAY, t.line, t.col);
        JT_VEC(JtExpr *) items = {0};
        jt_advance(p);
        if (p->tok.kind != TK_RBRACKET) {
            for (;;) {
                JtExpr *x = jt_parse_expr(p);
                jt_vec_push(&items, x);
                if (p->tok.kind != TK_COMMA) break;
                jt_advance(p);
            }
        }
        jt_expect(p, TK_RBRACKET, "']'");
        e->arr.items = items.items;
        e->arr.n = items.len;
        return e;
    }
    case TK_LPAREN:
        jt_advance(p);
        e = jt_parse_expr(p);
        jt_expect(p, TK_RPAREN, "')'");
        return e;
    case TK_INT: {
        long long v = strtoll(t.start, NULL, 10);
        if (v > INT32_MAX || t.len > 10)
            jt_error_at(p->lx.file, t.line, t.col, "inteiro fora do intervalo de int");
        e = jt_new_expr(EX_INT, t.line, t.col);
        e->i.value = (int32_t)v;
        e->i.lexeme = t.start;
        e->i.lexeme_len = t.len;
        break;
    }
    case TK_DOUBLE:
        e = jt_new_expr(EX_DOUBLE, t.line, t.col);
        e->d.value = strtod(t.start, NULL);
        e->d.lexeme = t.start;
        e->d.lexeme_len = t.len;
        break;
    case TK_STRING:
        e = jt_parse_string(p, &t);
        break;
    case TK_CHAR:
        e = jt_new_expr(EX_CHAR, t.line, t.col);
        e->ch = t.ch;
        break;
    case TK_IDENT:
        if (jt_tok_is(&t, "true") || jt_tok_is(&t, "false")) {
            e = jt_new_expr(EX_BOOL, t.line, t.col);
            e->b = jt_tok_is(&t, "true");
        } else if ((jt_tok_is(&t, "int") || jt_tok_is(&t, "double")) && p->lx.cur[0] == '(') {
            /* int(x) / double(x) */
            e = jt_new_expr(EX_CONV, t.line, t.col);
            e->conv.to = jt_tok_is(&t, "int") ? TY_INT : TY_DOUBLE;
            jt_advance(p);
            jt_expect(p, TK_LPAREN, "'('");
            e->conv.x = jt_parse_expr(p);
            jt_expect(p, TK_RPAREN, "')'");
            return e;
        } else if (jt_tok_is(&t, "len")) {
            e = jt_new_expr(EX_LEN, t.line, t.col);
            jt_advance(p);
            jt_expect(p, TK_LPAREN, "'('");
            e->len = jt_parse_expr(p);
            jt_expect(p, TK_RPAREN, "')'");
            return e;
        } else if (jt_is_reserved(&t)) {
            jt_error_at(p->lx.file, t.line, t.col, "esperado expressao, encontrado '%.*s'", (int)t.len, t.start);
        } else {
            jt_advance(p);
            if (p->tok.kind == TK_LPAREN) return jt_parse_call(p, &t);
            int m = jt_imported(p, t.start, t.len);
            if (m >= 0) {
                if (p->tok.kind != TK_DOT)
                    jt_error_at(p->lx.file, t.line, t.col, "modulo '%.*s' nao pode ser usado como valor", (int)t.len, t.start);
                return jt_parse_qualified_call(p, m, &t);
            }
            if (p->tok.kind == TK_DOT)
                jt_error_at(p->lx.file, t.line, t.col, "'%.*s' nao e uma biblioteca importada (falta 'import %.*s'?)",
                            (int)t.len, t.start, (int)t.len, t.start);
            e = jt_new_expr(EX_VAR, t.line, t.col);
            e->var.name = t.start;
            e->var.name_len = t.len;
            e->var.index = -1;
            return e;
        }
        break;
    default:
        jt_error_at(p->lx.file, t.line, t.col, "esperado expressao");
    }
    jt_advance(p);
    return e;
}

/* atomo seguido de [indice]* */
static JtExpr *jt_parse_primary(JtParser *p) {
    JtExpr *e = jt_parse_atom(p);
    while (p->tok.kind == TK_LBRACKET) {
        JtExpr *ix = jt_new_expr(EX_INDEX, p->tok.line, p->tok.col);
        jt_advance(p);
        ix->idx.base = e;
        ix->idx.index = jt_parse_expr(p);
        jt_expect(p, TK_RBRACKET, "']'");
        e = ix;
    }
    return e;
}

static JtExpr *jt_binary(JtBinOp op, JtExpr *l, JtExpr *r, const JtToken *at) {
    JtExpr *e = jt_new_expr(EX_BINARY, at->line, at->col);
    e->bin.op = op;
    e->bin.l = l;
    e->bin.r = r;
    return e;
}

static JtExpr *jt_unary(JtUnOp op, JtExpr *x, const JtToken *at) {
    JtExpr *e = jt_new_expr(EX_UNARY, at->line, at->col);
    e->un.op = op;
    e->un.x = x;
    return e;
}

/*
 * Precedencia (da mais fraca para a mais forte):
 *   or < and < not < comparacao < + - < * / % < - unario
 */
static JtExpr *jt_parse_unary(JtParser *p) {
    if (p->tok.kind == TK_MINUS) {
        JtToken op = p->tok;
        jt_advance(p);
        return jt_unary(OPU_NEG, jt_parse_unary(p), &op);
    }
    return jt_parse_primary(p);
}

static JtExpr *jt_parse_mul(JtParser *p) {
    JtExpr *e = jt_parse_unary(p);
    for (;;) {
        JtBinOp op;
        if (p->tok.kind == TK_STAR) op = OPB_MUL;
        else if (p->tok.kind == TK_SLASH) op = OPB_DIV;
        else if (p->tok.kind == TK_PERCENT) op = OPB_MOD;
        else return e;
        JtToken at = p->tok;
        jt_advance(p);
        e = jt_binary(op, e, jt_parse_unary(p), &at);
    }
}

static JtExpr *jt_parse_add(JtParser *p) {
    JtExpr *e = jt_parse_mul(p);
    for (;;) {
        JtBinOp op;
        if (p->tok.kind == TK_PLUS) op = OPB_ADD;
        else if (p->tok.kind == TK_MINUS) op = OPB_SUB;
        else return e;
        JtToken at = p->tok;
        jt_advance(p);
        e = jt_binary(op, e, jt_parse_mul(p), &at);
    }
}

static JtExpr *jt_parse_cmp(JtParser *p) {
    JtExpr *e = jt_parse_add(p);
    for (;;) {
        JtBinOp op;
        switch (p->tok.kind) {
        case TK_EQ: op = OPB_EQ; break;
        case TK_NE: op = OPB_NE; break;
        case TK_LT: op = OPB_LT; break;
        case TK_LE: op = OPB_LE; break;
        case TK_GT: op = OPB_GT; break;
        case TK_GE: op = OPB_GE; break;
        default: return e;
        }
        JtToken at = p->tok;
        jt_advance(p);
        e = jt_binary(op, e, jt_parse_add(p), &at);
    }
}

static JtExpr *jt_parse_not(JtParser *p) {
    if (p->tok.kind == TK_IDENT && jt_tok_is(&p->tok, "not")) {
        JtToken op = p->tok;
        jt_advance(p);
        return jt_unary(OPU_NOT, jt_parse_not(p), &op);
    }
    return jt_parse_cmp(p);
}

static JtExpr *jt_parse_and(JtParser *p) {
    JtExpr *e = jt_parse_not(p);
    while (p->tok.kind == TK_IDENT && jt_tok_is(&p->tok, "and")) {
        JtToken at = p->tok;
        jt_advance(p);
        e = jt_binary(OPB_AND, e, jt_parse_not(p), &at);
    }
    return e;
}

static JtExpr *jt_parse_expr(JtParser *p) {
    JtExpr *e = jt_parse_and(p);
    while (p->tok.kind == TK_IDENT && jt_tok_is(&p->tok, "or")) {
        JtToken at = p->tok;
        jt_advance(p);
        e = jt_binary(OPB_OR, e, jt_parse_and(p), &at);
    }
    return e;
}

/* Instrucao de uma linha (sem o NEWLINE final). */
static JtStmt jt_parse_simple(JtParser *p) {
    JtStmt s = {0};
    s.line = p->tok.line;
    s.col = p->tok.col;
    if (p->tok.kind == TK_INDENT)
        jt_error_at(p->lx.file, s.line, s.col, "indentacao inesperada");
    if (p->tok.kind != TK_IDENT)
        jt_error_at(p->lx.file, s.line, s.col, "esperado instrucao");
    if (jt_tok_is(&p->tok, "elif") || jt_tok_is(&p->tok, "else"))
        jt_error_at(p->lx.file, s.line, s.col, "'%.*s' sem 'if' correspondente", (int)p->tok.len, p->tok.start);

    if (jt_tok_is(&p->tok, "void"))
        jt_error_at(p->lx.file, s.line, s.col, "void so pode ser usado como retorno de funcao");

    /* [global] [const] [tipo] nome = expr -- sem tipo, ele e deduzido do valor */
    if (jt_tok_is(&p->tok, "global")) {
        if (p->depth > 0 || p->module >= 0)
            jt_error_at(p->lx.file, s.line, s.col, "global so pode ser usado no nivel principal do programa");
        s.is_global = true;
        jt_advance(p);
        if (!jt_tok_is(&p->tok, "const") && !jt_tok_type(&p->tok, &s.type) &&
            (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok)))
            jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado tipo ou nome apos 'global'");
    }
    if (jt_tok_is(&p->tok, "const")) {
        s.is_const = true;
        jt_advance(p);
        if (!jt_tok_type(&p->tok, &s.type) && (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok)))
            jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado tipo ou nome apos 'const'");
    }
    if ((s.is_const || s.is_global) && !jt_tok_type(&p->tok, &s.type)) {
        /* const nome = expr / global nome = expr */
        s.kind = ST_VAR;
        s.infer = true;
        s.type = TY_AUTO;
        s.name = p->tok.start;
        s.name_len = p->tok.len;
        s.var = -1;
        jt_advance(p);
        jt_expect(p, TK_ASSIGN, "'='");
        s.init = jt_parse_expr(p);
        return s;
    }
    if (s.is_const || jt_tok_type(&p->tok, &s.type)) {
        s.kind = ST_VAR;
        jt_advance(p);
        s.type = jt_parse_type_suffix(p, s.type);
        if (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok))
            jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado nome da variavel");
        s.name = p->tok.start;
        s.name_len = p->tok.len;
        s.var = -1;
        jt_advance(p);
        jt_expect(p, TK_ASSIGN, "'='");
        s.init = jt_parse_expr(p);
        return s;
    }

    JtToken name = p->tok;
    jt_advance(p);

    /* nome = expr */
    if (p->tok.kind == TK_ASSIGN && !jt_is_reserved(&name)) {
        s.kind = ST_ASSIGN;
        s.name = name.start;
        s.name_len = name.len;
        s.var = -1;
        jt_advance(p);
        s.init = jt_parse_expr(p);
        return s;
    }

    /* nome[indice] = expr */
    if (p->tok.kind == TK_LBRACKET && !jt_is_reserved(&name)) {
        s.kind = ST_INDEX_SET;
        s.name = name.start;
        s.name_len = name.len;
        s.var = -1;
        jt_advance(p);
        s.index = jt_parse_expr(p);
        jt_expect(p, TK_RBRACKET, "']'");
        jt_expect(p, TK_ASSIGN, "'='");
        s.init = jt_parse_expr(p);
        return s;
    }

    /* modulo.funcao(args) como instrucao */
    if (p->tok.kind == TK_DOT && jt_imported(p, name.start, name.len) >= 0) {
        s.kind = ST_EXPR;
        s.init = jt_parse_qualified_call(p, jt_imported(p, name.start, name.len), &name);
        return s;
    }

    /* nome.append(expr) */
    if (p->tok.kind == TK_DOT && !jt_is_reserved(&name)) {
        jt_advance(p);
        if (!jt_at_keyword(p, "append"))
            jt_error_at(p->lx.file, p->tok.line, p->tok.col,
                        "metodo desconhecido '%.*s' (se '%.*s' e uma biblioteca, falta 'import %.*s')",
                        (int)p->tok.len, p->tok.start, (int)name.len, name.start, (int)name.len, name.start);
        s.kind = ST_APPEND;
        s.name = name.start;
        s.name_len = name.len;
        s.var = -1;
        jt_advance(p);
        jt_expect(p, TK_LPAREN, "'('");
        s.init = jt_parse_expr(p);
        jt_expect(p, TK_RPAREN, "')'");
        return s;
    }

    /* funcao(args) como instrucao */
    if (p->tok.kind == TK_LPAREN && !jt_is_reserved(&name)) {
        s.kind = ST_EXPR;
        s.init = jt_parse_call(p, &name);
        return s;
    }

    /* print/println(expr) */
    if (jt_tok_is(&name, "print"))        s.fn = BI_PRINT;
    else if (jt_tok_is(&name, "println")) s.fn = BI_PRINTLN;
    else jt_error_at(p->lx.file, s.line, s.col, "instrucao invalida '%.*s'", (int)name.len, name.start);

    s.kind = ST_CALL;
    jt_expect(p, TK_LPAREN, "'('");
    s.arg = jt_parse_expr(p);
    jt_expect(p, TK_RPAREN, "')'");
    return s;
}

static JtStmt jt_parse_stmt(JtParser *p);

/* NEWLINE INDENT instrucao+ DEDENT */
static JtBlock jt_parse_block(JtParser *p) {
    jt_expect(p, TK_NEWLINE, "fim de linha");
    if (p->tok.kind != TK_INDENT)
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado bloco indentado");
    jt_advance(p);
    JtBlock b = {0};
    p->depth++;
    while (p->tok.kind != TK_DEDENT) {
        JtStmt s = jt_parse_stmt(p);
        jt_vec_push(&b, s);
    }
    p->depth--;
    jt_advance(p);
    return b;
}


/* if cond bloco (elif cond bloco)* (else bloco)? */
static JtStmt jt_parse_if(JtParser *p) {
    JtStmt s = {0};
    s.kind = ST_IF;
    s.line = p->tok.line;
    s.col = p->tok.col;
    JT_VEC(JtExpr *) conds = {0};
    JT_VEC(JtBlock) blocks = {0};
    do {
        jt_advance(p); /* if / elif */
        JtExpr *c = jt_parse_expr(p);
        jt_vec_push(&conds, c);
        JtBlock b = jt_parse_block(p);
        jt_vec_push(&blocks, b);
    } while (jt_at_keyword(p, "elif"));
    if (jt_at_keyword(p, "else")) {
        jt_advance(p);
        s.has_else = true;
        s.else_block = jt_parse_block(p);
    }
    s.conds = conds.items;
    s.blocks = blocks.items;
    s.nbranches = conds.len;
    return s;
}

/* while cond bloco */
static JtStmt jt_parse_while(JtParser *p) {
    JtStmt s = {0};
    s.kind = ST_WHILE;
    s.line = p->tok.line;
    s.col = p->tok.col;
    jt_advance(p);
    s.cond = jt_parse_expr(p);
    s.body = jt_parse_block(p);
    return s;
}

/* passo do range: literal inteiro, opcionalmente negativo */
static int32_t jt_parse_step(JtParser *p) {
    JtToken at = p->tok;
    bool neg = false;
    if (p->tok.kind == TK_MINUS) { neg = true; jt_advance(p); }
    if (p->tok.kind != TK_INT)
        jt_error_at(p->lx.file, at.line, at.col, "passo do range deve ser um inteiro constante");
    long long v = strtoll(p->tok.start, NULL, 10);
    if (v == 0 || v > INT32_MAX || p->tok.len > 10)
        jt_error_at(p->lx.file, at.line, at.col, "passo do range deve ser diferente de zero e caber em int");
    jt_advance(p);
    return (int32_t)(neg ? -v : v);
}

/* for nome in range(fim) | range(inicio, fim) | range(inicio, fim, passo) */
static JtStmt jt_parse_for(JtParser *p) {
    JtStmt s = {0};
    s.kind = ST_FOR;
    s.line = p->tok.line;
    s.col = p->tok.col;
    jt_advance(p);
    if (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok))
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado nome da variavel do laco");
    s.name = p->tok.start;
    s.name_len = p->tok.len;
    s.var = -1;
    jt_advance(p);
    if (!jt_at_keyword(p, "in")) jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado 'in'");
    jt_advance(p);
    if (!jt_at_keyword(p, "range")) {
        /* for nome in array */
        s.kind = ST_FOREACH;
        s.iter = jt_parse_expr(p);
        s.body = jt_parse_block(p);
        return s;
    }
    jt_advance(p);
    jt_expect(p, TK_LPAREN, "'('");
    JtExpr *a = jt_parse_expr(p);
    s.step = 1;
    if (p->tok.kind == TK_COMMA) {
        jt_advance(p);
        s.start = a;
        s.end = jt_parse_expr(p);
        if (p->tok.kind == TK_COMMA) {
            jt_advance(p);
            s.step = jt_parse_step(p);
        }
    } else {
        s.start = jt_new_expr(EX_INT, a->line, a->col);
        s.start->i.lexeme = "0";
        s.start->i.lexeme_len = 1;
        s.end = a;
    }
    jt_expect(p, TK_RPAREN, "')'");
    s.body = jt_parse_block(p);
    return s;
}

/* tipo|void|fn nome( ... na posicao atual? (olha dois tokens a frente) */
static bool jt_at_func_def(JtParser *p) {
    JtType ty;
    if (!jt_at_keyword(p, "void") && !jt_at_keyword(p, "fn") && !jt_tok_type(&p->tok, &ty)) return false;
    JtLexer peek = p->lx;
    JtToken name = jt_lex_next(&peek);
    if (name.kind == TK_LBRACKET) {
        if (jt_lex_next(&peek).kind != TK_RBRACKET) return false;
        name = jt_lex_next(&peek);
    }
    JtToken paren = jt_lex_next(&peek);
    return name.kind == TK_IDENT && paren.kind == TK_LPAREN;
}

/* [extern] tipo nome(tipo a, tipo b) [bloco] -- extern nao tem corpo
   fn nome(a, b) bloco                      -- tipo de retorno deduzido do corpo
   parametro sem tipo (a) recebe o tipo do argumento de cada chamada */
static void jt_parse_func(JtParser *p, bool is_extern) {
    JtFunc f = {0};
    f.line = p->tok.line;
    f.col = p->tok.col;
    f.module = p->module;
    f.is_extern = is_extern;
    f.file = p->lx.file;
    if (p->depth > 0)
        jt_error_at(p->lx.file, f.line, f.col, "funcoes so podem ser declaradas no nivel principal");
    f.template_of = -1;
    if (jt_at_keyword(p, "fn")) {
        if (is_extern)
            jt_error_at(p->lx.file, f.line, f.col, "funcao extern precisa de tipo de retorno (int, string, void...)");
        f.ret = TY_AUTO;
        jt_advance(p);
    } else if (jt_at_keyword(p, "void")) {
        f.ret = TY_VOID;
        jt_advance(p);
    } else {
        jt_tok_type(&p->tok, &f.ret);
        jt_advance(p);
        f.ret = jt_parse_type_suffix(p, f.ret);
    }
    if (jt_is_reserved(&p->tok))
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "nome de funcao invalido '%.*s'", (int)p->tok.len, p->tok.start);
    f.name = p->tok.start;
    f.name_len = p->tok.len;
    jt_advance(p);
    jt_expect(p, TK_LPAREN, "'('");
    if (p->tok.kind != TK_RPAREN) {
        for (;;) {
            JtVarInfo v = {0};
            JtToken at = p->tok;
            bool is_void = jt_at_keyword(p, "void");
            if (!is_void && !jt_tok_type(&p->tok, &v.type)) {
                /* parametro sem tipo: so o nome */
                if (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok))
                    jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado nome do parametro");
                if (is_extern)
                    jt_error_at(p->lx.file, p->tok.line, p->tok.col,
                                "parametro de funcao extern precisa de tipo ('%.*s')", (int)p->tok.len, p->tok.start);
                v.name = p->tok.start;
                v.name_len = p->tok.len;
                v.type = TY_AUTO;
                v.readonly = RO_PARAM;
                v.sig = -1;
                jt_advance(p);
                jt_vec_push(&p->prog->vars, v);
                jt_vec_push(&f.params, (int)p->prog->vars.len - 1);
                if (p->tok.kind != TK_COMMA) break;
                jt_advance(p);
                continue;
            }
            if (is_void) v.type = TY_VOID;
            jt_advance(p);
            if (!is_void) v.type = jt_parse_type_suffix(p, v.type);
            if (p->tok.kind == TK_LPAREN) {
                /* valor de funcao: tipo(tipo, tipo) nome */
                JtSig sig = {0};
                sig.ret = v.type;
                jt_advance(p);
                while (p->tok.kind != TK_RPAREN) {
                    JtType pt;
                    if (!jt_tok_type(&p->tok, &pt))
                        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado tipo na assinatura da funcao");
                    jt_advance(p);
                    pt = jt_parse_type_suffix(p, pt);
                    if (sig.n == 16) jt_error_at(p->lx.file, at.line, at.col, "assinatura com parametros demais");
                    sig.params[sig.n++] = pt;
                    if (p->tok.kind != TK_COMMA) break;
                    jt_advance(p);
                }
                jt_expect(p, TK_RPAREN, "')'");
                jt_vec_push(&p->prog->sigs, sig);
                v.sig = (int)p->prog->sigs.len - 1;
                v.type = TY_FN;
            } else if (is_void) {
                jt_error_at(p->lx.file, at.line, at.col, "parametro nao pode ser void");
            }
            if (p->tok.kind != TK_IDENT || jt_is_reserved(&p->tok))
                jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado nome do parametro");
            v.name = p->tok.start;
            v.name_len = p->tok.len;
            v.readonly = RO_PARAM;
            jt_advance(p);
            jt_vec_push(&p->prog->vars, v);
            jt_vec_push(&f.params, (int)p->prog->vars.len - 1);
            if (p->tok.kind != TK_COMMA) break;
            jt_advance(p);
        }
    }
    jt_expect(p, TK_RPAREN, "')'");
    for (size_t i = 0; i < f.params.len; i++)
        if (p->prog->vars.items[f.params.items[i]].type == TY_AUTO) f.is_generic = true;
    f.is_template = f.is_generic || f.ret == TY_AUTO;
    if (is_extern) jt_expect(p, TK_NEWLINE, "fim de linha (funcao extern nao tem corpo)");
    else f.body = jt_parse_block(p);
    jt_vec_push(&p->prog->funcs, f);
}

static JtStmt jt_parse_stmt(JtParser *p) {
    if (jt_at_func_def(p)) jt_error_at(p->lx.file, p->tok.line, p->tok.col, "funcoes so podem ser declaradas no nivel principal");
    if (jt_at_keyword(p, "import") || jt_at_keyword(p, "extern"))
        jt_error_at(p->lx.file, p->tok.line, p->tok.col, "'%.*s' so pode ser usado no nivel principal",
                    (int)p->tok.len, p->tok.start);
    if (jt_at_keyword(p, "return")) {
        JtStmt s = {0};
        s.kind = ST_RETURN;
        s.line = p->tok.line;
        s.col = p->tok.col;
        jt_advance(p);
        if (p->tok.kind != TK_NEWLINE) s.init = jt_parse_expr(p);
        jt_expect(p, TK_NEWLINE, "fim de linha");
        return s;
    }
    if (jt_at_keyword(p, "if")) return jt_parse_if(p);
    if (jt_at_keyword(p, "while")) return jt_parse_while(p);
    if (jt_at_keyword(p, "for")) return jt_parse_for(p);
    if (jt_at_keyword(p, "break") || jt_at_keyword(p, "continue")) {
        JtStmt s = {0};
        s.kind = jt_at_keyword(p, "break") ? ST_BREAK : ST_CONTINUE;
        s.line = p->tok.line;
        s.col = p->tok.col;
        jt_advance(p);
        jt_expect(p, TK_NEWLINE, "fim de linha");
        return s;
    }
    JtStmt s = jt_parse_simple(p);
    jt_expect(p, TK_NEWLINE, "fim de linha");
    return s;
}

static void jt_parse_file(JtParser *p);

/* Registra e le a biblioteca <dir>/<nome>.jat; devolve o indice do modulo. */
static int jt_load_module(JtProgram *prog, char *dir, char *jat_path, const char *name, size_t name_len) {
    JtModule mod = {0};
    mod.dir = dir;
    mod.jat_path = jat_path;
    mod.name = name;
    mod.name_len = name_len;
    char *n = jt_strdup_n(name, name_len);
    char *hpp = jt_xmalloc(strlen(dir) + name_len + 6);
    sprintf(hpp, "%s/%s.hpp", dir, n);
    if (jt_file_exists(hpp)) mod.hpp_path = hpp;
    else free(hpp);
    mod.flags = jt_load_flags(dir, n);
    free(n);

    /* registra antes de ler: imports circulares encontram o modulo ja existente */
    jt_vec_push(&prog->modules, mod);
    int index = (int)prog->modules.len - 1;

    JtParser sub = {0};
    sub.prog = prog;
    sub.module = index;
    sub.dir = prog->modules.items[index].dir;
    char *src = jt_read_file(prog->modules.items[index].jat_path);
    jt_lexer_init(&sub.lx, prog->modules.items[index].jat_path, src);
    jt_advance(&sub);
    jt_parse_file(&sub);
    return index;
}


/*
 * import nome: procura library/<nome>/<nome>.jat
 *   1. em library/ na pasta do arquivo que importa (bibliotecas do projeto)
 *   2. ao lado da biblioteca atual (uma biblioteca importando outra)
 *   3. em library/ ao lado do executavel jatai (biblioteca padrao)
 */
static void jt_parse_import(JtParser *p) {
    JtToken at = p->tok;
    if (p->depth > 0)
        jt_error_at(p->lx.file, at.line, at.col, "import so pode ser usado no nivel principal");
    jt_advance(p);
    JtToken name = p->tok;
    if (name.kind != TK_IDENT || jt_is_reserved(&name))
        jt_error_at(p->lx.file, name.line, name.col, "esperado nome da biblioteca");
    jt_advance(p);
    jt_expect(p, TK_NEWLINE, "fim de linha");
    if (jt_imported(p, name.start, name.len) >= 0) return;

    JtProgram *prog = p->prog;
    for (size_t i = 0; i < prog->modules.len; i++) {
        const JtModule *m = &prog->modules.items[i];
        if (m->name_len == name.len && memcmp(m->name, name.start, name.len) == 0) {
            jt_vec_push(&p->imports, (int)i); /* ja carregado por outro arquivo */
            return;
        }
    }

    char *n = jt_strdup_n(name.start, name.len);
    char *file_name = jt_xmalloc(name.len + 5);
    snprintf(file_name, name.len + 5, "%s.jat", n);
    char *roots[3];
    int nroots = 0;
    roots[nroots++] = jt_path_join(p->dir, "library", NULL);
    if (p->module >= 0) roots[nroots++] = jt_path_join(p->dir, "..", NULL);
    if (prog->lib_root) roots[nroots++] = jt_strdup_n(prog->lib_root, strlen(prog->lib_root));

    JtModule mod = {0};
    for (int i = 0; i < nroots && !mod.jat_path; i++) {
        char *candidate = jt_path_join(roots[i], n, file_name);
        if (jt_file_exists(candidate)) {
            mod.jat_path = candidate;
            mod.dir = jt_path_join(roots[i], n, NULL);
        } else {
            free(candidate);
        }
    }
    if (!mod.jat_path) {
        fprintf(stderr, "%s:%d:%d: erro: biblioteca '%s' nao encontrada. Procurei em:\n",
                p->lx.file, name.line, name.col, n);
        for (int i = 0; i < nroots; i++) fprintf(stderr, "  %s/%s/%s\n", roots[i], n, file_name);
        exit(1);
    }
    int index = jt_load_module(prog, mod.dir, mod.jat_path, name.start, name.len);
    jt_vec_push(&p->imports, index);

    /* funcoes extern vem da biblioteca nativa (bin/<plataforma>/), verificada ao carregar */
    for (int i = 0; i < nroots; i++) free(roots[i]);
    free(file_name);
    free(n);
}

/* Nivel principal de um arquivo: programa (instrucoes) ou biblioteca (so declaracoes). */
static void jt_parse_file(JtParser *p) {
    while (p->tok.kind != TK_EOF) {
        if (jt_at_keyword(p, "import")) {
            jt_parse_import(p);
            continue;
        }
        if (jt_at_keyword(p, "extern")) {
            if (p->module < 0)
                jt_error_at(p->lx.file, p->tok.line, p->tok.col, "extern so pode ser usado em bibliotecas");
            jt_advance(p);
            if (!jt_at_func_def(p))
                jt_error_at(p->lx.file, p->tok.line, p->tok.col, "esperado declaracao de funcao depois de extern");
            jt_parse_func(p, true);
            p->prog->modules.items[p->module].has_extern = true;
            continue;
        }
        if (jt_at_func_def(p)) {
            jt_parse_func(p, false);
            continue;
        }
        if (p->module >= 0)
            jt_error_at(p->lx.file, p->tok.line, p->tok.col,
                        "bibliotecas so podem conter funcoes, extern e import");
        JtStmt s = jt_parse_stmt(p);
        jt_vec_push(&p->prog->body, s);
    }
}

/* lib_root: pasta library/ da biblioteca padrao (ou NULL) */
/* So a biblioteca <dir>/<nome>.jat (modulo 0), para o jatai -lib. */
static JtProgram jt_parse_library(const char *dir, const char *name, const char *lib_root) {
    JtProgram prog = {0};
    prog.lib_root = lib_root;
    prog.cur_module = -1;
    char *jat = jt_xmalloc(strlen(dir) + strlen(name) + 6);
    sprintf(jat, "%s/%s.jat", dir, name);
    if (!jt_file_exists(jat)) jt_fatal("'%s' nao encontrado", jat);
    prog.file = jat;
    jt_load_module(&prog, jt_strdup_n(dir, strlen(dir)), jat, jt_strdup_n(name, strlen(name)), strlen(name));
    return prog;
}

static JtProgram jt_parse(const char *file, const char *src, const char *lib_root) {
    JtProgram prog = {0};
    prog.file = file;
    prog.lib_root = lib_root;
    prog.cur_module = -1;

    JtParser p = {0};
    p.prog = &prog;
    p.module = -1;
    p.dir = jt_dirname(file);
    jt_lexer_init(&p.lx, file, src);
    jt_advance(&p);
    jt_parse_file(&p);
    return prog;
}

#endif
