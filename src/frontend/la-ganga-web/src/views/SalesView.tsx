import { useState } from 'react'
import { hasPermission } from '../lib/access'
import type { PageResult, Sale } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { listSales, listSessions } from '../admin/adminApi'
import { channelLabels, formatDateTime, formatTime, managuaToday } from '../admin/format'
import { useDebounced, useFetch } from '../admin/hooks'
import { SaleDialog } from '../admin/SaleDialog'
import { ExcelShortcut } from '../admin/reportsUi'
import { LoadError, Pagination, Spinner, Tag } from '../admin/ui'

const pageSize = 25

export function SalesView({ user }: { user: CurrentUser }) {
  const canSessions = hasPermission(user, 'cash.report.read')
  const today = managuaToday()
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [sessionId, setSessionId] = useState('')
  const [status, setStatus] = useState('')
  const [needsReview, setNeedsReview] = useState(false)
  const [numberInput, setNumberInput] = useState('')
  const number = useDebounced(numberInput)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Sale | null>(null)

  const sessions = useFetch(`sessions|${from}|${to}`, (signal) => listSessions(from, to, signal), canSessions && Boolean(from) && Boolean(to) && from <= to)
  const sales = useFetch<PageResult<Sale>>(
    `sales|${from}|${to}|${sessionId}|${status}|${needsReview}|${number}|${page}`,
    (signal) => listSales({ from, to, sessionId, status, needsReview, number, page, pageSize }, signal),
  )

  const items = sales.data?.items ?? []
  const sessionList = sessions.data ?? []

  function resetPage<T>(setter: (value: T) => void) {
    return (value: T) => { setter(value); setPage(1) }
  }

  function handleChanged(updated: Sale) {
    setSelected(updated)
    sales.reload()
  }

  const rangeInvalid = from > to

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Operación · <b className="live-data">Datos reales</b></p>
          <h1>Ventas</h1>
          <p className="page-summary">Historial de toda la tienda. Abrí una venta para reimprimir el recibo, anularla o resolver una revisión.</p>
        </div>
        <div className="page-actions"><ExcelShortcut kind="sales" range={{ from, to }} /></div>
      </header>

      <section className="panel-card adm-card">
        <div className="adm-toolbar">
          <label className="adm-field-inline"><span>Desde</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => { if (event.target.value) { resetPage(setFrom)(event.target.value); setSessionId('') } }} />
          </label>
          <label className="adm-field-inline"><span>Hasta</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => { if (event.target.value) { resetPage(setTo)(event.target.value); setSessionId('') } }} />
          </label>
          {canSessions && (
            <label className="adm-field-inline"><span>Caja / turno</span>
              <select value={sessionId} onChange={(event) => resetPage(setSessionId)(event.target.value)} aria-label="Filtrar por caja">
                <option value="">Todas las cajas</option>
                {sessionList.map((item) => (
                  <option key={item.session.id} value={item.session.id}>{item.session.registerName} · {item.session.openedByName} · {formatDateTime(item.session.openedAtUtc)}</option>
                ))}
              </select>
            </label>
          )}
          <label className="adm-field-inline"><span>Estado</span>
            <select value={status} onChange={(event) => resetPage(setStatus)(event.target.value)} aria-label="Filtrar por estado">
              <option value="">Todas</option>
              <option value="Confirmed">Confirmadas</option>
              <option value="Voided">Anuladas</option>
            </select>
          </label>
          <label className="adm-field-inline"><span>Número</span>
            <input type="text" placeholder="V-000123" value={numberInput} onChange={(event) => { setNumberInput(event.target.value); setPage(1) }} aria-label="Buscar por número de venta" />
          </label>
          <label className="adm-check">
            <input type="checkbox" checked={needsReview} onChange={(event) => resetPage(setNeedsReview)(event.target.checked)} /> Solo por revisar
          </label>
        </div>
        {rangeInvalid && <p className="adm-neg">La fecha «Desde» no puede ser posterior a «Hasta».</p>}
        {sales.error && <LoadError message={sales.error} onRetry={sales.reload} />}

        <div className="table-scroll">
          <table className="adm-table">
            <thead>
              <tr><th>Número</th><th>Fecha</th><th>Caja</th><th>Vendedor</th><th>Canal</th><th className="numeric">Total</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {sales.loading && items.length === 0 && <tr><td colSpan={7}><Spinner label="Cargando ventas…" /></td></tr>}
              {!sales.loading && !sales.error && items.length === 0 && <tr><td colSpan={7} className="adm-empty">No hay ventas con estos filtros.</td></tr>}
              {items.map((sale) => (
                <tr
                  key={sale.id} className={sale.status === 'Voided' ? 'clickable inactive-row' : 'clickable'} tabIndex={0}
                  onClick={() => setSelected(sale)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(sale) } }}
                  aria-label={`Venta ${sale.number}, ${formatNio(sale.totalNio)}`}
                >
                  <td><strong>{sale.number}</strong></td>
                  <td>{formatDateTime(sale.createdAtUtc)}{sale.isOffline && <small className="row-sub">sin conexión · recibida {formatTime(sale.receivedAtUtc)}</small>}</td>
                  <td>{sale.registerName}</td>
                  <td>{sale.sellerName}</td>
                  <td>{channelLabels[sale.channel] ?? sale.channel}</td>
                  <td className="numeric">{formatNio(sale.totalNio)}</td>
                  <td>
                    <span className="adm-actions" style={{ gap: 4 }}>
                      <Tag tone={sale.status === 'Voided' ? 'danger' : 'ok'}>{sale.status === 'Voided' ? 'Anulada' : 'Confirmada'}</Tag>
                      {sale.requiresReview && <Tag tone="warn">Por revisar</Tag>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sales.data && <Pagination page={sales.data.page} totalPages={sales.data.totalPages} totalCount={sales.data.totalCount} onPage={setPage} noun="ventas" />}
      </section>

      {selected && <SaleDialog key={selected.id} sale={selected} user={user} onClose={() => setSelected(null)} onChanged={handleChanged} />}
    </main>
  )
}
