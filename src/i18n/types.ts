/** Troca cada texto folha por `string`, mantendo a estrutura do objeto. */
export type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };

/** Todas as chaves possíveis em notação de ponto, ex.: "editor.tools.text". */
export type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];
