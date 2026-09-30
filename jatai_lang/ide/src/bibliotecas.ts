// As bibliotecas padrao do Jatai, respondidas pela pagina.
//
// No Windows cada biblioteca e uma DLL (library/<nome>/bin); na web a VM chama
// `jatai.call` e quem responde e a funcao de mesmo modulo e nome daqui. As
// regras sao as da versao C++ (library/<nome>/<nome>.hpp): posicoes em bytes
// UTF-8, como len(); texto invalido vira 0; erros de arquivo encerram o programa.
//
// Fora daqui: iliv (janela) e http (servidor) pedem o Jatai instalado, e
// callbacks em funcoes extern ainda nao existem na web.

export type Valor = number | string | boolean;
/** uma funcao pode devolver bytes crus - um pedaco de UTF-8 cortado no meio do caractere */
export type Retorno = Valor | Uint8Array | void;
export type Funcao = (...args: Valor[]) => Retorno;
export type Bibliotecas = Record<string, Record<string, Funcao>>;

/** Encerra o programa com uma mensagem, como o jt_fatal da VM. */
export class ErroJatai extends Error {}

export type Contexto = {
  escreve: (fd: 1 | 2, texto: string) => void;
  /** a proxima linha da entrada (sem o \n), ou null no fim da entrada */
  leLinha: () => string | null;
  /** true quando nao ha mais entrada (pode esperar o que se digita) */
  fimDaEntrada: () => boolean;
  /** toda a entrada que resta */
  leTudo: () => string;
  espera: (segundos: number) => void;
  fs: SistemaDeArquivos;
  fala: (texto: string, esperar: boolean) => void;
  cala: () => void;
  vozes: string[];
  voz: { nome: string; velocidade: number; volume: number };
};

const utf8 = new TextEncoder();
const deUtf8 = new TextDecoder();
const bytes = (s: Valor) => utf8.encode(String(s));

// -------------------------------------------------------------- text

const ESPACO = new Set([32, 9, 13, 10]);

// A mesma regra do text.hpp: ASCII e o bloco Latin-1 (0xC3 + 0x80-0x9E / 0xA0-0xBE).
function caixa(b: Uint8Array, de: number, ate: number, alta: boolean): void {
  for (let i = de; i < ate; i++) {
    const c = b[i];
    if (alta && c >= 97 && c <= 122) b[i] = c - 32;
    else if (!alta && c >= 65 && c <= 90) b[i] = c + 32;
    else if (c === 0xc3 && i + 1 < ate) {
      const d = b[i + 1];
      if (alta && d >= 0xa0 && d <= 0xbe && d !== 0xb7) b[i + 1] = d - 0x20;
      if (!alta && d >= 0x80 && d <= 0x9e && d !== 0x97) b[i + 1] = d + 0x20;
      i++;
    }
  }
}

function tamanhoDoCaractere(b: Uint8Array, i: number): number {
  const c = b[i];
  const n = c < 0x80 ? 1 : c >> 5 === 6 ? 2 : c >> 4 === 14 ? 3 : c >> 3 === 30 ? 4 : 1;
  return i + n <= b.length ? n : 1;
}

function acha(s: Uint8Array, parte: Uint8Array, de = 0): number {
  if (parte.length === 0) return de <= s.length ? de : -1;
  fora: for (let i = de; i + parte.length <= s.length; i++) {
    for (let k = 0; k < parte.length; k++) if (s[i + k] !== parte[k]) continue fora;
    return i;
  }
  return -1;
}

function apara(b: Uint8Array, esquerda: boolean, direita: boolean): Uint8Array {
  let i = 0, n = b.length;
  if (esquerda) while (i < n && ESPACO.has(b[i])) i++;
  if (direita) while (n > i && ESPACO.has(b[n - 1])) n--;
  return b.slice(i, n);
}

const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);

// "  jOAO   da  SILVA-souza " -> "Joao da Silva-Souza"
function nomeProprio(s: string): Uint8Array {
  const palavras = s.split(/[ \t\r\n]+/).filter(Boolean);
  const partes = palavras.map((p, n) => {
    const b = bytes(p);
    caixa(b, 0, b.length, false);
    if (n === 0 || !PARTICULAS.has(deUtf8.decode(b))) {
      let maiuscula = true;
      for (let k = 0; k < b.length;) {
        const t = tamanhoDoCaractere(b, k);
        if (maiuscula) caixa(b, k, k + t, true);
        maiuscula = b[k] === 45 || b[k] === 39; // - e '
        k += t;
      }
    }
    return deUtf8.decode(b);
  });
  return bytes(partes.join(' '));
}

// o from_chars do C++: o texto inteiro (sem as pontas) tem de ser o numero
function inteiro(s: string): number | null {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return null;
  const v = Number(t);
  return v >= -2147483648 && v <= 2147483647 ? v : null;
}

