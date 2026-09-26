// dialogo.ts - perguntar de verdade, com as palavras certas nos botoes.
//
// O confirm() do navegador tem dois botoes, e eles se chamam OK e Cancelar.
// Nao serve para a pergunta que mais importa aqui - sair de um trabalho com
// coisa por gravar - porque ali sao TRES saidas, e nenhuma delas se chama OK:
// salvar, descartar, ou voltar atras. "OK" para uma pergunta dessas e o jeito
// mais rapido de alguem apagar a propria tarde sem perceber.
//
// Alem disso o confirm() abre uma janela do navegador dentro de um programa
// que nao quer parecer um navegador: fonte diferente, botoes diferentes, e o
// nome do arquivo HTML no titulo.
//
// Uso:
//     const r = await pergunta("Sair do trabalho?", "O que fazer com...", [
//       { id: "salvar", texto: "Salvar", tipo: "primary" },
//       { id: "descartar", texto: "Descartar" },
//       { id: "cancelar", texto: "Cancelar", tipo: "ghost", escape: true },
//     ]);
//
// Devolve o `id` do botao escolhido. Esc e o clique fora escolhem o botao
// marcado com `escape` - que e sempre o que NAO faz nada.

// A mesma pergunta, com uma caixa de texto. Devolve o que foi escrito, ou
// null se a pessoa desistiu - que nao e o mesmo que texto vazio.
//
// Existe por causa do "Novo trabalho": pedir o nome numa caixa que fica na
// tela o tempo todo e ocupar espaco permanente com um gesto que acontece uma
// vez. Perguntar na hora do clique e perguntar quando importa.

export function perguntaTexto(titulo?, texto?, ajustes?) {
  const a = ajustes || {};
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.className = "dlg-fundo";
    fundo.innerHTML =
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-titulo"></div>' +
        '<div class="dlg-texto"></div>' +
        '<input type="text" class="dlg-campo" maxlength="60">' +
        '<div class="dlg-botoes">' +
          '<button class="btn primary dlg-ok"></button>' +
          '<button class="btn ghost dlg-nao">Cancelar</button>' +
        '</div>' +
      '</div>';

    fundo.querySelector(".dlg-titulo").textContent = titulo;
    fundo.querySelector(".dlg-texto").textContent = texto || "";
    fundo.querySelector(".dlg-ok").textContent = a.botao || "Criar";

    const campo = fundo.querySelector(".dlg-campo");
    campo.value = a.valor || "";
    campo.placeholder = a.placeholder || "";

    let fechado = false;
    const fecha = (v) => {
      if (fechado) return;
      fechado = true;
      fundo.remove();
      resolve(v);
    };

    fundo.querySelector(".dlg-ok").addEventListener("click",
        () => fecha(campo.value.trim()));
    fundo.querySelector(".dlg-nao").addEventListener("click", () => fecha(null));
    fundo.addEventListener("mousedown", (e) => { if (e.target === fundo) fecha(null); });

    // O teclado e da pergunta enquanto ela esta na tela. Enter confirma, Esc
    // desiste - e o keydown do editor nao ve nenhum dos dois.
    campo.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); fecha(campo.value.trim()); }
      else if (e.key === "Escape") { e.preventDefault(); fecha(null); }
    });

    document.body.appendChild(fundo);
    campo.focus();
    // Ja escrito e ja selecionado: quem gostou do nome aperta Enter, quem nao
    // gostou digita por cima sem precisar apagar.
    campo.select();
  });
}

export function pergunta(titulo?, texto?, botoes?) {
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.className = "dlg-fundo";
    fundo.innerHTML =
      '<div class="dlg" role="dialog" aria-modal="true">' +
        '<div class="dlg-titulo"></div>' +
        '<div class="dlg-texto"></div>' +
        '<div class="dlg-botoes"></div>' +
      '</div>';

    // Titulo e texto por textContent: sao nomes de trabalho, e nome de
    // trabalho e o que a pessoa digitou.
    fundo.querySelector(".dlg-titulo").textContent = titulo;
    fundo.querySelector(".dlg-texto").textContent = texto || "";

    const saida = fundo.querySelector(".dlg-botoes");
    const fugir = (botoes.find((b) => b.escape) || botoes[botoes.length - 1]).id;

    let fechado = false;
    const fecha = (id) => {
      if (fechado) return;
      fechado = true;
      document.removeEventListener("keydown", tecla, true);
      fundo.remove();
      resolve(id);
    };

    botoes.forEach((b) => {
      const el = document.createElement("button");
      el.className = "btn" + (b.tipo ? " " + b.tipo : "");
      el.textContent = b.texto;
      el.addEventListener("click", () => fecha(b.id));
      saida.appendChild(el);
    });

    // O teclado antes de todo mundo: enquanto a pergunta esta na tela, Esc e
    // Enter sao dela, e nao dos atalhos do editor.
    const tecla = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fecha(fugir); }
      else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        fecha((botoes.find((b) => b.tipo === "primary") || botoes[0]).id);
      }
    };
    document.addEventListener("keydown", tecla, true);

    // Clicar fora e desistir - nunca confirmar.
    fundo.addEventListener("mousedown", (e) => {
      if (e.target === fundo) fecha(fugir);
    });

    document.body.appendChild(fundo);
    const primeiro = saida.querySelector(".primary") || saida.firstChild;
    if (primeiro) primeiro.focus();
  });
}
