#ifndef JT_LEXER_H
#define JT_LEXER_H

#include "common.h"

typedef enum {
    TK_IDENT,
    TK_INT,
    TK_DOUBLE,
    TK_STRING,
    TK_CHAR,
    TK_LPAREN,
    TK_RPAREN,
    TK_COMMA,
    TK_LBRACKET,
    TK_RBRACKET,
    TK_DOT,
    TK_ASSIGN,
    TK_PLUS,
    TK_MINUS,
    TK_STAR,
    TK_SLASH,
    TK_PERCENT,
    TK_EQ,
    TK_NE,
    TK_LT,
    TK_LE,
    TK_GT,
    TK_GE,
    TK_NEWLINE, /* fim de instrucao */
    TK_INDENT,  /* abre bloco */
    TK_DEDENT,  /* fecha bloco */
    TK_EOF,
} JtTokKind;

#define JT_MAX_INDENT 128

typedef struct {
    JtTokKind kind;
    const char *start; /* texto bruto no fonte */
    size_t len;
    int line, col;
    char *str;         /* TK_STRING: conteudo com escapes ja resolvidos */
    bool triple;       /* TK_STRING com aspas triplas (multilinha, crua) */
    size_t str_len;
    char ch;           /* TK_CHAR */
} JtToken;

typedef struct {
    const char *file;
    const char *cur;
    const char *line_start;
    int line;
    /* indentacao significativa */
    bool at_line_start;
    int indents[JT_MAX_INDENT]; /* pilha de larguras; indents[0] = 0 */
    int nindents;
    int pending_dedents;
    int paren_depth;            /* dentro de ( ) e [ ] a quebra de linha e ignorada */
    char indent_char;           /* ' ' ou '\t', fixado pela primeira indentacao */
    int col_base;               /* somado as colunas: expressao de "{...}" lida de dentro de uma string */
} JtLexer;

static void jt_lexer_init(JtLexer *lx, const char *file, const char *src) {
    memset(lx, 0, sizeof *lx);
    lx->at_line_start = true;
    lx->nindents = 1;
    lx->file = file;
    lx->cur = src;
    /* ignora BOM UTF-8 */
    if ((unsigned char)src[0] == 0xEF && (unsigned char)src[1] == 0xBB && (unsigned char)src[2] == 0xBF)
        lx->cur += 3;
    lx->line_start = lx->cur;
    lx->line = 1;
}

