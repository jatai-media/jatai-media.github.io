// plugins.ts - as pastas de plugins, a lista do que elas tem, e a camada deles
// na previa.
//
// Um plugin e uma pasta:
//
//   tarja-apresentador/
//     manifest.json    nome, duracao, parametros (ver Param)
//     plugin.js        export default { render(ctx, info) } - ver sandbox.ts
//     ...              imagens e fontes que ele usar
//
// A pessoa ADICIONA pastas: a pasta de um plugin so (com o manifest.json nela)
// ou uma que contem varios, um por subpasta. As pastas se somam - abrir a
// segunda nao tira os plugins da primeira. O navegador guarda o acesso a cada
// uma: nas proximas vezes elas abrem sozinhas, ou com um clique em Reabrir.
//
// Na linha do tempo, um plugin e um clipe como a foto: mora numa pista de
// video, empilha com o resto pela ordem das pistas, se enquadra pelo painel
// Imagem (posicao, giro, zoom, animacao) e sai na exportacao. O que ele guarda
// e so {id, params} - o codigo fica na pasta, e recarregar depois de mexer no
// plugin.js ja mostra a versao nova no mesmo clipe.

import { state, stackZ, toast, clamp } from "../ui/core";
import { refresh } from "../ui/dock-view";
import { screenIn, screenSize } from "../ui/panel-player";
import { applyTransform, pintaMoldura } from "../ui/panel-imagem";
import { apaga, grava, todos } from "../backend/idb";
import { carregaNoSandbox, limpaSandbox, desenhaNoSandbox, type Caixa } from "./sandbox";
import { refazFiltros, marcaAlvos } from "./filtros";

export interface Param {
  id: string;
  // "cores": uma LISTA de cores ("#rrggbb"[]), que o conta-gotas vai somando
  tipo: "texto" | "cor" | "cores" | "numero" | "escolha" | "sim_nao";
  rotulo: string;
  padrao: unknown;
  min?: number; max?: number; passo?: number; unidade?: string;
  opcoes?: string[];
  linhas?: number;          // texto: mais de 1 vira caixa de varias linhas
  contagotas?: boolean;     // cor: botao para escolher clicando na tela
}

export interface Plugin {
  id: string;               // o nome da pasta do plugin
  pasta: string;            // de qual pasta aberta ele veio
  // "desenho": desenha por cima; "filtro": altera o que esta abaixo (ver filtros.ts)
  tipo: "desenho" | "filtro";
  // So filtros. "abaixo": recebe tudo o que esta abaixo, montado (camada de
  // ajuste). "camada": recebe so a camada logo abaixo, e a saida, com
  // transparencia, vai por cima do resto (chroma key, cor de um clipe so).
  alcance: "abaixo" | "camada";
  nome: string;
  descricao: string;
  versao: string;
  autor: string;
  duracao: number;          // segundos, ao entrar na linha do tempo
  parado: boolean;          // true: o desenho nao muda com o tempo
  params: Param[];
  erro: string;             // "" quando carregou
}

// Uma pasta aberta. Com alca (Chrome, Edge) ela fica guardada no IndexedDB e
// volta na proxima sessao; escolhida pelo <input> de pasta (Firefox, Safari),
// ela vale so enquanto a pagina estiver aberta.
export interface Pasta {
  key: string;
  nome: string;
  handle?: FileSystemDirectoryHandle;
  grupos?: Map<string, Arquivo[]>;
  // "reconectar": o navegador quer um clique para liberar o acesso de novo
  situacao: "ok" | "reconectar" | "erro";
  erro: string;
  quantos: number;
}

export const plugins = {
  lista: [] as Plugin[],
  pastas: [] as Pasta[],
  carregando: false,
  // Muda a cada carga: e o que faz a previa pedir de novo os quadros de um
  // plugin cujo codigo mudou, mesmo com os mesmos parametros.
  geracao: 0,
};

interface Guardado { key: string; nome: string; handle: FileSystemDirectoryHandle }

// Um arquivo lido da pasta, com o caminho a partir da pasta do plugin.
interface Arquivo { caminho: string; file: File }

