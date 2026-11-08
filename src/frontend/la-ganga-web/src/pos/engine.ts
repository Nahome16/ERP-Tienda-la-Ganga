import type { PosSnapshot, SaleResult } from '../lib/apiTypes'
import { errorMessage, classifyError, onNetworkResult, posRequest } from './net'
import {
  countByStatus, drainOutbox, enqueueSale, listOutbox, pruneSent, recoverInterrupted, retryEntry,
  type SendSale,
} from './outbox'
import { loadLastSync, loadSnapshot, saveLastSync, saveSnapshot } from './storage'
import type { ConnectionStatus, NewOutboxEntry, OutboxEntry, StoredSnapshot } from './types'

export type EngineState = {
  connection: ConnectionStatus
  syncing: boolean
  /** Ventas de este usuario en la cola local (todas, en orden). */
  outbox: OutboxEntry[]
  snapshot: StoredSnapshot | null
  snapshotError: string | null
  loaded: boolean
  lastSyncAtUtc: string | null
  /** El servidor respondió 401: hay que iniciar sesión de nuevo para sincronizar. */
  sessionExpired: boolean
}

export type EngineEvent =
  | { type: 'online'; synced: number }
  | { type: 'offline' }
  | { type: 'synced'; count: number }
  | { type: 'attention'; count: number }
  | { type: 'unauthorized' }

export type EngineDeps = {
  send: SendSale
  fetchSnapshot: () => Promise<PosSnapshot>
  ping: () => Promise<boolean>
  isBrowserOnline: () => boolean
}

const TICK_MS = 4000
const PING_ONLINE_MS = 20_000
const PING_OFFLINE_MS = 5000
const DRAIN_MS = 15_000
const SNAPSHOT_MS = 4 * 60_000
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

