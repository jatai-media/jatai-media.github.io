// sandbox.ts - onde o codigo dos plugins roda.
//
// Um plugin e codigo de outra pessoa. Rodando direto na pagina, ele leria os
// projetos, as alcas de arquivo guardadas no IndexedDB e tudo o mais que o
// editor enxerga. Por isso ele roda num <iframe sandbox="allow-scripts">: sem
// allow-same-origin a origem do iframe e opaca - nada de IndexedDB, de
// localStorage, de acesso a esta pagina - e a politica de conteudo la dentro
// fecha a rede (connect-src 'none'). O plugin recebe so os parametros dele e
// devolve a imagem pronta; nao ha mais nada que ele consiga pedir.
//
// O contrato do plugin (plugin.js, um modulo ES):
//
//   export default {
//     async init(api) { ... },            // opcional: carrega imagens e fontes
//     render(ctx, info) { ... },          // desenha UM quadro
//   }
//
//   api.imagem("logo.png")                 -> ImageBitmap de um arquivo da pasta
//   api.fonte("Titulo.ttf", "Titulo")      -> registra a fonte com esse nome
//   info = { t, dur, progresso, w, h, params, dados }
//     t: segundos desde o comeco do clipe; dur: duracao do clipe
//     w, h: tamanho do quadro em pixels (varia entre previa e exportacao:
//           desenhe sempre em proporcao de w e h)
//     params: os valores do painel; dados: o que init devolveu
//   render pode devolver { x, y, w, h } (pixels): a area que desenhou. Sem isso
//   a area e medida pelos pixels nao transparentes. E em torno do centro dela
//   que o painel Imagem gira e amplia o plugin, e e ela que a moldura abraca.
//
// A mesma funcao desenha a previa e a exportacao - e isso que garante que o
// que se ve e o que sai no arquivo.
//
// FILTROS ("tipo": "filtro" no manifest): o render recebe tambem
// info.entrada, um ImageBitmap com tudo o que esta ABAIXO do filtro na pilha, e
// desenha no ctx a imagem ja filtrada. Para efeitos por pixel ha
// api.shader(glsl): um shader de fragmento WebGL2, compilado uma vez no init,
// que roda na placa de video - `sh.aplica(entrada, { forca: 0.5 })` devolve um
// canvas pronto para ctx.drawImage.

