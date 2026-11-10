import { useState } from 'react'
import { hasPermission } from '../lib/access'
import type { CashConsolidated } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import type { CurrentUser } from '../types'
import { getConsolidated, getSettings } from '../admin/adminApi'
import { SessionDialog } from '../admin/CashDialogs'
import { BreakdownTables, ReconBadge, ReconciliationBlock, TenderedBreakdown } from '../admin/CashReconciliation'
import { PrintableCashSlip, type SlipData } from '../admin/CashSlip'
import { printCashSlip } from '../admin/cashSlipData'
import { addDays, formatIsoDate, formatTime, managuaToday } from '../admin/format'
import { managuaDate } from '../admin/reportsApi'
import { useFetch } from '../admin/hooks'
import { methodsFromConsolidated, methodsFromSummary, methodStatus } from '../admin/reconciliation'
import { ExcelShortcut } from '../admin/reportsUi'
import { Kpi, LoadError, Notice, Spinner, Tag } from '../admin/ui'

function consolidatedSlip(storeName: string, data: CashConsolidated): SlipData {
  return {
    storeName,
    title: `Cierre del día ${formatIsoDate(data.date)}`,
    meta: [['Cajas', String(data.sessions.length)], ['Abiertas', String(data.openSessionsCount)]],
    totals: data.totals,
    methods: methodsFromConsolidated(data),
    open: data.openSessionsCount > 0,
    registers: data.sessions.map((item) => {
      const isOpen = item.session.closedAtUtc === null
      const states = methodsFromSummary(item).map((method) => `${method.key === 'cash' ? 'Efect.' : method.key === 'transfer' ? 'Transf.' : 'Tarj.'} ${methodStatus(method, isOpen).label}`)
      return {
        name: item.session.registerName,
        detail: `${item.session.openedByName} · ${isOpen ? 'abierta' : 'cerrada'} · ${states.join(' · ')}`,
        totalNio: item.totals.netTotalNio,
      }
    }),
  }
}