function decimal(s: string): number {
  const t = s.trim();
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) && !/^-?(inf|infinity|nan)$/i.test(t)) return 0;
  const v = Number(t);
  return Number.isNaN(v) && !/nan/i.test(t) ? 0 : v;
}

const text: Record<string, Funcao> = {
  upper: (s) => { const b = bytes(s); caixa(b, 0, b.length, true); return b; },
  lower: (s) => { const b = bytes(s); caixa(b, 0, b.length, false); return b; },
  name: (s) => nomeProprio(String(s)),
  capitalize: (s) => {
    const b = bytes(s);
    if (b.length) caixa(b, 0, tamanhoDoCaractere(b, 0), true);
    return b;
  },
  trim: (s) => apara(bytes(s), true, true),
  trim_left: (s) => apara(bytes(s), true, false),
  trim_right: (s) => apara(bytes(s), false, true),
  contains: (s, p) => acha(bytes(s), bytes(p)) >= 0,
  starts_with: (s, p) => String(s).startsWith(String(p)),
  ends_with: (s, p) => String(s).endsWith(String(p)),
  find: (s, p) => acha(bytes(s), bytes(p)),
  find_from: (s, p, de) => {
    const b = bytes(s);
    let i = Number(de);
    if (i < 0) i = 0;
    if (i > b.length) return -1;
    return acha(b, bytes(p), i);
  },
  count: (s, p) => {
    const b = bytes(s), q = bytes(p);
    if (!q.length) return 0;
    let n = 0;
    for (let i = acha(b, q); i >= 0; i = acha(b, q, i + q.length)) n++;
    return n;
  },
  replace: (s, antigo, novo) => (String(antigo) ? String(s).split(String(antigo)).join(String(novo)) : String(s)),
  slice: (s, de, ate) => {
    const b = bytes(s), n = b.length;
    let a = Math.max(0, Math.min(Number(de), n));
    let z = Math.min(Number(ate), n);
    if (z < a) z = a;
    return b.slice(a, z);
  },
  repeat: (s, vezes) => (Number(vezes) > 0 ? String(s).repeat(Number(vezes)) : ''),
  length: (s) => { let n = 0; for (const c of bytes(s)) if ((c & 0xc0) !== 0x80) n++; return n; },
  is_int: (s) => inteiro(String(s)) !== null,
  to_int: (s) => inteiro(String(s)) ?? 0,
  to_double: (s) => decimal(String(s)),
};

// -------------------------------------------------------------- file

/** Os arquivos que o programa ve: os do projeto, e o que ele mesmo cria. */
export class SistemaDeArquivos {
  private arquivos = new Map<string, Uint8Array>();
  private pastas = new Set<string>(['']);
  /** o que mudou, para a pagina atualizar o projeto no fim */
  readonly alterados = new Map<string, Uint8Array | null>();

  constructor(iniciais: Record<string, string>) {
    for (const [c, t] of Object.entries(iniciais)) this.poe(SistemaDeArquivos.normaliza(c), utf8.encode(t), false);
  }

  // "./a/../b//c.txt" -> "b/c.txt"; tudo relativo a raiz do projeto
  static normaliza(caminho: string): string {
    const out: string[] = [];
    for (const p of caminho.replace(/\\/g, '/').split('/')) {
      if (!p || p === '.') continue;
      if (p === '..') out.pop();
      else out.push(p);
    }
    return out.join('/');
  }

  private poe(c: string, dados: Uint8Array, marca = true): void {
    this.arquivos.set(c, dados);
    const partes = c.split('/');
    for (let i = 1; i < partes.length; i++) this.pastas.add(partes.slice(0, i).join('/'));
    if (marca) this.alterados.set(c, dados);
  }

  le(c: string): Uint8Array | undefined { return this.arquivos.get(SistemaDeArquivos.normaliza(c)); }
  existe(c: string): boolean { const n = SistemaDeArquivos.normaliza(c); return this.arquivos.has(n) || this.pastas.has(n); }
  ehPasta(c: string): boolean { return this.pastas.has(SistemaDeArquivos.normaliza(c)); }
  grava(c: string, dados: Uint8Array): void {
    const n = SistemaDeArquivos.normaliza(c);
    if (this.pastas.has(n)) throw new ErroJatai(`file: '${c}' e uma pasta`);
    const pai = n.includes('/') ? n.slice(0, n.lastIndexOf('/')) : '';
    if (!this.pastas.has(pai)) throw new ErroJatai(`file: a pasta de '${c}' nao existe (use file.mkdir)`);
    this.poe(n, dados);
  }
  criaPasta(c: string): void {
    const partes = SistemaDeArquivos.normaliza(c).split('/');
    for (let i = 1; i <= partes.length; i++) this.pastas.add(partes.slice(0, i).join('/'));
  }
  apaga(c: string): void {
    const n = SistemaDeArquivos.normaliza(c);
    if (this.arquivos.delete(n)) { this.alterados.set(n, null); return; }
    if (this.pastas.has(n)) {
      if (this.lista(n).length) throw new ErroJatai(`file.remove: a pasta '${c}' nao esta vazia`);
      this.pastas.delete(n);
    }
  }
  lista(c: string): string[] {
    const n = SistemaDeArquivos.normaliza(c);
    const prefixo = n ? n + '/' : '';
    const nomes = new Set<string>();
    for (const k of [...this.arquivos.keys(), ...this.pastas]) {
      if (!k || !k.startsWith(prefixo) || k === n) continue;
      nomes.add(k.slice(prefixo.length).split('/')[0]);
    }
    return [...nomes].sort();
  }
}

