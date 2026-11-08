import { useEffect, useState } from 'react'
import { AdminShell } from './components/AdminShell'
import type { ApiState, AppView, HealthStatus } from './types'
import { DashboardView } from './views/DashboardView'
import { InventoryView } from './views/InventoryView'
import { PosView } from './views/PosView'

const knownViews: AppView[] = ['panel', 'ventas', 'pos', 'caja', 'historial', 'delivery', 'pedidos', 'clientes', 'compras', 'inventario']

const moduleCopy: Record<Exclude<AppView, 'panel' | 'pos' | 'inventario'>, { title: string; summary: string }> = {
  ventas: { title: 'Ventas', summary: 'Resumen comercial, metas y resultados del período.' },
  caja: { title: 'Caja', summary: 'Apertura, movimientos, dinero esperado y cierre.' },
  historial: { title: 'Historial de ventas', summary: 'Consulta de tickets, pagos, anulaciones y devoluciones.' },
  delivery: { title: 'Delivery', summary: 'Entregas asignadas, rutas, estados y comprobantes.' },
  pedidos: { title: 'Pedidos', summary: 'Preparación, pago y entrega controlados por separado.' },
  clientes: { title: 'Clientes', summary: 'Contactos, compras, preferencias, abonos y saldos.' },
  compras: { title: 'Compras', summary: 'Proveedores, recepción de mercadería y costos.' },
}

function isAppView(value: string): value is AppView {
  return knownViews.some((view) => view === value)
}

function viewFromHash(): AppView {
  const value = window.location.hash.replace('#', '')
  return isAppView(value) ? value : 'panel'
}

function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.status === 'healthy'
    && typeof candidate.service === 'string'
    && typeof candidate.timeZone === 'string'
    && typeof candidate.checkedAtUtc === 'string'
}

function ModulePlaceholder({ view }: { view: keyof typeof moduleCopy }) {
  const module = moduleCopy[view]
  return (
    <main className="admin-page placeholder-page">
      <header className="page-header">
        <div><p className="page-kicker">Módulo administrativo</p><h1>{module.title}</h1><p className="page-summary">{module.summary}</p></div>
      </header>
      <section className="placeholder-card">
        <span>Próxima etapa</span>
        <h2>La estructura visual ya está reservada.</h2>
        <p>Diseñaremos este módulo paso a paso antes de conectar sus reglas y datos reales.</p>
      </section>
    </main>
  )
}

function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' })
  const [view, setView] = useState<AppView>(() => viewFromHash())

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`Estado HTTP inesperado: ${response.status}`)
        const payload: unknown = await response.json()
        if (!isHealthStatus(payload)) throw new Error('Respuesta de salud inválida')
        setApi({ kind: 'ready', data: payload })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setApi({ kind: 'offline' })
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function handleHashChange() {
      setView(viewFromHash())
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function navigate(nextView: AppView) {
    setView(nextView)
    window.history.replaceState(null, '', `#${nextView}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (view === 'pos') return <PosView api={api} onNavigate={navigate} />

  return (
    <AdminShell activeView={view} api={api} onNavigate={navigate}>
      {view === 'panel' && <DashboardView onNavigate={navigate} />}
      {view === 'inventario' && <InventoryView />}
      {view !== 'panel' && view !== 'inventario' && <ModulePlaceholder view={view} />}
    </AdminShell>
  )
}

export default App