async function defaultPing(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const defaultDeps: EngineDeps = {
  send: (request) => posRequest<SaleResult>('/api/v1/pos/sales', { method: 'POST', body: request }),
  fetchSnapshot: () => posRequest<PosSnapshot>('/api/v1/pos/snapshot'),
  ping: defaultPing,
  isBrowserOnline: () => typeof navigator === 'undefined' || navigator.onLine !== false,
}

/**
 * Motor del modo sin conexión: detecta la conexión (eventos del navegador +
 * peticiones reales + ping a /api/health), mantiene la instantánea y envía la
 * cola de ventas en segundo plano. No depende de React.
 */
export class PosEngine {
  private state: EngineState = {
    connection: 'online', syncing: false, outbox: [], snapshot: null, snapshotError: null,
    loaded: false, lastSyncAtUtc: null, sessionExpired: false,
  }
  private readonly listeners = new Set<() => void>()
  private readonly eventListeners = new Set<(event: EngineEvent) => void>()
  private readonly deps: EngineDeps
  private timer: ReturnType<typeof setInterval> | null = null
  private unsubscribeNetwork: (() => void) | null = null
  private draining = false
  private drainAgain: { force: boolean } | null = null
  private snapshotLoading = false
  private reconnecting = false
  private lastPingAt = 0
  private lastDrainAt = 0
  private lastSnapshotAt = 0
  private started = false
  private generation = 0

  constructor(private readonly userId: string, deps: Partial<EngineDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
    this.state = { ...this.state, connection: this.deps.isBrowserOnline() ? 'online' : 'offline' }
  }

  // --- suscripción (useSyncExternalStore) ---
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly getState = () => this.state

  onEvent(listener: (event: EngineEvent) => void) {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  private setState(patch: Partial<EngineState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  private emit(event: EngineEvent) {
    this.eventListeners.forEach((listener) => listener(event))
  }

  // --- ciclo de vida ---
  async start() {
    if (this.started) return
    this.started = true
    const generation = ++this.generation
    window.addEventListener('online', this.handleBrowserOnline)
    window.addEventListener('offline', this.handleBrowserOffline)
    this.unsubscribeNetwork = onNetworkResult((reachable) => this.setConnection(reachable ? 'online' : 'offline'))

    try {
      await recoverInterrupted()
      await pruneSent(SENT_RETENTION_MS)
    } catch {
      // El almacenamiento local puede fallar en navegadores restringidos; seguimos.
    }
    const [outbox, snapshot, lastSync] = await Promise.all([
      listOutbox(this.userId).catch(() => []),
      loadSnapshot().catch(() => null),
      loadLastSync().catch(() => null),
    ])
    if (!this.started || generation !== this.generation) return
    this.setState({ outbox, snapshot, lastSyncAtUtc: lastSync, loaded: true })

    this.timer = setInterval(() => { void this.tick() }, TICK_MS)
    void this.checkConnection()
  }

  stop() {
    this.started = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    window.removeEventListener('online', this.handleBrowserOnline)
    window.removeEventListener('offline', this.handleBrowserOffline)
    this.unsubscribeNetwork?.()
    this.unsubscribeNetwork = null
  }

  private readonly handleBrowserOnline = () => { void this.checkConnection() }
  private readonly handleBrowserOffline = () => { this.setConnection('offline') }

  // --- conexión ---
  private setConnection(next: ConnectionStatus) {
    const previous = this.state.connection
    if (previous === next) return
    this.setState({ connection: next })
    if (next === 'offline') {
      this.emit({ type: 'offline' })
      this.lastPingAt = Date.now() - PING_OFFLINE_MS + 1000
      return
    }
    void this.handleReconnected()
  }

  /** Comprueba de verdad si el servidor responde (navigator.onLine solo es una pista). */
  async checkConnection(): Promise<ConnectionStatus> {
    this.lastPingAt = Date.now()
    if (!this.deps.isBrowserOnline()) {
      this.setConnection('offline')
      return 'offline'
    }
    const reachable = await this.deps.ping()
    this.setConnection(reachable ? 'online' : 'offline')
    return reachable ? 'online' : 'offline'
  }

  private async handleReconnected() {
    // Durante la reconexión se avisa con un solo mensaje («online» con el total enviado).
    this.reconnecting = true
    const before = countByStatus(this.state.outbox, 'sent')
    try {
      await this.syncNow({ force: true })
      await this.refreshSnapshot()
    } finally {
      this.reconnecting = false
    }
    const synced = Math.max(0, countByStatus(this.state.outbox, 'sent') - before)
    this.emit({ type: 'online', synced })
  }

  /** Otra parte de la app recibió un 401: hay que iniciar sesión de nuevo. */
  markSessionExpired() {
    if (this.state.sessionExpired) return
    this.setState({ sessionExpired: true })
    this.emit({ type: 'unauthorized' })
  }

  private async tick() {
    if (!this.started) return
    const now = Date.now()
    const pingEvery = this.state.connection === 'offline' ? PING_OFFLINE_MS : PING_ONLINE_MS
    if (now - this.lastPingAt >= pingEvery) await this.checkConnection()
    if (this.state.connection !== 'online') return
    if (!this.state.sessionExpired && now - this.lastDrainAt >= DRAIN_MS && countByStatus(this.state.outbox, 'pending', 'sending') > 0) {
      await this.syncNow()
    }
    if (now - this.lastSnapshotAt >= SNAPSHOT_MS) await this.refreshSnapshot()
  }

  // --- cola ---
  async reloadOutbox() {
    const outbox = await listOutbox(this.userId)
    this.setState({ outbox })
  }

  /** Guarda la venta en la cola local (IndexedDB) y la envía en segundo plano. */
  async enqueue(entry: NewOutboxEntry): Promise<OutboxEntry> {
    const saved = await enqueueSale(entry)
    await this.reloadOutbox()
    void this.syncNow()
    return saved
  }

  async retry(clientSaleId: string) {
    await retryEntry(clientSaleId)
    await this.reloadOutbox()
    if (this.state.sessionExpired) this.setState({ sessionExpired: false })
    await this.syncNow({ force: true })
  }

  async retryAll() {
    for (const entry of this.state.outbox) {
      if (entry.status === 'attention' || entry.status === 'pending') await retryEntry(entry.clientSaleId)
    }
    await this.reloadOutbox()
    if (this.state.sessionExpired) this.setState({ sessionExpired: false })
    await this.syncNow({ force: true })
  }

  /** Envía la cola. Si ya hay un envío en curso, pide otra vuelta al terminar. */
  async syncNow({ force = false }: { force?: boolean } = {}) {
    if (this.draining) {
      this.drainAgain = { force: force || (this.drainAgain?.force ?? false) }
      return
    }
    if (this.state.connection === 'offline' && !force) return
    this.draining = true
    this.lastDrainAt = Date.now()
    this.setState({ syncing: true })
    let sentTotal = 0
    let attentionTotal = 0
    try {
      const result = await drainOutbox({
        userId: this.userId,
        send: this.deps.send,
        force,
        onProgress: () => { void this.reloadOutbox() },
      })
      sentTotal = result.sent
      attentionTotal = result.needsAttention
      if (result.stoppedBy === 'unauthorized') {
        this.setState({ sessionExpired: true })
        this.emit({ type: 'unauthorized' })
      } else if (result.sent > 0) {
        this.setState({ sessionExpired: false })
      }
    } catch (error) {
      // Error local de almacenamiento: no se pierde nada, se reintenta en el próximo ciclo.
      console.error('No se pudo procesar la cola de ventas', error)
    } finally {
      this.draining = false
      await this.reloadOutbox().catch(() => undefined)
      this.setState({ syncing: false })
    }
    if (sentTotal > 0) {
      const now = new Date().toISOString()
      this.setState({ lastSyncAtUtc: now })
      void saveLastSync(now).catch(() => undefined)
      if (!this.reconnecting) this.emit({ type: 'synced', count: sentTotal })
      void this.refreshSnapshot()
    }
    if (attentionTotal > 0) this.emit({ type: 'attention', count: attentionTotal })
    const again = this.drainAgain
    this.drainAgain = null
    if (again && this.state.connection === 'online') await this.syncNow(again)
  }

  // --- instantánea ---
  async refreshSnapshot(): Promise<boolean> {
    if (this.snapshotLoading) return false
    this.snapshotLoading = true
    this.lastSnapshotAt = Date.now()
    try {
      const snapshot = await this.deps.fetchSnapshot()
      let stored: StoredSnapshot = { snapshot, fetchedAtUtc: new Date().toISOString() }
      try {
        stored = await saveSnapshot(snapshot, stored.fetchedAtUtc)
      } catch {
        // Sin almacenamiento local seguimos con la copia en memoria.
      }
      const now = new Date().toISOString()
      this.setState({ snapshot: stored, snapshotError: null, lastSyncAtUtc: now })
      void saveLastSync(now).catch(() => undefined)
      return true
    } catch (error) {
      if (classifyError(error) === 'unauthorized') {
        this.setState({ sessionExpired: true })
        this.emit({ type: 'unauthorized' })
      }
      this.setState({ snapshotError: errorMessage(error) })
      return false
    } finally {
      this.snapshotLoading = false
    }
  }
}
