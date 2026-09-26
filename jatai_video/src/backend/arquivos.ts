// Os arquivos importados, e como reencontra-los amanha.
//
// No C++ um projeto guardava CAMINHOS, e reabrir era importar os caminhos de
// novo. O navegador nao da caminho nenhum a pagina - entrega um File, ou, no
// Chrome e no Edge, uma alca (FileSystemFileHandle) que pode ser guardada e
// reaberta depois com a permissao de quem usa.
//
// Entao cada arquivo importado ganha uma CHAVE, guardada no IndexedDB junto da
// alca. A chave faz o papel do caminho: e ela que vai no projeto, e e por ela
// que `importar` acha o arquivo de novo. Sem alca (Firefox, Safari), o proprio
// File vai para o IndexedDB - funciona igual, mas ocupa espaco do navegador.

import { apaga, grava, le, todos } from './idb';

export const EXT_VIDEO = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'wmv'];
export const EXT_AUDIO = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac', 'opus'];
export const EXT_IMAGEM = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];

const PREFIXO = 'arq:';

export interface Registro {
  key: string;
  name: string;
  size: number;
  lastModified: number;
  handle?: FileSystemFileHandle;
  file?: File;
}

// Um arquivo que chegou agora: o File para ler, e a alca quando houver.
export interface Chegado {
  file: File;
  handle?: FileSystemFileHandle;
}

export function ehChave(s: string): boolean {
  return typeof s === 'string' && s.startsWith(PREFIXO);
}

// Guarda a referencia e devolve a chave nova.
export async function guarda(c: Chegado): Promise<string> {
  const key = PREFIXO + crypto.randomUUID();
  const reg: Registro = {
    key, name: c.file.name, size: c.file.size, lastModified: c.file.lastModified,
  };
  if (c.handle) reg.handle = c.handle;
  else reg.file = c.file;
  await grava('arquivos', reg);
  return key;
}

// Reabre pela chave. A alca pode pedir permissao de novo - o Chrome esquece
// entre sessoes -, e o pedido so vale com um clique recente; abrir um projeto
// e um clique, e e dele que a permissao sai.
export async function reabre(key: string): Promise<Chegado | null> {
  const reg = await le<Registro>('arquivos', key);
  if (!reg) return null;
  if (reg.file) return { file: reg.file };
  if (!reg.handle) return null;

  const h = reg.handle;
  try {
    let p = h.queryPermission ? await h.queryPermission({ mode: 'read' }) : 'granted';
    if (p === 'prompt' && h.requestPermission) p = await h.requestPermission({ mode: 'read' });
    if (p !== 'granted') return null;
    return { file: await h.getFile(), handle: h };
  } catch {
    // O arquivo saiu do lugar, ou a permissao foi negada.
    return null;
  }
}

// Apaga as referencias que nenhum projeto usa mais. So pesa de verdade quando
// o File foi copiado para dentro do navegador.
export async function limpa(emUso: Set<string>): Promise<void> {
  const regs = await todos<Registro>('arquivos');
  await Promise.all(regs.filter((r) => !emUso.has(r.key)).map((r) => apaga('arquivos', r.key)));
}

// ---------------------------------------------------------------- escolher

const TIPOS: FilePickerAcceptType[] = [{
  description: 'Video, audio e imagem',
  accept: {
    'video/*': EXT_VIDEO.map((e) => '.' + e),
    'audio/*': EXT_AUDIO.map((e) => '.' + e),
    'image/*': EXT_IMAGEM.map((e) => '.' + e),
  },
}];

// O dialogo do sistema. Vazio e desistencia.
export async function escolhe(): Promise<Chegado[]> {
  if (window.showOpenFilePicker) {
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: TIPOS, id: 'jatai-midia' });
      return Promise.all(hs.map(async (h) => ({ file: await h.getFile(), handle: h })));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return [];
      throw e;
    }
  }

  return new Promise((ok) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'video/*,audio/*,image/*';
    inp.addEventListener('change', () => ok([...(inp.files || [])].map((file) => ({ file }))));
    inp.addEventListener('cancel', () => ok([]));
    inp.click();
  });
}

// ---------------------------------------------------------------- arrastar

// Largar arquivos na janela. O alvo e a janela inteira, como era no C++.
export function ligaArrasto(aviso: (on: boolean) => void, chegou: (c: Chegado[]) => void): void {
  let dentro = 0;
  const temArquivo = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();
    if (dentro++ === 0) aviso(true);
  });
  window.addEventListener('dragover', (e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!temArquivo(e)) return;
    if (--dentro <= 0) { dentro = 0; aviso(false); }
  });
  window.addEventListener('drop', async (e) => {
    if (!temArquivo(e)) return;
    e.preventDefault();
    dentro = 0;
    aviso(false);

    // As alcas precisam ser pedidas ainda dentro do evento: depois do primeiro
    // await a lista de itens ja foi esvaziada pelo navegador.
    const itens = [...e.dataTransfer!.items].filter((i) => i.kind === 'file');
    const pedidos = itens.map((i) => ({
      alca: i.getAsFileSystemHandle ? i.getAsFileSystemHandle() : Promise.resolve(null),
      file: i.getAsFile(),
    }));

    const out: Chegado[] = [];
    for (const p of pedidos) {
      const h = await p.alca.catch(() => null);
      if (h && h.kind === 'file') {
        const fh = h as FileSystemFileHandle;
        out.push({ file: await fh.getFile(), handle: fh });
      } else if (p.file) {
        out.push({ file: p.file });
      }
    }
    chegou(out);
  });
}
