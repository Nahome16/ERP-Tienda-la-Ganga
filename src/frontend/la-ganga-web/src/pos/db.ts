// Capa mínima sobre IndexedDB. Los datos de negocio del POS (instantánea, cola
// de ventas, usuario y caja en caché) viven aquí y nunca en localStorage.

const DB_NAME = 'la-ganga-pos'
const DB_VERSION = 1

export type StoreName = 'snapshot' | 'outbox' | 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador no permite guardar datos en el equipo.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('outbox')) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
        outbox.createIndex('clientSaleId', 'clientSaleId', { unique: true })
        outbox.createIndex('userId', 'userId')
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'))
    request.onblocked = () => reject(new Error('El almacenamiento local está bloqueado por otra pestaña.'))
  })
  dbPromise = opening
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null
  })
  return opening
}

/** Cierra y borra la base (solo para pruebas). */
export async function resetDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close()
    } catch {
      // ya estaba cerrada
    }
    dbPromise = null
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => resolve()
  })
}

/**
 * Ejecuta `work` dentro de una transacción. Dentro de `work` solo se debe
 * esperar a peticiones de IndexedDB (si no, la transacción se cierra sola).
 */
export async function withTransaction<T>(
  stores: StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result: T
    let failed = false
    tx.oncomplete = () => { if (!failed) resolve(result) }
    tx.onerror = () => { failed = true; reject(tx.error ?? new Error('Error de almacenamiento local.')) }
    tx.onabort = () => { failed = true; reject(tx.error ?? new Error('Transacción cancelada.')) }
    work(tx).then(
      (value) => { result = value },
      (error: unknown) => {
        failed = true
        reject(error instanceof Error ? error : new Error(String(error)))
        try { tx.abort() } catch { /* ya terminó */ }
      },
    )
  })
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Error de almacenamiento local.'))
  })
}

export async function getRecord<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withTransaction([store], 'readonly', (tx) => request<T | undefined>(tx.objectStore(store).get(key)))
}

export async function putRecord(store: StoreName, value: unknown): Promise<void> {
  await withTransaction([store], 'readwrite', async (tx) => {
    await request(tx.objectStore(store).put(value))
  })
}

export async function deleteRecord(store: StoreName, key: IDBValidKey): Promise<void> {
  await withTransaction([store], 'readwrite', async (tx) => {
    await request(tx.objectStore(store).delete(key))
  })
}
