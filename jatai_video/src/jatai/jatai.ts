// jatai.ts - roda scripts Jatai na pagina
//
// A VM do Jatai (C) vem compilada para WebAssembly em public/jatai.wasm (ver
// jatai/build-wasm.mjs). Ela e um programa WASI comum: le o script e as
// bibliotecas de arquivos e escreve na saida padrao. Aqui fica um WASI minimo,
// so com o que ela usa, sobre um sistema de arquivos em memoria.
//
// As funcoes `extern` das bibliotecas sao a ponte com a pagina: onde no Windows
// o Jatai carregaria uma DLL, aqui ele chama `jatai.call`, que procura a funcao
// JavaScript de mesmo modulo e nome (ver src/web.h no repositorio do Jatai).

// JtType (src/ast.h)
const TY_INT = 0, TY_DOUBLE = 1, TY_STRING = 2, TY_CHAR = 3, TY_BOOL = 4, TY_VOID = 5;

// errno do WASI
const OK = 0, EBADF = 8, ENOENT = 44, EACCES = 2, EINVAL = 28;

export type ValorJatai = number | string | boolean;
export type FuncaoJatai = (...args: ValorJatai[]) => ValorJatai | void;
/** modulo -> funcao -> implementacao, ex.: { editor: { add_text(txt, ini, dur) {...} } } */
export type Bibliotecas = Record<string, Record<string, FuncaoJatai>>;

export type Resultado = {
  codigo: number;   // 0 = terminou bem
  saida: string;    // o que o script escreveu (print/println)
  erros: string;    // mensagens de erro do Jatai (stderr)
};

class Fim extends Error {
  constructor(public codigo: number) { super("fim " + codigo); }
}

let modulo: Promise<WebAssembly.Module> | null = null;

function carregaModulo(): Promise<WebAssembly.Module> {
  if (!modulo) {
    const url = import.meta.env.BASE_URL + "jatai.wasm";
    modulo = WebAssembly.compileStreaming(fetch(url)).catch((e) => {
      modulo = null;
      throw e;
    });
  }
  return modulo;
}

type Aberto = { dados: Uint8Array; pos: number };

/**
 * Roda `fonte` como o arquivo /script.jat. `arquivos` sao outros arquivos do
 * sistema de arquivos (ex.: "library/editor/editor.jat"), e `bibliotecas` as
 * implementacoes das funcoes extern.
 */
