// A plataforma da linguagem Jatai: o editor, as vistas da barra lateral, o
// painel de baixo e os comandos. No molde do VS Code - quem conhece um, conhece
// o outro -, com o programa rodando no proprio navegador.

import './estilo.css';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

import { Execucao, interativo, verifica, type Problema } from './executar';
import { bibliotecaPadrao, documentacao, listaDeExemplos, type Exemplo } from './fontes';
import { SO_NO_COMPUTADOR } from './bibliotecas';
import { ID, registraJatai } from './linguagem';
import { Projeto } from './projeto';
import { Terminal } from './terminal';
import { baixa, zip } from './zip';

// O zip de download sai da release mais nova do GitHub: o endereco nao muda de
// versao para versao.
const REPOSITORIO = 'https://github.com/jatai-media/jatai-media.github.io';
const DOWNLOAD = REPOSITORIO + '/releases/latest/download/jatai-windows-x64.zip';
const VERSOES = REPOSITORIO + '/releases';

(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function guardado<T>(chave: string, padrao: T): T {
  try { const v = localStorage.getItem(chave); return v ? { ...padrao, ...JSON.parse(v) } : padrao; }
  catch { return padrao; }
}
function guarda(chave: string, v: unknown): void {
  try { localStorage.setItem(chave, JSON.stringify(v)); } catch { /* sem espaco */ }
}

registraJatai();
const projeto = new Projeto();

// ================================================================ o editor

const temaMonaco = () => (document.documentElement.dataset.theme === 'light' ? 'jatai-claro' : 'jatai-escuro');

const editor = monaco.editor.create($('editor'), {
  language: ID,
  theme: temaMonaco(),
  automaticLayout: true,
  fontFamily: "'Cascadia Code', Consolas, 'Courier New', monospace",
  fontSize: 14,
  tabSize: 4,
  insertSpaces: true,
  detectIndentation: false,
  minimap: { enabled: true },
  renderWhitespace: 'selection',
  bracketPairColorization: { enabled: true },
  guides: { indentation: true, bracketPairs: true },
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  scrollBeyondLastLine: false,
  fixedOverflowWidgets: true,
  padding: { top: 8 },
});

// ================================================================ as abas

type Aba = {
  id: string;              // o caminho no projeto, ou "exemplo:<nome>"
  titulo: string;
  modelo: monaco.editor.ITextModel;
  leitura: boolean;
  estado: monaco.editor.ICodeEditorViewState | null;
};

const abas: Aba[] = [];
let ativa: Aba | null = null;

const uriDe = (id: string) => monaco.Uri.from({ scheme: id.startsWith('exemplo:') ? 'exemplo' : 'file',
                                                path: '/' + id.replace(/^exemplo:/, '') });
const nomeDe = (caminho: string) => caminho.split('/').pop() || caminho;
const ehJatai = (caminho: string) => caminho.endsWith('.jat');

function modeloDe(id: string, texto: string): monaco.editor.ITextModel {
  const uri = uriDe(id);
  const existe = monaco.editor.getModel(uri);
  if (existe) return existe;
  const lang = ehJatai(id) ? ID : id.endsWith('.json') ? 'json' : 'plaintext';
  const m = monaco.editor.createModel(texto, lang, uri);
  if (!id.startsWith('exemplo:')) {
    m.onDidChangeContent(() => {
      projeto.grava(id, m.getValue());
      if (ehJatai(id)) agendaVerificacao(id);
    });
  }
  return m;
}

function abre(id: string, foco = true): Aba | null {
  let aba = abas.find((a) => a.id === id);
  if (!aba) {
    let texto: string | undefined, leitura = false;
    if (id.startsWith('exemplo:')) {
      texto = listaDeExemplos.find((e) => e.nome === id.slice(8))?.texto;
      leitura = true;
    } else texto = projeto.le(id);
    if (texto === undefined) return null;
    aba = { id, titulo: nomeDe(id.replace(/^exemplo:/, '')), modelo: modeloDe(id, texto), leitura, estado: null };
    abas.push(aba);
  }
  ativaAba(aba);
  if (foco) editor.focus();
  return aba;
}

function ativaAba(aba: Aba): void {
  if (ativa && ativa !== aba) ativa.estado = editor.saveViewState();
  ativa = aba;
  editor.setModel(aba.modelo);
  editor.updateOptions({ readOnly: aba.leitura });
  if (aba.estado) editor.restoreViewState(aba.estado);
  pintaAbas();
  pintaExplorador();
  pintaAvisoLeitura();
  $('tituloArquivo').textContent = aba.leitura ? `${aba.titulo} (exemplo)` : aba.id;
  document.title = `${aba.titulo} — Jatai`;
  if (!aba.leitura && ehJatai(aba.id)) agendaVerificacao(aba.id, 0);
  guardaAbas();
}

function fechaAba(aba: Aba): void {
  const i = abas.indexOf(aba);
  if (i < 0) return;
  abas.splice(i, 1);
  // o modelo de um exemplo nao guarda nada; o de um arquivo fica para reabrir rapido
  if (aba.leitura) aba.modelo.dispose();
  if (ativa === aba) {
    ativa = null;
    const outra = abas[i] || abas[i - 1];
    if (outra) ativaAba(outra);
    else { editor.setModel(null); pintaAbas(); pintaExplorador(); pintaAvisoLeitura(); $('tituloArquivo').textContent = ''; }
  } else pintaAbas();
  guardaAbas();
}

function guardaAbas(): void {
  guarda('jatai.ide.abas', { abertas: abas.map((a) => a.id), ativa: ativa?.id ?? null });
}

function pintaAbas(): void {
  const barra = $('abas');
  barra.textContent = '';
  for (const aba of abas) {
    const b = document.createElement('div');
    b.className = 'aba' + (aba === ativa ? ' on' : '') + (aba.leitura ? ' leitura' : '');
    b.title = aba.leitura ? 'Exemplo (somente leitura)' : aba.id;
    b.innerHTML = `<img src="${import.meta.env.BASE_URL}icons/jatai-file.png" alt=""><span></span><button title="Fechar (Ctrl+W)">×</button>`;
    b.querySelector('span')!.textContent = aba.titulo;
    if (!ehJatai(aba.id.replace(/^exemplo:/, ''))) b.querySelector('img')!.remove();
    b.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); fechaAba(aba); }
    });
    b.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') fechaAba(aba);
      else ativaAba(aba);
    });
    barra.appendChild(b);
  }
}

