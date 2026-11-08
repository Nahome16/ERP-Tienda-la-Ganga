import { useState } from 'react'
import { hasPermission } from '../lib/access'
import type { CashConsolidated } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import type { CurrentUser } from '../types'
import { getConsolidated, getSettings } from '../admin/adminApi'
import { BreakdownTables, Difference, SessionDialog } from '../admin/CashDialogs'
import { PrintableCashSlip, type SlipData } from '../admin/CashSlip'
import { printCashSlip } from '../admin/cashSlipData'
import { addDays, formatIsoDate, formatTime, managuaToday } from '../admin/format'
import { useFetch } from '../admin/hooks'
import { Kpi, LoadError, Notice, Row, Spinner, Tag } from '../admin/ui'

function consolidatedSlip(storeName: string, data: CashConsolidated): SlipData {
  return {
    storeName,
    title: `Cierre del día ${formatIsoDate(data.date)}`,
    meta: [['Cajas', String(data.sessions.length)], ['Abiertas', String(data.openSessionsCount)]],
    totals: data.totals,
    expectedNio: data.expectedCashNio,
    expectedUsd: data.expectedCashUsd,
    countedNio: data.countedCashNio,
    countedUsd: data.countedCashUsd,
    registers: data.sessions.map((item) => ({
      name: item.session.registerName,
      detail: `${item.session.openedByName} · ${item.session.closedAtUtc ? 'cerrada' : 'abierta'}`,
      totalNio: item.totals.netTotalNio,
    })),
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

  const countedKnown = data !== null && data.countedCashNio !== null && data.countedCashUsd !== null

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Operación · <b className="live-data">Datos reales</b></p>
          <h1>Caja y cierres</h1>
          <p className="page-summary">Consolidado del día por caja, método de pago y banco. Fechas en hora de Managua.</p>
        </div>
        <div className="page-actions">
          <button type="button" className="secondary-button" onClick={reload}>Actualizar</button>
          <button type="button" className="primary-button" disabled={!data} onClick={printCashSlip}>Imprimir cierre del día</button>
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
          {totals.reviewCount > 0 && (
            <Notice tone="warn">
              <span>{totals.reviewCount} venta{totals.reviewCount === 1 ? '' : 's'} requiere{totals.reviewCount === 1 ? '' : 'n'} revisión (stock, precio, tasa o caja cerrada).</span>
              <a href="#ventas">Revisar ventas</a>
            </Notice>
          )}

          <div className="adm-kpis">
            <Kpi label="Total vendido" value={formatNio(totals.netTotalNio)} hint={`Bruto ${formatNio(totals.grossTotalNio)}`} />
            <Kpi label="Efectivo" value={formatNio(totals.cashTotalNio)} hint="Neto, ya descontado el cambio" />
            <Kpi label="Transferencia" value={formatNio(totals.transferTotalNio)} />
            <Kpi label="POS / Tarjeta" value={formatNio(totals.cardTotalNio)} />
            <Kpi label="Descuentos" value={formatNio(totals.discountTotalNio)} />
            <Kpi label="Ventas" value={totals.salesCount} hint={`${totals.voidedCount} anulada${totals.voidedCount === 1 ? '' : 's'} (${formatNio(totals.voidedTotalNio)})`} tone={totals.reviewCount > 0 ? 'warn' : undefined} />
          </div>

          <section className="panel-card adm-card">
            <h2 className="adm-card-title">Cajas del día</h2>
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Caja</th><th>Cajero</th><th>Apertura</th><th>Estado</th><th className="numeric">Total vendido</th>
                    <th className="numeric">Esperado C$</th><th className="numeric">Esperado US$</th>
                    <th className="numeric">Contado C$ / US$</th><th>Diferencia</th>
                    <th className="actions-col"><span className="visually-hidden">Acciones</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.length === 0 && <tr><td colSpan={10} className="adm-empty">Ninguna caja se abrió este día.</td></tr>}
                  {data.sessions.map((item) => {
                    const { session } = item
                    const isOpen = session.closedAtUtc === null
                    return (
                      <tr key={session.id}>
                        <td><strong>{session.registerName}</strong></td>
                        <td>{session.openedByName}</td>
                        <td>{formatTime(session.openedAtUtc)}{session.closedAtUtc && <small className="row-sub">cierre {formatTime(session.closedAtUtc)}</small>}</td>
                        <td><Tag tone={isOpen ? 'warn' : 'ok'}>{isOpen ? 'Abierta' : 'Cerrada'}</Tag></td>
                        <td className="numeric">{formatNio(item.totals.netTotalNio)}{item.totals.reviewCount > 0 && <small className="row-sub adm-neg">{item.totals.reviewCount} por revisar</small>}</td>
                        <td className="numeric">{formatNio(item.expectedCashNio)}</td>
                        <td className="numeric">{formatUsd(item.expectedCashUsd)}</td>
                        <td className="numeric">
                          {session.countedCashNio === null ? '—' : <>{formatNio(session.countedCashNio)}<small className="row-sub">{formatUsd(session.countedCashUsd ?? 0)}</small></>}
                        </td>
                        <td>
                          {isOpen ? <span className="adm-muted">—</span> : (
                            <>
                              <Difference value={item.differenceCashNio} format={formatNio} />
                              <small className="row-sub"><Difference value={item.differenceCashUsd} format={formatUsd} /></small>
                            </>
                          )}
                        </td>
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

          <div className="adm-split">
            <section className="panel-card adm-card">
              <h2 className="adm-card-title">Efectivo esperado vs contado</h2>
              <Row label="Esperado C$">{formatNio(data.expectedCashNio)}</Row>
              <Row label="Contado C$">{data.countedCashNio === null ? 'Hay cajas abiertas' : formatNio(data.countedCashNio)}</Row>
              <Row label="Diferencia C$">{<Difference value={data.countedCashNio === null ? null : data.countedCashNio - data.expectedCashNio} format={formatNio} />}</Row>
              <Row label="Esperado US$">{formatUsd(data.expectedCashUsd)}</Row>
              <Row label="Contado US$">{data.countedCashUsd === null ? 'Hay cajas abiertas' : formatUsd(data.countedCashUsd)}</Row>
              <Row label="Diferencia US$">{<Difference value={data.countedCashUsd === null ? null : data.countedCashUsd - data.expectedCashUsd} format={formatUsd} />}</Row>
              {!countedKnown && <p className="adm-help" style={{ marginTop: 8 }}>El contado aparece cuando todas las cajas del día están cerradas.</p>}
            </section>
            <section className="panel-card adm-card">
              <h2 className="adm-card-title">Efectivo recibido</h2>
              <Row label="C$ recibidos">{formatNio(totals.cashNioTendered)}</Row>
              <Row label="US$ recibidos">{formatUsd(totals.cashUsdTendered)}</Row>
              <Row label="US$ en córdobas">{formatNio(totals.cashUsdEquivalentNio)}</Row>
              <Row label="Cambio entregado">{formatNio(totals.changeGivenNio)}</Row>
            </section>
          </div>

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
