import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight, Ban, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Clock, Printer, ReceiptText, RefreshCw, Search,
  TriangleAlert, WifiOff, type LucideIcon,
} from 'lucide-react'
import type { CashSession, PaymentMethod, Sale, SaleChannel } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { channelLabel, formatDateTime, formatTime, mergeSales, type SaleRow } from './format'
import {
  dayDiff, describePeriod, inPeriod, managuaDate, monthGrid, monthName, quickPeriod, searchSales, shiftDate, shiftMonth, stepPeriod,
  summarizeSales, type SalesPeriod, type SalesSummary,
} from './salesPeriod'
import { Modal } from './Modal'
import { VoidSaleModal } from './VoidSaleModal'
import { errorMessage, posRequest } from './net'
import type { OutboxEntry } from './types'

type SalesPanelProps = {
  session: CashSession
  entries: OutboxEntry[]
  online: boolean
  syncing: boolean
  onPrint: (sale: Sale) => void
  onRetry: (clientSaleId: string) => void
  onRetryAll: () => void
  onClose: () => void
  /** El cajero puede anular sin autorización (por ejemplo, el administrador). */
  canVoidDirect: boolean
  /** Venta anulada desde la caja; `reload` = cargar sus prendas al carrito para cobrar de nuevo. */
  onVoided: (sale: Sale, reload: boolean) => void
  /** Abre el cambio de talla con el recibo de esa venta (si el usuario puede hacer cambios). */
  onExchange?: (sale: Sale) => void
}

type CalendarDay = { count: number; totalNio: number }

const quickButtons = [
  { key: 'session', label: 'Turno actual' },
  { key: 'today', label: 'Hoy' },
  { key: 'yesterday', label: 'Ayer' },
  { key: 'week', label: '7 días' },
  { key: 'month', label: 'Este mes' },
] as const

const compactNio = (value: number) => (value >= 1000 ? `C$ ${(value / 1000).toLocaleString('es-NI', { maximumFractionDigits: 1 })} mil` : formatNio(value))