function pintaAvisoLeitura(): void {
  const el = $('avisoLeitura');
  if (!ativa?.leitura) { el.hidden = true; return; }
  const ex = listaDeExemplos.find((e) => 'exemplo:' + e.nome === ativa!.id);
  el.hidden = false;
  el.innerHTML = '<span>Exemplo — somente leitura.</span> <button class="bt link">Copiar para o projeto e editar</button>' +
    (ex?.soNoComputador ? ` <span class="selo">usa a biblioteca ${ex.soNoComputador}: só roda no Jatai instalado</span>` : '');
  el.querySelector('button')!.addEventListener('click', () => ex && copiaExemplo(ex));
}

// ================================================================ vistas da lateral

type Vista = 'explorador' | 'exemplos' | 'bibliotecas' | 'baixar';
const layout = guardado('jatai.ide.layout', { vista: 'explorador' as Vista | null, lateral: 260, painel: 230, painelAberto: true });
const pastasFechadas = new Set<string>();

function mostraVista(v: Vista | null): void {
  // clicar na vista aberta fecha a lateral, como no VS Code
  layout.vista = v;
  document.querySelectorAll<HTMLElement>('.atv').forEach((b) => b.classList.toggle('on', b.dataset.vista === v));
  document.body.classList.toggle('sem-lateral', !v);
  guarda('jatai.ide.layout', layout);
  pintaLateral();
}

function pintaLateral(): void {
  const el = $('lateral');
  el.textContent = '';
  if (layout.vista === 'explorador') pintaExplorador();
  else if (layout.vista === 'exemplos') pintaExemplos(el);
  else if (layout.vista === 'bibliotecas') pintaBibliotecas(el);
  else if (layout.vista === 'baixar') pintaBaixar(el);
}

function cabecalho(titulo: string, botoes: Array<[string, string, () => void]> = []): HTMLElement {
  const h = document.createElement('div');
  h.className = 'lat-cabeca';
  h.innerHTML = `<span>${titulo}</span><div class="espaco"></div>`;
  for (const [icone, dica, faz] of botoes) {
    const b = document.createElement('button');
    b.className = 'bt icone';
    b.title = dica;
    b.innerHTML = icone;
    b.addEventListener('click', faz);
    h.appendChild(b);
  }
  return h;
}

const ICONE = {
  arquivo: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5zm0 0V5H13M8 7.5v5M5.5 10h5" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  pasta: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13zM8 7.5v4.5M5.8 9.8h4.4" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
  enviar: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 11V2.5m0 0L5 5.5m3-3 3 3M2.5 10.5v3h11v-3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  zip: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 2.5V11m0 0-3-3m3 3 3-3M2.5 10.5v3h11v-3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  recolher: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 3.5h9v9h-9zM6 8h4" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
};

// ---------------------------------------------------------------- explorador

