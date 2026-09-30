// O terminal do painel de baixo: a saida do programa, os erros em vermelho, e
// uma linha para digitar quando o programa pede entrada.

const LOCAL = /([\w./-]+\.jat):(\d+):(\d+)/g;

export class Terminal {
  private linhaAtual: HTMLElement | null = null;
  private campo: HTMLInputElement | null = null;

  constructor(private el: HTMLElement, private abre: (arquivo: string, linha: number, coluna: number) => void) {
    el.addEventListener('click', () => this.campo?.focus());
  }

  limpa(): void {
    this.el.textContent = '';
    this.linhaAtual = null;
    this.campo = null;
  }

  /** uma linha de comando, como no terminal do VS Code */
  comando(texto: string): void {
    this.fechaLinha();
    const d = document.createElement('div');
    d.className = 't-cmd';
    d.textContent = texto;
    this.el.appendChild(d);
    this.rola();
  }

  aviso(texto: string, tipo: 'ok' | 'erro' | 'info' = 'info'): void {
    this.fechaLinha();
    const d = document.createElement('div');
    d.className = 't-aviso t-' + tipo;
    d.textContent = texto;
    this.el.appendChild(d);
    this.rola();
  }

  escreve(fd: 1 | 2, texto: string): void {
    const partes = texto.split('\n');
    partes.forEach((p, i) => {
      if (i > 0) this.fechaLinha();
      if (!p) return;
      const linha = this.linha();
      const s = document.createElement('span');
      if (fd === 2) s.className = 't-err';
      this.poeComLinks(s, p);
      linha.appendChild(s);
    });
    this.rola();
  }

  private poeComLinks(s: HTMLElement, texto: string): void {
    let ultimo = 0;
    for (const m of texto.matchAll(LOCAL)) {
      s.append(texto.slice(ultimo, m.index));
      const a = document.createElement('a');
      a.textContent = m[0];
      a.href = '#';
      const [arq, l, c] = [m[1].replace(/^\//, ''), +m[2], +m[3]];
      a.addEventListener('click', (e) => { e.preventDefault(); this.abre(arq, l, c); });
      s.append(a);
      ultimo = (m.index ?? 0) + m[0].length;
    }
    s.append(texto.slice(ultimo));
  }

  private linha(): HTMLElement {
    if (!this.linhaAtual) {
      this.linhaAtual = document.createElement('div');
      this.linhaAtual.className = 't-linha';
      this.el.appendChild(this.linhaAtual);
    }
    return this.linhaAtual;
  }

  private fechaLinha(): void { this.linhaAtual = null; }

  /** O programa parou esperando uma linha: o campo aparece onde o cursor estaria. */
  pedeEntrada(responde: (linha: string) => void, fim: () => void): void {
    const linha = this.linha();
    const campo = document.createElement('input');
    campo.className = 't-campo';
    campo.spellcheck = false;
    campo.setAttribute('aria-label', 'Entrada do programa');
    campo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const t = campo.value;
        const eco = document.createElement('span');
        eco.className = 't-eco';
        eco.textContent = t;
        campo.replaceWith(eco);
        this.campo = null;
        this.fechaLinha();
        responde(t);
      } else if ((e.key === 'd' || e.key === 'z') && e.ctrlKey) {
        e.preventDefault();
        campo.remove();
        this.campo = null;
        this.aviso('[fim da entrada]');
        fim();
      }
    });
    linha.appendChild(campo);
    this.campo = campo;
    this.rola();
    campo.focus();
  }

  /** o programa acabou esperando: o campo que sobrou sai */
  cancelaEntrada(): void {
    this.campo?.remove();
    this.campo = null;
  }

  private rola(): void { this.el.scrollTop = this.el.scrollHeight; }
}
