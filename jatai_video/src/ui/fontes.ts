// fontes.ts - as fontes dos textos, que vao DENTRO do programa.
//
// Uma fonte do sistema (Segoe UI, Helvetica...) so existe no sistema dela: o
// mesmo projeto aberto no Linux ou no Mac trocaria a letra por outra, e o
// texto mudaria de largura, de altura e de cara. Por isso os textos usam so
// fontes empacotadas no build (pacotes @fontsource, licenca OFL): sao as
// mesmas em qualquer sistema, funcionam sem internet e no GitHub Pages.
//
// O clipe de texto guarda o `id` daqui (texto.fonte). A previa (HTML) e a
// exportacao (canvas, ver backend/texto-canvas.ts) tiram a familia do mesmo
// lugar - e por isso saem iguais.

import "@fontsource-variable/inter";
import "@fontsource-variable/roboto";
import "@fontsource-variable/montserrat";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/700.css";
import "@fontsource/poppins/800.css";
import "@fontsource-variable/oswald";
import "@fontsource/bebas-neue";
import "@fontsource/anton";
import "@fontsource-variable/playfair-display";
import "@fontsource-variable/lora";
import "@fontsource-variable/merriweather";
import "@fontsource-variable/dancing-script";
import "@fontsource/pacifico";
import "@fontsource/permanent-marker";
import "@fontsource-variable/roboto-mono";

export interface Fonte { id: string; nome: string; css: string; grupo: string }

// A ordem daqui e a da lista no painel.
export const FONTES: Fonte[] = [
  { id: "inter",            nome: "Inter",            css: "Inter Variable",            grupo: "Sem serifa" },
  { id: "roboto",           nome: "Roboto",           css: "Roboto Variable",           grupo: "Sem serifa" },
  { id: "montserrat",       nome: "Montserrat",       css: "Montserrat Variable",       grupo: "Sem serifa" },
  { id: "poppins",          nome: "Poppins",          css: "Poppins",                   grupo: "Sem serifa" },
  { id: "oswald",           nome: "Oswald",           css: "Oswald Variable",           grupo: "Titulos" },
  { id: "bebas-neue",       nome: "Bebas Neue",       css: "Bebas Neue",                grupo: "Titulos" },
  { id: "anton",            nome: "Anton",            css: "Anton",                     grupo: "Titulos" },
  { id: "playfair-display", nome: "Playfair Display", css: "Playfair Display Variable", grupo: "Com serifa" },
  { id: "lora",             nome: "Lora",             css: "Lora Variable",             grupo: "Com serifa" },
  { id: "merriweather",     nome: "Merriweather",     css: "Merriweather Variable",     grupo: "Com serifa" },
  { id: "dancing-script",   nome: "Dancing Script",   css: "Dancing Script Variable",   grupo: "Manuscritas" },
  { id: "pacifico",         nome: "Pacifico",         css: "Pacifico",                  grupo: "Manuscritas" },
  { id: "permanent-marker", nome: "Permanent Marker", css: "Permanent Marker",          grupo: "Manuscritas" },
  { id: "roboto-mono",      nome: "Roboto Mono",      css: "Roboto Mono Variable",      grupo: "Monoespacada" },
];

// Texto sem fonte escolhida (inclusive os de projetos de antes da escolha) usa
// esta. Era a Segoe UI, que so existe no Windows.
export const FONTE_PADRAO = "inter";

export function fonteDe(id?: string): Fonte {
  return FONTES.find((f) => f.id === id) || FONTES.find((f) => f.id === FONTE_PADRAO)!;
}

/** A familia para o CSS e para o canvas, com a reserva do navegador no fim. */
export function familiaCss(id?: string): string {
  return '"' + fonteDe(id).css + '", sans-serif';
}

/** Acha a fonte pelo id ou pelo nome, sem ligar para maiusculas ("Bebas Neue",
    "bebas-neue"). Para os scripts. */
export function achaFonte(nome: string): Fonte | null {
  const n = String(nome || "").trim().toLowerCase();
  return FONTES.find((f) => f.id === n || f.nome.toLowerCase() === n) || null;
}

/** Garante a fonte carregada antes de desenhar num canvas. A previa (HTML) nao
    precisa: o navegador redesenha sozinho quando a fonte chega. O canvas nao -
    ele desenharia com a reserva, e o arquivo sairia com outra letra.
    `texto` faz vir tambem as partes da fonte com os caracteres usados
    (acentos ficam em arquivos a parte). */
export async function carregaFonte(id: string | undefined, peso: number, texto?: string) {
  try { await document.fonts.load((peso || 400) + ' 32px "' + fonteDe(id).css + '"', texto || undefined); }
  catch { /* sem a fonte, vale a reserva - melhor que parar a exportacao */ }
}
