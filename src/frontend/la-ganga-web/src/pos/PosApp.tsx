import { useCallback, useEffect, useRef, useState } from 'react'
import { PrintableCashSummary, PrintableReceipt, printReceipt } from '../components/Receipt'
import { ApiError } from '../lib/api'
import { saveCachedUser } from '../lib/session'
import type { CashSession, CashSummary, Sale } from '../lib/apiTypes'
import type { ApiState, AppView, CurrentUser } from '../types'
import { CloseCashModal } from './CloseCashModal'
import { countByStatus } from './outbox'
import { readSoundPreference, saveSoundPreference } from './feedback'
import { timeAgo } from './format'
import { useNow, usePosEngine } from './hooks'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import { OpenCashScreen } from './OpenCashScreen'
import { SalesPanel } from './SalesPanel'
import { SellScreen } from './SellScreen'
import { clearCartDraft, clearCashSession, loadCashSession, saveCashSession } from './storage'
import './pos.css'

export type PosAppProps = {
  api: ApiState
  user: CurrentUser
  canReturnToAdmin: boolean
  onNavigate: (view: AppView) => void
  onLogout: () => void
  /** La sesión se restauró desde el equipo porque no había red al abrir la app. */
  offlineStart?: boolean
  /** Lleva a la pantalla de inicio de sesión sin llamar al servidor (sesión vencida). */
  onSessionExpired?: () => void
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'no-data' }
  | { kind: 'error'; message: string }
  | { kind: 'open-cash' }
  | { kind: 'ready' }

type Toast = { id: number; text: string; tone: 'ok' | 'warn' | 'error' }
type PanelModal = 'sales' | 'close' | 'logout' | null
type PrintJob = { nonce: number; sale: Sale } | { nonce: number; summary: CashSummary }

function isNotFound(error: unknown) {
  return error instanceof ApiError && error.status === 404
}