export async function rodaJatai(fonte: string, arquivos: Record<string, string>,
                                bibliotecas: Bibliotecas): Promise<Resultado> {
  const mod = await carregaModulo();
  const utf8 = new TextEncoder();
  const fs = new Map<string, Uint8Array>();
  fs.set("script.jat", utf8.encode(fonte));
  for (const [nome, texto] of Object.entries(arquivos)) fs.set(nome, utf8.encode(texto));

  const args = ["/jatai", "/script.jat"].map((a) => utf8.encode(a + "\0"));
  const abertos = new Map<number, Aberto>();
  let proximoFd = 4; // 0-2: padrao, 3: a pasta "/"

  const decOut = new TextDecoder(), decErr = new TextDecoder();
  let saida = "", erros = "";

  let mem: WebAssembly.Memory;
  let exports: any;
  const dv = () => new DataView(mem.buffer);
  const bytes = () => new Uint8Array(mem.buffer);
  const cstr = (p: number) => {
    const b = bytes();
    let e = p;
    while (b[e]) e++;
    return new TextDecoder().decode(b.subarray(p, e));
  };

  const wasi = {
    args_sizes_get(argc: number, bufSize: number) {
      dv().setUint32(argc, args.length, true);
      dv().setUint32(bufSize, args.reduce((n, a) => n + a.length, 0), true);
      return OK;
    },
    args_get(argv: number, buf: number) {
      for (const a of args) {
        dv().setUint32(argv, buf, true);
        bytes().set(a, buf);
        argv += 4;
        buf += a.length;
      }
      return OK;
    },
    fd_prestat_get(fd: number, out: number) {
      if (fd !== 3) return EBADF;
      dv().setUint8(out, 0);          // diretorio
      dv().setUint32(out + 4, 1, true); // nome "/"
      return OK;
    },
    fd_prestat_dir_name(fd: number, p: number, len: number) {
      if (fd !== 3 || len < 1) return EBADF;
      bytes()[p] = 47; // "/"
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
    path_open(dirfd: number, _dirflags: number, p: number, len: number, oflags: number,
              _rb: bigint, _ri: bigint, _fdflags: number, fdOut: number) {
      if (dirfd !== 3) return EBADF;
      if (oflags & 1) return EACCES; // criar arquivo: so leitura aqui
      let nome = new TextDecoder().decode(bytes().subarray(p, p + len));
      nome = nome.replace(/^\.?\/+/, "").replace(/\/\.\//g, "/");
      const dados = fs.get(nome);
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
          bytes().set(pedaco, ptr);
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
      let total = 0;
      for (let i = 0; i < n; i++) {
        const ptr = dv().getUint32(iovs + i * 8, true), tam = dv().getUint32(iovs + i * 8 + 4, true);
        const pedaco = bytes().slice(ptr, ptr + tam);
        if (fd === 1) saida += decOut.decode(pedaco, { stream: true });
        else erros += decErr.decode(pedaco, { stream: true });
        total += tam;
      }
      dv().setUint32(escritos, total, true);
      return OK;
    },
    proc_exit(codigo: number) { throw new Fim(codigo); },
  };

  // jatai.call: uma funcao extern chamada pelo script (ver src/web.h)
  const jatai = {
    call(modP: number, fnP: number, argsP: number, tiposP: number, n: number, retTipo: number, retP: number) {
      const m = cstr(modP), f = cstr(fnP);
      const impl = bibliotecas[m]?.[f];
      if (!impl) throw new Error(`a pagina nao implementa ${m}.${f}`);
      const v = dv();
      const valores: ValorJatai[] = [];
      for (let k = 0; k < n; k++) {
        const t = v.getUint8(tiposP + k), a = argsP + k * 8;
        if (t === TY_DOUBLE) valores.push(v.getFloat64(a, true));
        else if (t === TY_STRING) {
          const p = v.getUint32(a, true), tam = v.getUint32(a + 4, true);
          valores.push(new TextDecoder().decode(bytes().subarray(p, p + tam)));
        } else if (t === TY_BOOL) valores.push(v.getInt32(a, true) !== 0);
        else if (t === TY_CHAR) valores.push(String.fromCharCode(v.getInt32(a, true)));
        else valores.push(v.getInt32(a, true));
      }
      const r = impl(...valores);
      // a funcao pode ter feito a memoria crescer: os DataView antigos nao valem mais
      if (retTipo === TY_VOID) return;
      if (retTipo === TY_DOUBLE) dv().setFloat64(retP, Number(r) || 0, true);
      else if (retTipo === TY_STRING) {
        const b = utf8.encode(String(r ?? ""));
        const p = exports.jt_web_str_new(b.length) >>> 0;
        bytes().set(b, p);
        dv().setUint32(retP, p, true);
      } else if (retTipo === TY_CHAR) dv().setInt32(retP, String(r ?? "\0").charCodeAt(0) || 0, true);
      else dv().setInt32(retP, r === true ? 1 : r === false ? 0 : (Number(r) | 0), true);
    },
  };

  const inst = await WebAssembly.instantiate(mod, { wasi_snapshot_preview1: wasi, jatai });
  exports = inst.exports;
  mem = exports.memory;

  let codigo = 0;
  try {
    exports._start();
  } catch (e) {
    if (e instanceof Fim) codigo = e.codigo;
    else {
      codigo = 1;
      erros += (erros && !erros.endsWith("\n") ? "\n" : "") + "jatai: " + (e?.message || e) + "\n";
    }
  }
  saida += decOut.decode();
  erros += decErr.decode();
  return { codigo, saida, erros };
}
