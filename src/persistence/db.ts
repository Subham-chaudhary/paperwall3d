/** Minimal promise wrapper over the raw IndexedDB API (no libraries). */

export const DB_NAME = 'paperwall3d';
export const DB_VERSION = 1;
export type StoreName = 'projects' | 'analysis';

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and lazily create/upgrade) the application database. The connection is cached. */
export function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('analysis')) {
        db.createObjectStore('analysis', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
    req.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  }).catch((e: unknown) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

/** Run one request inside its own transaction and resolve once the transaction commits. */
async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    let result: unknown;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export const idbGet = <T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> =>
  run<T | undefined>(store, 'readonly', (s) => s.get(key));

export const idbPut = (store: StoreName, value: unknown): Promise<IDBValidKey> =>
  run<IDBValidKey>(store, 'readwrite', (s) => s.put(value));

export const idbDelete = (store: StoreName, key: IDBValidKey): Promise<void> =>
  run<void>(store, 'readwrite', (s) => s.delete(key));

export const idbGetAll = <T>(store: StoreName): Promise<T[]> => run<T[]>(store, 'readonly', (s) => s.getAll());

/** Delete every record in `store` whose string key starts with `prefix`. */
export async function idbDeleteByPrefix(store: StoreName, prefix: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const cursorReq = os.openKeyCursor(range);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      os.delete(cursor.primaryKey);
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}
