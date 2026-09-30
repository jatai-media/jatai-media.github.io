// Compila a VM do Jatai (../../main.c e ../../src/*.h) para WebAssembly:
// public/jatai.wasm, que a plataforma roda no navegador.
//
// Usa o @yowasp/clang, um clang que roda no proprio Node (compilado para
// WebAssembly): nao precisa de compilador instalado, nem aqui nem no deploy do
// GitHub Pages. O setjmp/longjmp do parser pede o suporte a excecoes do
// WebAssembly, que os navegadores atuais tem.
//
//   npm run wasm

import { runClang } from '@yowasp/clang';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const raiz = resolve(import.meta.dirname, '../..'); // jatai_lang/
const saida = resolve(import.meta.dirname, '../public/jatai.wasm');

const src = {};
for (const nome of readdirSync(join(raiz, 'src')))
  if (nome.endsWith('.h')) src[nome] = readFileSync(join(raiz, 'src', nome), 'utf8');
const arquivos = { 'main.c': readFileSync(join(raiz, 'main.c'), 'utf8'), src };

const inicio = Date.now();
let out;
try {
  out = await runClang([
    'clang', '--target=wasm32-wasip1', '-std=c11', '-O2', '-Wall', '-Wextra', '-Wno-unused-function',
    '-mllvm', '-wasm-enable-sjlj', '-lsetjmp',
    '-Wl,-z,stack-size=1048576',
    'main.c', '-o', 'jatai.wasm',
  ], arquivos, { fetchProgress: () => {} });
} catch (e) {
  if (e?.code === undefined) throw e;
  console.error('jatai.wasm: o clang falhou (erros acima)');
  process.exit(1);
}

mkdirSync(dirname(saida), { recursive: true });
writeFileSync(saida, out['jatai.wasm']);
console.log(`jatai.wasm: ${(out['jatai.wasm'].length / 1024).toFixed(0)} KB em ${Date.now() - inicio} ms`);