// O campo de nome que aparece dentro da arvore (novo arquivo, nova pasta, renomear).
let editando: { tipo: 'arquivo' | 'pasta' | 'renomear'; pai: string; alvo?: string } | null = null;

function pintaExplorador(): void {
  if (layout.vista !== 'explorador') return;
  const el = $('lateral');
  el.textContent = '';
  el.appendChild(cabecalho('Explorador', [
    [ICONE.arquivo, 'Novo arquivo (Ctrl+Alt+N)', () => comecaEdicao('arquivo', pastaSelecionada())],
    [ICONE.pasta, 'Nova pasta', () => comecaEdicao('pasta', pastaSelecionada())],
    [ICONE.enviar, 'Enviar arquivos do computador', enviaArquivos],
    [ICONE.zip, 'Baixar o projeto (.zip)', baixaProjeto],
    [ICONE.recolher, 'Recolher pastas', () => { projeto.pastas().forEach((p) => pastasFechadas.add(p)); pintaExplorador(); }],
  ]));

  const arvore = document.createElement('div');
  arvore.className = 'arvore';
  arvore.tabIndex = 0;
  el.appendChild(arvore);

  const pastas = projeto.pastas();
  const arquivos = projeto.caminhos();

  const desenha = (pai: string, nivel: number) => {
    const filhosPasta = pastas.filter((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '') === pai);
    const filhosArq = arquivos.filter((a) => (a.includes('/') ? a.slice(0, a.lastIndexOf('/')) : '') === pai);
    if (editando && editando.tipo !== 'renomear' && editando.pai === pai) arvore.appendChild(campoDeNome(nivel));
    for (const p of filhosPasta) {
      if (editando?.tipo === 'renomear' && editando.alvo === p) { arvore.appendChild(campoDeNome(nivel, nomeDe(p))); continue; }
      const aberta = !pastasFechadas.has(p);
      arvore.appendChild(item(nomeDe(p), nivel, 'pasta', aberta, () => {
        if (aberta) pastasFechadas.add(p); else pastasFechadas.delete(p);
        pintaExplorador();
      }, p));
      if (aberta) desenha(p, nivel + 1);
    }
    for (const a of filhosArq) {
      if (editando?.tipo === 'renomear' && editando.alvo === a) { arvore.appendChild(campoDeNome(nivel, nomeDe(a))); continue; }
      arvore.appendChild(item(nomeDe(a), nivel, 'arquivo', false, () => abre(a), a));
    }
  };
  desenha('', 0);

  if (!arquivos.length && !editando) {
    const vazio = document.createElement('div');
    vazio.className = 'lat-vazio';
    vazio.innerHTML = 'O projeto está vazio. <a href="#">Criar um arquivo</a>';
    vazio.querySelector('a')!.addEventListener('click', (e) => { e.preventDefault(); comecaEdicao('arquivo', ''); });
    arvore.appendChild(vazio);
  }
  arvore.addEventListener('contextmenu', (e) => {
    if (e.target === arvore) { e.preventDefault(); menu(e, ''); }
  });
}

function item(nome: string, nivel: number, tipo: 'pasta' | 'arquivo', aberta: boolean,
              clique: () => void, caminho: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'item ' + tipo + (tipo === 'arquivo' && ativa?.id === caminho ? ' on' : '');
  d.style.paddingLeft = 8 + nivel * 14 + 'px';
  d.dataset.caminho = caminho;
  const icone = tipo === 'pasta'
    ? `<span class="seta${aberta ? ' aberta' : ''}">›</span>`
    : ehJatai(nome) ? `<img src="${import.meta.env.BASE_URL}icons/jatai-file.png" alt="">`
    : '<span class="doc">≡</span>';
  d.innerHTML = `${icone}<span class="nome"></span>`;
  d.querySelector('.nome')!.textContent = nome;
  d.addEventListener('click', clique);
  d.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e, caminho, tipo); });
  return d;
}

function pastaSelecionada(): string {
  if (!ativa || ativa.leitura) return '';
  return ativa.id.includes('/') ? ativa.id.slice(0, ativa.id.lastIndexOf('/')) : '';
}

function comecaEdicao(tipo: 'arquivo' | 'pasta' | 'renomear', pai: string, alvo?: string): void {
  if (layout.vista !== 'explorador') mostraVista('explorador');
  pastasFechadas.delete(pai);
  editando = { tipo, pai, alvo };
  pintaExplorador();
}

