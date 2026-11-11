import { useState } from 'react'
import { Ban, ShoppingCart } from 'lucide-react'
import type { Sale } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { AuthorizationFields } from './Authorization'
import { approverReady, emptyApprover, type Approver } from './approver'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'

/**
 * Anular una venta desde la caja. Si el cajero no puede anular por sí mismo, el administrador
 * autoriza con su usuario y contraseña. «Anular y cargar al carrito» reemplaza a «editar venta»:
 * la venta queda anulada (el recibo y el arqueo siguen cuadrando) y sus prendas pasan al carrito
 * para corregir y cobrar de nuevo.
 */
export function VoidSaleModal({ sale, needsApproval, onVoided, onClose }: {
  sale: Sale
  needsApproval: boolean
  onVoided: (sale: Sale, reload: boolean) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [approver, setApprover] = useState<Approver>(emptyApprover)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonOk = reason.trim().length >= 5
  const ready = reasonOk && (!needsApproval || approverReady(approver))

  async function submit(reload: boolean) {
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      const voided = await posRequest<Sale>(`/api/v1/pos/sales/${sale.id}/void`, {
        method: 'POST',
        body: {
          reason: reason.trim(),
          ...(needsApproval ? { approverUsername: approver.username.trim(), approverPassword: approver.password } : {}),
        },
      })
      onVoided(voided, reload)
    } catch (caught) {
      setError(errorMessage(caught, 'No fue posible anular la venta.'))
      setApprover({ ...approver, password: '' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Anular ${sale.number}`}
      size="md"
      onClose={onClose}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="pv-btn pv-btn-secondary" onClick={() => { void submit(true) }} disabled={busy || !ready}>
            <ShoppingCart size={18} strokeWidth={1.75} aria-hidden="true" />Anular y cargar al carrito
          </button>
          <button type="button" className="pv-btn pv-btn-danger" onClick={() => { void submit(false) }} disabled={busy || !ready}>
            <Ban size={18} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Anulando…' : 'Anular venta'}
          </button>
        </>
      )}
    >
      <p className="pv-confirm-big"><strong>{sale.number}</strong> · {formatNio(sale.totalNio)}</p>
      <ul className="pv-void-lines">
        {sale.lines.map((line) => (
          <li key={`${line.variantId}-${line.unitPrice}`}>{line.quantity} × {line.productName} ({line.sizeName} / {line.colorName})</li>
        ))}
      </ul>
      <p className="pv-note">
        Las prendas vuelven al inventario y el dinero sale del arqueo de esta caja. Para corregir la venta usá
        <strong> «Anular y cargar al carrito»</strong>: quedan en el carrito para cobrar de nuevo.
      </p>
      <label className="pv-field">
        <span>Motivo</span>
        <input data-autofocus value={reason} maxLength={500} placeholder="Ej.: se cobró la talla equivocada" onChange={(event) => setReason(event.target.value)} disabled={busy} />
        {!reasonOk && reason.length > 0 && <small className="pv-hint pv-warn">Escribí un motivo un poco más claro (al menos 5 letras).</small>}
      </label>
      {needsApproval && <AuthorizationFields value={approver} onChange={setApprover} action="esta anulación" disabled={busy} />}
      {error && <p className="pv-error" role="alert">{error}</p>}
    </Modal>
  )
}
