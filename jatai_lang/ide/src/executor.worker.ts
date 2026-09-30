/// <reference lib="webworker" />
// Roda um programa Jatai num worker: a pagina continua respondendo, e Parar e
// so encerrar o worker.
//
// A VM e um programa WASI comum (ver ../src/web.h): le o programa e as
// bibliotecas de arquivos, escreve na saida padrao, e cada funcao `extern` chega
// em `jatai.call`. Aqui fica um WASI minimo - as 13 funcoes que ela importa -
// sobre os arquivos do projeto.

import {
  bibliotecas, ErroJatai, SistemaDeArquivos, SO_NO_COMPUTADOR, type Contexto, type Retorno, type Valor,
} from './bibliotecas';
import {
  CTRL_BYTES, CTRL_ESTADO, CTRL_FALA, CTRL_TAMANHO, ENTRADA_ESPERANDO, ENTRADA_FIM, ENTRADA_PRONTA,
  type MensagemWorker, type PedidoRodar,
} from './protocolo';

declare const self: DedicatedWorkerGlobalScope;
const envia = (m: MensagemWorker) => self.postMessage(m);

// JtType (src/ast.h)
const TY_DOUBLE = 1, TY_STRING = 2, TY_CHAR = 3, TY_BOOL = 4, TY_VOID = 5;
// errno do WASI
const OK = 0, EBADF = 8, ENOENT = 44, EACCES = 2, EINVAL = 28;

class Fim extends Error {
  constructor(public codigo: number) { super('fim ' + codigo); }
}

let modulo: Promise<WebAssembly.Module> | null = null;
function carregaModulo(): Promise<WebAssembly.Module> {
  modulo ??= WebAssembly.compileStreaming(fetch(new URL(import.meta.env.BASE_URL + 'jatai.wasm', self.location.origin)));
  return modulo;
}

// -------------------------------------------------------------- a entrada

// O que o programa le vem de dois lugares: o que ja estava escrito no painel
// Entrada e, com a pagina isolada, o que se digita no terminal enquanto ele roda.
class Entrada {
  private resto: string;
  private acabou: boolean;

  constructor(inicial: string, private ctrl: Int32Array | null, private texto: Uint8Array | null) {
    this.resto = inicial;
    // sem memoria compartilhada nao ha como esperar: o que nao esta escrito e o fim
    this.acabou = !ctrl;
  }

  // pede mais uma linha a pagina e espera; false quando ela disse "fim"
  private pede(): boolean {
    if (this.acabou || !this.ctrl || !this.texto) return false;
    Atomics.store(this.ctrl, CTRL_ESTADO, ENTRADA_ESPERANDO);
    envia({ tipo: 'pede-entrada' });
    Atomics.wait(this.ctrl, CTRL_ESTADO, ENTRADA_ESPERANDO);
    const estado = Atomics.load(this.ctrl, CTRL_ESTADO);
    Atomics.store(this.ctrl, CTRL_ESTADO, 0);
    if (estado === ENTRADA_FIM) { this.acabou = true; return false; }
    const n = Atomics.load(this.ctrl, CTRL_TAMANHO);
    this.resto += new TextDecoder().decode(this.texto.slice(0, n)) + '\n';
    return estado === ENTRADA_PRONTA;
  }

  linha(): string | null {
    while (!this.resto.includes('\n')) {
      if (!this.pede()) break;
    }
    if (!this.resto) return null;
    const i = this.resto.indexOf('\n');
    const l = i < 0 ? this.resto : this.resto.slice(0, i);
    this.resto = i < 0 ? '' : this.resto.slice(i + 1);
    return l.replace(/\r$/, '');
  }

  fim(): boolean {
    if (this.resto) return false;
    return !this.pede() && !this.resto;
  }

  tudo(): string {
    while (this.pede());
    const t = this.resto;
    this.resto = '';
    return t;
  }
}

// -------------------------------------------------------------- rodar

