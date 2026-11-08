import type { CashSession, PosSnapshot } from '../lib/apiTypes'
import { deleteRecord, getRecord, putRecord } from './db'
import type { CachedCashSession, CartDraft, StoredSnapshot } from './types'

type StoredSnapshotRecord = StoredSnapshot & { key: 'current' }
type MetaRecord<T> = { key: string; value: T }

export async function getMeta<T>(key: string): Promise<T | null> {
  const record = await getRecord<MetaRecord<T>>('meta', key)
  return record ? record.value : null
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putRecord('meta', { key, value } satisfies MetaRecord<T>)
}

export async function deleteMeta(key: string): Promise<void> {
  await deleteRecord('meta', key)
}

export async function saveSnapshot(snapshot: PosSnapshot, fetchedAtUtc = new Date().toISOString()): Promise<StoredSnapshot> {
  const record: StoredSnapshotRecord = { key: 'current', snapshot, fetchedAtUtc }
  await putRecord('snapshot', record)
  return { snapshot, fetchedAtUtc }
}

export async function loadSnapshot(): Promise<StoredSnapshot | null> {
  const record = await getRecord<StoredSnapshotRecord>('snapshot', 'current')
  return record ? { snapshot: record.snapshot, fetchedAtUtc: record.fetchedAtUtc } : null
}

// --- Caja abierta guardada en el equipo (para arrancar sin conexión) ---

export async function saveCashSession(userId: string, session: CashSession): Promise<void> {
  await putRecord('meta', { key: 'cashSession', userId, session } satisfies CachedCashSession)
}

export async function loadCashSession(userId: string): Promise<CashSession | null> {
  const record = await getRecord<CachedCashSession>('meta', 'cashSession')
  if (!record || record.userId !== userId || record.session.closedAtUtc) return null
  return record.session
}

/** Caja guardada de cualquier usuario (solo para decidir el arranque sin conexión). */
export async function loadAnyCashSession(): Promise<CachedCashSession | null> {
  const record = await getRecord<CachedCashSession>('meta', 'cashSession')
  return record ?? null
}

export async function clearCashSession(): Promise<void> {
  await deleteRecord('meta', 'cashSession')
}

// --- Borrador del carrito (sobrevive a recargas) ---

export async function saveCartDraft(draft: CartDraft): Promise<void> {
  await putRecord('meta', draft)
}

export async function loadCartDraft(userId: string): Promise<CartDraft | null> {
  const record = await getRecord<CartDraft>('meta', 'cartDraft')
  return record && record.userId === userId ? record : null
}

export async function clearCartDraft(): Promise<void> {
  await deleteRecord('meta', 'cartDraft')
}

// --- Última sincronización ---

export async function saveLastSync(isoUtc: string): Promise<void> {
  await setMeta('lastSyncAt', isoUtc)
}

export async function loadLastSync(): Promise<string | null> {
  return getMeta<string>('lastSyncAt')
}
