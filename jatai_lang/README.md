# Jatai

Linguagem de programação com tipagem estática, sintaxe por indentação e textos em
português nas mensagens de erro. O mesmo programa roda interpretado (bytecode) ou vira um
executável nativo (é transpilado para C++20).

```
import text

string nome = "mundo"
println("Olá, {nome}!")

int quadrado(int x)
    return x * x

for i in range(1, 6)
    println("{i} ao quadrado = {quadrado(i)}")
```

- **Usar no navegador, sem instalar nada:** https://jatai-media.github.io/jatai_lang/
- **Baixar para Windows:** [jatai-windows-x64.zip](https://github.com/jatai-media/jatai-media.github.io/releases/latest/download/jatai-windows-x64.zip)
  (jatai.exe, bibliotecas, o compilador do `-build` e a extensão do VS Code)

## Linha de comando

```
jatai programa.jat               roda
jatai programa.jat -check        só verifica (sintaxe e tipos)
jatai programa.jat -build        gera build/programa/programa.exe
jatai programa.jat -build -cpp   idem, mantendo o .cpp gerado
jatai -lib library/nome          compila a biblioteca nativa de uma biblioteca
```

## Pastas

```
main.c, src/     a linguagem: lexer, parser, tipos, bytecode, VM, gerador de C++
src/web.h        a VM no navegador (WebAssembly): as funções extern viram JavaScript
library/         as bibliotecas padrão (ver library/README.md para criar a sua)
exemplos/        programas de exemplo
testes/          testes de regressão: cada .jat com a saída .esperado
extensao/        extensão do VS Code (realce e recuo)
ide/             a plataforma web: editor no molde do VS Code que roda Jatai no navegador
```

## Compilar

```
gcc -std=c11 -O2 -o jatai main.c -l:libffi.a
```

O `-build` usa o GCC portátil de `src/toolchain` quando ele existe ao lado do `jatai`
(é o que vai no zip de download); senão, o `g++` do sistema. O toolchain e os binários
(`.exe`, `.dll`, `library/*/bin`) não ficam no git — vão no zip da release.

Testes: para cada `testes/X.jat`, a saída de `jatai testes/X.jat` tem de ser igual a
`testes/X.esperado`.
