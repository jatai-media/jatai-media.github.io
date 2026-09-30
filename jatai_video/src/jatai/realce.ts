// realce.ts - cores para o codigo Jatai no editor de scripts
//
// Transforma o texto em HTML com <span class="jr-..."> por token. O HTML tem
// exatamente os mesmos caracteres do texto (so escapados), porque fica por
// baixo do <textarea> transparente em que se digita: qualquer letra a mais ou
// a menos desalinharia o cursor das cores.

const PALAVRAS = new Set(["if", "elif", "else", "while", "for", "in", "return", "break", "continue",
                          "import", "extern", "global", "const"]);
const LOGICOS = new Set(["and", "or", "not"]);
const TIPOS = new Set(["int", "double", "string", "char", "bool", "void"]);
const EMBUTIDAS = new Set(["print", "println", "len", "range", "append"]);

// depois de um tipo no comeco da linha: "int nome(" / "string[] nome(" define uma funcao
const DEFINE_TIPADA = /^(\[\])?\s+[A-Za-z_]\w*\s*\(/;
const COMECO_DE_LINHA = /^\s*(extern\s+)?$/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function span(cls: string, s: string): string {
  return `<span class="jr-${cls}">${esc(s)}</span>`;
}

// texto da linha antes da posicao i
function linhaAntes(src: string, i: number): string {
  return src.slice(src.lastIndexOf("\n", i - 1) + 1, i);
}

// Onde fecha a "{" que abre em s[i]? (respeita parenteses, chaves e strings de dentro)
function fechaInterp(s: string, i: number, fim: number): number {
  let prof = 0;
  for (let k = i + 1; k < fim; k++) {
    const c = s[k];
    if (c === "\n") return -1;
    if (c === '"' || c === "'") {
      for (k++; k < fim && s[k] !== c; k++) {
        if (s[k] === "\n") return -1;
        if (s[k] === "\\") k++;
      }
    } else if (c === "(" || c === "[" || c === "{") prof++;
    else if (c === ")" || c === "]") prof--;
    else if (c === "}") {
      if (prof === 0) return k;
      prof--;
    }
  }
  return -1;
}

// Conteudo de uma string: texto comum, escapes e "{expr}" / "{{expr}}" com o codigo colorido.
function corpoString(s: string, triplo: boolean): string {
  let out = "", texto = "";
  const solta = () => { if (texto) out += span("str", texto); texto = ""; };
  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (!triplo && c === "\\" && i + 1 < s.length) {
      solta();
      out += span("esc", s.slice(i, i + 2));
      i += 2;
      continue;
    }
    const duplo = triplo && s.startsWith("{{", i);
    if (c === "{" && (!triplo || duplo)) {
      const ini = duplo ? i + 1 : i;
      const j = /[A-Za-z_ ]/.test(s[ini + 1] || "") ? fechaInterp(s, ini, s.length) : -1;
      if (j > 0 && (!duplo || s[j + 1] === "}")) {
        const abre = duplo ? "{{" : "{", fecha = duplo ? "}}" : "}";
        solta();
        out += span("interp", abre) + codigo(s.slice(i + abre.length, j)) + span("interp", fecha);
        i = j + fecha.length;
        continue;
      }
    }
    texto += c;
    i++;
  }
  solta();
  return out;
}

/** HTML colorido do codigo Jatai. */
export function codigo(src: string): string {
  let out = "";
  let i = 0;
  let nomeDeFuncao = false; // o proximo nome e o de uma funcao sendo definida
  const n = src.length;
  while (i < n) {
    const c = src[i];

    if (c === "#") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      out += span("com", src.slice(i, j));
      i = j;
      continue;
    }

    if (src.startsWith('"""', i)) {
      const j = src.indexOf('"""', i + 3);
      const fim = j < 0 ? n : j;
      out += span("str", '"""') + corpoString(src.slice(i + 3, fim), true);
      if (j >= 0) out += span("str", '"""');
      i = j < 0 ? n : j + 3;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== '"' && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "{") {
          const k = fechaInterp(src, j, n);
          if (k > 0) j = k;
        }
        j++;
      }
      const fechou = j < n && src[j] === '"';
      out += span("str", '"') + corpoString(src.slice(i + 1, Math.min(j, n)), false);
      if (fechou) out += span("str", '"');
      i = fechou ? j + 1 : j;
      continue;
    }

    if (c === "'") {
      const m = /^'(\\.|[^'\\\n])'/.exec(src.slice(i, i + 4));
      if (m) {
        out += span("str", m[0]);
        i += m[0].length;
        continue;
      }
    }

    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!;
      out += span("num", m[0]);
      i += m[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(c)) {
      const w = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      const resto = src.slice(i + w.length, i + w.length + 80);
      let cls = "";
      if (nomeDeFuncao) cls = "def";
      else if (w === "fn") cls = "fn";
      else if (PALAVRAS.has(w)) cls = "kw";
      else if (LOGICOS.has(w)) cls = "logic";
      else if (TIPOS.has(w)) cls = "tipo";
      else if (w === "true" || w === "false") cls = "bool";
      else if (/^\.\s*[A-Za-z_]/.test(resto)) cls = "mod";
      else if (/^\s*\(/.test(resto)) cls = EMBUTIDAS.has(w) ? "builtin" : "call";
      const define = w === "fn" ||
                     (TIPOS.has(w) && DEFINE_TIPADA.test(resto) && COMECO_DE_LINHA.test(linhaAntes(src, i)));
      nomeDeFuncao = cls !== "def" && define;
      out += cls ? span(cls, w) : esc(w);
      i += w.length;
      continue;
    }

    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      out += c;
      i++;
      continue;
    }

    if (c !== "[" && c !== "]") nomeDeFuncao = false; // "int[] nome(": os [] nao contam
    out += "+-*/%=<>!".includes(c) ? span("op", c) : esc(c);
    i++;
  }
  return out;
}
