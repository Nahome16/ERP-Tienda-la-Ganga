import { ApiError } from '../lib/api'
import type { Sale, SaleResult } from '../lib/apiTypes'
import { request, withTransaction } from './db'
import { classifyError } from './net'
import type { NewOutboxEntry, OutboxEntry, OutboxStatus } from './types'

// Cola local de ventas (IndexedDB, store «outbox»). Una venta se guarda aquí
// PRIMERO y después se envía; si algo falla no se pierde nada.

const STORE = 'outbox'

export const MAX_BACKOFF_MS = 5 * 60 * 1000

/** Retroceso exponencial: 2 s, 4 s, 8 s… hasta 5 minutos. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (attempts - 1))
}

export async function enqueueSale(input: NewOutboxEntry): Promise<OutboxEntry> {
  return withTransaction([STORE], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE)
    // Idempotencia local: la misma venta no se encola dos veces.
    const existing = await request<OutboxEntry | undefined>(store.index('clientSaleId').get(input.clientSaleId))
    if (existing) return existing
    const entry: Omit<OutboxEntry, 'seq'> = {
      clientSaleId: input.clientSaleId,
      userId: input.userId,
      userName: input.userName,
      status: 'pending',
      request: input.request,
      localSale: input.localSale,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      errorCode: null,
      errorStatus: null,
      sentAt: null,
      serverSale: null,
      alreadyProcessed: false,
    }
    const seq = await request<IDBValidKey>(store.add(entry))
    return { ...entry, seq: Number(seq) }
  })
}

/** Todas las ventas de la cola, en orden de creación. `userId` filtra por dueño. */
export async function listOutbox(userId?: string): Promise<OutboxEntry[]> {
  const all = await withTransaction([STORE], 'readonly', (tx) => request<OutboxEntry[]>(tx.objectStore(STORE).getAll()))
  const filtered = userId === undefined ? all : all.filter((entry) => entry.userId === userId)
  return filtered.sort((a, b) => a.seq - b.seq)
}

export async function getOutboxEntry(clientSaleId: string): Promise<OutboxEntry | null> {
  const entry = await withTransaction([STORE], 'readonly', (tx) =>
    request<OutboxEntry | undefined>(tx.objectStore(STORE).index('clientSaleId').get(clientSaleId)))
  return entry ?? null
}

async function updateEntry(clientSaleId: string, change: (entry: OutboxEntry) => OutboxEntry): Promise<OutboxEntry | null> {
  return withTransaction([STORE], 'readwrite', async (tx) => {
    const store = tx.objectStore(STORE)
    const current = await request<OutboxEntry | undefined>(store.index('clientSaleId').get(clientSaleId))
    if (!current) return null
    const next = change(current)
    await request(store.put(next))
    return next
  })
}

/**
 * Si el navegador se cerró a mitad de un envío, esas ventas quedaron «sending».
 * Al abrir se vuelven a poner en cola (reenviar es seguro: el servidor es idempotente).
 */
export async function recoverInterrupted(): Promise<number> {
  const entries = await listOutbox()
  let recovered = 0
  for (const entry of entries) {
    if (entry.status !== 'sending') continue
    await updateEntry(entry.clientSaleId, (current) => ({ ...current, status: 'pending', nextAttemptAt: null }))
    recovered += 1
  }
  return recovered
}

/** Reintento manual: devuelve una venta «pending» o «attention» a la cola, sin esperas. */
export async function retryEntry(clientSaleId: string): Promise<OutboxEntry | null> {
  return updateEntry(clientSaleId, (entry) => entry.status === 'sent'
    ? entry
    : { ...entry, status: 'pending', nextAttemptAt: null, lastError: null, errorCode: null, errorStatus: null })
}

/** Quita de la cola las ventas ya enviadas que tienen más de `olderThanMs`. */
export async function pruneSent(olderThanMs: number, now = Date.now()): Promise<number> {
  const entries = await listOutbox()
  const stale = entries.filter((entry) => entry.status === 'sent' && entry.sentAt !== null && now - Date.parse(entry.sentAt) > olderThanMs)
  if (stale.length === 0) return 0
  await withTransaction([STORE], 'readwrite', async (tx) => {
    for (const entry of stale) await request(tx.objectStore(STORE).delete(entry.seq))
  })
  return stale.length
}

