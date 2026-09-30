// ids.ts - os nomes pelos quais um script Jatai chama os elementos do editor
//
// O id e do CLIPE (`jid`), e nao do arquivo: a mesma foto colocada duas vezes
// na linha do tempo sao dois elementos, e cada um pode ter o seu id ("gato",
// "gato2") e a sua animacao. Da-se pelo botao direito no clipe, na linha do
// tempo. O script so mexe no que ja esta na linha do tempo: quem coloca os
// elementos e a pessoa.
//
// Um clipe dividido (tesoura) continua com o id nas duas metades - e a mesma
// cena -, e o script usa a metade que esta no instante do relogio dele. Um
// clipe colado nasce sem id.

import { state } from "../ui/core";

// O id de um clipe ("" se nao tem).
export function idDoClipe(c?): string {
  return (c && c.jid) || "";
}

// "" se `id` pode ser dado ao clipe `clipe`; senao, o motivo.
export function problemaDoId(id: string, clipe?: number): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id))
    return "Id invalido: use letras, numeros e _, comecando por letra.";
  const c = state.clips.find((x) => x.id !== clipe && x.jid === id);
  if (c) return `O id "${id}" ja e do clipe "${c.name}".`;
  return "";
}

// Projetos de antes guardavam o id no arquivo da cesta (midias[].jid). Ele
// passa para os clipes daquele arquivo - todos, que era como o script os via
// (valia o que estivesse no instante do relogio). Dali em diante cada um pode
// ganhar um id proprio.
export function migraIdsDeMidia(idPorMidia: Map<number, string>) {
  if (!idPorMidia.size) return;
  for (const c of state.clips)
    if (!c.jid && idPorMidia.has(c.media)) c.jid = idPorMidia.get(c.media);
}