export function CashView({ user }: { user: CurrentUser }) {
  const [date, setDate] = useState(() => managuaToday())
  const [detailId, setDetailId] = useState<string | null>(null)
  const today = managuaToday()
  const canClose = hasPermission(user, 'cash.report.read')

  const { data, error, loading, reload } = useFetch<CashConsolidated>(`cash|${date}`, (signal) => getConsolidated(date, signal), Boolean(date))
  const settings = useFetch('cash-settings', (signal) => getSettings(signal))
  const storeName = settings.data?.storeName ?? 'Tienda La Ganga'
  const totals = data?.totals

  const dayOpen = data !== null && data.openSessionsCount > 0

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Operación · <b className="live-data">Datos reales</b></p>
          <h1>Caja y cierres</h1>
          <p className="page-summary">Consolidado del día por caja, método de pago, moneda y banco, con lo esperado contra lo verificado. Fechas en hora de Managua.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="secondary-button" onClick={reload}>Actualizar</button>
          <button type="button" className="primary-button" disabled={!data} onClick={printCashSlip}>Imprimir cierre del día</button>
          <ExcelShortcut kind="cash" range={{ from: date, to: date }} />
        </div>
      </header>

      <div className="adm-toolbar">
        <button type="button" className="secondary-button" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior">‹</button>
        <label className="adm-field-inline">
          <span>Fecha</span>
          <input type="date" value={date} max={today} onChange={(event) => { if (event.target.value) setDate(event.target.value) }} />
        </label>
        <button type="button" className="secondary-button" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Día siguiente">›</button>
        {date !== today && <button type="button" className="link-button" onClick={() => setDate(today)}>Ir a hoy</button>}
        <strong style={{ marginLeft: 8 }}>{formatIsoDate(date)}</strong>
      </div>

      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Cargando consolidado…" />}

      {data && totals && (
        <>
          {data.openSessionsCount > 0 && (
            <Notice tone="warn">
              <span>Hay {data.openSessionsCount} caja{data.openSessionsCount === 1 ? '' : 's'} abierta{data.openSessionsCount === 1 ? '' : 's'}: los montos todavía pueden cambiar. Cerrala desde la tabla de abajo cuando termine el turno.</span>
            </Notice>
          )}
          {data.sessions.some((item) => managuaDate(new Date(item.session.openedAtUtc)) !== date) && (
            <Notice tone="info">
              <span>Algunas cajas se abrieron antes de esta fecha. Los totales de arriba cuentan solo las ventas de esta fecha; en la tabla cada caja muestra su turno completo, porque el arqueo se hace por turno.</span>
            </Notice>
          )}
          {totals.reviewCount > 0 && (
            <Notice tone="warn">
              <span>{totals.reviewCount} venta{totals.reviewCount === 1 ? '' : 's'} requiere{totals.reviewCount === 1 ? '' : 'n'} revisión (stock, precio, tasa o caja cerrada).</span>
              <a href="#ventas">Revisar ventas</a>
            </Notice>
          )}

          <div className="adm-kpis">
            <Kpi label="Total vendido" value={formatNio(totals.netTotalNio)} hint={`Bruto ${formatNio(totals.grossTotalNio)}`} />
            <Kpi label="Efectivo" value={formatNio(totals.cashTotalNio)} hint="Neto, ya descontado el cambio" />
            <Kpi label="Transferencia" value={formatNio(totals.transferTotalNio)} hint={totals.transferUsdTendered > 0 ? `Incluye ${formatUsd(totals.transferUsdTendered)}` : 'Equivalente en C$'} />
            <Kpi label="POS / Tarjeta" value={formatNio(totals.cardTotalNio)} hint={totals.cardUsdTendered > 0 ? `Incluye ${formatUsd(totals.cardUsdTendered)}` : 'Equivalente en C$'} />
            <Kpi label="Descuentos" value={formatNio(totals.discountTotalNio)} />
            <Kpi label="Ventas" value={totals.salesCount} hint={`${totals.voidedCount} anulada${totals.voidedCount === 1 ? '' : 's'} (${formatNio(totals.voidedTotalNio)})`} tone={totals.reviewCount > 0 ? 'warn' : undefined} />
          </div>

          <section className="panel-card adm-card">
            <h2 className="adm-card-title">Cajas del día</h2>
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Caja</th><th>Apertura</th><th>Estado</th><th className="numeric">Total vendido</th>
                    <th className="numeric">Efectivo esperado</th><th className="numeric">Efectivo contado</th>
                    <th>Efectivo</th><th>Transferencia</th><th>Tarjeta (POS)</th>
                    <th className="actions-col"><span className="visually-hidden">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.length === 0 && <tr><td colSpan={10} className="adm-empty">Ninguna caja estuvo abierta este día.</td></tr>}
                  {data.sessions.map((item) => {
                    const { session } = item
                    const isOpen = session.closedAtUtc === null
                    const [cash, transfer, card] = methodsFromSummary(item)
                    return (
                      <tr key={session.id}>
                        <td><strong>{session.registerName}</strong><small className="row-sub">{session.openedByName}</small></td>
                        <td className="nowrap">{formatTime(session.openedAtUtc)}{session.closedAtUtc && <small className="row-sub">cierre {formatTime(session.closedAtUtc)}</small>}</td>
                        <td><Tag tone={isOpen ? 'warn' : 'ok'}>{isOpen ? 'Abierta' : 'Cerrada'}</Tag></td>
                        <td className="numeric">{formatNio(item.totals.netTotalNio)}{item.totals.reviewCount > 0 && <small className="row-sub adm-neg">{item.totals.reviewCount} por revisar</small>}</td>
                        <td className="numeric">{formatNio(item.expectedCashNio)}<small className="row-sub">{formatUsd(item.expectedCashUsd)}</small></td>
                        <td className="numeric">
                          {session.countedCashNio === null ? '—' : <>{formatNio(session.countedCashNio)}<small className="row-sub">{formatUsd(session.countedCashUsd ?? 0)}</small></>}
                        </td>
                        <td><ReconBadge method={cash} open={isOpen} /></td>
                        <td><ReconBadge method={transfer} open={isOpen} /></td>
                        <td><ReconBadge method={card} open={isOpen} /></td>
                        <td className="actions-col">
                          <button type="button" className="link-button" onClick={() => setDetailId(session.id)}>{isOpen && canClose ? 'Detalle / Cerrar' : 'Detalle'}</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel-card adm-card">
            <h2 className="adm-card-title">Esperado vs verificado</h2>
            <p className="adm-help">Efectivo contra el conteo físico, transferencias contra el banco y tarjeta contra el cierre de lote de la terminal, cada uno por moneda.{dayOpen ? ' Lo verificado aparece cuando todas las cajas del día están cerradas.' : ''}</p>
            <ReconciliationBlock methods={methodsFromConsolidated(data)} open={dayOpen} scope="day" />
          </section>

          <section className="panel-card adm-card">
            <h2 className="adm-card-title">Recibido por método y moneda</h2>
            <TenderedBreakdown totals={totals} />
          </section>

          <section className="panel-card adm-card"><BreakdownTables totals={totals} /></section>
        </>
      )}

      {detailId && (
        <SessionDialog
          key={detailId} sessionId={detailId} storeName={storeName} canClose={canClose}
          onClose={() => setDetailId(null)} onChanged={reload}
        />
      )}
      {data && !detailId && <PrintableCashSlip data={consolidatedSlip(storeName, data)} />}
    </main>
  )
}
