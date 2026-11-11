import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, CircleAlert, CircleCheck, Clock, Printer, ReceiptText, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react'
import type { CashSession, Sale } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { channelLabel, formatTime, mergeSales, type SaleRow } from './format'
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
}

export function SalesPanel({ session, entries, online, syncing, onPrint, onRetry, onRetryAll, onClose, canVoidDirect, onVoided }: SalesPanelProps) {
  const [voiding, setVoiding] = useState<Sale | null>(null)
  const [serverSales, setServerSales] = useState<Sale[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setServerSales(await posRequest<Sale[]>(`/api/v1/cash/sessions/${session.id}/sales`))
    } catch (caught) {
      setError(errorMessage(caught, 'No pudimos traer las ventas del servidor.'))
    } finally {
      setLoading(false)
    }
  }, [session.id])

  useEffect(() => {
    // Carga asíncrona al abrir el panel (y al volver la conexión).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (online) void load()
  }, [load, online])

  const rows = useMemo(
    () => mergeSales(entries.filter((entry) => entry.request.cashSessionId === session.id), serverSales.filter((sale) => sale.cashSessionId === session.id)),
    [entries, serverSales, session.id],
  )
  const total = rows.filter((row) => row.status !== 'voided').reduce((sum, row) => sum + row.sale.totalNio, 0)
  const needsAttention = rows.some((row) => row.status === 'attention' || row.status === 'pending')
  const detail = rows.find((row) => row.clientSaleId === detailId) ?? null

  return (
    <>
      <Modal
        title={`Ventas de ${session.registerName}`}
        size="lg"
        onClose={onClose}
        footer={(
          <>
            <span className="pv-confirm-text">{rows.length} {rows.length === 1 ? 'venta' : 'ventas'} · {formatNio(total)}</span>
            {online && <button type="button" className="pv-btn pv-btn-secondary" onClick={() => { void load() }} disabled={loading}><RefreshCw size={18} strokeWidth={1.75} className={loading ? 'pv-spin' : undefined} aria-hidden="true" />{loading ? 'Actualizando…' : 'Actualizar'}</button>}
            {needsAttention && online && <button type="button" className="pv-btn pv-btn-secondary" onClick={onRetryAll} disabled={syncing}>Reintentar envío</button>}
            <button type="button" className="pv-btn pv-btn-primary" onClick={onClose}>Cerrar</button>
          </>
        )}
      >
        {!online && <p className="pv-banner pv-banner-warn"><WifiOff size={18} strokeWidth={1.75} aria-hidden="true" /><span>Sin conexión: se muestran las ventas guardadas en este equipo.</span></p>}
        {error && <p className="pv-banner pv-banner-error" role="alert"><CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" /><span>{error}</span></p>}
        {rows.length === 0 && (
          <div className="pv-empty">
            <span className="pv-badge-icon" aria-hidden="true"><ReceiptText size={26} strokeWidth={1.75} /></span>
            <p>Todavía no hay ventas en esta caja.</p>
          </div>
        )}
        {rows.length > 0 && (
          <ul className="pv-sales-list">
            {rows.map((row) => (
              <SaleItem
                key={row.clientSaleId} row={row} onPrint={onPrint} onRetry={onRetry}
                onDetail={() => setDetailId(detailId === row.clientSaleId ? null : row.clientSaleId)}
                onVoid={online && (row.status === 'sent' || row.status === 'review') && row.sale.id ? () => setVoiding(row.sale) : undefined}
              />
            ))}
          </ul>
        )}
        {detail && (
          <div className="pv-sale-detail" aria-live="polite">
            <h3>{detail.sale.number}</h3>
            <ul>
              {detail.sale.lines.map((line) => (
                <li key={`${line.variantId}-${line.unitPrice}`}>{line.quantity} × {line.productName} ({line.sizeName} / {line.colorName}) — {formatNio(line.lineTotalNio)}</li>
              ))}
            </ul>
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

const statusIcons: Record<SaleRow['status'], LucideIcon> = {
  pending: Clock, sent: CircleCheck, review: TriangleAlert, voided: Ban, attention: CircleAlert,
}

function SaleItem({ row, onPrint, onRetry, onDetail, onVoid }: {
  row: SaleRow
  onPrint: (sale: Sale) => void
  onRetry: (clientSaleId: string) => void
  onDetail: () => void
  onVoid?: () => void
}) {
  const { sale } = row
  const StatusIcon = statusIcons[row.status]
  return (
    <li className={`pv-sale-item is-${row.status}`}>
      <div className="pv-sale-main">
        <strong>{sale.number}</strong>
        <span>{formatTime(sale.createdAtUtc)} · {channelLabel[sale.channel]}{sale.isOffline ? ' · sin conexión' : ''}</span>
      </div>
      <b className="pv-sale-total">{formatNio(sale.totalNio)}</b>
      <span className={`pv-pill pv-pill-${row.status}`}><StatusIcon size={13} strokeWidth={2} aria-hidden="true" />{row.label}</span>
      <div className="pv-sale-actions">
        <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={() => onPrint(sale)}><Printer size={16} strokeWidth={1.75} aria-hidden="true" />Recibo</button>
        <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={onDetail}>Detalle</button>
        {onVoid && <button type="button" className="pv-btn pv-btn-small pv-btn-secondary pv-btn-void" onClick={onVoid}><Ban size={16} strokeWidth={1.75} aria-hidden="true" />Anular</button>}
        {row.entry && (row.status === 'attention' || (row.status === 'pending' && row.entry.attempts > 0)) && (
          <button type="button" className="pv-btn pv-btn-small pv-btn-secondary" onClick={() => onRetry(row.clientSaleId)}>Reintentar</button>
        )}
      </div>
      {row.status === 'attention' && row.detail && <p className="pv-sale-msg"><CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />{row.detail}</p>}
    </li>
  )
}
