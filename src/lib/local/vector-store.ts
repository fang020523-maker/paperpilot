"use client";

/**
 * IndexedDB 向量库（隐私模式）
 * 存储浏览器端嵌入的分块向量与元数据 —— 全部数据不出本地。
 */

const DB_NAME = "paperpilot-local";
const STORE = "chunks";
const META = "meta";

export interface LocalChunk {
  id: string;
  paperId: string;
  paperTitle: string;
  page: number;
  section?: string;
  text: string;
  embedding: number[]; // Float32 → number[]（结构化克隆直接支持 Float32Array，但转数组更直观）
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putChunks(chunks: LocalChunk[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, "readwrite");
    const store = t.objectStore(STORE);
    for (const c of chunks) store.put(c);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function getAllChunks(): Promise<LocalChunk[]> {
  return tx<LocalChunk[]>(STORE, "readonly", (s) => s.getAll() as IDBRequest<LocalChunk[]>);
}

export async function clearChunks(): Promise<void> {
  await tx(STORE, "readwrite", (s) => s.clear());
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx(META, "readwrite", (s) => s.put(value, key));
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx<T>(META, "readonly", (s) => s.get(key) as IDBRequest<T>);
}

/** 余弦相似度端侧检索 */
export function localVectorSearch(
  chunks: LocalChunk[],
  queryEmb: number[],
  topK: number
): { chunk: LocalChunk; score: number }[] {
  const scored = chunks.map((c) => {
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < queryEmb.length; i++) {
      dot += queryEmb[i] * c.embedding[i];
      na += queryEmb[i] * queryEmb[i];
      nb += c.embedding[i] * c.embedding[i];
    }
    return { chunk: c, score: dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
