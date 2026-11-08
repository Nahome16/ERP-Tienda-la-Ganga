import { useEffect } from 'react'
import { allowedViews } from '../lib/access'
import type { CashConsolidated, InventorySummary } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import type { AppView, CurrentUser } from '../types'
import { getConsolidated, getInventorySummary } from '../admin/adminApi'
import { formatInt, formatIsoDate, formatTime, managuaToday } from '../admin/format'
import { useFetch } from '../admin/hooks'
import { Kpi, LoadError, Notice, Spinner, Tag } from '../admin/ui'

const refreshMs = 60_000

export function DashboardView({ user, onNavigate }: { user: CurrentUser; onNavigate: (view: AppView) => void }) {
  const today = managuaToday()
  const cash = useFetch<CashConsolidated>(`dash-cash|${today}`, (signal) => getConsolidated(today, signal))
  const stock = useFetch<InventorySummary>('dash-stock', (signal) => getInventorySummary(signal))
  const reloadCash = cash.reload
  const reloadStock = stock.reload

  useEffect(() => {
    const timer = window.setInterval(() => { reloadCash(); reloadStock() }, refreshMs)
    return () => window.clearInterval(timer)
  }, [reloadCash, reloadStock])

  const allowed = allowedViews(user)
  const totals = cash.data?.totals
  const openSessions = cash.data?.sessions.filter((item) => item.session.closedAtUtc === null) ?? []
  const methods = totals
    ? [
      { label: 'Efectivo', value: totals.cashTotalNio, className: '' },
      { label: 'Transferencia', value: totals.transferTotalNio, className: 'orange' },
      { label: 'POS / Tarjeta', value: totals.cardTotalNio, className: 'dark' },
    ]
    : []
  const methodsTotal = methods.reduce((sum, item) => sum + item.value, 0)
  const quick: { view: AppView; title: string; hint: string }[] = [
    { view: 'pos', title: 'Nueva venta', hint: 'Abrir el punto de venta' },
    { view: 'caja', title: 'Cierre de caja', hint: 'Consolidado y arqueo' },
    { view: 'ventas', title: 'Ventas', hint: 'Historial y revisiones' },
    { view: 'productos', title: 'Productos', hint: 'Crear, importar, etiquetas' },
    { view: 'inventario', title: 'Inventario', hint: 'Existencias y Kardex' },
  ]

  return (
    <main className="admin-page dashboard-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">{formatIsoDate(today)} · <b className="live-data">Datos reales</b></p>
          <h1>Panel</h1>
          <p className="page-summary">Hola, {user.displayName}. Así va el día en la tienda.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={() => { reloadCash(); reloadStock() }}>Actualizar</button>
          {allowed.includes('pos') && <button className="primary-button" type="button" onClick={() => onNavigate('pos')}>Nueva venta</button>}
        </div>
      </header>

      {cash.error && <LoadError message={`No se pudo cargar el resumen del día: ${cash.error}`} onRetry={cash.reload} />}
      {cash.loading && !cash.data && <Spinner label="Cargando el día…" />}

      {cash.data && totals && (
        <>
          {cash.data.openSessionsCount > 0 && (
            <Notice tone="info">
              <span>{cash.data.openSessionsCount} caja{cash.data.openSessionsCount === 1 ? '' : 's'} abierta{cash.data.openSessionsCount === 1 ? '' : 's'}: {openSessions.map((item) => `${item.session.registerName} (${item.session.openedByName}, desde ${formatTime(item.session.openedAtUtc)})`).join(' · ')}</span>
            </Notice>
          )}
          {totals.reviewCount > 0 && (
            <Notice tone="warn">
              <span>{totals.reviewCount} venta{totals.reviewCount === 1 ? '' : 's'} por revisar.</span>
              {allowed.includes('ventas') && <a href="#ventas">Revisar ahora</a>}
            </Notice>
          )}
          <div className="adm-kpis">
            <Kpi label="Vendido hoy" value={formatNio(totals.netTotalNio)} hint={`${totals.salesCount} venta${totals.salesCount === 1 ? '' : 's'}${totals.voidedCount > 0 ? ` · ${totals.voidedCount} anulada${totals.voidedCount === 1 ? '' : 's'}` : ''}`} />
            <Kpi label="Efectivo" value={formatNio(totals.cashTotalNio)} />
            <Kpi label="Transferencia" value={formatNio(totals.transferTotalNio)} />
            <Kpi label="POS / Tarjeta" value={formatNio(totals.cardTotalNio)} />
            <Kpi label="Cajas abiertas" value={cash.data.openSessionsCount} hint={`de ${cash.data.sessions.length} abierta${cash.data.sessions.length === 1 ? '' : 's'} hoy`} tone={cash.data.openSessionsCount > 0 ? 'warn' : undefined} />
            <Kpi label="Ventas por revisar" value={totals.reviewCount} tone={totals.reviewCount > 0 ? 'danger' : 'ok'} />
          </div>
        </>
      )}

      <div className="adm-split">
        <section className="panel-card adm-card">
          <h2 className="adm-card-title">Ventas de hoy por método de pago</h2>
          {!totals && !cash.error && <Spinner />}
          {totals && methodsTotal === 0 && <p className="adm-muted">Todavía no hay ventas hoy.</p>}
          {totals && methodsTotal > 0 && (
            <div className="adm-bars">
              {methods.map((item) => (
                <div className="adm-bar-row" key={item.label}>
                  <span>{item.label}</span>
                  <b>{formatNio(item.value)} · {Math.round((item.value / methodsTotal) * 100)}%</b>
                  <div><i className={item.className} style={{ width: `${Math.max(2, (item.value / methodsTotal) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel-card adm-card">
          <h2 className="adm-card-title">Existencias</h2>
          {stock.error && <p className="adm-muted">No se pudo cargar el resumen de inventario.</p>}
          {stock.data && (
            <div className="adm-quick" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div><span className="adm-muted">Agotados</span><br /><strong className={stock.data.outOfStockCount > 0 ? 'adm-neg' : undefined} style={{ fontSize: '1.4rem' }}>{formatInt(stock.data.outOfStockCount)}</strong></div>
              <div><span className="adm-muted">Bajo stock</span><br /><strong style={{ fontSize: '1.4rem' }}>{formatInt(stock.data.lowStockCount)}</strong></div>
              <div><span className="adm-muted">Negativos</span><br /><strong className={stock.data.negativeCount > 0 ? 'adm-neg' : undefined} style={{ fontSize: '1.4rem' }}>{formatInt(stock.data.negativeCount)}</strong>{stock.data.negativeCount > 0 && <> <Tag tone="danger">revisar</Tag></>}</div>
              <div><span className="adm-muted">Unidades</span><br /><strong style={{ fontSize: '1.4rem' }}>{formatInt(stock.data.totalUnits)}</strong></div>
            </div>
          )}
          {!stock.data && !stock.error && <Spinner />}
        </section>
      </div>

      <section className="panel-card adm-card">
        <h2 className="adm-card-title">Accesos rápidos</h2>
        <div className="adm-quick">
          {quick.filter((item) => allowed.includes(item.view)).map((item) => (
            <button key={item.view} type="button" onClick={() => onNavigate(item.view)}><strong>{item.title}</strong><small>{item.hint}</small></button>
          ))}
        </div>
      </section>
    </main>
  )
}