function campoDeNome(nivel: number, valor = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = 'item editando';
  d.style.paddingLeft = 8 + nivel * 14 + 'px';
  const inp = document.createElement('input');
  inp.value = valor;
  inp.placeholder = editando?.tipo === 'pasta' ? 'nome da pasta' : 'nome.jat';
  inp.spellcheck = false;
  const acaba = (ok: boolean) => {
    if (!editando) return;
    const e = editando;
    editando = null;
    if (ok) confirmaNome(e, inp.value.trim());
    pintaExplorador();
  };
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); acaba(true); }
    if (ev.key === 'Escape') { ev.preventDefault(); acaba(false); }
  });
  inp.addEventListener('blur', () => acaba(!!inp.value.trim()));
  d.appendChild(inp);
  setTimeout(() => {
    inp.focus();
    const ponto = inp.value.lastIndexOf('.');
    inp.setSelectionRange(0, ponto > 0 ? ponto : inp.value.length);
  });
  return d;
}

function confirmaNome(e: NonNullable<typeof editando>, nome: string): void {
  if (!nome || /[\\:*?"<>|]/.test(nome)) { if (nome) avisa('Nome inválido: ' + nome); return; }
  if (e.tipo === 'renomear' && e.alvo) {
    const pai = e.alvo.includes('/') ? e.alvo.slice(0, e.alvo.lastIndexOf('/')) : '';
    const novo = Projeto.normaliza((pai ? pai + '/' : '') + nome);
    if (novo === e.alvo) return;
    if (projeto.tem(novo) || projeto.pastas().includes(novo)) { avisa(`Já existe '${novo}'.`); return; }
    renomeia(e.alvo, novo);
    return;
  }
  let caminho = Projeto.normaliza((e.pai ? e.pai + '/' : '') + nome);
  if (e.tipo === 'pasta') { projeto.criaPasta(caminho); return; }
  if (!caminho.includes('.')) caminho += '.jat';
  if (projeto.tem(caminho)) { abre(caminho); return; }
  projeto.grava(caminho, '');
  abre(caminho);
}

function renomeia(de: string, para: string): void {
  // as abas do que muda de nome reabrem com o nome novo
  const afetadas = abas.filter((a) => a.id === de || a.id.startsWith(de + '/'));
  const eraAtiva = ativa && afetadas.includes(ativa) ? ativa.id : null;
  for (const a of afetadas) { fechaAba(a); a.modelo.dispose(); }
  projeto.renomeia(de, para);
  for (const a of afetadas) abre(para + a.id.slice(de.length), false);
  if (eraAtiva) abre(para + eraAtiva.slice(de.length));
}

function apaga(caminho: string, tipo: 'pasta' | 'arquivo'): void {
  const quantos = tipo === 'pasta' ? projeto.caminhos().filter((c) => c.startsWith(caminho + '/')).length : 0;
  const msg = tipo === 'pasta' ? `Apagar a pasta '${caminho}'${quantos ? ` e os ${quantos} arquivos dentro dela` : ''}?`
                               : `Apagar '${caminho}'?`;
  if (!confirm(msg)) return;
  for (const a of abas.filter((x) => x.id === caminho || x.id.startsWith(caminho + '/'))) { fechaAba(a); a.modelo.dispose(); }
  projeto.apaga(caminho);
}

// ---------------------------------------------------------------- menu do botao direito

function menu(e: MouseEvent, caminho: string, tipo?: 'pasta' | 'arquivo'): void {
  fechaMenu();
  const pai = tipo === 'pasta' ? caminho : caminho.includes('/') ? caminho.slice(0, caminho.lastIndexOf('/')) : '';
  const itens: Array<[string, () => void] | null> = [
    ['Novo arquivo', () => comecaEdicao('arquivo', pai)],
    ['Nova pasta', () => comecaEdicao('pasta', pai)],
  ];
  if (tipo === 'arquivo') {
    itens.push(null, ['Rodar', () => { abre(caminho); void rodar(); }]);
    itens.push(['Baixar', () => baixa(nomeDe(caminho), new Blob([projeto.le(caminho) ?? ''], { type: 'text/plain' }))]);
  }
  if (tipo) {
    itens.push(null, ['Renomear', () => comecaEdicao('renomear', pai, caminho)]);
    itens.push(['Apagar', () => apaga(caminho, tipo)]);
  }
  const m = document.createElement('div');
  m.className = 'menu';
  for (const it of itens) {
    if (!it) { m.appendChild(Object.assign(document.createElement('div'), { className: 'menu-sep' })); continue; }
    const b = document.createElement('button');
    b.textContent = it[0];
    b.addEventListener('click', () => { fechaMenu(); it[1](); });
    m.appendChild(b);
  }
  document.body.appendChild(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(e.clientX, innerWidth - r.width - 4) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - r.height - 4) + 'px';
}
function fechaMenu(): void { document.querySelector('.menu')?.remove(); }
document.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('.menu')) fechaMenu(); });

// ---------------------------------------------------------------- enviar e baixar

