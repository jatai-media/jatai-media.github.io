// O backend do navegador: as mesmas perguntas que a interface fazia ao C++,
// com as mesmas respostas. Cada funcao aqui tem a irma em app.h, com o prefixo
// "jt" - `thumb` e jtThumb, `projetoSalvar` e jtProjetoSalvar, e assim por
// diante. A interface nao sabe quem responde.
//
// O que ainda nao veio do C++ responde com um recado, em vez de fingir:
//
// - separar a voz dependia de um programa a parte (nsound-separate);
// - remover o fundo, o narrador e o reconhecedor de fala dependem de modelos
//   ONNX, que no navegador pedem o ONNX Runtime Web - e o passo seguinte.

import { escolhe, guarda, ligaArrasto, reabre, type Chegado } from './arquivos';
import { exportar, exportCancelar, exportDestino } from './exportar';
import { cesta } from './midia';
import { silences, waveform, esqueceOnda } from './onda';
import { getPrefs, setPref } from './prefs';
import { projetoApagar, projetoLer, projetoNovo, projetoRascunho, projetoSalvar, projetos } from './projetos';
import { esqueceLeitores, frameAt, strip, thumb } from './quadros';
import { motor, play, setEnv, start, transport } from './som';

const AINDA_NAO = 'ainda nao disponivel na versao para navegador';

// Poe na cesta o que acabou de chegar - do dialogo ou do arrasto.
async function entra(chegados: Chegado[]): Promise<number> {
  let n = 0;
  for (const c of chegados) {
    try {
      await cesta.add(await guarda(c), c);
      n++;
    } catch (e) {
      console.warn('importar', c.file.name, e);
    }
  }
  return n;
}

// Trabalho por salvar: o navegador pergunta antes de fechar a aba. A pergunta
// e a generica dele - nenhum navegador deixa a pagina escrever a sua.
let sujo = false;
window.addEventListener('beforeunload', (e) => {
  if (!sujo) return;
  e.preventDefault();
  e.returnValue = '';
});

function fecharAgora() {
  sujo = false;
  // Fechar a aba nao e permitido a pagina; sair e voltar ao comeco.
  location.assign(import.meta.env.BASE_URL);
  return { ok: true };
}

export const backend = {
  // ------------------------------------------------------------ midia
  async import() {
    const chegados = await escolhe();
    if (!chegados.length) return { ok: false, cancelled: true };
    return { ok: true, added: await entra(chegados) };
  },
  async getMedia() { return cesta.toJson(); },
  async removeMedia(id: number) {
    esqueceLeitores(id);
    esqueceOnda(id);
    cesta.remove(id);
    return { ok: true };
  },
  // Reabre pelas chaves que o projeto guardou. Na ordem da pergunta, e zero
  // para o que nao voltou - e assim que a pagina sabe qual clipe ficou orfao.
  async importar(...chaves: string[]) {
    const ids: number[] = [];
    let faltando = 0;
    for (const k of chaves) {
      const c = k ? await reabre(k) : null;
      if (!c) { ids.push(0); faltando++; continue; }
      ids.push(await cesta.add(k, c));
    }
    return { ok: true, ids, faltando };
  },

  // ------------------------------------------------------------ preferencias
  async getPrefs() { return getPrefs(); },
  async setPref(chave: string, valor: string) { return setPref(chave, valor); },

  // ------------------------------------------------------------ imagem
  thumb: (id: number) => thumb(id),
  frameAt: (id: number, sec: number, w: number, h: number, camada: number) => frameAt(id, sec, w, h, camada),
  strip: (id: number, t0: number, t1: number, n: number, alt: number) => strip(id, t0, t1, n, alt),
  waveform: (id: number, t0: number, t1: number, colunas: number) => waveform(id, t0, t1, colunas),

  // ------------------------------------------------------------ som
  async play(de: number, ...plano: number[]) { return play(de, ...plano); },
  start: () => start(),
  async stopAudio() { motor.stop(); return { ok: true }; },
  async setGain(id: number, ganho: number) { motor.setGain(id, ganho); return { ok: true }; },
  async setEnv(id: number, ...plano: number[]) { return setEnv(id, ...plano); },
  async transport() { return transport(); },

  // A pagina montou: e aqui que a janela passa a aceitar arquivos largados.
  async ready() {
    ligaArrasto(
      (on) => window.jtDrag?.(on),
      async (chegados) => {
        const n = await entra(chegados);
        await window.jtImported?.(n);
      });
    return { ok: true, arrastarArquivos: true };
  },

  // ------------------------------------------------------------ cortes
  silences: (id: number, de: number, ate: number, db: number, min: number, folga: number) =>
    silences(id, de, ate, db, min, folga),
  async separate() { return { ok: false, error: 'separar a voz: ' + AINDA_NAO }; },

  // ------------------------------------------------------------ fundo
  async fundoTem() { return { ok: true, modelo: false }; },
  async fundo() { return { ok: false, error: 'remover o fundo: ' + AINDA_NAO }; },
  async fundoCancelar() { return { ok: true }; },

  // ------------------------------------------------------------ narrador
  async voices() { return { ok: true, vozes: [], erro: 'o narrador ' + AINDA_NAO }; },
  async narrate() { return { ok: false, error: 'o narrador ' + AINDA_NAO }; },
  async keepNarration() { return { ok: false, error: 'o narrador ' + AINDA_NAO }; },

  // ------------------------------------------------------------ projetos
  projetos: () => projetos(),
  projetoNovo: (nome: string, json: string) => projetoNovo(nome, json),
  projetoLer: (id: string) => projetoLer(id),
  projetoSalvar: (id: string, json: string, capaMidia: number, capaSeg: number) =>
    projetoSalvar(id, json, capaMidia, capaSeg),
  projetoRascunho: (id: string, json: string) => projetoRascunho(id, json),
  projetoApagar: (id: string) => projetoApagar(id),

  // ------------------------------------------------------------ fechar
  async sujo(v: boolean) { sujo = !!v; return { ok: true }; },
  async fecharAgora() { return fecharAgora(); },
  async desistiuDeFechar() { return { ok: true }; },
  // Sair pelo menu passa pela mesma pergunta que fechar - no C++ era o X da
  // janela; aqui e o proprio Sair.
  async sair() {
    if (sujo && window.jtFechar) await window.jtFechar();
    else fecharAgora();
    return { ok: true };
  },

  // ------------------------------------------------------------ exportar
  exportDestino: (sugestao: string) => exportDestino(sugestao),
  exportar: (...args: unknown[]) => exportar(...args),
  async exportCancelar() { return exportCancelar(); },
};

// Como a interface ve a ponte: cada funcao com a mesma assinatura frouxa que
// o bind do webview tinha - argumentos quaisquer, resposta em JSON. Os tipos
// de verdade ficam do lado de ca.
export type Ponte = { [K in keyof typeof backend]: (...args: any[]) => Promise<any> };
