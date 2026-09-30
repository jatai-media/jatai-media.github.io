# Bibliotecas do Jatai

Uma biblioteca é uma pasta com o nome dela. Não é preciso mexer no código da linguagem para criar uma.

```
library/
  time/
    time.jat                    declarações (funções Jatai e funções extern)
    time.hpp                    implementação C++ das funções extern
    time.windows.flags          (opcional) bibliotecas do sistema para o link
    bin/windows-x64/time.dll    biblioteca nativa já compilada (jatai -lib library/time)
    bin/linux-x64/libtime.so    (a mesma, para Linux)
```

Todas as bibliotecas padrão seguem essa estrutura. Uma biblioteca em C, Rust ou outra
linguagem troca o `.hpp` pelos próprios fontes (veja "Opção 2" abaixo).

## Bibliotecas padrão

| Biblioteca | Para quê |
|------------|----------|
| `time`     | medir tempo (`now`, `elapsed`, `elapsed_ms`) e pausar (`sleep`) |
| `text`     | strings: `upper`, `lower`, `name`, `trim`, `split`, `lines`, `join`, `before`, `after`, `find`, `replace`, `slice`, `to_int`... (ver `text/text.jat`) |
| `io`       | terminal: `input`, `read_line`, `read_all`, `eof`, `eprint`/`eprintln` (stderr), `flush` |
| `file`     | arquivos e pastas: `read`, `write`, `append`, `read_lines`, `write_lines`, `exists`, `is_dir`, `size`, `mkdir`, `list`, `copy`, `rename`, `remove` |
| `iliv`     | janela 2D com eventos por callback (Windows): `open`, `run`, `on_draw`, `on_key`, `on_click`, `rect`, `circle`, `text`... |
| `http`     | servidor web: `route`, `static_dir`, `serve`/`serve_local`, `query`, `body`, `status`, `content_type`, `my_ip`... |
| `voz`      | fala pelas vozes do Windows (SAPI/COM): `say`, `say_words` (callback por palavra), `say_async`, `save_wav`, `voices`, `set_voice`, `rate`, `volume` |

## Usando

```
import time

double inicio = time.now()
time.sleep(0.1)
double ms = time.elapsed_ms(inicio)
```

`import nome` procura `nome/nome.jat` nesta ordem:

1. `library/` na pasta do arquivo que faz o `import` (bibliotecas do seu projeto)
2. ao lado da biblioteca atual (quando uma biblioteca importa outra)
3. `library/` ao lado do executável `jatai` (biblioteca padrão)

## Biblioteca só em Jatai

`library/geo/geo.jat`:

```
double area_retangulo(double largura, double altura)
    return largura * altura

double area_quadrado(double lado)
    return area_retangulo(lado, lado)
```

- Uma biblioteca contém só funções, `extern` e `import`, sem instruções soltas.
- Dentro dela, as funções se chamam sem prefixo; quem importa usa `geo.area_quadrado(2.0)`.
- Funções de biblioteca enxergam só os próprios parâmetros e variáveis locais.

Bibliotecas só em Jatai não precisam de compilador nem de binário.

## Funções nativas (extern)

Para o que não dá para escrever em Jatai (relógio, arquivos, rede, janelas), declare a
função com `extern`. A implementação fica numa **biblioteca nativa** (DLL no Windows,
`.so` no Linux) com funções exportadas **no padrão C**. Por isso ela pode ser escrita em
C, C++, Rust, Zig ou qualquer linguagem que exporte funções C, sem depender da versão
do compilador.

A biblioteca nativa é compilada **uma vez**, por quem cria a biblioteca, e fica em
`bin/<plataforma>/`. Quem só usa a biblioteca não precisa de compilador para o modo
interpretado.

| Modo | Como a função extern é chamada |
|------|--------------------------------|
| `jatai arquivo.jat` | a VM carrega a DLL/.so e chama as funções pela libffi |
| `jatai arquivo.jat -build` | a DLL/.so é copiada para `build/<programa>/bin/` e o programa a carrega de lá ao iniciar |

### Opção 1: C++ natural (`<nome>.hpp`)

Escreva as funções em C++ comum, em `namespace jatai::<nome>`, e rode `jatai -lib`:
ele lê o `.jat`, gera sozinho as funções exportadas no padrão C e compila a DLL.

`library/texto/texto.jat`:

```
extern string maiusculas(string s)
extern int contar(string s, char c)
extern void repetir(int vezes, void(int) acao)
```

`library/texto/texto.hpp`:

