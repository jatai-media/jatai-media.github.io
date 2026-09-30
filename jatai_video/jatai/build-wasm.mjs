// Compila a VM do Jatai (../jatai_lang/main.c e ../jatai_lang/src/*.h) para WebAssembly: public/jatai.wasm.
//
// Usa o @yowasp/clang, um clang que roda no proprio Node (compilado para WebAssembly),
// entao nao precisa de nenhum compilador instalado. O setjmp/longjmp (usado pelo parser
// para testar "{expr}" em strings) precisa do suporte a excecoes do WebAssembly, que o
// Chrome, o Edge, o Firefox e o Safari ja tem.
//
//   npm run jatai:wasm

import { runClang } from '@yowasp/clang';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const here = import.meta.dirname;
// A linguagem mora ao lado, no mesmo repositorio: jatai_image/jatai_lang. O
// jatai.wasm nao vai para o git - sai sempre do codigo-fonte, aqui e no deploy.
const raiz = resolve(here, '../../jatai_lang');
const saida = resolve(here, '../public/jatai.wasm');

if (!existsSync(join(raiz, 'main.c'))) {
  console.error(`jatai.wasm: a linguagem nao esta em ${raiz}`);
  process.exit(1);
}

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
