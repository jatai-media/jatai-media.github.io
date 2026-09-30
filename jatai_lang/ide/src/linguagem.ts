// A linguagem Jatai no Monaco: realce, recuo, autocompletar e ajuda.
//
// O realce segue a gramatica da extensao do VS Code (extensao/syntaxes), e o
// recuo o language-configuration.json dela - quem usa as duas coisas ve o
// mesmo codigo do mesmo jeito.

import * as monaco from 'monaco-editor/editor/editor.api';
import { documentacao, type FuncaoDoc } from './fontes';

export const ID = 'jatai';

const TIPOS = ['int', 'double', 'string', 'char', 'bool', 'void'];
const CONTROLE = ['if', 'elif', 'else', 'while', 'for', 'in', 'return', 'break', 'continue'];
const EMBUTIDAS: Record<string, string> = {
  print: 'print(valor)\n\nEscreve sem pular linha.',
  println: 'println(valor)\n\nEscreve e pula linha.',
  len: 'len(x)\n\nTamanho de uma string (em bytes) ou de um array.',
  range: 'range(n) / range(inicio, fim)\n\nOs inteiros de 0 (ou início) até n - 1, para o `for`.',
};

const CABECA_DE_BLOCO =
  /^\s*((if|elif|while|for)\b.*|else\s*|(int|double|string|char|bool|void|fn)(\[\])?\s+[A-Za-z_][A-Za-z0-9_]*\s*\(.*\)\s*)(#.*)?$/;

export function registraJatai(): void {
  monaco.languages.register({ id: ID, extensions: ['.jat'], aliases: ['Jatai', 'jatai'] });

  monaco.languages.setLanguageConfiguration(ID, {
    comments: { lineComment: '#' },
    brackets: [['(', ')'], ['[', ']']],
    autoClosingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"', notIn: ['string', 'comment'] },
      { open: "'", close: "'", notIn: ['string', 'comment'] },
    ],
    surroundingPairs: [{ open: '(', close: ')' }, { open: '[', close: ']' }, { open: '"', close: '"' }],
    wordPattern: /[A-Za-z_][A-Za-z0-9_]*|\d+(\.\d+)?/,
    indentationRules: {
      increaseIndentPattern: CABECA_DE_BLOCO,
      decreaseIndentPattern: /^\s*(elif|else)\b/,
    },
    onEnterRules: [
      { beforeText: CABECA_DE_BLOCO, action: { indentAction: monaco.languages.IndentAction.Indent } },
      { beforeText: /^\s*(return\b.*|break|continue)\s*(#.*)?$/, action: { indentAction: monaco.languages.IndentAction.Outdent } },
    ],
    folding: { offSide: true },
  });

  monaco.languages.setMonarchTokensProvider(ID, {
    tipos: TIPOS,
    controle: CONTROLE,
    tokenizer: {
      root: [
        [/#.*$/, 'comment'],
        [/^(\s*)(import)(\s+)([A-Za-z_]\w*)/, ['', 'keyword', '', 'namespace']],
        [/"""/, { token: 'string', next: '@texto_longo' }],
        [/"/, { token: 'string', next: '@texto' }],
        [/'(?:\\[ntr\\"']|[^'\\])'/, 'string'],
        [/\b\d+\.\d+\b/, 'number.float'],
        [/\b\d+\b/, 'number'],
        [/\b(const|extern|global)\b/, 'keyword.modifier'],
        [/\b(and|or|not)\b/, 'keyword.operator'],
        [/\b(true|false)\b/, 'constant'],
        [/\bfn\b/, 'type'],
        // tipo nome( -> definicao de funcao. O "[]" e `(\[\]|)`, e nao `(\[\])?`:
        // no Monarch um grupo que nao casa quebra o realce da linha inteira.
        [/\b(int|double|string|char|bool|void)(\[\]|)(\s+)([A-Za-z_]\w*)(?=\s*\()/,
          ['type', 'type', '', 'function.definition']],
        [/\b(print|println|len|range)\b(?=\s*\()/, 'function.builtin'],
        [/\b([A-Za-z_]\w*)(\.)([A-Za-z_]\w*)(?=\s*\()/, ['namespace', 'delimiter', 'function']],
        [/\.(append)\b/, 'function'],
        [/[A-Za-z_]\w*(?=\s*\()/, 'function'],
        [/[A-Za-z_]\w*/, { cases: { '@tipos': 'type', '@controle': 'keyword', '@default': 'identifier' } }],
        [/==|!=|<=|>=|<|>|=|[+\-*/%]/, 'operator'],
        [/[()[\],]/, 'delimiter'],
      ],
      texto: [
        [/\\[ntr\\"'{}]/, 'string.escape'],
        [/\\./, 'string.invalid'],
        [/\{(?=[A-Za-z_(])/, { token: 'delimiter.interpolation', next: '@interpolacao' }],
        [/"/, { token: 'string', next: '@pop' }],
        [/[^\\"{]+/, 'string'],
        [/\{/, 'string'],
      ],
      texto_longo: [
        [/\{\{\s*(?=[A-Za-z_(])/, { token: 'delimiter.interpolation', next: '@interpolacao_longa' }],
        [/"""/, { token: 'string', next: '@pop' }],
        [/[^"{]+/, 'string'],
        [/["{]/, 'string'],
      ],
      interpolacao: [
        [/\}/, { token: 'delimiter.interpolation', next: '@pop' }],
        { include: 'root' },
      ],
      interpolacao_longa: [
        [/\s*\}\}/, { token: 'delimiter.interpolation', next: '@pop' }],
        { include: 'root' },
      ],
    },
  } as monaco.languages.IMonarchLanguage);

  // Cores no molde do tema escuro do VS Code
  monaco.editor.defineTheme('jatai-escuro', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'C586C0' },
      { token: 'keyword.modifier', foreground: '569CD6' },
      { token: 'keyword.operator', foreground: 'C586C0' },
      { token: 'type', foreground: '4EC9B0' },
      { token: 'constant', foreground: '569CD6' },
      { token: 'namespace', foreground: '4EC9B0' },
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'function.definition', foreground: 'DCDCAA', fontStyle: 'bold' },
      { token: 'function.builtin', foreground: 'DCDCAA' },
      { token: 'number', foreground: 'B5CEA8' },
      { token: 'number.float', foreground: 'B5CEA8' },
      { token: 'string', foreground: 'CE9178' },
      { token: 'string.escape', foreground: 'D7BA7D' },
      { token: 'string.invalid', foreground: 'F44747' },
      { token: 'delimiter.interpolation', foreground: 'F5B829' },
      { token: 'identifier', foreground: '9CDCFE' },
    ],
    colors: { 'editor.background': '#1E1E1E' },
  });
  monaco.editor.defineTheme('jatai-claro', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'comment', foreground: '008000', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'AF00DB' },
      { token: 'keyword.modifier', foreground: '0000FF' },
      { token: 'type', foreground: '267F99' },
      { token: 'namespace', foreground: '267F99' },
      { token: 'function', foreground: '795E26' },
      { token: 'function.definition', foreground: '795E26', fontStyle: 'bold' },
      { token: 'string', foreground: 'A31515' },
      { token: 'delimiter.interpolation', foreground: 'B8860B' },
      { token: 'identifier', foreground: '001080' },
    ],
    colors: {},
  });

  registraAjudas();
}

