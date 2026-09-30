// canal.ts - a conversa entre a guia do editor de scripts e a do editor de video
//
// O script e escrito numa guia propria (script.html), mas roda na guia do
// editor de video: e la que esta a linha do tempo. As duas conversam por um
// BroadcastChannel (mesma origem, qualquer guia):
//
//   script -> video   { t: "quem" }                         quem esta com um trabalho aberto?
//   video  -> script  { t: "aqui", guia, projeto }           resposta (e tambem ao abrir/fechar trabalho)
//   video  -> script  { t: "saiu", guia }                    a guia fechou ou o trabalho foi fechado
//   script -> video   { t: "rodar", guia, pedido, fonte, nome, script }
//   video  -> script  { t: "fim", guia, pedido, resultado }
//   script -> video   { t: "limpar", guia, pedido, nome, script }   tira do video o que o script fez
//   video  -> script  { t: "limpo", guia, pedido, clipes }
//
// `script` e o id do script na lista: rodar de novo o mesmo script substitui o
// que ele tinha feito da outra vez (ver limpaDono em editor-lib.ts).
//
// Com duas guias do editor de video abertas, o pedido leva o id da guia que deve
// rodar: um script nao pode mexer em dois trabalhos ao mesmo tempo.

import type { Resultado } from "./jatai";

export const NOME_CANAL = "jatai-scripts";

export type Mensagem =
  | { t: "quem" }
  | { t: "aqui"; guia: string; projeto: string }
  | { t: "saiu"; guia: string }
  | { t: "rodar"; guia: string; pedido: string; fonte: string; nome: string; script: string }
  | { t: "fim"; guia: string; pedido: string; resultado: Resultado }
  | { t: "limpar"; guia: string; pedido: string; nome: string; script: string }
  | { t: "limpo"; guia: string; pedido: string; clipes: number };

export function abreCanal(ouve: (m: Mensagem) => void): BroadcastChannel {
  const c = new BroadcastChannel(NOME_CANAL);
  c.onmessage = (e) => ouve(e.data as Mensagem);
  return c;
}