```cpp
#pragma once
#include <cctype>
#include <functional>
#include <string>
#include <string_view>

namespace jatai::texto {

inline std::string maiusculas(std::string_view s) {
    std::string r(s); // string_view -> string precisa ser explicito
    for (char& c : r) c = (char)std::toupper((unsigned char)c);
    return r;
}

inline int contar(std::string_view s, char c) {
    int n = 0;
    for (char x : s) if (x == c) n++;
    return n;
}

inline void repetir(int vezes, std::function<void(int)> acao) {
    for (int i = 0; i < vezes; i++) acao(i);
}

}
```

```
jatai -lib library/texto
```

| Jatai    | C++ no .hpp |
|----------|-------------|
| `int`, `double`, `bool`, `char` | o mesmo tipo |
| `string` | `std::string_view` (parâmetro, sem cópia) ou `const std::string&`; `std::string` (retorno) |
| `void`   | `void` (só retorno) |
| função `void(int, string) f` | `std::function<void(int, const std::string&)>` (retorno string: `std::string`) |

### Opção 2: funções C (C, Rust, Zig...)

Inclua `library/jatai.h` (ou siga o contrato dele em outra linguagem) e exporte
`jatai_<nome>_<funcao>`:

```c
#include "jatai.h"

JATAI_LIBRARY(calc)   /* exporta jatai_calc_init: obrigatorio */

JATAI_API int32_t jatai_calc_somar(int32_t a, int32_t b) { return a + b; }

/* string recebida: ponteiro + tamanho; string devolvida: criada com jatai_str/jatai_str_new */
JATAI_API char *jatai_calc_inverter(const char *s, size_t n) {
    char *r = jatai_str_new(n);
    for (size_t i = 0; i < n; i++) r[i] = s[n - 1 - i];
    return r;
}

/* callback: ponteiro de funcao + contexto; chame fn(ctx, argumentos...) */
JATAI_API void jatai_calc_para_cada(int32_t n, void (*fn)(void *, int32_t), void *ctx) {
    for (int32_t i = 0; i < n; i++) fn(ctx, i);
}
```

| Jatai    | C |
|----------|---|
| `int`    | `int32_t` |
| `double` | `double` |
| `bool`, `char` | `int32_t` (0/1, valor do byte) |
| `string` (parâmetro) | `const char *p, size_t n` (dois parâmetros) |
| `string` (retorno) | `char *` criado com `jatai_str(p, n)` ou `jatai_str_new(n)` |
| função (parâmetro) | `R (*fn)(void *ctx, ...), void *ctx` (dois parâmetros) |

Um callback que devolve string devolve `char *`: leia o tamanho com `jatai_str_len` e
libere com `jatai_str_free` depois de usar. Em C, rode `jatai -lib library/calc` (usa o
gcc); em outra linguagem, compile como biblioteca dinâmica e coloque o arquivo em
`bin/<plataforma>/` (`calc.dll`, `libcalc.so`, `libcalc.dylib`).

Arrays ainda não podem ser usados em funções `extern` nem em callbacks.

### `jatai -lib <pasta>`

Compila os fontes da pasta (`.c`, `.cpp` e, se houver, a ponte gerada para o `<nome>.hpp`)
em `bin/<plataforma>/`. Se os fontes, o `.hpp` ou o `.jat` ficarem mais novos que o
binário, o Jatai avisa para recompilar.

### Bibliotecas do sistema (`<nome>.flags`)

Opções de link do g++ usadas pelo `jatai -lib`:

- `<nome>.flags`: vale em qualquer sistema;
- `<nome>.windows.flags`, `<nome>.linux.flags`, `<nome>.macos.flags`: só no sistema correspondente.

A `http` tem `http.windows.flags` com `-lws2_32` (no Linux os sockets já fazem parte da
biblioteca C), e a `iliv` tem `iliv.windows.flags` com `-lgdi32 -lwinmm`.

### Dicas

- Prefira `std::string_view` (ou `const char *` + tamanho em C) nos parâmetros `string`:
  o texto não é copiado.
- Strings são UTF-8: `std::toupper` sozinho não converte `ç`, `ã`, `é`... (veja
  `detail::to_upper` em `text/text.hpp`).
- Se a função escreve na saída ou pausa a execução, chame `fflush(stdout)` antes, para a
  saída do programa aparecer na ordem certa.
- Funções chamadas milhões de vezes em laço (como `rgb`) ficam um pouco mais lentas no
  `-build` do que se estivessem no próprio programa, porque o compilador não consegue
  otimizar através da DLL. Para a maioria das bibliotecas a diferença não aparece.