static bool jt_is_digit(char c) { return c >= '0' && c <= '9'; }
static bool jt_is_ident_start(char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_'; }
static bool jt_is_ident_char(char c) { return jt_is_ident_start(c) || jt_is_digit(c); }

/* Resolve o escape apos a barra em *s; retorna o byte resultante. */
static char jt_lex_escape(JtLexer *lx, const char *s) {
    switch (*s) {
    case 'n':  return '\n';
    case 't':  return '\t';
    case 'r':  return '\r';
    case '\\': return '\\';
    case '"':  return '"';
    case '\'': return '\'';
    }
    jt_error_at(lx->file, lx->line, (int)(s - lx->line_start), "escape invalido '\\%c'", *s);
    return 0;
}

/* s aponta para um '{' (em "{expr}", ou o segundo '{' de "{{ expr }}"). Devolve o
   '}' correspondente, pulando ( ) [ ] { } e strings/chars aninhados, ou NULL se ele
   nao fecha antes do fim da linha (ou de end, quando end nao e NULL). */
static const char *jt_interp_close(const char *s, const char *end) {
    int depth = 0;
    for (const char *p = s + 1; (!end || p < end) && *p != '\n' && *p != '\r' && *p != '\0'; p++) {
        char c = *p;
        if (c == '"' || c == '\'') {
            for (p++; *p != c; p++) {
                if ((end && p >= end) || *p == '\n' || *p == '\r' || *p == '\0') return NULL;
                if (*p == '\\') p++;
            }
        } else if (c == '(' || c == '[' || c == '{') {
            depth++;
        } else if (c == ')' || c == ']') {
            if (--depth < 0) return NULL;
        } else if (c == '}') {
            if (depth == 0) return p;
            depth--;
        }
    }
    return NULL;
}

/* Em uma string "...", {expr} comeca com '{' seguido de um nome. Devolve o '}'
   que a fecha, ou NULL se nao e interpolacao (o '{' e texto). */
static const char *jt_interp_span(const char *s, const char *end) {
    if (s[0] != '{' || (end && s + 1 >= end) || !jt_is_ident_start(s[1])) return NULL;
    return jt_interp_close(s, end);
}

static void jt_lex_string(JtLexer *lx, JtToken *t) {
    const char *body = lx->cur + 1; /* pula a aspa */
    const char *p = body;
    while (*p != '"') {
        const char *close = jt_interp_span(p, NULL);
        if (close) { p = close + 1; continue; }
        if (*p == '\0' || *p == '\n' || *p == '\r')
            jt_error_at(lx->file, t->line, t->col, "string nao terminada");
        if (*p == '\\' && p[1] != '\0') p++;
        p++;
    }

    char *out = jt_xmalloc((size_t)(p - body) + 1);
    size_t n = 0;
    for (const char *s = body; s < p; s++) {
        const char *close = jt_interp_span(s, NULL);
        if (close) { /* expressao interpolada: copiada sem resolver escapes */
            memcpy(out + n, s, (size_t)(close + 1 - s));
            n += (size_t)(close + 1 - s);
            s = close;
            continue;
        }
        if (*s == '\\') out[n++] = jt_lex_escape(lx, ++s);
        else out[n++] = *s;
    }
    out[n] = '\0';
    t->str = out;
    t->str_len = n;
    lx->cur = p + 1;
}

/*
 * """ ... """: string multilinha e crua (sem escapes), para colar HTML/CSS/JS.
 *  - a quebra de linha logo apos o """ de abertura e ignorada;
 *  - CRLF vira LF;
 *  - se o """ de fechamento esta sozinho na linha, o recuo dele e removido de
 *    todas as linhas (como no Swift), junto com a quebra de linha final.
 */
static void jt_lex_triple(JtLexer *lx, JtToken *t) {
    const char *body = lx->cur + 3, *p = body;
    for (;;) {
        if (*p == '\0') jt_error_at(lx->file, t->line, t->col, "string com aspas triplas nao terminada");
        if (p[0] == '"' && p[1] == '"' && p[2] == '"') break;
        if (*p == '\n') {
            lx->line++;
            lx->line_start = p + 1;
        }
        p++;
    }
    const char *end = p;
    lx->cur = p + 3;

    /* copia normalizando CRLF */
    char *raw = jt_xmalloc((size_t)(end - body) + 1);
    size_t n = 0;
    for (const char *s = body; s < end; s++)
        if (!(s[0] == '\r' && s + 1 < end && s[1] == '\n')) raw[n++] = *s;
    raw[n] = '\0';

    /* conteudo = raw[start, n): sem a quebra de linha logo apos a abertura */
    size_t start = raw[0] == '\n' ? 1 : 0;

    /* a ultima linha (depois da ultima quebra) e so espaco? entao o """ final esta
       sozinho: o recuo dele sai de todas as linhas e a quebra final nao entra */
    size_t last = n;
    while (last > start && raw[last - 1] != '\n') last--;
    bool has_nl = last > start;
    bool closing_alone = has_nl || start == 1;
    for (size_t i = last; closing_alone && i < n; i++)
        if (raw[i] != ' ' && raw[i] != '\t') closing_alone = false;
    const char *indent = raw + last;
    size_t ind_len = closing_alone ? n - last : 0;
    size_t stop = !closing_alone ? n : has_nl ? last - 1 : start; /* fim do conteudo */

    char *out = jt_xmalloc(n + 1);
    size_t o = 0;
    int line = t->line + (start ? 1 : 0);
    for (size_t i = start; i < stop;) {
        /* inicio de uma linha do conteudo: remove o recuo do """ final
           (menos na linha que comeca junto com o """ de abertura) */
        if (ind_len && !(i == 0 && start == 0)) {
            size_t k = 0;
            while (k < ind_len && i + k < stop && raw[i + k] == indent[k]) k++;
            bool blank = true;
            for (size_t j = i; j < stop && raw[j] != '\n'; j++)
                if (raw[j] != ' ' && raw[j] != '\t') { blank = false; break; }
            if (k < ind_len && !blank)
                jt_error_at(lx->file, line, (int)k + 1,
                            "linha com recuo menor que o \"\"\" que fecha a string");
            i += k;
            if (blank) while (i < stop && raw[i] != '\n') i++;
        }
        while (i < stop && raw[i] != '\n') out[o++] = raw[i++];
        if (i < stop) { out[o++] = '\n'; i++; line++; }
    }
    out[o] = '\0';
    free(raw);
    t->str = out;
    t->str_len = o;
    t->triple = true;
}

static void jt_lex_char(JtLexer *lx, JtToken *t) {
    const char *p = lx->cur + 1; /* pula o apostrofo */
    if (*p == '\\') t->ch = jt_lex_escape(lx, ++p);
    else if (*p == '\'' || *p == '\0' || *p == '\n' || *p == '\r')
        jt_error_at(lx->file, t->line, t->col, "char vazio ou nao terminado");
    else t->ch = *p;
    p++;
    if (*p != '\'')
        jt_error_at(lx->file, t->line, t->col, "char deve conter exatamente um byte");
    lx->cur = p + 1;
}

static JtToken jt_make_tok(JtLexer *lx, JtTokKind kind) {
    JtToken t = {0};
    t.kind = kind;
    t.start = lx->cur;
    t.line = lx->line;
    t.col = (int)(lx->cur - lx->line_start) + 1 + lx->col_base;
    return t;
}

static void jt_lex_newline(JtLexer *lx) {
    lx->cur++;
    lx->line++;
    lx->line_start = lx->cur;
}

/* Inicio de linha logica: mede a indentacao e emite INDENT/DEDENT.
   Linhas vazias ou so com comentario sao ignoradas. Retorna true se gerou token. */
static bool jt_lex_indent(JtLexer *lx, JtToken *out) {
    for (;;) {
        const char *p = lx->cur;
        while (*p == ' ' || *p == '\t') p++;
        const char *q = p;
        if (*q == '#') while (*q != '\n' && *q != '\0') q++;
        if (*q == '\r') q++;
        if (*q == '\n') { lx->cur = q; jt_lex_newline(lx); continue; } /* linha vazia */
        if (*q == '\0') { lx->cur = q; return false; }

        for (const char *w = lx->cur; w < p; w++) {
            if (lx->indent_char == 0) lx->indent_char = *w;
            else if (*w != lx->indent_char)
                jt_error_at(lx->file, lx->line, (int)(w - lx->line_start) + 1,
                            "indentacao mistura tabs e espacos");
        }

        int width = (int)(p - lx->cur);
        lx->cur = p;
        lx->at_line_start = false;
        int top = lx->indents[lx->nindents - 1];
        if (width > top) {
            if (lx->nindents == JT_MAX_INDENT) jt_error_at(lx->file, lx->line, 1, "aninhamento profundo demais");
            lx->indents[lx->nindents++] = width;
            *out = jt_make_tok(lx, TK_INDENT);
            return true;
        }
        if (width < top) {
            while (lx->nindents > 1 && width < lx->indents[lx->nindents - 1]) {
                lx->nindents--;
                lx->pending_dedents++;
            }
            if (width != lx->indents[lx->nindents - 1])
                jt_error_at(lx->file, lx->line, width + 1, "indentacao nao corresponde a nenhum bloco anterior");
            lx->pending_dedents--;
            *out = jt_make_tok(lx, TK_DEDENT);
            return true;
        }
        return false;
    }
}

static JtToken jt_lex_next(JtLexer *lx) {
    if (lx->pending_dedents > 0) {
        lx->pending_dedents--;
        return jt_make_tok(lx, TK_DEDENT);
    }

    JtToken ind;
    if (lx->at_line_start && lx->paren_depth == 0 && jt_lex_indent(lx, &ind)) return ind;

    for (;;) {
        char c = *lx->cur;
        if (c == ' ' || c == '\t' || c == '\r') { lx->cur++; continue; }
        if (c == '#') {
            while (*lx->cur != '\n' && *lx->cur != '\0') lx->cur++;
            continue;
        }
        if (c == '\n') {
            if (lx->paren_depth > 0 || lx->at_line_start) { jt_lex_newline(lx); continue; }
            JtToken t = jt_make_tok(lx, TK_NEWLINE);
            jt_lex_newline(lx);
            lx->at_line_start = true;
            return t;
        }
        break;
    }

    JtToken t = jt_make_tok(lx, TK_EOF);
    char c = *lx->cur;
    switch (c) {
    case '\0':
        /* fecha a ultima linha e todos os blocos abertos */
        if (lx->paren_depth > 0) jt_error_at(lx->file, t.line, t.col, "parentese nao fechado");
        if (!lx->at_line_start) { lx->at_line_start = true; t.kind = TK_NEWLINE; return t; }
        if (lx->nindents > 1) { lx->nindents--; t.kind = TK_DEDENT; return t; }
        return t;
    case '(':  t.kind = TK_LPAREN; lx->paren_depth++; break;
    case ')':  t.kind = TK_RPAREN; if (lx->paren_depth > 0) lx->paren_depth--; break;
    case ',':  t.kind = TK_COMMA;   break;
    case '.':  t.kind = TK_DOT;     break;
    case '[':  t.kind = TK_LBRACKET; lx->paren_depth++; break;
    case ']':  t.kind = TK_RBRACKET; if (lx->paren_depth > 0) lx->paren_depth--; break;
    case '+':  t.kind = TK_PLUS;    break;
    case '-':  t.kind = TK_MINUS;   break;
    case '*':  t.kind = TK_STAR;    break;
    case '/':  t.kind = TK_SLASH;   break;
    case '%':  t.kind = TK_PERCENT; break;
    case '=':
    case '<':
    case '>':
    case '!':
        if (lx->cur[1] == '=') {
            t.kind = c == '=' ? TK_EQ : c == '<' ? TK_LE : c == '>' ? TK_GE : TK_NE;
            lx->cur += 2;
            t.len = 2;
            return t;
        }
        if (c == '!') jt_error_at(lx->file, t.line, t.col, "use 'not' em vez de '!'");
        t.kind = c == '=' ? TK_ASSIGN : c == '<' ? TK_LT : TK_GT;
        break;
    case '"':
        t.kind = TK_STRING;
        if (lx->cur[1] == '"' && lx->cur[2] == '"') jt_lex_triple(lx, &t);
        else jt_lex_string(lx, &t);
        t.len = (size_t)(lx->cur - t.start);
        return t;
    case '\'':
        t.kind = TK_CHAR;
        jt_lex_char(lx, &t);
        t.len = (size_t)(lx->cur - t.start);
        return t;
    default:
        if (jt_is_digit(c)) {
            t.kind = TK_INT;
            while (jt_is_digit(*lx->cur)) lx->cur++;
            if (lx->cur[0] == '.' && jt_is_digit(lx->cur[1])) {
                t.kind = TK_DOUBLE;
                lx->cur++;
                while (jt_is_digit(*lx->cur)) lx->cur++;
            }
            t.len = (size_t)(lx->cur - t.start);
            return t;
        }
        if (jt_is_ident_start(c)) {
            while (jt_is_ident_char(*lx->cur)) lx->cur++;
            t.kind = TK_IDENT;
            t.len = (size_t)(lx->cur - t.start);
            return t;
        }
        jt_error_at(lx->file, t.line, t.col, "caractere inesperado '%c'", c);
    }
    lx->cur++;
    t.len = 1;
    return t;
}

#endif
