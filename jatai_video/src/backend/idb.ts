// IndexedDB em forma de promessa. E onde o editor guarda o que o C++ guardava
// em %APPDATA%: os projetos e a referencia aos arquivos importados.

const NOME = 'jatai-video';
const VERSAO = 1;

export type Loja = 'arquivos' | 'projetos';

let aberto: Promise<IDBDatabase> | null = null;

function abre(): Promise<IDBDatabase> {
  if (aberto) return aberto;
  aberto = new Promise((ok, falha) => {
    const req = indexedDB.open(NOME, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('arquivos')) db.createObjectStore('arquivos', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('projetos')) db.createObjectStore('projetos', { keyPath: 'id' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => { aberto = null; falha(req.error); };
  });
  return aberto;
}

function pedido<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((ok, falha) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => falha(req.error);
  });
}

async function loja(nome: Loja, modo: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await abre();
  return db.transaction(nome, modo).objectStore(nome);
}

export async function le<T>(nome: Loja, chave: string): Promise<T | undefined> {
  return pedido((await loja(nome, 'readonly')).get(chave)) as Promise<T | undefined>;
}

export async function todos<T>(nome: Loja): Promise<T[]> {
  return pedido((await loja(nome, 'readonly')).getAll()) as Promise<T[]>;
}

export async function grava<T>(nome: Loja, valor: T): Promise<void> {
  await pedido((await loja(nome, 'readwrite')).put(valor));
}

export async function apaga(nome: Loja, chave: string): Promise<void> {
  await pedido((await loja(nome, 'readwrite')).delete(chave));
}