async function roda(p: PedidoRodar): Promise<void> {
  const mod = await carregaModulo();
  const utf8 = new TextEncoder();

  const fs = new SistemaDeArquivos(p.arquivos);
  const ctrl = p.controle ? new Int32Array(p.controle, 0, 4) : null;
  const texto = p.controle ? new Uint8Array(p.controle, CTRL_BYTES) : null;
  const entrada = new Entrada(p.entrada, ctrl, texto);

  const dec = { 1: new TextDecoder(), 2: new TextDecoder() };
  const escreve = (fd: 1 | 2, t: string) => { if (t) envia({ tipo: 'saida', fd, texto: t }); };

  // pausa de verdade com a memoria compartilhada; sem ela, o worker gira
  const relogio = p.controle ? new Int32Array(new SharedArrayBuffer(4)) : null;
  const espera = (s: number) => {
    if (relogio) Atomics.wait(relogio, 0, 0, s * 1000);
    else { const ate = performance.now() + s * 1000; while (performance.now() < ate); }
  };

  const vozAtual = { nome: p.vozes[0] ?? '', velocidade: 0, volume: 100 };
  const ctx: Contexto = {
    escreve,
    leLinha: () => entrada.linha(),
    fimDaEntrada: () => entrada.fim(),
    leTudo: () => entrada.tudo(),
    espera,
    fs,
    vozes: p.vozes,
    voz: vozAtual,
    fala: (t, esperar) => {
      const aguarda = esperar && !!ctrl;
      if (aguarda) Atomics.store(ctrl!, CTRL_FALA, 1);
      envia({ tipo: 'fala', texto: t, voz: vozAtual.nome, velocidade: vozAtual.velocidade,
              volume: vozAtual.volume, esperar: aguarda });
      if (aguarda) Atomics.wait(ctrl!, CTRL_FALA, 1);
    },
    cala: () => envia({ tipo: 'cala' }),
  };
  const libs = bibliotecas(ctx);

  // Os arquivos que a VM abre: os do projeto (que o programa pode ter mudado) e
  // a biblioteca padrao, que ja veio junto em `arquivos`.
  const args = ['/jatai', '/' + p.principal, ...(p.verificar ? ['-check'] : [])]
    .map((a) => utf8.encode(a + '\0'));
  const abertos = new Map<number, { dados: Uint8Array; pos: number }>();
  let proximoFd = 4; // 0-2: padrao, 3: a pasta "/"

  let mem!: WebAssembly.Memory;
  let exp!: { _start: () => void; jt_web_str_new: (n: number) => number; memory: WebAssembly.Memory };
  const dv = () => new DataView(mem.buffer);
  const byt = () => new Uint8Array(mem.buffer);
  const cstr = (ptr: number) => {
    const b = byt();
    let e = ptr;
    while (b[e]) e++;
    return new TextDecoder().decode(b.subarray(ptr, e));
  };

  const wasi = {
    args_sizes_get(argc: number, tam: number) {
      dv().setUint32(argc, args.length, true);
      dv().setUint32(tam, args.reduce((n, a) => n + a.length, 0), true);
      return OK;
    },
    args_get(argv: number, buf: number) {
      for (const a of args) {
        dv().setUint32(argv, buf, true);
        byt().set(a, buf);
        argv += 4;
        buf += a.length;
      }
      return OK;
    },
    fd_prestat_get(fd: number, out: number) {
      if (fd !== 3) return EBADF;
      dv().setUint8(out, 0);
      dv().setUint32(out + 4, 1, true);
      return OK;
    },
    fd_prestat_dir_name(fd: number, ptr: number, len: number) {
      if (fd !== 3 || len < 1) return EBADF;
      byt()[ptr] = 47; // "/"
      return OK;
    },
    fd_fdstat_get(fd: number, out: number) {
      const tipo = fd <= 2 ? 2 : fd === 3 ? 3 : abertos.has(fd) ? 4 : -1;
      if (tipo < 0) return EBADF;
      const v = dv();
      v.setUint8(out, tipo);
      v.setUint16(out + 2, 0, true);
      v.setBigUint64(out + 8, 0xffffffffffffffffn, true);
      v.setBigUint64(out + 16, 0xffffffffffffffffn, true);
      return OK;
    },
    fd_fdstat_set_flags() { return OK; },
    path_open(dirfd: number, _df: number, ptr: number, len: number, oflags: number,
              _rb: bigint, _ri: bigint, _ff: number, fdOut: number) {
      if (dirfd !== 3) return EBADF;
      if (oflags & 1) return EACCES; // a VM so le; quem escreve e a biblioteca file
      const nome = new TextDecoder().decode(byt().subarray(ptr, ptr + len));
      const dados = fs.le(nome);
      if (!dados) return ENOENT;
      const fd = proximoFd++;
      abertos.set(fd, { dados, pos: 0 });
      dv().setUint32(fdOut, fd, true);
      return OK;
    },
    fd_close(fd: number) { return abertos.delete(fd) || fd <= 3 ? OK : EBADF; },
    fd_seek(fd: number, offset: bigint, whence: number, out: number) {
      const f = abertos.get(fd);
      if (!f) return fd <= 2 ? OK : EBADF;
      const base = whence === 0 ? 0 : whence === 1 ? f.pos : whence === 2 ? f.dados.length : -1;
      if (base < 0) return EINVAL;
      f.pos = Math.max(0, base + Number(offset));
      dv().setBigUint64(out, BigInt(f.pos), true);
      return OK;
    },
    fd_read(fd: number, iovs: number, n: number, lidos: number) {
      const f = abertos.get(fd);
      let total = 0;
      if (f) {
        for (let i = 0; i < n; i++) {
          const ptr = dv().getUint32(iovs + i * 8, true), tam = dv().getUint32(iovs + i * 8 + 4, true);
          const pedaco = f.dados.subarray(f.pos, f.pos + tam);
          byt().set(pedaco, ptr);
          f.pos += pedaco.length;
          total += pedaco.length;
          if (pedaco.length < tam) break;
        }
      } else if (fd !== 0) return EBADF;
      dv().setUint32(lidos, total, true);
      return OK;
    },
    fd_write(fd: number, iovs: number, n: number, escritos: number) {
      if (fd !== 1 && fd !== 2) return EBADF;
      let total = 0, t = '';
      for (let i = 0; i < n; i++) {
        const ptr = dv().getUint32(iovs + i * 8, true), tam = dv().getUint32(iovs + i * 8 + 4, true);
        t += dec[fd].decode(byt().slice(ptr, ptr + tam), { stream: true });
        total += tam;
      }
      escreve(fd, t);
      dv().setUint32(escritos, total, true);
      return OK;
    },
    proc_exit(codigo: number) { throw new Fim(codigo); },
  };

  // jatai.call: uma funcao extern chamada pelo programa (ver src/web.h)
  const jatai = {
    call(modP: number, fnP: number, argsP: number, tiposP: number, n: number, retTipo: number, retP: number) {
      const m = cstr(modP), f = cstr(fnP);
      const impl = libs[m]?.[f];
      if (!impl) {
        if (SO_NO_COMPUTADOR[m])
          throw new ErroJatai(`a biblioteca '${m}' ${SO_NO_COMPUTADOR[m]}: ela so funciona no Jatai ` +
                              `instalado (botao Baixar, no alto da tela)`);
        throw new ErroJatai(`'${m}.${f}' ainda nao existe na web`);
      }
      const v = dv();
      const valores: Valor[] = [];
      for (let k = 0; k < n; k++) {
        const t = v.getUint8(tiposP + k), a = argsP + k * 8;
        if (t === TY_DOUBLE) valores.push(v.getFloat64(a, true));
        else if (t === TY_STRING) {
          const ptr = v.getUint32(a, true), tam = v.getUint32(a + 4, true);
          valores.push(new TextDecoder().decode(byt().subarray(ptr, ptr + tam)));
        } else if (t === TY_BOOL) valores.push(v.getInt32(a, true) !== 0);
        else if (t === TY_CHAR) valores.push(String.fromCharCode(v.getInt32(a, true)));
        else valores.push(v.getInt32(a, true));
      }
      const r: Retorno = impl(...valores);
      // a funcao pode ter feito a memoria crescer: os DataView antigos nao valem mais
      if (retTipo === TY_VOID) return;
      if (retTipo === TY_DOUBLE) dv().setFloat64(retP, Number(r) || 0, true);
      else if (retTipo === TY_STRING) {
        const b = r instanceof Uint8Array ? r : utf8.encode(String(r ?? ''));
        const ptr = exp.jt_web_str_new(b.length) >>> 0;
        byt().set(b, ptr);
        dv().setUint32(retP, ptr, true);
      } else if (retTipo === TY_CHAR) dv().setInt32(retP, String(r ?? '\0').charCodeAt(0) || 0, true);
      else dv().setInt32(retP, r === true ? 1 : r === false ? 0 : (Number(r) | 0), true);
    },
  };

  const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi, jatai });
  exp = inst.exports as unknown as typeof exp;
  mem = exp.memory;

  let codigo = 0;
  try {
    exp._start();
  } catch (e) {
    if (e instanceof Fim) codigo = e.codigo;
    else {
      codigo = 1;
      const msg = e instanceof ErroJatai ? e.message
        : e instanceof RangeError ? 'a pilha estourou (recursao sem fim?)'
        : (e as Error)?.message || String(e);
      escreve(2, 'jatai: ' + msg + '\n');
    }
  }
  escreve(1, dec[1].decode());
  escreve(2, dec[2].decode());

  const alterados: Record<string, string | null> = {};
  for (const [c, d] of fs.alterados) alterados[c] = d ? new TextDecoder().decode(d) : null;
  envia({ tipo: 'fim', codigo, alterados });
}

self.onmessage = (ev: MessageEvent<PedidoRodar>) => {
  roda(ev.data).catch((e) => {
    envia({ tipo: 'saida', fd: 2, texto: 'jatai: ' + ((e as Error)?.message || e) + '\n' });
    envia({ tipo: 'fim', codigo: 1, alterados: {} });
  });
};
