// Os projetos - o projeto.h, no navegador. A montagem inteira mora no
// IndexedDB; daqui nao se olha o que ha dentro dela alem do resumo que a tela
// inicial mostra. Quem entende o que e um clipe e a pagina.
//
// O rascunho continua SEPARADO do projeto: a gravacao automatica escreve nele,
// e o projeto so muda quando alguem manda salvar. E isso que deixa
// "descartar" descartar de verdade.

import { limpa } from './arquivos';
import { cesta } from './midia';
import { apaga, grava, le, todos } from './idb';
import { capa } from './quadros';

interface Guardado {
  id: string;
  nome: string;
  json: string;
  mudado: number;          // segundos desde 1970, como no C++
  rascunho: string;
  rascunhoMudado: number;
  capa: string;            // data URL
}

const agora = () => Math.floor(Date.now() / 1000);

// O rascunho so conta quando e mais novo que o projeto. A folga de dois
// segundos e a mesma do C++.
function temRascunho(p: Guardado): boolean {
  return !!p.rascunho && p.rascunhoMudado > p.mudado + 2;
}

// O resumo que a tela inicial le sem interpretar a montagem.
function resumo(json: string): { nome?: string; clipes: number; segundos: number } {
  try {
    const p = JSON.parse(json);
    return { nome: p.projetoNome, clipes: p.projetoClipes | 0, segundos: Number(p.projetoSegundos) || 0 };
  } catch {
    return { clipes: 0, segundos: 0 };
  }
}

export async function projetos() {
  const lista = await todos<Guardado>('projetos');
  lista.sort((a, b) => Math.max(b.mudado, b.rascunhoMudado) - Math.max(a.mudado, a.rascunhoMudado));
  return {
    ok: true,
    projetos: lista.map((p) => {
      const r = resumo(temRascunho(p) ? p.rascunho : p.json);
      return { id: p.id, nome: p.nome, mudado: Math.max(p.mudado, temRascunho(p) ? p.rascunhoMudado : 0),
               clipes: r.clipes, segundos: r.segundos, capa: p.capa, recuperar: temRascunho(p) };
    }),
  };
}

// Um id que ainda nao existe: dois projetos chamados "teste" nao podem virar um
// so - o segundo passaria por cima do primeiro sem avisar.
async function idLivre(nome: string): Promise<string> {
  const base = (nome || 'projeto').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'projeto';
  const ids = new Set((await todos<Guardado>('projetos')).map((p) => p.id));
  if (!ids.has(base)) return base;
  for (let n = 2; n < 1000; n++) if (!ids.has(base + ' ' + n)) return base + ' ' + n;
  return base + ' ' + Date.now();
}

export async function projetoNovo(nome: string, json: string) {
  const id = await idLivre(nome);
  await grava<Guardado>('projetos', {
    id, nome: nome || id, json, mudado: agora(), rascunho: '', rascunhoMudado: 0, capa: '',
  });
  return { ok: true, id };
}

export async function projetoLer(id: string) {
  const p = id ? await le<Guardado>('projetos', id) : undefined;
  if (!p) return { ok: false, error: 'este projeto nao esta mais aqui' };
  return { ok: true, json: p.json, rascunho: temRascunho(p) ? p.rascunho : '' };
}

export async function projetoRascunho(id: string, json: string) {
  const p = id ? await le<Guardado>('projetos', id) : undefined;
  if (!p) return { ok: false };
  p.rascunho = json || '';
  p.rascunhoMudado = json ? agora() : 0;
  await grava('projetos', p);
  return { ok: true };
}

// Grava a montagem e, se pedirem, refaz a capa. Salvou, o rascunho cumpriu o
// papel e some.
export async function projetoSalvar(id: string, json: string, capaMidia: number, capaSeg: number) {
  const p = id ? await le<Guardado>('projetos', id) : undefined;
  if (!p) return { ok: false, error: 'projeto sem nome' };
  p.json = json;
  p.mudado = agora();
  p.rascunho = '';
  p.rascunhoMudado = 0;
  const r = resumo(json);
  if (r.nome) p.nome = r.nome;
  // Falhar a capa nao e falhar a gravacao: fica sem capa, e so.
  if (capaMidia > 0) {
    try { p.capa = (await capa(capaMidia, capaSeg)) || p.capa; } catch { /* sem capa */ }
  }
  await grava('projetos', p);
  return { ok: true };
}

export async function projetoApagar(id: string) {
  if (!id) return { ok: false, error: 'nao foi possivel apagar este projeto' };
  await apaga('projetos', id);
  // Os arquivos que so este projeto usava saem junto - os que estao na cesta
  // aberta ficam, porque ela pode ser de outro trabalho ainda nao salvo.
  const emUso = new Set<string>(cesta.toJson().map((m) => m.path));
  for (const p of await todos<Guardado>('projetos')) {
    for (const texto of [p.json, p.rascunho]) {
      try {
        for (const m of JSON.parse(texto || '{}').midias || []) if (m.caminho) emUso.add(m.caminho);
      } catch { /* projeto ilegivel: nao manda em nada */ }
    }
  }
  await limpa(emUso);
  return { ok: true };
}
