// A interface veio de JavaScript, onde `querySelector("#x").value` e
// `getElementById("x").disabled` nao pedem licenca a ninguem. Enquanto ela nao
// ganha tipos de verdade, estas duas buscas devolvem `any` - so dentro deste
// projeto, que tem tsconfig proprio.

interface ParentNode {
  querySelector(selectors: string): any;
}

interface Document {
  getElementById(elementId: string): any;
}

// Os avisos que o backend manda para a pagina, como o C++ mandava.
interface Window {
  jtDrag?: (on: boolean) => void;
  jtImported?: (added: number) => void | Promise<void>;
  jtExportProgresso?: (feito: number, total: number) => void;
  jtFundoProgresso?: (feito: number, total: number) => void;
  jtFechar?: () => void | Promise<void>;
}

// O alvo de um evento, no JavaScript, e quase sempre um elemento - e a
// interface o trata assim (`e.target.closest(...)`).
interface EventTarget {
  closest(selectors: string): any;
  dataset: DOMStringMap;
}

interface Element {
  dataset: DOMStringMap;
  isContentEditable: boolean;
}
