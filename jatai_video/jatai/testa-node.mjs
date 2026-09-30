// Roda um arquivo .jat no jatai.wasm pelo Node, fora do navegador, para
// conferir a VM web contra o jatai.exe. O caminho e relativo a pasta jatai_lang/.
//
//   node --no-warnings jatai/testa-node.mjs exemplos/9_sieve.jat
//   node --no-warnings jatai/testa-node.mjs --simula jatai_video/zoom_gato.jat
//
// Usa o mesmo WASI minimo da pagina (src/jatai/jatai.ts), lendo os arquivos do
// disco (o WASI do proprio Node nao abre arquivos no Windows). Termina com o
// codigo de saida do script.
//
// Funcoes extern so existem na pagina: sem opcao, um script que as chame para
// com erro. Com --simula, cada chamada extern e mostrada na saida de erro e
// devolve um valor neutro (0, "", false; exists devolve true), para conferir
// um script do editor (import editor / time) fora do navegador.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '../../jatai_lang');
const simula = process.argv.includes('--simula');
const script = (process.argv.slice(2).find((a) => a !== '--simula') ?? '').replace(/^\/+/, '');
if (!script) {
    console.error('uso: node --no-warnings jatai/testa-node.mjs [--simula] exemplos/9_sieve.jat');
    process.exit(2);
}

const OK = 0, EBADF = 8, ENOENT = 44, EACCES = 2, EINVAL = 28;
const utf8 = new TextEncoder();
const args = ['/jatai', '/' + script].map((a) => utf8.encode(a + '\0'));
const abertos = new Map();
let proximoFd = 4; // 0-2: padrao, 3: a pasta "/" (jatai_lang/)
let mem, exports;
const dv = () => new DataView(mem.buffer);
const bytes = () => new Uint8Array(mem.buffer);

class Fim extends Error {
    constructor(codigo) { super('fim ' + codigo); this.codigo = codigo; }
}

const wasi = {
    args_sizes_get(argc, bufSize) {
        dv().setUint32(argc, args.length, true);
        dv().setUint32(bufSize, args.reduce((n, a) => n + a.length, 0), true);
        return OK;
    },
    args_get(argv, buf) {
        for (const a of args) {
            dv().setUint32(argv, buf, true);
            bytes().set(a, buf);
            argv += 4;
            buf += a.length;
        }
        return OK;
    },
    fd_prestat_get(fd, out) {
        if (fd !== 3) return EBADF;
        dv().setUint8(out, 0);
        dv().setUint32(out + 4, 1, true);
        return OK;
    },
    fd_prestat_dir_name(fd, p, len) {
        if (fd !== 3 || len < 1) return EBADF;
        bytes()[p] = 47; // "/"
        return OK;
    },
    fd_fdstat_get(fd, out) {
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
    path_open(dirfd, _dirflags, p, len, oflags, _rb, _ri, _fdflags, fdOut) {
        if (dirfd !== 3) return EBADF;
        if (oflags & 1) return EACCES; // criar arquivo: so leitura, como na pagina
        let nome = new TextDecoder().decode(bytes().subarray(p, p + len));
        nome = nome.replace(/^\.?\/+/, '').replace(/\/\.\//g, '/');
        // como na pagina: com --simula, library/editor e library/time sao as versoes web
        const web = resolve(import.meta.dirname, nome);
        const caminho = simula && nome.startsWith('library/') && existsSync(web) ? web : resolve(raiz, nome);
        if (!existsSync(caminho) || !statSync(caminho).isFile()) return ENOENT;
        const fd = proximoFd++;
        abertos.set(fd, { dados: readFileSync(caminho), pos: 0 });
        dv().setUint32(fdOut, fd, true);
        return OK;
    },
    fd_close(fd) { return abertos.delete(fd) || fd <= 3 ? OK : EBADF; },
    fd_seek(fd, offset, whence, out) {
        const f = abertos.get(fd);
        if (!f) return fd <= 2 ? OK : EBADF;
        const base = whence === 0 ? 0 : whence === 1 ? f.pos : whence === 2 ? f.dados.length : -1;
        if (base < 0) return EINVAL;
        f.pos = Math.max(0, base + Number(offset));
        dv().setBigUint64(out, BigInt(f.pos), true);
        return OK;
    },
    fd_read(fd, iovs, n, lidos) {
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
    fd_write(fd, iovs, n, escritos) {
        if (fd !== 1 && fd !== 2) return EBADF;
        let total = 0;
        for (let i = 0; i < n; i++) {
            const ptr = dv().getUint32(iovs + i * 8, true), tam = dv().getUint32(iovs + i * 8 + 4, true);
            (fd === 1 ? process.stdout : process.stderr).write(bytes().slice(ptr, ptr + tam));
            total += tam;
        }
        dv().setUint32(escritos, total, true);
        return OK;
    },
    proc_exit(codigo) { throw new Fim(codigo); },
};

// JtType (src/ast.h) e o formato de jatai.call (src/web.h)
const TY_DOUBLE = 1, TY_STRING = 2, TY_CHAR = 3, TY_BOOL = 4, TY_VOID = 5;
const cstr = (p) => {
    const b = bytes();
    let e = p;
    while (b[e]) e++;
    return new TextDecoder().decode(b.subarray(p, e));
};
const jatai = {
    call(modP, fnP, argsP, tiposP, n, retTipo, retP) {
        const nome = cstr(modP) + '.' + cstr(fnP);
        if (!simula) throw new Error(`funcoes extern so existem na pagina (${nome}); use --simula`);
        const v = dv(), vals = [];
        for (let k = 0; k < n; k++) {
            const t = v.getUint8(tiposP + k), a = argsP + k * 8;
            if (t === TY_DOUBLE) vals.push(v.getFloat64(a, true));
            else if (t === TY_STRING) {
                const p = v.getUint32(a, true), tam = v.getUint32(a + 4, true);
                vals.push(JSON.stringify(new TextDecoder().decode(bytes().subarray(p, p + tam))));
            } else if (t === TY_BOOL) vals.push(v.getInt32(a, true) !== 0);
            else if (t === TY_CHAR) vals.push(`'${String.fromCharCode(v.getInt32(a, true))}'`);
            else vals.push(v.getInt32(a, true));
        }
        process.stderr.write(`  [${nome}(${vals.join(', ')})]
`);
        if (retTipo === TY_VOID) return;
        if (retTipo === TY_DOUBLE) dv().setFloat64(retP, 0, true);
        else if (retTipo === TY_STRING) dv().setUint32(retP, exports.jt_web_str_new(0) >>> 0, true);
        else dv().setInt32(retP, nome.endsWith('.exists') ? 1 : 0, true);
    },
};

const wasm = await WebAssembly.compile(readFileSync(resolve(import.meta.dirname, '../public/jatai.wasm')));
const inst = await WebAssembly.instantiate(wasm, { wasi_snapshot_preview1: wasi, jatai });
exports = inst.exports;
mem = exports.memory;
try {
    exports._start();
    process.exitCode = 0;
} catch (e) {
    if (e instanceof Fim) process.exitCode = e.codigo;
    else {
        console.error('jatai: ' + (e?.message || e));
        process.exitCode = 1;
    }
}
