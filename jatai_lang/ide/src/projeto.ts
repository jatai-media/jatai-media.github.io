// O projeto de quem usa a plataforma: arquivos e pastas, guardados no
// navegador. E o equivalente a pasta do programa no computador - inclusive a
// `library/` dele, que o `import` procura antes da biblioteca padrao.

const CHAVE = 'jatai.ide.projeto';

export const BOAS_VINDAS = `# Bem-vindo ao Jatai!
# Aperte Ctrl+Enter (ou o botão Rodar) para rodar este programa.

import text

string nome = "mundo"
println("Olá, {nome}!")

# funções têm tipo de retorno e de parâmetros
int quadrado(int x)
    return x * x

for i in range(1, 6)
    println("{i} ao quadrado = {quadrado(i)}")

println(text.upper("pronto."))
`;

type Guardado = { arquivos: Record<string, string>; pastas: string[] };

export class Projeto {
  private arquivos = new Map<string, string>();
  private pastasVazias = new Set<string>();
  private ouvintes: Array<() => void> = [];

  constructor() {
    let g: Guardado | null = null;
    try { g = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch { g = null; }
    if (g && g.arquivos && Object.keys(g.arquivos).length) {
      for (const [c, t] of Object.entries(g.arquivos)) this.arquivos.set(c, t);
      for (const p of g.pastas || []) this.pastasVazias.add(p);
    } else {
      this.arquivos.set('main.jat', BOAS_VINDAS);
    }
  }

  aoMudar(f: () => void): void { this.ouvintes.push(f); }

  private salva(): void {
    const g: Guardado = { arquivos: Object.fromEntries(this.arquivos), pastas: [...this.pastasVazias] };
    try { localStorage.setItem(CHAVE, JSON.stringify(g)); } catch { /* cheio ou bloqueado: fica na memoria */ }
    for (const f of this.ouvintes) f();
  }

  static normaliza(caminho: string): string {
    return caminho.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.').join('/');
  }

  arquivosTodos(): Record<string, string> { return Object.fromEntries(this.arquivos); }
  caminhos(): string[] { return [...this.arquivos.keys()].sort(); }
  tem(c: string): boolean { return this.arquivos.has(c); }
  le(c: string): string | undefined { return this.arquivos.get(c); }

  // As pastas: as que tem arquivo dentro, e as criadas vazias.
  pastas(): string[] {
    const s = new Set(this.pastasVazias);
    for (const c of this.arquivos.keys()) {
      const partes = c.split('/');
      for (let i = 1; i < partes.length; i++) s.add(partes.slice(0, i).join('/'));
    }
    return [...s].sort();
  }

  /** grava sem avisar a lista (digitar no editor nao redesenha o explorador) */
  grava(c: string, texto: string, avisa = false): void {
    const novo = !this.arquivos.has(c);
    this.arquivos.set(c, texto);
    if (novo || avisa) this.salva();
    else this.salvaCalado();
  }

  private timer = 0;
  private salvaCalado(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      try {
        localStorage.setItem(CHAVE, JSON.stringify({ arquivos: Object.fromEntries(this.arquivos), pastas: [...this.pastasVazias] }));
      } catch { /* sem espaco */ }
    }, 300);
  }

  criaPasta(c: string): void { this.pastasVazias.add(c); this.salva(); }

  apaga(c: string): void {
    if (this.arquivos.delete(c)) { this.salva(); return; }
    // pasta: tudo o que esta dentro
    for (const k of [...this.arquivos.keys()]) if (k.startsWith(c + '/')) this.arquivos.delete(k);
    for (const p of [...this.pastasVazias]) if (p === c || p.startsWith(c + '/')) this.pastasVazias.delete(p);
    this.salva();
  }

  renomeia(de: string, para: string): void {
    if (this.arquivos.has(de)) {
      const t = this.arquivos.get(de)!;
      this.arquivos.delete(de);
      this.arquivos.set(para, t);
    } else {
      for (const [k, t] of [...this.arquivos]) {
        if (!k.startsWith(de + '/')) continue;
        this.arquivos.delete(k);
        this.arquivos.set(para + k.slice(de.length), t);
      }
      for (const p of [...this.pastasVazias]) {
        if (p === de || p.startsWith(de + '/')) { this.pastasVazias.delete(p); this.pastasVazias.add(para + p.slice(de.length)); }
      }
    }
    this.salva();
  }

  /** o que o programa gravou com a biblioteca file */
  aplica(alterados: Record<string, string | null>): string[] {
    const mudou: string[] = [];
    for (const [c, t] of Object.entries(alterados)) {
      if (t === null) { if (this.arquivos.delete(c)) mudou.push(c); }
      else if (this.arquivos.get(c) !== t) { this.arquivos.set(c, t); mudou.push(c); }
    }
    if (mudou.length) this.salva();
    return mudou;
  }
}