const RUNNER = `
const plugins = new Map();

// A area desenhada, em fracao do quadro: o retangulo dos pixels que nao sao
// transparentes. Linha a linha de cima e de baixo, e so depois as colunas entre
// elas - numa tarja, quase todo o quadro e vazio e sai rapido.
function mede(ctx, w, h) {
  const px = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer);
  const vazia = (y) => { for (let x = 0, i = y * w; x < w; x++, i++) if (px[i] >>> 24 > 8) return false; return true; };
  let y0 = 0; while (y0 < h && vazia(y0)) y0++;
  if (y0 >= h) return null;
  let y1 = h - 1; while (y1 > y0 && vazia(y1)) y1--;
  let x0 = w, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const i = y * w;
    for (let x = 0; x < x0; x++) if (px[i + x] >>> 24 > 8) { x0 = x; break; }
    for (let x = w - 1; x > x1; x--) if (px[i + x] >>> 24 > 8) { x1 = x; break; }
  }
  return { x: x0 / w, y: y0 / h, w: (x1 - x0 + 1) / w, h: (y1 - y0 + 1) / h };
}
// ---- api.shader: um shader de fragmento sobre a imagem de entrada (WebGL2)
//
// Quem escreve o plugin escreve so os uniforms dele e o main(). Sem #version, o
// cabecalho vem daqui: entrada (a imagem), tamanho (pixels), uv (0..1, com o
// 0,0 no canto de CIMA a esquerda, como no canvas) e a saida cor.
// (a quebra de linha vai por codigo: um escape aqui dentro passaria pelo
// template do TypeScript e viraria uma quebra de verdade no meio da string)
const NL = String.fromCharCode(10);
const CABECALHO = ["#version 300 es", "precision highp float;", "uniform sampler2D entrada;",
                   "uniform vec2 tamanho;", "in vec2 uv;", "out vec4 cor;", ""].join(NL);
const VERTICE = ["#version 300 es", "in vec2 p;", "out vec2 uv;",
                 "void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }"].join(NL);

function hexParaRgb(s) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(s));
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

function criaShader(fonte) {
  const tela = new OffscreenCanvas(2, 2);
  const gl = tela.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error("este navegador nao tem WebGL2 para api.shader");
  const compila = (tipo, src) => {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("erro no shader: " + gl.getShaderInfoLog(s));
    return s;
  };
  const src = fonte.trimStart().startsWith("#version") ? fonte : CABECALHO + fonte;
  const prog = gl.createProgram();
  gl.attachShader(prog, compila(gl.VERTEX_SHADER, VERTICE));
  gl.attachShader(prog, compila(gl.FRAGMENT_SHADER, src));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error("erro no shader: " + gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Os uniforms que o shader declara, com o tipo: e pelo tipo que um valor do
  // painel vira float, vec2, vec3 (uma cor "#rrggbb" vira vec3) ou int.
  //
  // Uma LISTA (uniform vec3 cores[8]) aparece como "cores[0]", com o tamanho
  // dela: fica guardada pelo nome sem o [0], e recebe uma lista de valores -
  // cores "#rrggbb", numeros ou listas de numeros. O que faltar fica zero.
  const uniforms = new Map();
  for (let i = 0, n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const u = gl.getActiveUniform(prog, i);
    const nome = u.name.endsWith("[0]") ? u.name.slice(0, -3) : u.name;
    uniforms.set(nome, { tipo: u.type, tam: u.size, loc: gl.getUniformLocation(prog, u.name) });
  }
  const COMPONENTES = new Map([[gl.FLOAT, 1], [gl.FLOAT_VEC2, 2], [gl.FLOAT_VEC3, 3], [gl.FLOAT_VEC4, 4],
                               [gl.INT, 1], [gl.BOOL, 1]]);
  const poeLista = (u, v) => {
    const comp = COMPONENTES.get(u.tipo);
    if (!comp) return;
    const dados = new Float32Array(u.tam * comp);
    (Array.isArray(v) ? v : [v]).slice(0, u.tam).forEach((x, i) => {
      if (typeof x === "boolean") x = x ? 1 : 0;
      if (typeof x === "string") x = hexParaRgb(x);
      const a = Array.isArray(x) ? x : [x];
      for (let k = 0; k < comp; k++) dados[i * comp + k] = Number(a[k] ?? a[0]) || 0;
    });
    switch (u.tipo) {
      case gl.FLOAT: gl.uniform1fv(u.loc, dados); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, dados); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, dados); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, dados); break;
      case gl.INT: case gl.BOOL: gl.uniform1iv(u.loc, Int32Array.from(dados, Math.round)); break;
    }
  };
  const poe = (nome, v) => {
    const u = uniforms.get(nome);
    if (!u || v === undefined || v === null) return;
    if (u.tam > 1) { poeLista(u, v); return; }
    if (typeof v === "boolean") v = v ? 1 : 0;
    if (typeof v === "string") v = hexParaRgb(v);
    const a = Array.isArray(v) ? v.map(Number) : [Number(v)];
    switch (u.tipo) {
      case gl.FLOAT: gl.uniform1f(u.loc, a[0]); break;
      case gl.FLOAT_VEC2: gl.uniform2f(u.loc, a[0], a[1] ?? a[0]); break;
      case gl.FLOAT_VEC3: gl.uniform3f(u.loc, a[0], a[1] ?? a[0], a[2] ?? a[0]); break;
      case gl.FLOAT_VEC4: gl.uniform4f(u.loc, a[0], a[1] ?? a[0], a[2] ?? a[0], a[3] ?? 1); break;
      case gl.INT: case gl.BOOL: gl.uniform1i(u.loc, Math.round(a[0])); break;
    }
  };

  return {
    aplica(entrada, valores) {
      const w = entrada.width, h = entrada.height;
      if (tela.width !== w) tela.width = w;
      if (tela.height !== h) tela.height = h;
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      // A primeira linha da textura e a de cima da imagem, e o uv do vertice
      // ja conta de cima (o Chrome ignora UNPACK_FLIP_Y para ImageBitmap).
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entrada);
      const e = uniforms.get("entrada");
      if (e) gl.uniform1i(e.loc, 0);
      poe("tamanho", [w, h]);
      for (const k of Object.keys(valores || {})) poe(k, valores[k]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return tela;
    },
  };
}

const responde = (m, extra, transfer) =>
  parent.postMessage(Object.assign({ pedido: m.pedido }, extra), "*", transfer || []);

async function importa(codigo) {
  // blob: e o caminho normal; data: fica de reserva para navegadores que nao
  // aceitam blob: dentro de uma origem opaca.
  const url = URL.createObjectURL(new Blob([codigo], { type: "text/javascript" }));
  try { return await import(url); }
  catch (e) {
    try { return await import("data:text/javascript;charset=utf-8," + encodeURIComponent(codigo)); }
    catch { throw e; }
  }
  finally { URL.revokeObjectURL(url); }
}

addEventListener("message", async (ev) => {
  const m = ev.data || {};
  try {
    if (m.tipo === "carrega") {
      const mod = await importa(m.codigo);
      const p = mod.default || mod;
      const render = p.render || mod.render;
      if (typeof render !== "function")
        throw new Error("plugin.js nao exporta render(ctx, info)");
      const arquivos = m.arquivos || {};
      const acha = (nome) => {
        const b = arquivos[nome];
        if (!b) throw new Error("arquivo nao encontrado na pasta do plugin: " + nome);
        return b;
      };
      const api = {
        imagem: async (nome) => createImageBitmap(acha(nome)),
        shader: (glsl) => criaShader(String(glsl)),
        fonte: async (nome, familia) => {
          const f = new FontFace(familia, await acha(nome).arrayBuffer());
          await f.load();
          document.fonts.add(f);
          return familia;
        },
      };
      const init = p.init || mod.init;
      const dados = init ? await init.call(p, api) : undefined;
      plugins.set(m.id, { p, render, dados });
      responde(m, { ok: true });
    } else if (m.tipo === "desenha") {
      const pl = plugins.get(m.id);
      if (!pl) throw new Error("plugin nao carregado");
      const tela = new OffscreenCanvas(m.w, m.h);
      const ctx = tela.getContext("2d");
      const dur = m.dur > 0 ? m.dur : 1;
      let disse;
      try {
        disse = await pl.render.call(pl.p, ctx, { t: m.t, dur, progresso: Math.min(1, Math.max(0, m.t / dur)),
                                     w: m.w, h: m.h, params: m.params || {}, dados: pl.dados,
                                     entrada: m.entrada || null });
      } finally {
        if (m.entrada) m.entrada.close();
      }
      const caixa = disse && [disse.x, disse.y, disse.w, disse.h].every((v) => typeof v === "number") && disse.w > 0 && disse.h > 0
        ? { x: disse.x / m.w, y: disse.y / m.h, w: disse.w / m.w, h: disse.h / m.h }
        : m.medir === false ? null : mede(ctx, m.w, m.h);
      const bmp = tela.transferToImageBitmap();
      responde(m, { ok: true, bmp, caixa }, [bmp]);
    } else if (m.tipo === "descarta") {
      plugins.clear();
      responde(m, { ok: true });
    }
  } catch (e) {
    responde(m, { ok: false, erro: String((e && e.message) || e) });
  }
});
parent.postMessage({ pronto: true }, "*");
`;