export function countByStatus(entries: OutboxEntry[], ...statuses: OutboxStatus[]): number {
  return entries.filter((entry) => statuses.includes(entry.status)).length
}

export type SendSale = (request: OutboxEntry['request']) => Promise<SaleResult>

export type DrainOptions = {
  /** Solo se envían ventas de este usuario (otra persona no puede enviarlas como suyas). */
  userId: string
  send: SendSale
  now?: () => number
  /** Ignora la espera de reintento (al recuperar la red o con «Reintentar ahora»). */
  force?: boolean
  onProgress?: (entry: OutboxEntry) => void
}

export type DrainResult = {
  sent: number
  needsAttention: number
  retryLater: number
  stoppedBy: 'network' | 'unauthorized' | null
  /** Ventas que cambiaron de estado, en el orden en que se procesaron. */
  processed: OutboxEntry[]
}

/**
 * Envía la cola en orden, una venta a la vez.
 *  - Éxito (200/201, incluso `alreadyProcessed`): queda «sent» con la venta del servidor.
 *  - Red caída: vuelve a «pending» con retroceso y se detiene el ciclo.
 *  - 401: se conserva «pending» y se detiene; tras iniciar sesión se continúa.
 *  - 5xx/408/429: «pending» con retroceso; se sigue con las demás.
 *  - Otros 4xx (422, 409…): «attention» con el mensaje del servidor; NO bloquea las siguientes.
 */
export async function drainOutbox({ userId, send, now = Date.now, force = false, onProgress }: DrainOptions): Promise<DrainResult> {
  const result: DrainResult = { sent: 0, needsAttention: 0, retryLater: 0, stoppedBy: null, processed: [] }
  const candidates = (await listOutbox(userId)).filter((entry) => entry.status === 'pending')

  for (const candidate of candidates) {
    if (!force && candidate.nextAttemptAt !== null && candidate.nextAttemptAt > now()) continue

    // Marca «sending» antes de llamar: si el navegador se cierra, al abrir se recupera.
    const sending = await updateEntry(candidate.clientSaleId, (entry) => entry.status === 'pending' ? { ...entry, status: 'sending' } : entry)
    if (!sending || sending.status !== 'sending') continue

    let saved: OutboxEntry | null
    try {
      const response = await send(sending.request)
      const sale: Sale = response.sale
      saved = await updateEntry(sending.clientSaleId, (entry) => ({
        ...entry,
        status: 'sent',
        sentAt: new Date(now()).toISOString(),
        serverSale: sale,
        alreadyProcessed: response.alreadyProcessed,
        nextAttemptAt: null,
        lastError: null,
        errorCode: null,
        errorStatus: null,
      }))
      result.sent += 1
    } catch (error) {
      const kind = classifyError(error)
      const message = error instanceof Error ? error.message : 'No fue posible enviar la venta.'
      const code = error instanceof ApiError ? error.code : null
      const status = error instanceof ApiError ? error.status : null
      if (kind === 'rejected') {
        saved = await updateEntry(sending.clientSaleId, (entry) => ({
          ...entry,
          status: 'attention',
          attempts: entry.attempts + 1,
          nextAttemptAt: null,
          lastError: message,
          errorCode: code,
          errorStatus: status,
        }))
        result.needsAttention += 1
      } else if (kind === 'unauthorized') {
        saved = await updateEntry(sending.clientSaleId, (entry) => ({
          ...entry,
          status: 'pending',
          nextAttemptAt: null,
          lastError: 'Tu sesión venció: iniciá sesión de nuevo para sincronizar.',
          errorCode: code,
          errorStatus: 401,
        }))
        result.stoppedBy = 'unauthorized'
      } else {
        saved = await updateEntry(sending.clientSaleId, (entry) => ({
          ...entry,
          status: 'pending',
          attempts: entry.attempts + 1,
          nextAttemptAt: now() + backoffMs(entry.attempts + 1),
          lastError: kind === 'network' ? 'Sin conexión con el servidor.' : message,
          errorCode: code,
          errorStatus: status,
        }))
        result.retryLater += 1
        if (kind === 'network') result.stoppedBy = 'network'
      }
    }
    if (saved) {
      result.processed.push(saved)
      onProgress?.(saved)
    }
    if (result.stoppedBy) break
  }
  return result
}
