// scripts.ts - os scripts Jatai guardados no navegador
//
// Ficam no localStorage, que e o mesmo para todas as guias da pagina: a guia do
// editor de scripts grava, e a guia do editor de video enxerga a mesma lista
// (o menu Script dela oferece rodar cada um). O evento "storage" avisa a outra
// guia quando a lista muda.

export type Script = {
  id: string;
  nome: string;
  texto: string;
  modificado: number; // Date.now() da ultima alteracao
};

const CHAVE = "jatai.scripts.v1";
const CHAVE_ATUAL = "jatai.scripts.atual";
// o painel Script antigo guardava um texto so, nesta chave
const CHAVE_ANTIGA = "jatai.script.v4";

export const EXEMPLO = `import editor
import time

#O script so anima o que voce colocou na linha do tempo.
#De ids pelo botao direito no clipe, na linha do tempo: na foto o id gato;
#se quiser, na musica o id trilha e num texto o id titulo.

#funcoes com fn: nao precisa escrever tipos, eles vem de quem chama

#gira aos poucos: um passo a cada decimo de segundo
#(zoom, posicao e giro sao inteiros, como no painel Imagem)
fn girar(id, graus, segundos)
    inicio = editor.rotation(id)
    passos = int(segundos * 10.0)
    for i in range(passos)
        time.sleep(0.1)
        editor.rotate(id, inicio + graus * (i + 1) / passos)

#o som entra subindo o volume, a partir do comeco do clipe
fn fade_in(id, segundos)
    time.at(editor.start_of(id))
    editor.volume(id, -60.0)
    time.sleep(segundos)
    editor.volume(id, 0.0)

if not editor.exists("gato")
    println("coloque uma foto na linha do tempo e de a ela o id gato")
    println("(botao direito no clipe da foto, na linha do tempo > Atribuir id)")
else
    #comeca junto com a foto e gira 30 graus em 3 segundos
    time.at(editor.start_of("gato"))
    girar("gato", 30, 3.0)

    #depois desgira crescendo, com movimento suave
    editor.ease(true)
    time.sleep(2.0)
    editor.rotate("gato", 0)
    editor.zoom("gato", 150)
    giro = editor.rotation("gato")
    tamanho = editor.scale("gato")
    println("gato: giro {giro}, tamanho {tamanho}")

if editor.exists("trilha")
    fade_in("trilha", 2.0)
    println("trilha: fade de entrada")

if editor.exists("titulo")
    cor = "#f0b429"
    editor.color("titulo", cor)
    println("titulo: {cor}")
`;

function novoId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function le(): Script[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (Array.isArray(v)) return v.filter((s) => s && typeof s.id === "string" && typeof s.texto === "string");
  } catch { /* lista corrompida: comeca de novo */ }
  return [];
}

function grava(lista: Script[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(lista)); } catch { /* sem armazenamento */ }
}

/** Todos os scripts, o mais recente primeiro. Na primeira vez cria o exemplo
    (e traz o texto do painel antigo, se havia). */
export function listaScripts(): Script[] {
  let lista = le();
  if (!lista.length && localStorage.getItem(CHAVE) === null) {
    const agora = Date.now();
    lista = [{ id: novoId(), nome: "exemplo", texto: EXEMPLO, modificado: agora - 1 }];
    let antigo: string | null = null;
    try { antigo = localStorage.getItem(CHAVE_ANTIGA); } catch { /* nada */ }
    if (antigo && antigo.trim() && antigo !== EXEMPLO)
      lista.unshift({ id: novoId(), nome: "meu script", texto: antigo, modificado: agora });
    grava(lista);
  }
  return lista.sort((a, b) => b.modificado - a.modificado);
}

export function pegaScript(id: string): Script | undefined {
  return le().find((s) => s.id === id);
}

/** Nome ainda nao usado: "script 1", "script 2"... */
function nomeLivre(base: string): string {
  const usados = new Set(le().map((s) => s.nome));
  if (!usados.has(base)) return base;
  for (let i = 2; ; i++) if (!usados.has(`${base} ${i}`)) return `${base} ${i}`;
}

export function criaScript(nome = "script", texto = "import editor\nimport time\n\n"): Script {
  const s = { id: novoId(), nome: nomeLivre(nome), texto, modificado: Date.now() };
  grava([s, ...le()]);
  return s;
}

export function salvaScript(id: string, mudanca: Partial<Pick<Script, "nome" | "texto">>): Script | undefined {
  const lista = le();
  const s = lista.find((x) => x.id === id);
  if (!s) return undefined;
  if (mudanca.nome !== undefined) s.nome = mudanca.nome.trim() || s.nome;
  if (mudanca.texto !== undefined) s.texto = mudanca.texto;
  s.modificado = Date.now();
  grava(lista);
  return s;
}

export function apagaScript(id: string) {
  grava(le().filter((s) => s.id !== id));
}

/** O script aberto por ultimo no editor de scripts. */
export function scriptAtual(): string | null {
  try { return localStorage.getItem(CHAVE_ATUAL); } catch { return null; }
}

export function marcaAtual(id: string) {
  try { localStorage.setItem(CHAVE_ATUAL, id); } catch { /* sem armazenamento */ }
}

/** A lista mudou em outra guia? */
export function observaScripts(f: () => void) {
  window.addEventListener("storage", (e) => { if (e.key === CHAVE) f(); });
}