export function SalesPanel({ session, entries, online, syncing, onPrint, onRetry, onRetryAll, onClose, canVoidDirect, onVoided, onExchange }: SalesPanelProps) {
  const today = managuaDate()
  const [period, setPeriod] = useState<SalesPeriod>({ kind: 'session' })
  const [voiding, setVoiding] = useState<Sale | null>(null)
  const [serverSales, setServerSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7))
  const [rangeMode, setRangeMode] = useState(false)
  const [rangeStart, setRangeStart] = useState<string | null>(null)
  const [days, setDays] = useState<Record<string, CalendarDay>>({})

  const salesUrl = period.kind === 'session'
    ? `/api/v1/cash/sessions/${session.id}/sales`
    : `/api/v1/cash/registers/${session.registerId}/sales?from=${period.from}&to=${period.to}`
  // Se vuelve a pedir al cambiar el período, al volver la conexión o con «Actualizar».
  const [reloadNonce, setReloadNonce] = useState(0)
  useEffect(() => {
    if (!online) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    posRequest<Sale[]>(salesUrl)
      .then((sales) => { if (!cancelled) setServerSales(sales) })
      .catch((caught: unknown) => {
        if (cancelled) return
        setServerSales([])
        setError(errorMessage(caught, 'No pudimos traer las ventas del servidor.'))
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [salesUrl, online, reloadNonce])
  const load = () => setReloadNonce((value) => value + 1)

  const grid = useMemo(() => monthGrid(calendarMonth), [calendarMonth])
  useEffect(() => {
    if (!calendarOpen || !online) return
    let cancelled = false
    const from = grid[0][0]
    const to = grid[grid.length - 1][6]
    posRequest<{ date: string; count: number; totalNio: number }[]>(`/api/v1/cash/registers/${session.registerId}/sales/days?from=${from}&to=${to}`)
      .then((list) => { if (!cancelled) setDays(Object.fromEntries(list.map((day) => [day.date, { count: day.count, totalNio: day.totalNio }]))) })
      .catch(() => { if (!cancelled) setDays({}) })
    return () => { cancelled = true }
  }, [calendarOpen, online, grid, session.registerId])

  const rows = useMemo(
    () => mergeSales(
      entries.filter((entry) => inPeriod(entry.serverSale ?? entry.localSale, period, session.id)),
      serverSales.filter((sale) => inPeriod(sale, period, session.id)),
    ),
    [entries, serverSales, period, session.id],
  )
  const visible = useMemo(() => searchSales(rows, query), [rows, query])
  const summary = useMemo(() => summarizeSales(visible.map((row) => row.sale)), [visible])
  const needsAttention = rows.some((row) => row.status === 'attention' || row.status === 'pending')
  const detail = visible.find((row) => row.clientSaleId === detailId) ?? null
  const showDate = period.kind === 'range' && period.from !== period.to

  function choosePeriod(next: SalesPeriod) {
    setPeriod(next)
    setDetailId(null)
    if (next.kind === 'range') setCalendarMonth(next.to.slice(0, 7))
  }

  function pickDay(day: string) {
    if (day > today) return
    if (rangeMode) {
      if (!rangeStart) { setRangeStart(day); choosePeriod({ kind: 'range', from: day, to: day }); return }
      const [from, to] = rangeStart <= day ? [rangeStart, day] : [day, rangeStart]
      setRangeStart(null)
      choosePeriod(dayDiff(from, to) >= 62 ? { kind: 'range', from: shiftDate(to, -61), to } : { kind: 'range', from, to })
      setCalendarOpen(false)
      return
    }
    choosePeriod({ kind: 'range', from: day, to: day })
    setCalendarOpen(false)
  }

  const activeQuick = period.kind === 'session'
    ? 'session'
    : quickButtons.find((button) => button.key !== 'session' && JSON.stringify(quickPeriod(button.key, today)) === JSON.stringify(period))?.key

  return (
    <>
      <Modal
        title={`Ventas de ${session.registerName}`}
        size="lg"
        onClose={onClose}
        footer={(
          <>
            <span className="pv-confirm-text">{summary.count} {summary.count === 1 ? 'venta' : 'ventas'} · {formatNio(summary.totalNio)}</span>
            {online && <button type="button" className="pv-btn pv-btn-secondary" onClick={load} disabled={loading}><RefreshCw size={18} strokeWidth={1.75} className={loading ? 'pv-spin' : undefined} aria-hidden="true" />{loading ? 'Actualizando…' : 'Actualizar'}</button>}
            {needsAttention && online && <button type="button" className="pv-btn pv-btn-secondary" onClick={onRetryAll} disabled={syncing}>Reintentar envío</button>}
            <button type="button" className="pv-btn pv-btn-primary" onClick={onClose}>Cerrar</button>
          </>
        )}
      >
        <div className="pv-sales-toolbar">
          <div className="pv-seg pv-sales-quick" role="group" aria-label="Período">
            {quickButtons.map((button) => (
              <button
                key={button.key} type="button" className={activeQuick === button.key ? 'is-active' : undefined}
                aria-pressed={activeQuick === button.key}
                onClick={() => choosePeriod(button.key === 'session' ? { kind: 'session' } : quickPeriod(button.key, today))}
              >
                {button.label}
              </button>
            ))}
          </div>
          <div className="pv-sales-date">
            <button type="button" className="pv-icon-button" aria-label="Período anterior" onClick={() => choosePeriod(stepPeriod(period, -1, today))}><ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" /></button>
            <button
              type="button" className={`pv-btn pv-btn-secondary pv-sales-date-label${calendarOpen ? ' is-open' : ''}`}
              aria-expanded={calendarOpen} onClick={() => { setCalendarOpen(!calendarOpen); setRangeStart(null) }}
            >
              <CalendarDays size={18} strokeWidth={1.75} aria-hidden="true" />{describePeriod(period, today)}
            </button>
            <button
              type="button" className="pv-icon-button" aria-label="Período siguiente"
              disabled={period.kind === 'session' || period.to >= today} onClick={() => choosePeriod(stepPeriod(period, 1, today))}
            ><ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
        </div>

        {calendarOpen && (
          <div className="pv-calendar" role="group" aria-label="Calendario de ventas">
            <div className="pv-calendar-head">
              <button type="button" className="pv-icon-button" aria-label="Mes anterior" onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}><ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" /></button>
              <strong>{monthName(calendarMonth)}</strong>
              <button type="button" className="pv-icon-button" aria-label="Mes siguiente" disabled={calendarMonth >= today.slice(0, 7)} onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}><ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" /></button>
              <label className="pv-calendar-range">
                <input type="checkbox" checked={rangeMode} onChange={(event) => { setRangeMode(event.target.checked); setRangeStart(null) }} />
                Varios días
              </label>
            </div>
            {rangeMode && <p className="pv-note">{rangeStart ? 'Ahora tocá el último día.' : 'Tocá el primer día y después el último.'}</p>}
            <div className="pv-calendar-grid">
              {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((name) => <span key={name} className="pv-calendar-weekday">{name}</span>)}
              {grid.flat().map((day) => {
                const info = days[day]
                const selected = period.kind === 'range' && day >= period.from && day <= period.to
                const outside = day.slice(0, 7) !== calendarMonth
                return (
                  <button
                    key={day} type="button" disabled={day > today}
                    className={`pv-calendar-day${info ? ' has-sales' : ''}${selected ? ' is-selected' : ''}${outside ? ' is-outside' : ''}${day === today ? ' is-today' : ''}${day === rangeStart ? ' is-start' : ''}`}
                    aria-label={`${day}${info ? `: ${info.count} ventas, ${formatNio(info.totalNio)}` : ': sin ventas'}`}
                    aria-pressed={selected}
                    onClick={() => pickDay(day)}
                  >
                    <span className="pv-calendar-num">{Number(day.slice(8))}</span>
                    {info && <span className="pv-calendar-total">{compactNio(info.totalNio)}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <label className="pv-sales-search">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            type="search" value={query} placeholder="Buscar por recibo, cliente, prenda o monto"
            aria-label="Buscar ventas" onChange={(event) => { setQuery(event.target.value); setDetailId(null) }}
          />
        </label>

        {!online && <p className="pv-banner pv-banner-warn"><WifiOff size={18} strokeWidth={1.75} aria-hidden="true" /><span>Sin conexión: se muestran solo las ventas guardadas en este equipo.</span></p>}
        {error && <p className="pv-banner pv-banner-error" role="alert"><CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" /><span>{error}</span></p>}

        {visible.length > 0 && <SummaryBar summary={summary} />}

        {visible.length === 0 && !loading && (
          <div className="pv-empty">
            <span className="pv-badge-icon" aria-hidden="true"><ReceiptText size={26} strokeWidth={1.75} /></span>
            <p>{query.trim() ? `Ninguna venta coincide con «${query.trim()}».` : period.kind === 'session' ? 'Todavía no hay ventas en este turno.' : `No hay ventas: ${describePeriod(period, today).toLowerCase()}.`}</p>
          </div>
        )}
        {visible.length > 0 && (
          <ul className="pv-sales-list">
            {visible.map((row) => {
              const currentTurn = row.sale.cashSessionId === session.id
              return (
                <SaleItem
                  key={row.clientSaleId} row={row} onPrint={onPrint} onRetry={onRetry} showDate={showDate}
                  onDetail={() => setDetailId(detailId === row.clientSaleId ? null : row.clientSaleId)}
                  // Anular solo en el turno abierto: una venta de un turno ya cerrado descuadraría su arqueo.
                  onVoid={online && currentTurn && (row.status === 'sent' || row.status === 'review') && row.sale.id ? () => setVoiding(row.sale) : undefined}
                  onExchange={onExchange && online && row.sale.id && (row.status === 'sent' || row.status === 'review') ? () => onExchange(row.sale) : undefined}
                />
              )
            })}
          </ul>
        )}
        {detail && (
          <div className="pv-sale-detail" aria-live="polite">
            <h3>{detail.sale.number}{detail.sale.customerName ? ` · ${detail.sale.customerName}` : ''}</h3>
            <p className="pv-note">{formatDateTime(detail.sale.createdAtUtc)} · {detail.sale.sellerName}{detail.sale.cashSessionId !== session.id ? ' · turno ya cerrado (no se puede anular)' : ''}</p>
            <ul>
              {detail.sale.lines.map((line) => (
                <li key={`${line.variantId}-${line.unitPrice}`}>{line.quantity} × {line.productName} ({line.sizeName} / {line.colorName}) — {formatNio(line.lineTotalNio)}</li>
              ))}
            </ul>
            {detail.sale.shipping && <p className="pv-note">Envío {formatNio(detail.sale.shipping.costNio)} a {detail.sale.shipping.destination}</p>}
            {detail.detail && <p className="pv-note">{detail.detail}</p>}
            {detail.entry?.lastError && detail.status !== 'sent' && <p className="pv-error">{detail.entry.lastError}</p>}
          </div>
        )}
      </Modal>
      {voiding && (
        <VoidSaleModal
          sale={voiding}
          needsApproval={!canVoidDirect}
          onClose={() => setVoiding(null)}
          onVoided={(sale, reload) => {
            setVoiding(null)
            setServerSales((current) => current.map((item) => (item.id === sale.id ? sale : item)))
            onVoided(sale, reload)
          }}
        />
      )}
    </>
  )
}

const methodNames: Record<PaymentMethod, string> = { Cash: 'Efectivo', Card: 'Tarjeta', Transfer: 'Transferencia' }

function SummaryBar({ summary }: { summary: SalesSummary }) {
  const channels = (Object.entries(summary.byChannel) as [SaleChannel, { count: number; totalNio: number }][]).filter(([, value]) => value.count > 0)
  return (
    <section className="pv-sales-summary" aria-label="Resumen">
      <div className="pv-sales-kpi is-main"><span>Vendido</span><strong>{formatNio(summary.totalNio)}</strong><small>{summary.count} {summary.count === 1 ? 'venta' : 'ventas'} · {summary.units} {summary.units === 1 ? 'prenda' : 'prendas'}</small></div>
      {(Object.keys(methodNames) as PaymentMethod[]).filter((method) => summary.byMethod[method] !== 0).map((method) => (
        <div key={method} className="pv-sales-kpi"><span>{methodNames[method]}</span><strong>{formatNio(summary.byMethod[method])}</strong></div>
      ))}
      {summary.shippingCount > 0 && <div className="pv-sales-kpi"><span>Envíos</span><strong>{formatNio(summary.shippingNio)}</strong><small>{summary.shippingCount} con envío</small></div>}
      {channels.length > 1 && (
        <div className="pv-sales-kpi"><span>Canales</span><small>{channels.map(([channel, value]) => `${channelLabel[channel]} ${value.count}`).join(' · ')}</small></div>
      )}
      {summary.voidedCount > 0 && <div className="pv-sales-kpi is-voided"><span>Anuladas</span><strong>{summary.voidedCount}</strong><small>{formatNio(summary.voidedNio)} no suman</small></div>}
    </section>
  )
}

const statusIcons: Record<SaleRow['status'], LucideIcon> = {
  pending: Clock, sent: CircleCheck, review: TriangleAlert, voided: Ban, attention: CircleAlert,
}

function SaleItem({ row, onPrint, onRetry, onDetail, onVoid, onExchange, showDate }: {
  row: SaleRow
  onPrint: (sale: Sale) => void
  onRetry: (clientSaleId: string) => void
  onDetail: () => void
  onVoid?: () => void
  onExchange?: () => void
  /** En rangos de varios días se muestra la fecha, no solo la hora. */
  showDate: boolean
}) {
  const { sale } = row
  const StatusIcon = statusIcons[row.status]
  return (
    <li className={`pv-sale-item is-${row.status}`}>
      <div className="pv-sale-main">
        <strong>{sale.number}</strong>
        <span>{showDate ? formatDateTime(sale.createdAtUtc) : formatTime(sale.createdAtUtc)} · {channelLabel[sale.channel]}{sale.customerName ? ` · ${sale.customerName}` : ''}{sale.shipping ? ` · envío a ${sale.shipping.destination}` : ''}{sale.isOffline ? ' · sin conexión' : ''}</span>
      </div>
      <b className="pv-sale-total">{formatNio(sale.totalNio)}</b>
      <span className={`pv-pill pv-pill-${row.status}`}><StatusIcon size={13} strokeWidth={2} aria-hidden="true" />{row.label}</span>
      <div className="pv-sale-actions">
        <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={() => onPrint(sale)}><Printer size={16} strokeWidth={1.75} aria-hidden="true" />Recibo</button>
        <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={onDetail}>Detalle</button>
        {onExchange && <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={onExchange}><ArrowLeftRight size={16} strokeWidth={1.75} aria-hidden="true" />Cambio</button>}
        {onVoid && <button type="button" className="pv-btn pv-btn-small pv-btn-secondary pv-btn-void" onClick={onVoid}><Ban size={16} strokeWidth={1.75} aria-hidden="true" />Anular</button>}
        {row.entry && (row.status === 'attention' || (row.status === 'pending' && row.entry.attempts > 0)) && (
          <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={() => onRetry(row.clientSaleId)}>Reintentar</button>
        )}
      </div>
      {row.status === 'attention' && row.detail && <p className="pv-sale-msg"><CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{row.detail}</p>}
    </li>
  )
}