// ------------------------------------------------------------ autocompletar e ajuda

function textoDaAjuda(f: FuncaoDoc): monaco.IMarkdownString {
  return { value: '```jatai\n' + `${f.biblioteca}.${f.assinatura}` + '\n```\n' + (f.doc || '') };
}

// "import text" no arquivo -> ["text"]
function importados(modelo: monaco.editor.ITextModel): Set<string> {
  return new Set([...modelo.getValue().matchAll(/^import\s+(\w+)/gm)].map((m) => m[1]));
}

function registraAjudas(): void {
  const docs = documentacao();
  const porBiblioteca = new Map<string, FuncaoDoc[]>();
  for (const d of docs) {
    if (!porBiblioteca.has(d.biblioteca)) porBiblioteca.set(d.biblioteca, []);
    porBiblioteca.get(d.biblioteca)!.push(d);
  }

  monaco.languages.registerCompletionItemProvider(ID, {
    triggerCharacters: ['.'],
    provideCompletionItems(modelo, pos) {
      const palavra = modelo.getWordUntilPosition(pos);
      const faixa = new monaco.Range(pos.lineNumber, palavra.startColumn, pos.lineNumber, palavra.endColumn);
      const antes = modelo.getLineContent(pos.lineNumber).slice(0, palavra.startColumn - 1);
      const K = monaco.languages.CompletionItemKind;

      // depois de "text." so as funcoes da biblioteca
      const qualificada = /([A-Za-z_]\w*)\.$/.exec(antes);
      if (qualificada) {
        const lista = porBiblioteca.get(qualificada[1]) ?? [];
        return {
          suggestions: lista.map((f) => ({
            label: f.nome, kind: K.Function, range: faixa, detail: f.assinatura,
            documentation: textoDaAjuda(f),
            insertText: `${f.nome}(${f.parametros.map((p, i) => '${' + (i + 1) + ':' + p.split(/\s+/).pop() + '}').join(', ')})`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          })),
        };
      }

      // depois de "import " as bibliotecas
      if (/^\s*import\s+$/.test(antes)) {
        return { suggestions: [...porBiblioteca.keys()].map((b) => ({
          label: b, kind: K.Module, range: faixa, insertText: b,
        })) };
      }

      const usadas = importados(modelo);
      const nomes = new Set<string>();
      for (const m of modelo.getValue().matchAll(/\b([A-Za-z_]\w*)\b/g)) nomes.add(m[1]);

      const sugestoes: monaco.languages.CompletionItem[] = [
        ...CONTROLE.map((k) => ({ label: k, kind: K.Keyword, range: faixa, insertText: k })),
        ...['import', 'const', 'global', 'extern', 'fn', 'and', 'or', 'not', 'true', 'false']
          .map((k) => ({ label: k, kind: K.Keyword, range: faixa, insertText: k })),
        ...TIPOS.map((t) => ({ label: t, kind: K.TypeParameter, range: faixa, insertText: t })),
        ...Object.entries(EMBUTIDAS).map(([n, d]) => ({
          label: n, kind: K.Function, range: faixa, insertText: n + '($0)',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: d,
        })),
        ...[...usadas].filter((b) => porBiblioteca.has(b))
          .map((b) => ({ label: b, kind: K.Module, range: faixa, insertText: b })),
        {
          label: 'for in range', kind: K.Snippet, range: faixa,
          insertText: 'for ${1:i} in range(${2:10})\n\t$0',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'laço contado',
        },
        {
          label: 'função', kind: K.Snippet, range: faixa,
          insertText: '${1:int} ${2:nome}(${3:int x})\n\treturn ${0:x}',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: 'função com tipo de retorno',
        },
      ];
      const conhecidos = new Set(sugestoes.map((s) => String(s.label)));
      for (const n of nomes) {
        if (!conhecidos.has(n) && n !== palavra.word)
          sugestoes.push({ label: n, kind: K.Variable, range: faixa, insertText: n });
      }
      return { suggestions: sugestoes };
    },
  });

  monaco.languages.registerHoverProvider(ID, {
    provideHover(modelo, pos) {
      const palavra = modelo.getWordAtPosition(pos);
      if (!palavra) return null;
      const linha = modelo.getLineContent(pos.lineNumber);
      const antes = linha.slice(0, palavra.startColumn - 1);
      const faixa = new monaco.Range(pos.lineNumber, palavra.startColumn, pos.lineNumber, palavra.endColumn);
      const qualificada = /([A-Za-z_]\w*)\.$/.exec(antes);
      if (qualificada) {
        const f = porBiblioteca.get(qualificada[1])?.find((x) => x.nome === palavra.word);
        if (f) return { range: faixa, contents: [textoDaAjuda(f)] };
      }
      if (EMBUTIDAS[palavra.word]) return { range: faixa, contents: [{ value: EMBUTIDAS[palavra.word] }] };
      if (porBiblioteca.has(palavra.word)) {
        const n = porBiblioteca.get(palavra.word)!.length;
        return { range: faixa, contents: [{ value: `**biblioteca ${palavra.word}** — ${n} funções` }] };
      }
      return null;
    },
  });
}
