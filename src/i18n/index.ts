import en from './locales/en';
import es from './locales/es';
import ptBR from './locales/pt-BR';
import type { DeepStrings, Paths } from './types';

export type Messages = DeepStrings<typeof en>;
export type TranslationKey = Paths<Messages>;
export type TranslationParams = Record<string, string | number>;

/**
 * Idiomas disponíveis. Para adicionar um novo:
 *  1. crie src/i18n/locales/<codigo>.ts tipado como `Messages`;
 *  2. registre-o aqui com o nome escrito no próprio idioma.
 */
export const LOCALES = {
  en: { label: 'English', messages: en },
  'pt-BR': { label: 'Português (Brasil)', messages: ptBR },
  es: { label: 'Español', messages: es },
} as const satisfies Record<string, { label: string; messages: Messages }>;

export type Locale = keyof typeof LOCALES;

const DEFAULT_LOCALE: Locale = 'en';
const STORAGE_KEY = 'jatai.locale';

type Listener = (locale: Locale) => void;
const listeners = new Set<Listener>();

let current: Locale = detectLocale();

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && value in LOCALES;
}

/** Ordem: escolha salva → idioma do navegador → inglês. */
function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    // localStorage indisponível (modo privado, bloqueado etc.)
  }

  for (const lang of navigator.languages ?? [navigator.language]) {
    if (isLocale(lang)) return lang;
    const base = lang.toLowerCase().split('-')[0];
    if (base === 'pt') return 'pt-BR';
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Traduz uma chave no idioma atual, com fallback para inglês. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const text = lookup(LOCALES[current].messages, key) ?? lookup(en, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // sem persistência; segue só nesta página
  }
  applyTranslations();
  listeners.forEach((listener) => listener(locale));
}

/** Registra um callback para quando o idioma mudar. Retorna a função de cancelamento. */
export function onLocaleChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Traduz o HTML estático via atributos:
 *   data-i18n="chave"                          → textContent
 *   data-i18n-attr="title:chave;aria-label:chave" → atributos
 * Textos gerados por código devem usar t() e reagir a onLocaleChange().
 */
export function applyTranslations(root: ParentNode = document): void {
  document.documentElement.lang = current;

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as TranslationKey);
  });

  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':').map((s) => s.trim());
      if (attr && key) el.setAttribute(attr, t(key as TranslationKey));
    }
  });
}
