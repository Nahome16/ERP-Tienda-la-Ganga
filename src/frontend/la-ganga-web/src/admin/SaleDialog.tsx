import { useState } from 'react'
import { PrintableReceipt, printReceipt } from '../components/Receipt'
import { hasPermission } from '../lib/access'
import type { Sale, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import type { CurrentUser } from '../types'
import { getSettings, resolveSaleReview, voidSale } from './adminApi'
import { channelLabels, formatDateTime, messageFrom, methodLabels } from './format'
import { useFetch } from './hooks'
import { Dialog, Notice, Row, Tag } from './ui'

const fallbackSettings: StoreSettings = {
  usdRate: 36.7, storeName: 'Tienda La Ganga', storeAddress: '', storePhone: '',
  receiptFooter: 'Recibo interno — no es factura', banks: [], sellerDiscountLimitPercent: 10, lowStockThreshold: 2,
}

type Mode = 'view' | 'void' | 'resolve'

/** Detalle de una venta con reimpresión, anulación y resolución de revisión. */
export function SaleDialog({ sale, user, onClose, onChanged }: {
  sale: Sale; user: CurrentUser; onClose: () => void; onChanged: (sale: Sale) => void
}) {
  const canVoid = hasPermission(user, 'sale.void')
  const settings = useFetch('sale-settings', (signal) => getSettings(signal))
  const [mode, setMode] = useState<Mode>('view')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function confirmVoid() {
    if (reason.trim().length < 5) { setError('El motivo es obligatorio y debe tener al menos 5 caracteres.'); return }
    setSaving(true); setError(null)
    try {
      const updated = await voidSale(sale.id, reason.trim())
      onChanged(updated)
      setMode('view'); setReason('')
      setDone('Venta anulada. El stock se devolvió al inventario.')
    } catch (caught) { setError(messageFrom(caught)) } finally { setSaving(false) }
  }

  async function confirmResolve() {
    if (!note.trim()) { setError('Escribí una nota sobre cómo se resolvió la revisión.'); return }
    setSaving(true); setError(null)
    try {
      const updated = await resolveSaleReview(sale.id, note.trim())
      onChanged(updated)
      setMode('view'); setNote('')
      setDone('La revisión quedó resuelta.')
    } catch (caught) { setError(messageFrom(caught)) } finally { setSaving(false) }
  }

  const voided = sale.status === 'Voided'
  return (
    <>
      <Dialog
        wide
        title={`Venta ${sale.number}`}
        subtitle={`${formatDateTime(sale.createdAtUtc)} · ${sale.registerName} · ${sale.sellerName}`}
        onClose={onClose}
        footer={(
          <>
            {canVoid && sale.requiresReview && !voided && mode === 'view' && <button type="button" className="secondary-button" onClick={() => { setMode('resolve'); setError(null); setDone(null) }}>Marcar revisión como resuelta</button>}
            {canVoid && !voided && mode === 'view' && <button type="button" className="adm-danger-button" onClick={() => { setMode('void'); setError(null); setDone(null) }}>Anular venta</button>}
            <button type="button" className="primary-button" onClick={printReceipt}>Reimprimir recibo</button>
          </>
        )}
      >
        <div className="adm-actions" style={{ marginBottom: 12 }}>
          <Tag tone={voided ? 'danger' : 'ok'}>{voided ? 'Anulada' : 'Confirmada'}</Tag>
          {sale.requiresReview && <Tag tone="warn">Requiere revisión</Tag>}
          {sale.isOffline && <Tag tone="info">Hecha sin conexión</Tag>}
          <Tag>{channelLabels[sale.channel] ?? sale.channel}</Tag>
        </div>

        {done && <Notice tone="ok">{done}</Notice>}
        {sale.requiresReview && sale.reviewNote && <Notice tone="warn"><span><b>Nota de revisión:</b> {sale.reviewNote}</span></Notice>}
        {voided && <Notice tone="error"><span><b>Anulada</b> {formatDateTime(sale.voidedAtUtc)} por {sale.voidedByName ?? '—'}. Motivo: {sale.voidReason ?? '—'}</span></Notice>}

        {mode === 'void' && (
          <div className="adm-section adm-form" style={{ marginBottom: 12 }}>
            <label className="adm-field">
              <span>Motivo de la anulación (obligatorio, mínimo 5 caracteres)</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} data-autofocus />
            </label>
            <p className="adm-help" style={{ margin: 0 }}>Se devuelve el stock y la venta deja de contar en la caja. No se puede deshacer.</p>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="adm-actions">
              <button type="button" className="adm-danger-button" disabled={saving} onClick={() => { void confirmVoid() }}>{saving ? 'Anulando…' : 'Sí, anular esta venta'}</button>
              <button type="button" className="secondary-button" onClick={() => { setMode('view'); setError(null) }}>No, volver</button>
            </div>
          </div>
        )}
        {mode === 'resolve' && (
          <div className="adm-section adm-form" style={{ marginBottom: 12 }}>
            <label className="adm-field">
              <span>Nota de resolución</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} placeholder="Ej. Se verificó el stock físico y se corrigió con un ajuste" data-autofocus />
            </label>
            {error && <Notice tone="error">{error}</Notice>}
            <div className="adm-actions">
              <button type="button" className="primary-button" disabled={saving} onClick={() => { void confirmResolve() }}>{saving ? 'Guardando…' : 'Marcar como resuelta'}</button>
              <button type="button" className="secondary-button" onClick={() => { setMode('view'); setError(null) }}>Cancelar</button>
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table className="adm-table adm-sale-lines">
            <thead><tr><th>Producto</th><th>Talla / color</th><th>Código</th><th className="numeric">Cant.</th><th className="numeric">Precio</th><th className="numeric">Importe</th></tr></thead>
            <tbody>
              {sale.lines.map((line, index) => (
                <tr key={`${line.variantId}-${index}`}>
                  <td>{line.productName}</td><td>{line.sizeName} / {line.colorName}</td><td className="adm-mono">{line.barcode}</td>
                  <td className="numeric">{line.quantity}</td><td className="numeric">{formatNio(line.unitPrice)}</td><td className="numeric">{formatNio(line.lineTotalNio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="adm-columns" style={{ marginTop: 14 }}>
          <section>
            <h3 className="adm-card-title">Totales</h3>
            <Row label="Subtotal">{formatNio(sale.subtotalNio)}</Row>
            <Row label={sale.discountType === 'Percent' && sale.discountValue !== null ? `Descuento ${sale.discountValue}%` : 'Descuento'}>−{formatNio(sale.discountNio)}</Row>
            <Row label="Total" strong>{formatNio(sale.totalNio)}</Row>
            <Row label="Cambio entregado">{formatNio(sale.changeNio)}</Row>
          </section>
          <section>
            <h3 className="adm-card-title">Pagos</h3>
            <ul className="adm-pay-list">
              {sale.payments.map((payment, index) => (
                <li key={`${payment.method}-${index}`}>
                  <strong>{methodLabels[payment.method] ?? payment.method}{payment.bank ? ` ${payment.bank}` : ''}</strong>
                  {' · '}
                  {payment.currency === 'USD' ? `${formatUsd(payment.amount)} @ ${payment.exchangeRate ?? '—'} = ${formatNio(payment.amountNio)}` : formatNio(payment.amountNio)}
                  {payment.reference && <small className="row-sub">ref. {payment.reference}</small>}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="adm-card-title">Datos</h3>
            <Row label="Vendedor">{sale.sellerName}</Row>
            <Row label="Caja">{sale.registerName}</Row>
            <Row label="Hora del equipo">{formatDateTime(sale.createdAtUtc)}</Row>
            <Row label="Recibida en el servidor">{formatDateTime(sale.receivedAtUtc)}</Row>
            {sale.note && <Row label="Nota">{sale.note}</Row>}
          </section>
        </div>
      </Dialog>
      <PrintableReceipt sale={sale} settings={settings.data ?? fallbackSettings} />
    </>
  )
}