function precisa(fs: SistemaDeArquivos, c: string, quem: string): Uint8Array {
  const d = fs.le(c);
  if (!d) throw new ErroJatai(`${quem}: arquivo '${c}' nao existe`);
  return d;
}

function file(ctx: Contexto): Record<string, Funcao> {
  const fs = ctx.fs;
  return {
    read: (c) => precisa(fs, String(c), 'file.read'),
    write: (c, conteudo) => fs.grava(String(c), bytes(conteudo)),
    append: (c, conteudo) => {
      const antes = fs.le(String(c)) ?? new Uint8Array();
      const mais = bytes(conteudo);
      const junto = new Uint8Array(antes.length + mais.length);
      junto.set(antes);
      junto.set(mais, antes.length);
      fs.grava(String(c), junto);
    },
    exists: (c) => fs.existe(String(c)),
    is_dir: (c) => fs.ehPasta(String(c)),
    size: (c) => precisa(fs, String(c), 'file.size').length,
    mkdir: (c) => fs.criaPasta(String(c)),
    remove: (c) => fs.apaga(String(c)),
    copy: (de, para) => fs.grava(String(para), precisa(fs, String(de), 'file.copy').slice()),
    rename: (de, para) => {
      const d = precisa(fs, String(de), 'file.rename');
      fs.grava(String(para), d);
      fs.apaga(String(de));
    },
    list_raw: (c) => {
      if (!fs.ehPasta(String(c))) throw new ErroJatai(`file.list: a pasta '${c}' nao existe`);
      return fs.lista(String(c)).join('\n');
    },
  };
}

// -------------------------------------------------------------- io

function io(ctx: Contexto): Record<string, Funcao> {
  return {
    input: (pergunta) => {
      ctx.escreve(1, String(pergunta));
      return ctx.leLinha() ?? '';
    },
    read_line: () => ctx.leLinha() ?? '',
    eof: () => ctx.fimDaEntrada(),
    read_all: () => ctx.leTudo(),
    eprint: (s) => ctx.escreve(2, String(s)),
    eprintln: (s) => ctx.escreve(2, String(s) + '\n'),
    flush: () => {},
  };
}

// -------------------------------------------------------------- time

const inicio = performance.now();

function time(ctx: Contexto): Record<string, Funcao> {
  return {
    now: () => (performance.now() - inicio) / 1000,
    sleep: (s) => ctx.espera(Math.max(0, Number(s))),
  };
}

// -------------------------------------------------------------- voz

// A fala do navegador (speechSynthesis), no lugar das vozes do Windows.
function voz(ctx: Contexto): Record<string, Funcao> {
  const v = ctx.voz;
  return {
    say: (t) => ctx.fala(String(t), true),
    say_async: (t) => ctx.fala(String(t), false),
    speaking: () => false,
    wait: () => {},
    stop: () => ctx.cala(),
    save_wav: () => false,
    voices: () => ctx.vozes.length,
    voice_name: (i) => ctx.vozes[Number(i)] ?? '',
    set_voice: (parte) => {
      const achada = ctx.vozes.find((n) => n.toLowerCase().includes(String(parte).toLowerCase()));
      if (achada) v.nome = achada;
      return !!achada;
    },
    voice: () => v.nome,
    rate: (r) => { v.velocidade = Math.max(-10, Math.min(10, Number(r))); },
    volume: (n) => { v.volume = Math.max(0, Math.min(100, Number(n))); },
  };
}

export function bibliotecas(ctx: Contexto): Bibliotecas {
  return { text, file: file(ctx), io: io(ctx), time: time(ctx), voz: voz(ctx) };
}

/** As bibliotecas que so existem no Jatai instalado. */
export const SO_NO_COMPUTADOR: Record<string, string> = {
  iliv: 'abre uma janela do Windows',
  http: 'abre um servidor web na sua maquina',
  level: 'e uma biblioteca nativa de teste',
};