function enviaArquivos(): void {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  inp.accept = '.jat,.txt,.csv,.json,.md,.html,.css';
  inp.addEventListener('change', async () => {
    const pai = pastaSelecionada();
    let ultimo = '';
    for (const f of inp.files ?? []) {
      ultimo = Projeto.normaliza((pai ? pai + '/' : '') + f.name);
      projeto.grava(ultimo, await f.text(), true);
      const aba = abas.find((a) => a.id === ultimo);
      if (aba) aba.modelo.setValue(projeto.le(ultimo)!);
    }
    if (ultimo) abre(ultimo);
  });
  inp.click();
}

function baixaProjeto(): void {
  const arquivos = projeto.arquivosTodos();
  if (!Object.keys(arquivos).length) { avisa('O projeto está vazio.'); return; }
  baixa('projeto-jatai.zip', zip(arquivos));
}

// ---------------------------------------------------------------- exemplos

function pintaExemplos(el: HTMLElement): void {
  el.appendChild(cabecalho('Exemplos'));
  const lista = document.createElement('div');
  lista.className = 'lista';
  for (const ex of listaDeExemplos) {
    const d = document.createElement('div');
    d.className = 'item exemplo' + (ativa?.id === 'exemplo:' + ex.nome ? ' on' : '');
    d.innerHTML = `<img src="${import.meta.env.BASE_URL}icons/jatai-file.png" alt=""><span class="nome"></span>` +
      (ex.soNoComputador ? '<span class="selo" title="usa uma biblioteca que só existe no Jatai instalado">computador</span>' : '') +
      '<button class="bt icone copiar" title="Copiar para o projeto">+</button>';
    d.querySelector('.nome')!.textContent = ex.nome.replace(/\.jat$/, '').replace(/^(\d+)_/, '$1. ').replace(/_/g, ' ');
    d.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('copiar')) copiaExemplo(ex);
      else { abre('exemplo:' + ex.nome); pintaLateral(); }
    });
    lista.appendChild(d);
  }
  el.appendChild(lista);
}

function copiaExemplo(ex: Exemplo): void {
  let nome = ex.nome, n = 2;
  while (projeto.tem(nome)) nome = ex.nome.replace(/\.jat$/, `_${n++}.jat`);
  projeto.grava(nome, ex.texto);
  const aba = abas.find((a) => a.id === 'exemplo:' + ex.nome);
  if (aba) fechaAba(aba);
  abre(nome);
  avisa(`'${nome}' copiado para o projeto.`);
}

// ---------------------------------------------------------------- bibliotecas

function pintaBibliotecas(el: HTMLElement): void {
  el.appendChild(cabecalho('Bibliotecas'));
  const lista = document.createElement('div');
  lista.className = 'lista docs';
  const docs = documentacao();
  const nomes = [...new Set(docs.map((d) => d.biblioteca))].filter((b) => b !== 'level').sort();
  for (const b of nomes) {
    const secao = document.createElement('details');
    secao.className = 'lib';
    const fora = SO_NO_COMPUTADOR[b];
    secao.innerHTML = `<summary><span class="nome">${b}</span>` +
      `<span class="selo ${fora ? '' : 'web'}">${fora ? 'computador' : 'navegador'}</span>` +
      '<button class="bt link importar" title="Acrescentar o import no arquivo aberto">import</button></summary>';
    if (fora) {
      const p = document.createElement('p');
      p.className = 'lib-nota';
      p.textContent = `A biblioteca ${b} ${fora}: roda no Jatai instalado.`;
      secao.appendChild(p);
    }
    for (const f of docs.filter((d) => d.biblioteca === b)) {
      const d = document.createElement('div');
      d.className = 'fn';
      d.title = f.doc || f.assinatura;
      d.innerHTML = '<code></code><div class="fn-doc"></div>';
      d.querySelector('code')!.textContent = f.assinatura;
      d.querySelector('.fn-doc')!.textContent = f.doc.split('\n')[0] || '';
      d.addEventListener('click', () => insere(`${b}.${f.nome}(${f.parametros.map((p) => p.split(/\s+/).pop()).join(', ')})`, b));
      secao.appendChild(d);
    }
    secao.querySelector('.importar')!.addEventListener('click', (e) => { e.preventDefault(); garanteImport(b); });
    lista.appendChild(secao);
  }
  el.appendChild(lista);
}

function garanteImport(b: string): void {
  if (!ativa || ativa.leitura) { avisa('Abra um arquivo do projeto primeiro.'); return; }
  const m = ativa.modelo;
  if (new RegExp(`^import\\s+${b}\\b`, 'm').test(m.getValue())) return;
  m.pushEditOperations([], [{ range: new monaco.Range(1, 1, 1, 1), text: `import ${b}\n` }], () => null);
}

