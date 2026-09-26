// menu.ts - o Menu da barra de cima.
//
// A barra tinha seis botoes: Importar, Trabalhos, Salvar, Paineis, Atalhos e
// Restaurar layout. Seis controles permanentes para gestos que acontecem uma
// vez por sessao - enquanto o nome do trabalho, que se olha o tempo todo,
// disputava espaco com eles.
//
// Agora ha um Menu so, com o resto organizado por assunto. O que sobrou na
// barra e o que se OLHA (o nome do trabalho, o relogio), e nao o que se
// aperta de vez em quando.
//
// Importar saiu daqui sem perda: a aba Midia sempre teve o proprio botao, e e
// la que a pessoa esta quando quer importar.

// O atalho de um comando, escrito como se le. Sai da lista de atalhos, e nao
// de um texto digitado aqui: quem troca a tecla no painel de Atalhos ve o
// menu mudar junto.
import { $, api, openMenu, closeMenu, showMenuSob, undo, redo } from "./core";
import { abreExportar } from "./exportar";
import { PANELS, layout } from "./panels";
import { openIds, closeTab, openTab } from "./dock-tree";
import { doImport } from "./panel-media";
import { voltaAoInicio } from "./tela-inicial";
import { SHORTCUTS, keyLabel, openKeys } from "./atalhos";
import { resetLayout } from "./prefs";

export function teclaDe(id?) {
  const a = SHORTCUTS.find((s) => s.id === id);
  return a ? keyLabel(a.tecla) : "";
}

// Um comando do menu que ja existe como atalho. Evita escrever duas vezes o
// que ele faz - e, sobretudo, evita que as duas versoes se afastem.
export function doAtalho(id?, rotulo?) {
  const a = SHORTCUTS.find((s) => s.id === id);
  return { label: rotulo || (a ? a.nome : id), tecla: teclaDe(id),
           action: () => { if (a) a.faz(); } };
}

export function menuPrincipal() {
  const abertos = new Set(openIds());

  return [
    { label: "Arquivo", sub: [
      { label: "Importar midia...", action: doImport },
      doAtalho("salvar", "Salvar o trabalho"),
      { sep: true },
      { label: "Exportar video...", action: abreExportar },
      { sep: true },
      { label: "Voltar aos trabalhos", action: voltaAoInicio },
      { label: "Sair", action: () => api.sair() },
    ] },

    { label: "Editar", sub: [
      doAtalho("undo", "Desfazer"),
      doAtalho("redo", "Refazer"),
      { sep: true },
      doAtalho("copy", "Copiar"),
      doAtalho("paste", "Colar"),
      doAtalho("split", "Dividir no cursor"),
      doAtalho("erase", "Excluir o escolhido"),
    ] },

    // Os paineis entram como estao: com o tique na frente de quem esta
    // aberto, do mesmo jeito que o menu antigo os mostrava.
    { label: "Layout", sub: Object.keys(PANELS).map((id): any => ({
        label: PANELS[id].title,
        marcado: abertos.has(id),
        action: () => { if (abertos.has(id)) closeTab(id); else openTab(id); },
      })).concat([
        { sep: true },
        { label: "Restaurar layout", action: resetLayout },
      ]) },

    { label: "Ajuda", sub: [
      { label: "Atalhos do teclado", action: () => openKeys($("btnMenu")) },
    ] },
  ];
}

export function abreMenuPrincipal(e?) {
  e.stopPropagation();
  // Clicar de novo no proprio botao fecha, como todo menu de barra.
  if (openMenu) { closeMenu(); return; }
  showMenuSob($("btnMenu"), menuPrincipal());
}