const MAX_BYTES = 64 * 1024 * 1024;   // por plugin: imagens e fontes, nao videos

const erroDe = (e) => String((e && e.message) || e);

// ------------------------------------------------------------ as pastas

export function temSuportePasta(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export function precisaReabrir(): boolean {
  return plugins.pastas.some((p) => p.situacao === "reconectar");
}

/** Menu > Plugins > Adicionar pasta de plugins. */
export async function abrePastaPlugins() {
  if (!temSuportePasta()) { await abrePorInput(); return; }
  let h: FileSystemDirectoryHandle;
  try {
    h = await window.showDirectoryPicker!({ id: "jatai-plugins", mode: "read" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return;
    toast("Nao foi possivel abrir a pasta: " + erroDe(e));
    return;
  }
  // A mesma pasta de novo e so recarrega-la.
  for (const p of plugins.pastas) {
    if (p.handle && (await (p.handle as any).isSameEntry?.(h))) {
      p.handle = h;
      await recarregaTudo(false);
      return;
    }
  }
  const key = "pasta:" + crypto.randomUUID();
  plugins.pastas.push({ key, nome: h.name, handle: h, situacao: "ok", erro: "", quantos: 0 });
  // Guardar e para a proxima vez; falhando (janela anonima, navegador que nao
  // guarda alcas), a pasta ainda vale nesta sessao.
  await grava<Guardado>("plugins", { key, nome: h.name, handle: h }).catch(() => {});
  await recarregaTudo(false);
}

/** Tira uma pasta da lista (os arquivos dela nao sao tocados). */
export async function removePasta(key: string) {
  plugins.pastas = plugins.pastas.filter((p) => p.key !== key);
  await apaga("plugins", key).catch(() => {});
  await recarregaTudo(false);
}

/** O botao Reabrir: pede de novo o acesso as pastas que o navegador esqueceu.
    So funciona dentro de um clique - e por isso nao acontece sozinho. */
export async function reabrePastas(key?: string) {
  for (const p of plugins.pastas) {
    if (p.situacao !== "reconectar" || !p.handle || (key && p.key !== key)) continue;
    try { await p.handle.requestPermission?.({ mode: "read" }); } catch { /* segue */ }
  }
  await recarregaTudo(false);
}

/** Recarrega todas as pastas: e o que se aperta depois de mexer num plugin.js. */
export async function recarregaPlugins() {
  await recarregaTudo(true);
  toast("Plugins recarregados.");
}

// Na partida: as pastas guardadas, carregadas sem perguntar nada se o
// navegador ainda da acesso.
export async function iniciaPlugins() {
  const regs = await todos<Guardado>("plugins").catch(() => [] as Guardado[]);
  plugins.pastas = regs.filter((r) => r && r.handle).map((r) => ({
    key: r.key, nome: r.nome, handle: r.handle, situacao: "ok" as const, erro: "", quantos: 0,
  }));
  if (plugins.pastas.length) await recarregaTudo(false).catch(() => {});
}

async function permissao(h: FileSystemDirectoryHandle, pedir: boolean): Promise<PermissionState> {
  let p: PermissionState = h.queryPermission ? await h.queryPermission({ mode: "read" }) : "granted";
  if (p === "prompt" && pedir && h.requestPermission) {
    try { p = await h.requestPermission({ mode: "read" }); } catch { /* sem clique recente */ }
  }
  return p;
}

// Le todas as pastas de novo e recarrega todos os plugins no sandbox. Um
// plugin com o mesmo id em duas pastas: vale o da pasta adicionada por ultimo.
async function recarregaTudo(pedir: boolean) {
  plugins.carregando = true;
  mostra();
  try {
    await limpaSandbox();
    const porId = new Map<string, Plugin>();
    for (const pa of plugins.pastas) {
      let grupos = pa.grupos || null;
      if (pa.handle) {
        if ((await permissao(pa.handle, pedir)) !== "granted") {
          pa.situacao = "reconectar";
          pa.quantos = 0;
          continue;
        }
        try { grupos = await gruposDaAlca(pa.handle); }
        catch (e) { pa.situacao = "erro"; pa.erro = erroDe(e); pa.quantos = 0; continue; }
      }
      pa.situacao = "ok";
      pa.erro = "";
      pa.quantos = grupos ? grupos.size : 0;
      for (const [id, arqs] of grupos || []) porId.set(id, await carregaUm(id, arqs, pa.nome));
    }
    plugins.lista = [...porId.values()].sort((a, b) => a.nome.localeCompare(b.nome));
    const ruins = plugins.lista.filter((p) => p.erro).length;
    if (ruins) toast(ruins + " plugin(s) com erro - veja o painel Plugins.");
  } finally {
    plugins.carregando = false;
    plugins.geracao++;
    mostra(["player", "timeline"]);
  }
}

// A pasta escolhida e ela mesma um plugin, ou contem varios?
async function gruposDaAlca(raiz: FileSystemDirectoryHandle) {
  const grupos = new Map<string, Arquivo[]>();
  if (await temArquivo(raiz, "manifest.json")) {
    grupos.set(raiz.name, await listaArquivos(raiz, ""));
    return grupos;
  }
  for await (const [nome, h] of (raiz as any).entries()) {
    if (h.kind !== "directory" || nome.startsWith(".")) continue;
    if (!(await temArquivo(h, "manifest.json"))) continue;
    grupos.set(nome, await listaArquivos(h, ""));
  }
  return grupos;
}

async function temArquivo(dir: FileSystemDirectoryHandle, nome: string) {
  try { await dir.getFileHandle(nome); return true; } catch { return false; }
}

async function listaArquivos(dir: FileSystemDirectoryHandle, prefixo: string, fundo = 0): Promise<Arquivo[]> {
  const out: Arquivo[] = [];
  for await (const [nome, h] of (dir as any).entries()) {
    if (nome.startsWith(".")) continue;
    if (h.kind === "file") out.push({ caminho: prefixo + nome, file: await h.getFile() });
    else if (fundo < 4) out.push(...await listaArquivos(h, prefixo + nome + "/", fundo + 1));
  }
  return out;
}

// Sem showDirectoryPicker (Firefox, Safari): o <input> de pasta. Funciona, mas
// o navegador nao guarda o acesso - e preciso escolher de novo a cada sessao.
function abrePorInput(): Promise<void> {
  return new Promise((ok) => {
    const inp = document.createElement("input");
    inp.type = "file";
    (inp as any).webkitdirectory = true;
    inp.addEventListener("cancel", () => ok());
    inp.addEventListener("change", async () => {
      const files = [...(inp.files || [])];
      if (!files.length) { ok(); return; }
      // webkitRelativePath: "Pasta/plugin/arquivo". A primeira parte e a pasta
      // escolhida; se o manifest esta nela, ela e o plugin.
      const partes = (f: File) => ((f as any).webkitRelativePath || f.name).split("/");
      const raiz = partes(files[0])[0];
      const unico = files.some((f) => partes(f).length === 2 && partes(f)[1] === "manifest.json");
      const grupos = new Map<string, Arquivo[]>();
      for (const f of files) {
        const p = partes(f);
        if (p.some((x) => x.startsWith("."))) continue;
        const id = unico ? raiz : p[1];
        const caminho = (unico ? p.slice(1) : p.slice(2)).join("/");
        if (!id || !caminho) continue;
        if (!grupos.has(id)) grupos.set(id, []);
        grupos.get(id)!.push({ caminho, file: f });
      }
      for (const [id, arqs] of [...grupos])
        if (!arqs.some((a) => a.caminho === "manifest.json")) grupos.delete(id);
      plugins.pastas.push({ key: "mem:" + crypto.randomUUID(), nome: raiz, grupos,
                            situacao: "ok", erro: "", quantos: grupos.size });
      await recarregaTudo(false);
      ok();
    });
    inp.click();
  });
}

// ------------------------------------------------------------ carregar

async function carregaUm(id: string, arqs: Arquivo[], pasta: string): Promise<Plugin> {
  const p: Plugin = { id, pasta, tipo: "desenho", alcance: "abaixo", nome: id, descricao: "", versao: "", autor: "",
                      duracao: 5, parado: false, params: [], erro: "" };
  try {
    const man = arqs.find((a) => a.caminho === "manifest.json");
    let m: any;
    try { m = JSON.parse(await man!.file.text()); }
    catch (e) { throw new Error("manifest.json invalido: " + erroDe(e)); }

    p.nome = String(m.nome || id);
    p.descricao = String(m.descricao || "");
    p.versao = String(m.versao || "");
    p.autor = String(m.autor || "");
    p.duracao = Number(m.duracao) > 0 ? Number(m.duracao) : 5;
    p.parado = m.parado === true;
    p.tipo = m.tipo === "filtro" ? "filtro" : "desenho";
    p.alcance = m.alcance === "camada" ? "camada" : "abaixo";
    p.params = (Array.isArray(m.params) ? m.params : []).map(leParam).filter(Boolean);

    const nomeCodigo = String(m.arquivo || "plugin.js");
    const cod = arqs.find((a) => a.caminho === nomeCodigo);
    if (!cod) throw new Error("falta o " + nomeCodigo);

    const outros: Record<string, Blob> = {};
    let bytes = 0;
    for (const a of arqs) {
      if (a === man || a === cod) continue;
      bytes += a.file.size;
      if (bytes > MAX_BYTES) throw new Error("arquivos demais na pasta (limite de 64 MB)");
      outros[a.caminho] = a.file;
    }
    p.erro = await carregaNoSandbox(id, await cod.file.text(), outros);
  } catch (e) {
    p.erro = erroDe(e);
  }
  return p;
}

const TIPOS = ["texto", "cor", "cores", "numero", "escolha", "sim_nao"];

function leParam(x: any): Param | null {
  if (!x || typeof x.id !== "string" || !x.id) return null;
  const tipo = TIPOS.includes(x.tipo) ? x.tipo : "texto";
  const padroes = { texto: "", cor: "#ffffff", cores: [], numero: 0, escolha: (x.opcoes || [""])[0], sim_nao: false };
  return {
    id: x.id, tipo, rotulo: String(x.rotulo || x.id),
    padrao: x.padrao !== undefined ? x.padrao : padroes[tipo],
    min: typeof x.min === "number" ? x.min : undefined,
    max: typeof x.max === "number" ? x.max : undefined,
    passo: typeof x.passo === "number" ? x.passo : undefined,
    unidade: typeof x.unidade === "string" ? x.unidade : undefined,
    opcoes: Array.isArray(x.opcoes) ? x.opcoes.map(String) : undefined,
    linhas: typeof x.linhas === "number" ? x.linhas : undefined,
    contagotas: x.contagotas === true,
  };
}

function mostra(extra: string[] = []) {
  refresh(["plugins"].concat(extra));
}

// ------------------------------------------------------------ o clipe

export function isPlugin(c?): boolean { return !!(c && c.kind === "plugin" && c.plugin); }

/** Clipe de plugin de FILTRO: uma camada de ajuste sobre o que esta abaixo.
    O clipe guarda isso ao nascer, para valer mesmo sem a pasta aberta. */
export function isFiltro(c?): boolean {
  if (!isPlugin(c)) return false;
  if (c.plugin.filtro) return true;
  const p = plugins.lista.find((x) => x.id === c.plugin.id);
  return !!p && p.tipo === "filtro";
}

/** Filtro que age so sobre a camada logo abaixo dele (ver Plugin.alcance). */
export function isFiltroDeCamada(c?): boolean {
  if (!isFiltro(c)) return false;
  if (c.plugin.camada) return true;
  const p = plugins.lista.find((x) => x.id === c.plugin.id);
  return !!p && p.alcance === "camada";
}

export function pluginDe(c?): Plugin | null {
  if (!isPlugin(c)) return null;
  return plugins.lista.find((p) => p.id === c.plugin.id) || null;
}

// Os valores que valem: o padrao do manifest, por cima o que o clipe guardou.
// Um parametro novo no manifest aparece nos clipes antigos com o padrao dele.
export function paramsDe(c?, p?: Plugin | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  (p ? p.params : []).forEach((x) => { out[x.id] = x.padrao; });
  return Object.assign(out, (c && c.plugin && c.plugin.params) || {});
}

// O tempo DO PLUGIN: a metade direita de um corte continua de onde a esquerda
// parou (t0), em vez de recomecar a animacao de entrada.
export function tempoDe(c?, at?: number) {
  const t0 = (c.plugin && c.plugin.t0) || 0;
  return { t: t0 + clamp(at - c.start, 0, c.len), dur: t0 + c.len };
}

export function pluginsAt(at: number) {
  return state.clips.filter((c) => isPlugin(c) && !c.off && at >= c.start && at < c.start + c.len);
}

/** Os plugins usados na montagem que nao estao carregados agora. */
export function pluginsFaltando(): string[] {
  const nomes = new Set<string>();
  state.clips.forEach((c) => {
    if (!isPlugin(c) || c.off) return;
    const p = pluginDe(c);
    if (!p || p.erro) nomes.add(c.name || c.plugin.id);
  });
  return [...nomes];
}

// ------------------------------------------------------------ a previa
//
// Um <canvas> por clipe de plugin sob a agulha, numa caixa irma das camadas de
// video (.pl-layer). Cada um leva o numero da pilha (stackZ), como os <img> e
// os textos, e e isso que o poe na frente ou atras deles. O enquadramento do
// clipe (painel Imagem) vai por cima, como transformacao de estilo - a mesma
// conta das fotos, com o centro na area que o plugin desenhou.
//
// O quadro e pedido ao sandbox e chega como ImageBitmap, junto com a area
// desenhada. Uma fila de um lugar por canvas: com a reproducao correndo, o
// pedido novo espera o que esta em curso, e so o mais recente e feito.

interface Fila { inflight: boolean; pending: boolean }
const filas = new WeakMap<HTMLCanvasElement, Fila>();

export function paintPluginLayer(raiz?) {
  const box = screenIn(raiz);
  if (!box) return;
  const layer = box.querySelector(".pl-layer");
  if (!layer) return;
  const med = screenSize(box);
  if (!med.w || !med.h) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(16, Math.min(state.canvas.w, Math.round(med.w * dpr)));
  const h = Math.max(16, Math.round(w * med.h / med.w));

  const lista = pluginsAt(state.pos);
  const tinha = new Map<number, HTMLCanvasElement>();
  layer.querySelectorAll("canvas").forEach((cv: HTMLCanvasElement) => tinha.set(Number(cv.dataset.clip), cv));

  lista.forEach((c) => {
    let cv = tinha.get(c.id);
    tinha.delete(c.id);
    if (!cv) {
      cv = document.createElement("canvas");
      cv.dataset.clip = String(c.id);
      layer.appendChild(cv);
    }
    cv.style.zIndex = String(stackZ(c));
    if (isFiltro(c)) {
      // Filtro: o quadro inteiro, sem enquadramento; refeito a cada pedido,
      // porque o que esta abaixo dele pode ter mudado.
      cv.style.transform = "";
      cv.dataset.w = String(w);
      cv.dataset.h = String(h);
      const p = pluginDe(c);
      if (!p || p.erro) pedeQuadro(c, cv, w, h);   // o aviso vermelho
      else refazFiltros();                         // a cadeia, de baixo para cima
      return;
    }
    applyTransform(cv, c, box);
    pedeQuadro(c, cv, w, h);
  });
  tinha.forEach((cv) => cv.remove());
  // Um filtro de camada que saiu da tela devolve a camada que ele escondia.
  marcaAlvos();
}

function pedeQuadro(c, cv: HTMLCanvasElement, w: number, h: number) {
  const p = pluginDe(c);
  if (!p || p.erro) {
    const key = "erro|" + w + "x" + h + "|" + plugins.geracao;
    if (cv.dataset.key === key) return;
    cv.dataset.key = key;
    guardaCaixa(cv, null);
    avisoNoCanvas(cv, w, h, !p ? "Plugin \"" + (c.name || c.plugin.id) + "\" nao carregado - " +
                                 "Menu > Plugins > Adicionar pasta de plugins"
                               : "Plugin \"" + p.nome + "\": " + p.erro);
    return;
  }

  const { t, dur } = tempoDe(c, state.pos);
  const params = paramsDe(c, p);
  const key = [p.id, plugins.geracao, w, h, p.parado ? "" : t.toFixed(3), dur.toFixed(3),
               JSON.stringify(params)].join("|");
  if (cv.dataset.key === key) return;

  let f = filas.get(cv);
  if (!f) { f = { inflight: false, pending: false }; filas.set(cv, f); }
  if (f.inflight) { f.pending = true; return; }
  f.inflight = true;
  f.pending = false;

  desenhaNoSandbox(p.id, { t, dur, w, h, params }).then((r) => {
    f!.inflight = false;
    cv.dataset.key = key;
    if (r.bmp) {
      if (cv.width !== w) cv.width = w;
      if (cv.height !== h) cv.height = h;
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(r.bmp, 0, 0);
      r.bmp.close();
      guardaCaixa(cv, r.caixa || null);
    } else {
      guardaCaixa(cv, null);
      avisoNoCanvas(cv, w, h, "Plugin \"" + p.nome + "\": " + r.erro);
    }
    // A area desenhada mudou: o centro do giro e a moldura vao com ela.
    const box = screenIn();
    if (box && cv.isConnected) {
      applyTransform(cv, c, box);
      if (c.id === state.pickedClip) pintaMoldura();
    }
    if (f!.pending && cv.isConnected) paintPluginLayer();
    // Um filtro acima deste plugin precisa do desenho novo.
    refazFiltros();
  });
}

// A area desenhada fica no proprio canvas: e dali que o painel Imagem tira o
// centro do giro, a moldura e o alvo do clique (ver caixaDaCamada).
function guardaCaixa(cv: HTMLCanvasElement, q: Caixa | null) {
  const d = cv.dataset;
  if (!q) { delete d.bx; delete d.by; delete d.bw; delete d.bh; return; }
  d.bx = q.x.toFixed(5); d.by = q.y.toFixed(5);
  d.bw = q.w.toFixed(5); d.bh = q.h.toFixed(5);
}

// O erro aparece em cima do quadro, onde quem escreve o plugin esta olhando.
function avisoNoCanvas(cv: HTMLCanvasElement, w: number, h: number, msg: string) {
  if (cv.width !== w) cv.width = w;
  if (cv.height !== h) cv.height = h;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  const tam = Math.max(11, Math.round(h * 0.028));
  ctx.font = "600 " + tam + "px system-ui, sans-serif";
  const larg = Math.min(w - tam, ctx.measureText(msg).width + tam);
  ctx.fillStyle = "rgba(120, 20, 30, .85)";
  ctx.fillRect(tam / 2, tam / 2, larg, tam * 1.8);
  ctx.fillStyle = "#ffd9dd";
  ctx.textBaseline = "middle";
  ctx.fillText(msg, tam, tam * 1.4, larg - tam);
}

// ------------------------------------------------------------ exportacao

export interface PluginExport { id: string; params: Record<string, unknown>; t0: number; dur: number;
                                parado: boolean; filtro: boolean; camada: boolean }

export function pluginParaExportar(c): PluginExport | null {
  const p = pluginDe(c);
  if (!p || p.erro) return null;
  const t0 = (c.plugin && c.plugin.t0) || 0;
  return { id: p.id, params: paramsDe(c, p), t0, dur: t0 + c.len,
           parado: p.parado && p.tipo !== "filtro", filtro: p.tipo === "filtro",
           camada: p.tipo === "filtro" && p.alcance === "camada" };
}

/** Um quadro do plugin na medida da exportacao, com a area que ele desenhou
    (so medida com `medir`). `t`: segundos desde o comeco do clipe. */
export async function quadroParaExportar(d: PluginExport, t: number, w: number, h: number, medir = true,
                                         entrada: ImageBitmap | null = null) {
  const r = await desenhaNoSandbox(d.id, { t: d.t0 + t, dur: d.dur, w, h, params: d.params, medir, entrada });
  return r.bmp ? { bmp: r.bmp, caixa: r.caixa || null } : null;
}
