// O que a plataforma traz da propria linguagem, embutido no build: a biblioteca
// padrao (os .jat, de que a VM precisa para o `import`) e os exemplos.

import { SO_NO_COMPUTADOR } from './bibliotecas';

const libs = import.meta.glob('../../library/*/*.jat', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;
const exemplos = import.meta.glob('../../exemplos/*.jat', { query: '?raw', import: 'default', eager: true }) as
  Record<string, string>;

/** "library/text/text.jat" -> texto, do jeito que a VM procura */
export const bibliotecaPadrao: Record<string, string> = {};
for (const [caminho, texto] of Object.entries(libs)) {
  bibliotecaPadrao[caminho.replace(/^.*\/library\//, 'library/')] = texto;
}

export type Exemplo = { nome: string; texto: string; soNoComputador: string | null };

// Em ordem de numero: 1_print, 2_variaveis... 10_time
export const listaDeExemplos: Exemplo[] = Object.entries(exemplos)
  .map(([caminho, texto]) => {
    const nome = caminho.replace(/^.*\//, '');
    const precisa = [...texto.matchAll(/^import\s+(\w+)/gm)].map((m) => m[1]).find((l) => SO_NO_COMPUTADOR[l]);
    return { nome, texto, soNoComputador: precisa ?? null };
  })
  .sort((a, b) => parseInt(a.nome) - parseInt(b.nome) || a.nome.localeCompare(b.nome));

// ------------------------------------------------------------ documentacao

export type FuncaoDoc = {
  biblioteca: string;
  nome: string;
  assinatura: string;   // "string upper(string s)"
  retorno: string;
  parametros: string[]; // ["string s"]
  doc: string;          // os comentarios logo acima
};

// Le as declaracoes de cada biblioteca: `extern tipo nome(...)` e as funcoes
// escritas em Jatai no nivel principal. O comentario que vem logo antes e a doc.
export function documentacao(): FuncaoDoc[] {
  const out: FuncaoDoc[] = [];
  for (const [caminho, texto] of Object.entries(bibliotecaPadrao)) {
    const biblioteca = caminho.split('/')[1];
    let doc: string[] = [];
    for (const linha of texto.split(/\r?\n/)) {
      if (/^#/.test(linha)) {
        const t = linha.replace(/^#\s?/, '');
        if (!/^(biblioteca |uso:)/.test(t)) doc.push(t);
        continue;
      }
      const m = /^(?:extern\s+)?([A-Za-z_]\w*(?:\[\])?)\s+([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(linha);
      if (m && !m[2].endsWith('_raw')) {
        out.push({
          biblioteca, nome: m[2], retorno: m[1],
          assinatura: `${m[1]} ${m[2]}(${m[3]})`,
          parametros: m[3].split(',').map((p) => p.trim()).filter(Boolean),
          doc: doc.join('\n').trim(),
        });
      }
      if (!/^\s/.test(linha)) doc = [];
    }
  }
  return out;
}