function insere(texto: string, b: string): void {
  if (!ativa || ativa.leitura) { avisa('Abra um arquivo do projeto primeiro.'); return; }
  garanteImport(b);
  const sel = editor.getSelection();
  if (sel) editor.executeEdits('bibliotecas', [{ range: sel, text: texto, forceMoveMarkers: true }]);
  editor.focus();
}

// ---------------------------------------------------------------- baixar

function pintaBaixar(el: HTMLElement): void {
  el.appendChild(cabecalho('Baixar o Jatai'));
  const d = document.createElement('div');
  d.className = 'baixar-corpo';
  d.innerHTML = `
    <p>O Jatai completo para o seu computador: roda os programas, compila para
    <code>.exe</code> e traz todas as bibliotecas, inclusive as que o navegador não tem
    (<b>iliv</b>, janelas; <b>http</b>, servidor web; <b>voz</b> do Windows).</p>
    <a class="bt primario grande" href="${DOWNLOAD}">Baixar para Windows (x64)</a>
    <p class="miudo">Windows 10 ou 11. Não precisa instalar nada: é só extrair o zip.</p>
    <h4>O que vem no zip</h4>
    <ul>
      <li><code>jatai.exe</code> - roda e compila os programas</li>
      <li><code>library/</code> - as bibliotecas padrão</li>
      <li><code>src/toolchain/</code> — o compilador do <code>-build</code></li>
      <li><code>exemplos/</code> - os mesmos exemplos daqui</li>
      <li><code>extensao/jatai.vsix</code> - realce da linguagem no VS Code</li>
    </ul>
    <h4>Como usar</h4>
    <ol>
      <li>Extraia o zip numa pasta, por exemplo <code>C:\\jatai</code>.</li>
      <li>No terminal, dentro dela: <code>jatai.exe exemplos\\1_print.jat</code></li>
      <li>Para gerar um executável: <code>jatai.exe programa.jat -build</code></li>
      <li>No VS Code: <code>code --install-extension extensao\\jatai.vsix</code></li>
    </ol>
    <p class="miudo">Levar um projeto daqui para o computador: botão
    <b>Baixar o projeto (.zip)</b>, no Explorador.</p>
    <p class="miudo"><a href="${VERSOES}" target="_blank" rel="noopener">Todas as versões</a></p>`;
  el.appendChild(d);
}

// ================================================================ o painel de baixo

const terminal = new Terminal($('terminal'), (arquivo, linha, coluna) => vaiPara(arquivo, linha, coluna));

function mostraPainel(nome: string): void {
  document.querySelectorAll<HTMLElement>('.pab').forEach((b) => b.classList.toggle('on', b.dataset.painel === nome));
  document.querySelectorAll<HTMLElement>('.painel-corpo').forEach((c) => { c.hidden = c.dataset.painel !== nome; });
  if (!layout.painelAberto) alternaPainel(true);
}
document.querySelectorAll<HTMLElement>('.pab').forEach((b) => b.addEventListener('click', () => mostraPainel(b.dataset.painel!)));
$('btLimpar').addEventListener('click', () => terminal.limpa());

function alternaPainel(abrir = !layout.painelAberto): void {
  layout.painelAberto = abrir;
  document.body.classList.toggle('sem-painel', !abrir);
  guarda('jatai.ide.layout', layout);
}

const entrada = $<HTMLTextAreaElement>('entrada');
entrada.value = guardado('jatai.ide.entrada', { texto: '' }).texto;
entrada.addEventListener('input', () => guarda('jatai.ide.entrada', { texto: entrada.value }));

function vaiPara(arquivo: string, linha: number, coluna: number): void {
  const id = projeto.tem(arquivo) ? arquivo
    : listaDeExemplos.some((e) => 'exemplos/' + e.nome === arquivo) ? 'exemplo:' + arquivo.slice(9) : null;
  if (!id) {
    if (bibliotecaPadrao[arquivo]) avisa(`O erro está na biblioteca padrão: ${arquivo}`);
    return;
  }
  abre(id);
  editor.setPosition({ lineNumber: linha, column: coluna });
  editor.revealLineInCenter(linha);
}

// ================================================================ rodar

let execucao: Execucao | null = null;

function estado(texto: string, tipo: '' | 'rodando' | 'erro' | 'ok' = ''): void {
  const el = $('stEstado');
  el.textContent = texto;
  el.className = 'estado ' + tipo;
}

