# Jatai

Suporte à linguagem Jatai (arquivos `.jat`) no VS Code:

- cores para tipos, palavras-chave, strings com interpolação de expressões `{a + 1}`, `{f(x)}`, chars, números e comentários `#`
- destaque de definições e chamadas de função, inclusive funções sem tipo (`fn nome(a, b)`), `print`/`println`/`len`/`range` e `.append`
- strings multilinha com aspas triplas `"""..."""` e interpolação `{{ expressão }}`
- `import`, `extern` e chamadas de biblioteca (`time.now()`)
- indentação automática depois de `if`, `elif`, `else`, `while`, `for` e definições de função
- recuo automático depois de `return`, `break` e `continue`
- dobra de blocos por indentação
- ícone próprio para arquivos `.jat`