const CSP = "default-src 'none'; script-src 'unsafe-inline' blob: data:; " +
            "img-src blob: data:; font-src blob: data:; style-src 'unsafe-inline'";

let quadro: HTMLIFrameElement | null = null;
let pronto: Promise<void> | null = null;
let pedidos = 0;
const esperando = new Map<number, (r: any) => void>();

function abre(): Promise<void> {
  if (pronto) return pronto;
  pronto = new Promise((ok) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.style.cssText = "position:fixed;width:0;height:0;border:0;left:-10px;top:-10px;visibility:hidden";
    f.srcdoc = '<!doctype html><meta charset="utf-8">' +
               '<meta http-equiv="Content-Security-Policy" content="' + CSP + '">' +
               "<script>" + RUNNER + "<\/script>";

    const ouve = (ev: MessageEvent) => {
      if (ev.source !== f.contentWindow) return;
      const m = ev.data || {};
      if (m.pronto) { ok(); return; }
      const volta = esperando.get(m.pedido);
      if (volta) { esperando.delete(m.pedido); volta(m); }
    };
    window.addEventListener("message", ouve);
    document.body.appendChild(f);
    quadro = f;
  });
  return pronto;
}

async function pede(msg: any, transfer: Transferable[] = []): Promise<any> {
  await abre();
  const pedido = ++pedidos;
  return new Promise((ok) => {
    esperando.set(pedido, ok);
    quadro!.contentWindow!.postMessage(Object.assign({ pedido }, msg), "*", transfer);
  });
}

/** Carrega (ou recarrega) um plugin. `arquivos`: os outros arquivos da pasta dele. */
export async function carregaNoSandbox(id: string, codigo: string,
                                       arquivos: Record<string, Blob>): Promise<string> {
  const r = await pede({ tipo: "carrega", id, codigo, arquivos });
  return r.ok ? "" : (r.erro || "o plugin nao carregou");
}

/** Esquece todos os plugins carregados (antes de recarregar a pasta). */
export async function limpaSandbox(): Promise<void> {
  if (!pronto) return;
  await pede({ tipo: "descarta" });
}

/** A area desenhada, em fracao do quadro (0 a 1). */
export interface Caixa { x: number; y: number; w: number; h: number }

export interface PedidoQuadro {
  t: number; dur: number; w: number; h: number; params: Record<string, unknown>;
  medir?: boolean;   // false: nao medir a area desenhada (poupa ler o quadro de volta)
  entrada?: ImageBitmap | null;   // filtros: o que esta abaixo (vai transferido)
}

/** Um quadro do plugin, do tamanho pedido. Quem recebe fecha o ImageBitmap. */
export async function desenhaNoSandbox(id: string, q: PedidoQuadro):
    Promise<{ bmp?: ImageBitmap; caixa?: Caixa | null; erro?: string }> {
  const w = Math.max(1, Math.round(q.w)), h = Math.max(1, Math.round(q.h));
  const r = await pede({ tipo: "desenha", id, t: q.t, dur: q.dur, w, h, params: q.params,
                        medir: q.medir !== false, entrada: q.entrada || null },
                      q.entrada ? [q.entrada] : []);
  return r.ok ? { bmp: r.bmp, caixa: r.caixa || null } : { erro: r.erro || "o plugin falhou ao desenhar" };
}