export function PosApp({ user, canReturnToAdmin, onNavigate, onLogout, offlineStart = false, onSessionExpired }: PosAppProps) {
  const { engine, state } = usePosEngine(user.id)
  const now = useNow(20_000)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [session, setSession] = useState<CashSession | null>(null)
  const [panel, setPanel] = useState<PanelModal>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference)
  const [printJob, setPrintJob] = useState<PrintJob | null>(null)
  const toastId = useRef(0)
  const booted = useRef(false)
  const sessionRef = useRef<CashSession | null>(null)
  useEffect(() => {
    sessionRef.current = session
  })

  const notify = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    toastId.current += 1
    const id = toastId.current
    setToasts((current) => [...current.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), tone === 'ok' ? 4500 : 8000)
  }, [])

  // El usuario queda guardado (sin contraseña) para poder abrir el POS sin conexión.
  useEffect(() => {
    if (!offlineStart) void saveCachedUser(user).catch(() => undefined)
  }, [user, offlineStart])

  // --- Arranque: caja actual + instantánea ---
  const boot = useCallback(async () => {
    setPhase({ kind: 'loading' })
    const cachedSession = await loadCashSession(user.id).catch(() => null)

    const sessionPromise = (async (): Promise<{ session: CashSession | null; reachable: boolean; error?: string }> => {
      try {
        const current = await posRequest<CashSession>('/api/v1/cash/sessions/current')
        return { session: current, reachable: true }
      } catch (error) {
        if (isNotFound(error)) return { session: null, reachable: true }
        if (error instanceof ApiError && error.status === 401) {
          engine.markSessionExpired()
          return { session: cachedSession, reachable: false }
        }
        if (error instanceof ApiError && error.status !== 0 && error.status < 500) {
          return { session: null, reachable: true, error: errorMessage(error) }
        }
        return { session: cachedSession, reachable: false }
      }
    })()
    const snapshotPromise = engine.getState().snapshot ? Promise.resolve(true) : engine.refreshSnapshot()
    const [found, hasSnapshot] = await Promise.all([sessionPromise, snapshotPromise])
    if (!engine.getState().snapshot) {
      setPhase({ kind: 'no-data' })
      return
    }
    if (engine.getState().snapshot && hasSnapshot && found.reachable) void engine.refreshSnapshot()
    if (found.error) {
      setPhase({ kind: 'error', message: found.error })
      return
    }
    if (found.session) {
      setSession(found.session)
      void saveCashSession(user.id, found.session).catch(() => undefined)
      setPhase({ kind: 'ready' })
    } else {
      if (found.reachable) void clearCashSession().catch(() => undefined)
      setSession(null)
      setPhase(found.reachable
        ? { kind: 'open-cash' }
        : { kind: 'error', message: 'Sin conexión: no podemos confirmar tu caja. Conectate a la red para abrirla o continuar.' })
    }
  }, [engine, user.id])

  useEffect(() => {
    if (!state.loaded || booted.current) return
    booted.current = true
    // Arranque asíncrono: los estados se actualizan cuando responden la caja y la instantánea.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void boot()
  }, [state.loaded, boot])

  /** Al volver la red, comprueba que la caja siga abierta en el servidor. */
  const revalidateSession = useCallback(async () => {
    if (!sessionRef.current) return
    try {
      const current = await posRequest<CashSession>('/api/v1/cash/sessions/current')
      setSession(current)
      void saveCashSession(user.id, current).catch(() => undefined)
    } catch (error) {
      if (isNotFound(error)) {
        void clearCashSession().catch(() => undefined)
        setSession(null)
        setPhase({ kind: 'open-cash' })
        notify('Tu caja ya no está abierta en el servidor. Las ventas guardadas se enviarán igual.', 'warn')
      } else if (error instanceof ApiError && error.status === 401) {
        engine.markSessionExpired()
      }
    }
  }, [engine, notify, user.id])

  // --- Avisos del motor (conexión, sincronización) ---
  useEffect(() => {
    return engine.onEvent((event) => {
      if (event.type === 'offline') {
        notify('Sin conexión. Podés seguir vendiendo: las ventas se enviarán solas cuando vuelva la red.', 'warn')
      } else if (event.type === 'online') {
        notify(event.synced > 0
          ? `Conexión recuperada. Se enviaron ${event.synced} ${event.synced === 1 ? 'venta' : 'ventas'}.`
          : 'Conexión recuperada.', 'ok')
        void revalidateSession()
      } else if (event.type === 'synced') {
        notify(`${event.count} ${event.count === 1 ? 'venta enviada' : 'ventas enviadas'} al servidor.`, 'ok')
      } else if (event.type === 'attention') {
        notify(`${event.count} ${event.count === 1 ? 'venta fue rechazada' : 'ventas fueron rechazadas'} por el servidor. Revisalas en «Ventas de esta caja».`, 'error')
      } else if (event.type === 'unauthorized') {
        notify('Tu sesión venció: iniciá sesión de nuevo para sincronizar. Tus ventas siguen guardadas.', 'error')
      }
    })
  }, [engine, notify, revalidateSession])

  // --- Impresión (un solo documento montado a la vez) ---
  useEffect(() => {
    if (!printJob) return
    const timer = setTimeout(() => printReceipt(), 60)
    return () => clearTimeout(timer)
  }, [printJob])

  const printSale = useCallback((sale: Sale) => setPrintJob({ nonce: Date.now(), sale }), [])

  // --- Cierre de sesión ---
  const unsent = countByStatus(state.outbox, 'pending', 'sending', 'attention')
  function requestLogout() {
    if (state.sessionExpired && onSessionExpired) {
      onSessionExpired()
      return
    }
    if (unsent > 0) setPanel('logout')
    else onLogout()
  }

  function toggleSound() {
    const next = !soundEnabled
    setSoundEnabled(next)
    saveSoundPreference(next)
  }

  const pendingCount = countByStatus(state.outbox, 'pending', 'sending')
  const attentionCount = countByStatus(state.outbox, 'attention')
  const connection = state.connection
  const settings = state.snapshot?.snapshot.settings
  const snapshotAge = state.snapshot ? now - Date.parse(state.snapshot.fetchedAtUtc) : 0
  const staleCatalog = snapshotAge > 12 * 60 * 60 * 1000

  const connectionLabel = connection === 'offline' ? 'Sin conexión' : state.syncing ? 'Sincronizando…' : 'En línea'
  const connectionTone = connection === 'offline' ? 'offline' : state.syncing ? 'syncing' : 'online'

  return (
    <main className="pv-page">
      <header className="pv-top">
        <div className="pv-brand">
          {canReturnToAdmin && <button type="button" className="pv-icon-button pv-on-dark" onClick={() => onNavigate('panel')} aria-label="Volver al panel">‹</button>}
          <img src="/logo-tienda-la-ganga.png" alt="" />
          <div>
            <h1>Punto de venta</h1>
            <small>{session ? `${session.registerName} · ` : ''}{user.displayName}</small>
          </div>
        </div>

        <div className="pv-status" aria-label="Estado de conexión y sincronización">
          <span className={`pv-conn pv-conn-${connectionTone}`} role="status" data-testid="connection-status"><i />{connectionLabel}</span>
          <button
            type="button" className={`pv-pending${pendingCount > 0 ? ' has-pending' : ''}${attentionCount > 0 ? ' has-attention' : ''}`}
            onClick={() => session && setPanel('sales')} disabled={!session} data-testid="pending-count"
            title="Ventas por enviar al servidor"
          >
            {pendingCount} {pendingCount === 1 ? 'pendiente' : 'pendientes'}{attentionCount > 0 ? ` · ${attentionCount} con error` : ''}
          </button>
          <span className="pv-sync-times">
            <span>Catálogo actualizado {state.snapshot ? timeAgo(state.snapshot.fetchedAtUtc, now) : 'nunca'}</span>
            <span>Última sincronización {timeAgo(state.lastSyncAtUtc, now)}</span>
          </span>
        </div>

        <nav className="pv-actions" aria-label="Acciones de la caja">
          <button type="button" className="pv-btn pv-btn-small pv-on-dark-btn" onClick={toggleSound} aria-pressed={soundEnabled} title="Sonido y vibración del escáner">{soundEnabled ? '🔔 Sonido' : '🔕 Sin sonido'}</button>
          {session && <button type="button" className="pv-btn pv-btn-small pv-on-dark-btn" onClick={() => setPanel('sales')}>Ventas de esta caja</button>}
          {session && <button type="button" className="pv-btn pv-btn-small pv-on-dark-btn" onClick={() => setPanel('close')}>Cerrar caja</button>}
          <button type="button" className="pv-btn pv-btn-small pv-btn-outline-dark" onClick={requestLogout}>Cerrar sesión</button>
        </nav>
      </header>

      {state.sessionExpired && (
        <div className="pv-banner pv-banner-error pv-banner-bar" role="alert">
          Tu sesión venció: iniciá sesión de nuevo para sincronizar. Tus ventas siguen guardadas en este equipo.
          <button type="button" className="pv-btn pv-btn-small" onClick={() => (onSessionExpired ?? onLogout)()}>Iniciar sesión</button>
        </div>
      )}
      {offlineStart && connection === 'offline' && !state.sessionExpired && (
        <div className="pv-banner pv-banner-warn pv-banner-bar" role="status">
          Modo sin conexión: entraste con el usuario guardado en este equipo. Todo se sincroniza cuando vuelva la red.
        </div>
      )}
      {attentionCount > 0 && session && (
        <div className="pv-banner pv-banner-warn pv-banner-bar" role="alert">
          {attentionCount} {attentionCount === 1 ? 'venta requiere' : 'ventas requieren'} atención: el servidor no las aceptó.
          <button type="button" className="pv-btn pv-btn-small" onClick={() => setPanel('sales')}>Ver detalle</button>
        </div>
      )}
      {staleCatalog && connection === 'offline' && (
        <div className="pv-banner pv-banner-warn pv-banner-bar" role="status">El catálogo tiene más de 12 horas sin actualizarse: precios y existencias pueden haber cambiado.</div>
      )}

      {phase.kind === 'loading' && (
        <div className="pv-center-screen"><div className="pv-spinner" aria-hidden="true" /><p>Preparando el punto de venta…</p></div>
      )}

      {phase.kind === 'no-data' && (
        <div className="pv-center-screen">
          <div className="pv-card pv-nodata">
            <h1>No hay datos para vender</h1>
            <p>
              {connection === 'offline'
                ? 'Este equipo todavía no descargó el catálogo y no hay conexión. Conectate a internet una vez para bajar los productos; después podrás vender aunque se caiga la red.'
                : 'No pudimos descargar el catálogo ni confirmar tu caja. Comprobá la conexión e intentá de nuevo.'}
            </p>
            {state.snapshotError && <p className="pv-error">{state.snapshotError}</p>}
            <button type="button" className="pv-btn pv-btn-primary" onClick={() => { void boot() }}>Reintentar</button>
          </div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="pv-center-screen">
          <div className="pv-card pv-nodata">
            <h1>No pudimos preparar tu caja</h1>
            <p className="pv-error">{phase.message}</p>
            <button type="button" className="pv-btn pv-btn-primary" onClick={() => { void boot() }}>Reintentar</button>
          </div>
        </div>
      )}

      {phase.kind === 'open-cash' && (
        <OpenCashScreen
          userName={user.displayName}
          online={connection === 'online'}
          onOpened={(opened) => {
            setSession(opened)
            void saveCashSession(user.id, opened).catch(() => undefined)
            setPhase({ kind: 'ready' })
            notify(`${opened.registerName} abierta. ¡Buenas ventas!`, 'ok')
          }}
        />
      )}

      {phase.kind === 'ready' && session && (
        <SellScreen
          user={user}
          session={session}
          engine={engine}
          engineState={state}
          soundEnabled={soundEnabled}
          onPrint={printSale}
          notify={notify}
        />
      )}

      {panel === 'sales' && session && (
        <SalesPanel
          session={session}
          entries={state.outbox}
          online={connection === 'online'}
          syncing={state.syncing}
          onPrint={printSale}
          onRetry={(id) => { void engine.retry(id) }}
          onRetryAll={() => { void engine.retryAll() }}
          onClose={() => setPanel(null)}
        />
      )}

      {panel === 'close' && session && (
        <CloseCashModal
          session={session}
          pendingCount={pendingCount}
          attentionCount={attentionCount}
          online={connection === 'online'}
          syncing={state.syncing}
          onSyncNow={() => { void engine.syncNow({ force: true }) }}
          onClosed={() => {
            void clearCashSession().catch(() => undefined)
            void clearCartDraft().catch(() => undefined)
          }}
          onPrintSummary={(summary) => setPrintJob({ nonce: Date.now(), summary })}
          onFinish={() => {
            setPanel(null)
            setSession(null)
            setPhase({ kind: 'open-cash' })
          }}
          onCancel={() => setPanel(null)}
        />
      )}

      {panel === 'logout' && (
        <Modal
          title="Tenés ventas sin enviar"
          size="sm"
          onClose={() => setPanel(null)}
          footer={(
            <>
              <button type="button" className="pv-btn pv-btn-ghost" data-autofocus onClick={() => setPanel(null)}>Quedarme</button>
              <button type="button" className="pv-btn pv-btn-primary" onClick={() => { setPanel(null); onLogout() }}>Cerrar sesión de todos modos</button>
            </>
          )}
        >
          <p className="pv-confirm-big">Hay <strong>{unsent}</strong> {unsent === 1 ? 'venta' : 'ventas'} que todavía no se {unsent === 1 ? 'envió' : 'enviaron'} al servidor.</p>
          <p className="pv-note">
            No se pierden: quedan guardadas en este equipo y se envían cuando vos volvás a iniciar sesión con conexión.
            Otra persona que use este equipo no puede enviarlas como suyas.
          </p>
        </Modal>
      )}

      {printJob && settings && ('sale' in printJob
        ? <PrintableReceipt key={printJob.nonce} sale={printJob.sale} settings={settings} />
        : <PrintableCashSummary key={printJob.nonce} summary={printJob.summary} storeName={settings.storeName} />)}

      <div className="pv-toasts" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`pv-toast pv-toast-${toast.tone}`}>{toast.text}</div>)}
      </div>
    </main>
  )
}