async function rodar(): Promise<void> {
  if (execucao && !execucao.terminou) return;
  if (!ativa) { avisa('Abra um arquivo .jat para rodar.'); return; }
  const exemplo = ativa.leitura;
  const principal = exemplo ? 'exemplos/' + ativa.titulo : ativa.id;
  if (!ehJatai(principal)) { avisa('Só arquivos .jat rodam.'); return; }

  const arquivos = exemplo ? { [principal]: ativa.modelo.getValue() } : projeto.arquivosTodos();
  terminal.limpa();
  mostraPainel('terminal');
  terminal.comando(`> jatai ${principal}`);
  $<HTMLButtonElement>('btRodar').disabled = true;
  $<HTMLButtonElement>('btParar').disabled = false;
  estado('rodando...', 'rodando');

  execucao = new Execucao(arquivos, principal, entrada.value, {
    saida: (fd, t) => terminal.escreve(fd, t),
    pedeEntrada: () => {
      estado('esperando entrada...', 'rodando');
      terminal.pedeEntrada((l) => { estado('rodando...', 'rodando'); execucao?.responde(l); },
                          () => execucao?.fimDaEntrada());
    },
    fim: (codigo, alterados, ms) => {
      terminal.cancelaEntrada();
      const s = (ms / 1000).toFixed(ms < 10000 ? 2 : 1);
      if (codigo === 0) { terminal.aviso(`[terminou em ${s} s]`, 'ok'); estado('pronto', 'ok'); }
      else if (codigo === 130) estado('parado');
      else { terminal.aviso(`[saiu com código ${codigo}]`, 'erro'); estado('erro', 'erro'); }
      $<HTMLButtonElement>('btRodar').disabled = false;
      $<HTMLButtonElement>('btParar').disabled = true;
      if (!exemplo) aplicaAlterados(alterados);
      else if (Object.keys(alterados).length)
        terminal.aviso(`(o exemplo gravou ${Object.keys(alterados).length} arquivo(s), descartados: copie-o para o projeto para guardá-los)`);
      editor.focus();
    },
  });
}

function aplicaAlterados(alterados: Record<string, string | null>): void {
  const mudou = projeto.aplica(alterados);
  if (!mudou.length) return;
  for (const c of mudou) {
    const aba = abas.find((a) => a.id === c);
    const t = projeto.le(c);
    if (aba && t !== undefined && aba.modelo.getValue() !== t) aba.modelo.setValue(t);
    if (aba && t === undefined) fechaAba(aba);
  }
  terminal.aviso(`arquivos gravados pelo programa: ${mudou.join(', ')}`);
}

function parar(): void { execucao?.para(); }

$('btRodar').addEventListener('click', () => void rodar());
$('btParar').addEventListener('click', parar);

// ================================================================ verificar enquanto se digita

let timerVerif = 0;
function agendaVerificacao(caminho: string, ms = 450): void {
  clearTimeout(timerVerif);
  timerVerif = window.setTimeout(() => {
    verifica(projeto.arquivosTodos(), caminho, (problemas) => marca(caminho, problemas));
  }, ms);
}

function marca(principal: string, problemas: Problema[]): void {
  // limpa as marcas dos arquivos do projeto e poe as novas onde elas cairem
  for (const m of monaco.editor.getModels()) {
    if (m.uri.scheme === 'file') monaco.editor.setModelMarkers(m, 'jatai', []);
  }
  const porArquivo = new Map<string, Problema[]>();
  for (const p of problemas) {
    if (!porArquivo.has(p.arquivo)) porArquivo.set(p.arquivo, []);
    porArquivo.get(p.arquivo)!.push(p);
  }
  for (const [arq, ps] of porArquivo) {
    const m = monaco.editor.getModel(uriDe(arq));
    if (!m) continue;
    monaco.editor.setModelMarkers(m, 'jatai', ps.map((p) => {
      const palavra = m.getWordAtPosition({ lineNumber: p.linha, column: Math.max(1, p.coluna) });
      return {
        severity: p.nota ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Error,
        message: p.mensagem,
        startLineNumber: p.linha, startColumn: palavra ? palavra.startColumn : p.coluna,
        endLineNumber: p.linha, endColumn: palavra ? palavra.endColumn : p.coluna + 1,
        source: 'jatai',
      };
    }));
  }

  const erros = problemas.filter((p) => !p.nota).length;
  $('contProblemas').textContent = erros ? String(erros) : '';
  const lista = $('problemas');
  lista.textContent = '';
  if (!problemas.length) {
    lista.innerHTML = `<div class="lat-vazio">Nenhum problema em ${principal}.</div>`;
    return;
  }
  for (const p of problemas) {
    const d = document.createElement('div');
    d.className = 'problema' + (p.nota ? ' nota' : '');
    d.innerHTML = `<span class="icone-p">${p.nota ? 'i' : '×'}</span><span class="msg"></span><span class="onde"></span>`;
    d.querySelector('.msg')!.textContent = p.mensagem;
    d.querySelector('.onde')!.textContent = `${p.arquivo} [${p.linha}, ${p.coluna}]`;
    d.addEventListener('click', () => vaiPara(p.arquivo, p.linha, p.coluna));
    lista.appendChild(d);
  }
}

