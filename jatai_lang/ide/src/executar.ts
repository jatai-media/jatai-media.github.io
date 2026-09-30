// A pagina do lado de ca do worker: rodar, parar, responder a entrada e a fala,
// e verificar o codigo enquanto se digita.

import ExecutorWorker from './executor.worker.ts?worker';
import { bibliotecaPadrao } from './fontes';
import {
  CTRL_BYTES, CTRL_ESTADO, CTRL_FALA, CTRL_TAMANHO, ENTRADA_FIM, ENTRADA_PRONTA, LINHA_MAX,
  type Arquivos, type MensagemWorker, type PedidoRodar,
} from './protocolo';

export type Ouvintes = {
  saida: (fd: 1 | 2, texto: string) => void;
  pedeEntrada: () => void;
  fim: (codigo: number, alterados: Record<string, string | null>, ms: number) => void;
};

/** A entrada interativa so existe com a pagina isolada (SharedArrayBuffer). */
export const interativo = typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated === true;

function vozesDoNavegador(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
}
// a lista chega depois do carregamento em alguns navegadores
if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();

export class Execucao {
  private worker: Worker;
  private controle: SharedArrayBuffer | null;
  private ctrl: Int32Array | null;
  private inicio = performance.now();
  terminou = false;

  constructor(arquivos: Arquivos, principal: string, entrada: string, private ouvir: Ouvintes) {
    this.controle = interativo ? new SharedArrayBuffer(CTRL_BYTES + LINHA_MAX) : null;
    this.ctrl = this.controle ? new Int32Array(this.controle, 0, 4) : null;
    this.worker = new ExecutorWorker();
    this.worker.onmessage = (ev: MessageEvent<MensagemWorker>) => this.recebe(ev.data);
    this.worker.onerror = (ev) => {
      this.ouvir.saida(2, 'jatai: ' + (ev.message || 'o executor falhou') + '\n');
      this.encerra(1, {});
    };
    const pedido: PedidoRodar = {
      tipo: 'rodar', arquivos: { ...bibliotecaPadrao, ...arquivos }, principal, verificar: false,
      entrada, controle: this.controle, vozes: vozesDoNavegador().map((v) => v.name),
    };
    this.worker.postMessage(pedido);
  }

  private recebe(m: MensagemWorker): void {
    if (m.tipo === 'saida') this.ouvir.saida(m.fd, m.texto);
    else if (m.tipo === 'pede-entrada') this.ouvir.pedeEntrada();
    else if (m.tipo === 'fala') this.fala(m.texto, m.voz, m.velocidade, m.volume, m.esperar);
    else if (m.tipo === 'cala') speechSynthesis?.cancel();
    else if (m.tipo === 'fim') this.encerra(m.codigo, m.alterados);
  }

  private fala(texto: string, voz: string, velocidade: number, volume: number, esperar: boolean): void {
    const acaba = () => {
      if (esperar && this.ctrl) { Atomics.store(this.ctrl, CTRL_FALA, 0); Atomics.notify(this.ctrl, CTRL_FALA); }
    };
    if (typeof speechSynthesis === 'undefined') { acaba(); return; }
    const u = new SpeechSynthesisUtterance(texto);
    const v = vozesDoNavegador().find((x) => x.name === voz);
    if (v) u.voice = v; else u.lang = 'pt-BR';
    u.rate = Math.pow(2, velocidade / 10);    // -10..10 do SAPI -> 0.5x..2x
    u.volume = volume / 100;
    u.onend = acaba;
    u.onerror = acaba;
    speechSynthesis.speak(u);
  }

  /** uma linha digitada no terminal */
  responde(linha: string): void {
    if (!this.ctrl || !this.controle) return;
    const b = new TextEncoder().encode(linha).slice(0, LINHA_MAX);
    new Uint8Array(this.controle, CTRL_BYTES).set(b);
    Atomics.store(this.ctrl, CTRL_TAMANHO, b.length);
    Atomics.store(this.ctrl, CTRL_ESTADO, ENTRADA_PRONTA);
    Atomics.notify(this.ctrl, CTRL_ESTADO);
  }

  /** Ctrl+D: nao ha mais entrada */
  fimDaEntrada(): void {
    if (!this.ctrl) return;
    Atomics.store(this.ctrl, CTRL_ESTADO, ENTRADA_FIM);
    Atomics.notify(this.ctrl, CTRL_ESTADO);
  }

  para(): void {
    if (this.terminou) return;
    this.ouvir.saida(2, '\n[parado]\n');
    this.encerra(130, {});
  }

  private encerra(codigo: number, alterados: Record<string, string | null>): void {
    if (this.terminou) return;
    this.terminou = true;
    this.worker.terminate();
    speechSynthesis?.cancel();
    this.ouvir.fim(codigo, alterados, performance.now() - this.inicio);
  }
}

// ------------------------------------------------------------ verificar

export type Problema = { arquivo: string; linha: number; coluna: number; mensagem: string; nota: boolean };

// "/main.jat:3:9: erro: esperado int, recebeu string"
export function problemasDe(texto: string): Problema[] {
  const out: Problema[] = [];
  for (const l of texto.split('\n')) {
    const m = /^\/?(.+?):(\d+):(\d+): (erro|nota): (.*)$/.exec(l.trim());
    if (m) out.push({ arquivo: m[1], linha: +m[2], coluna: +m[3], mensagem: m[5], nota: m[4] === 'nota' });
  }
  return out;
}

// Um worker so para verificar, sempre vivo: roda `jatai -check` a cada pausa na
// digitacao. So o pedido mais novo interessa.
let verificador: Worker | null = null;
let ocupado = false;
let proximo: { arquivos: Arquivos; principal: string; responde: (p: Problema[], texto: string) => void } | null = null;

export function verifica(arquivos: Arquivos, principal: string, responde: (p: Problema[], texto: string) => void): void {
  proximo = { arquivos, principal, responde };
  if (!ocupado) void anda();
}

async function anda(): Promise<void> {
  if (!proximo) return;
  const agora = proximo;
  proximo = null;
  ocupado = true;
  verificador ??= new ExecutorWorker();
  let erros = '';
  await new Promise<void>((pronto) => {
    // um programa com erro de sintaxe nao demora; um laco infinito no nivel de cima nao roda (-check nao executa)
    const tempo = setTimeout(() => { verificador?.terminate(); verificador = null; pronto(); }, 4000);
    verificador!.onmessage = (ev: MessageEvent<MensagemWorker>) => {
      const m = ev.data;
      if (m.tipo === 'saida' && m.fd === 2) erros += m.texto;
      if (m.tipo === 'fim') { clearTimeout(tempo); pronto(); }
    };
    const pedido: PedidoRodar = {
      tipo: 'rodar', arquivos: { ...bibliotecaPadrao, ...agora.arquivos }, principal: agora.principal,
      verificar: true, entrada: '', controle: null, vozes: [],
    };
    verificador!.postMessage(pedido);
  });
  ocupado = false;
  agora.responde(problemasDe(erros), erros);
  if (proximo) void anda();
}
