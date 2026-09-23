import { getLocale, LOCALES, onLocaleChange, setLocale, type Locale } from '../i18n';

/** Monta um <select> de idioma dentro de cada elemento com [data-lang-switcher]. */
export function mountLangSwitchers(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-lang-switcher]').forEach((host) => {
    const label = document.createElement('label');
    label.className = 'lang-switcher';

    const hint = document.createElement('span');
    hint.className = 'visually-hidden';
    hint.dataset.i18n = 'common.language';

    const select = document.createElement('select');
    for (const [code, { label: name }] of Object.entries(LOCALES)) {
      select.add(new Option(name, code));
    }
    select.value = getLocale();
    select.addEventListener('change', () => setLocale(select.value as Locale));
    onLocaleChange((locale) => (select.value = locale));

    label.append(hint, select);
    host.replaceChildren(label);
  });
}