// ================================================================ barra de status, tema, avisos

editor.onDidChangeCursorPosition((e) => {
  $('stCursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
});

$('stModo').textContent = interativo ? 'entrada: no terminal' : 'entrada: painel Entrada';
$('stModo').title = interativo
  ? 'O programa espera o que você digita no terminal (io.input, io.read_line).'
  : 'Este navegador não deu isolamento à página: o programa lê o que estiver no painel Entrada.';

$('btTema').addEventListener('click', () => {
  const novo = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = novo;
  try { localStorage.setItem('jatai.theme', novo); } catch { /* ok */ }
  monaco.editor.setTheme(temaMonaco());
});

($('btBaixar') as HTMLAnchorElement).href = DOWNLOAD;

let timerAviso = 0;
function avisa(texto: string): void {
  let el = document.querySelector<HTMLElement>('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = texto;
  el.classList.add('show');
  clearTimeout(timerAviso);
  timerAviso = window.setTimeout(() => el!.classList.remove('show'), 3200);
}

// ================================================================ divisores

function arrasta(divisor: HTMLElement, mede: (e: PointerEvent) => void): void {
  divisor.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    divisor.setPointerCapture(e.pointerId);
    document.body.classList.add('arrastando');
    const move = (ev: PointerEvent) => mede(ev);
    const solta = () => {
      divisor.removeEventListener('pointermove', move);
      document.body.classList.remove('arrastando');
      guarda('jatai.ide.layout', layout);
    };
    divisor.addEventListener('pointermove', move);
    divisor.addEventListener('pointerup', solta, { once: true });
  });
}

const raiz = document.documentElement;
const aplicaTamanhos = () => {
  raiz.style.setProperty('--lateral', layout.lateral + 'px');
  raiz.style.setProperty('--painel', layout.painel + 'px');
};
arrasta($('divLateral'), (e) => {
  layout.lateral = Math.max(170, Math.min(innerWidth * 0.5, e.clientX - 48));
  aplicaTamanhos();
});
arrasta($('divPainel'), (e) => {
  layout.painel = Math.max(80, Math.min(innerHeight * 0.7, innerHeight - e.clientY - 22));
  aplicaTamanhos();
});

// ================================================================ atalhos

document.querySelectorAll<HTMLElement>('.atv').forEach((b) => b.addEventListener('click', () => {
  const v = b.dataset.vista as Vista;
  mostraVista(layout.vista === v ? null : v);
}));

// Dentro do editor quem recebe as teclas e o Monaco: os comandos vao nele tambem.
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void rodar());
editor.addCommand(monaco.KeyCode.F5, () => void rodar());
editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F5, parar);
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => avisa('Tudo é salvo sozinho, no navegador.'));

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if ((ctrl && e.key === 'Enter') || (e.key === 'F5' && !e.shiftKey)) { e.preventDefault(); void rodar(); }
  else if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); parar(); }
  else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); avisa('Tudo é salvo sozinho, no navegador.'); }
  else if (ctrl && e.key.toLowerCase() === 'b') { e.preventDefault(); mostraVista(layout.vista ? null : 'explorador'); }
  else if (ctrl && (e.key === '`' || e.key === "'")) { e.preventDefault(); alternaPainel(); }
  else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); mostraVista('explorador'); }
  else if (ctrl && e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); comecaEdicao('arquivo', pastaSelecionada()); }
  else if (ctrl && e.key.toLowerCase() === 'w' && ativa) { e.preventDefault(); fechaAba(ativa); }
});

// ================================================================ partida

projeto.aoMudar(() => pintaExplorador());
aplicaTamanhos();
document.body.classList.toggle('sem-painel', !layout.painelAberto);
mostraVista(layout.vista);

const antes = guardado('jatai.ide.abas', { abertas: [] as string[], ativa: null as string | null });
for (const id of antes.abertas) abre(id, false);
const alvo = (antes.ativa && abas.find((a) => a.id === antes.ativa)) || abas[0];
if (alvo) ativaAba(alvo);
else if (projeto.tem('main.jat')) abre('main.jat');

terminal.aviso(interativo
  ? 'Ctrl+Enter roda o arquivo aberto. Quando o programa pedir entrada, digite aqui.'
  : 'Ctrl+Enter roda o arquivo aberto. A entrada do programa vem do painel Entrada.');
