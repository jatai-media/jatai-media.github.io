// As mensagens entre a pagina e o worker que roda a VM do Jatai.

/** Os arquivos do programa: caminho relativo ("main.jat", "library/util/util.jat") -> texto. */
export type Arquivos = Record<string, string>;

export type PedidoRodar = {
  tipo: 'rodar';
  arquivos: Arquivos;
  /** o arquivo a rodar, um dos de `arquivos` */
  principal: string;
  /** so verificar (jatai -check): sintaxe e tipos, sem executar */
  verificar: boolean;
  /** o que ja esta escrito no painel Entrada */
  entrada: string;
  /** controle da entrada interativa e da fala; so existe com a pagina isolada */
  controle: SharedArrayBuffer | null;
  /** as vozes do navegador, para a biblioteca voz */
  vozes: string[];
};

export type MensagemWorker =
  | { tipo: 'saida'; fd: 1 | 2; texto: string }
  /** o programa parou esperando uma linha (io.input, io.read_line...) */
  | { tipo: 'pede-entrada' }
  | { tipo: 'fala'; texto: string; voz: string; velocidade: number; volume: number; esperar: boolean }
  | { tipo: 'cala' }
  /** os arquivos que o programa criou, mudou (texto) ou apagou (null) com a biblioteca file */
  | { tipo: 'fim'; codigo: number; alterados: Record<string, string | null> };

// A memoria compartilhada da entrada interativa e da fala (Int32 nas 4 primeiras
// posicoes, o texto da linha depois):
//   [0] estado da entrada: 0 nada, 1 o programa esperando, 2 linha pronta, 3 fim da entrada
//   [1] tamanho da linha, em bytes
//   [2] fala: 1 falando, 0 terminou
export const CTRL_ESTADO = 0, CTRL_TAMANHO = 1, CTRL_FALA = 2;
export const ENTRADA_ESPERANDO = 1, ENTRADA_PRONTA = 2, ENTRADA_FIM = 3;
export const CTRL_BYTES = 16;
export const LINHA_MAX = 64 * 1024;
