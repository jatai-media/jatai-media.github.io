// A cesta de midia: o que foi importado e o que ele e. Faz o papel de media.h
// e do `probe` do decoder.h - quem le os cabecalhos agora e o mediabunny, em
// cima do WebCodecs do navegador.

import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny';
import { EXT_AUDIO, EXT_IMAGEM, EXT_VIDEO, type Chegado } from './arquivos';

// O item como a pagina o conhece - os mesmos campos do to_json do C++.
export interface MediaItem {
  id: number;
  name: string;
  path: string;        // a chave do arquivo (arquivos.ts), no lugar do caminho
  ext: string;
  kind: 'video' | 'audio' | 'imagem';
  bytes: number;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  vcodec: string;
  acodec: string;
  error: string;
  hasVoice: boolean;
  hasFundo: boolean;
}

// O item e o que o backend precisa para le-lo.
export interface Entrada {
  item: MediaItem;
  file: File;
  handle?: FileSystemFileHandle;
  input?: Input;
  video?: InputVideoTrack;
  audio?: InputAudioTrack;
  imagem?: ImageBitmap;
}

export function kindOf(ext: string): MediaItem['kind'] {
  if (EXT_VIDEO.includes(ext)) return 'video';
  if (EXT_AUDIO.includes(ext)) return 'audio';
  return 'imagem';
}

function extDe(nome: string): string {
  const i = nome.lastIndexOf('.');
  return i >= 0 ? nome.slice(i + 1).toLowerCase() : '';
}

export function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

class Cesta {
  private entradas: Entrada[] = [];
  private proximo = 0;

  find(id: number): Entrada | undefined {
    return this.entradas.find((e) => e.item.id === id);
  }

  toJson(): MediaItem[] {
    return this.entradas.map((e) => ({ ...e.item }));
  }

  // O mesmo arquivo importado duas vezes e um item so, como no C++ - la a
  // comparacao era pelo caminho; aqui, pela alca ou pela assinatura do File.
  private async jaTem(c: Chegado): Promise<Entrada | undefined> {
    for (const e of this.entradas) {
      if (c.handle && e.handle) {
        if (await c.handle.isSameEntry(e.handle)) return e;
        continue;
      }
      if (e.file.name === c.file.name && e.file.size === c.file.size &&
          e.file.lastModified === c.file.lastModified) return e;
    }
    return undefined;
  }

  async add(key: string, c: Chegado): Promise<number> {
    const igual = await this.jaTem(c);
    if (igual) return igual.item.id;

    const ext = extDe(c.file.name);
    const item: MediaItem = {
      id: ++this.proximo, name: c.file.name, path: key, ext, kind: kindOf(ext),
      bytes: c.file.size, duration: 0, width: 0, height: 0, fps: 0,
      hasVideo: false, hasAudio: false, vcodec: '', acodec: '', error: '',
      hasVoice: false, hasFundo: false,
    };
    const e: Entrada = { item, file: c.file, handle: c.handle };
    await sonda(e);
    this.entradas.push(e);
    return item.id;
  }

  remove(id: number): void {
    const e = this.find(id);
    if (!e) return;
    e.input?.dispose();
    e.imagem?.close();
    this.entradas = this.entradas.filter((x) => x !== e);
  }
}

export const cesta = new Cesta();

// Le os cabecalhos. Imagem vai direto para o decodificador de imagens do
// navegador; o resto passa pelo mediabunny.
async function sonda(e: Entrada): Promise<void> {
  const it = e.item;

  if (EXT_IMAGEM.includes(it.ext)) {
    try {
      const bmp = await createImageBitmap(e.file);
      e.imagem = bmp;
      it.kind = 'imagem';
      it.width = bmp.width;
      it.height = bmp.height;
      it.hasVideo = true;
    } catch (err) {
      it.error = 'o navegador nao abre esta imagem: ' + mensagem(err);
    }
    return;
  }

  const input = new Input({ source: new BlobSource(e.file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video && !audio) throw new Error('nenhuma trilha de video ou audio');

    it.duration = await input.computeDuration();
    const avisos: string[] = [];

    if (video) {
      it.vcodec = (await video.getCodec()) || '';
      it.width = await video.getDisplayWidth();
      it.height = await video.getDisplayHeight();
      if (await video.canDecode()) {
        it.hasVideo = true;
        e.video = video;
        try { it.fps = (await video.computePacketStats(60)).averagePacketRate; } catch { /* sem fps */ }
      } else {
        avisos.push('o navegador nao decodifica o video (' + (it.vcodec || 'codec desconhecido') + ')');
      }
    }
    if (audio) {
      it.acodec = (await audio.getCodec()) || '';
      if (await audio.canDecode()) {
        it.hasAudio = true;
        e.audio = audio;
      } else {
        avisos.push('o navegador nao decodifica o audio (' + (it.acodec || 'codec desconhecido') + ')');
      }
    }

    // Como no C++: a extensao so sugere, quem decide e o que o arquivo tem.
    it.kind = it.hasVideo ? 'video' : 'audio';
    if (!it.hasVideo && !it.hasAudio) it.error = avisos.join('; ');
    e.input = input;
  } catch (err) {
    input.dispose();
    it.error = 'o navegador nao abre este arquivo: ' + mensagem(err);
  }
}
