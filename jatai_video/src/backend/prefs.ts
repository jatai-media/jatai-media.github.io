// Preferencias: um mapa chave -> texto, como o config.ini do C++. Moram no
// localStorage, que basta para meia duzia de chaves pequenas.

const CHAVE = 'jatai.video.prefs';

function le(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(CHAVE) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function getPrefs() {
  return {
    ...le(),
    // Os recados que o C++ mandava junto. Aqui a previa sempre vai por
    // endereco e o arrasto sempre funciona; o reconhecedor de fala ainda nao
    // existe no navegador, e a interface usa a regua de nivel.
    quadrosServidos: true,
    arrastarArquivos: true,
    falaReconhecida: false,
  };
}

export function setPref(chave: string, valor: string) {
  if (!chave) return { ok: false };
  const p = le();
  p[chave] = String(valor ?? '');
  try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { return { ok: false }; }
  return { ok: true };
}
