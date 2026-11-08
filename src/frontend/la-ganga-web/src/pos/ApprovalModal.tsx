import { useState, type FormEvent } from 'react'
import type { DiscountType } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import type { DiscountApproval } from './types'

type ApprovalResponse = { approvalId: string; approverName: string; expiresAtUtc: string }

type ApprovalModalProps = {
  discountType: DiscountType
  discountValue: number
  discountNio: number
  discountPercent: number
  limitPercent: number
  onApproved: (approval: DiscountApproval) => void
  onCancel: () => void
}

/** El administrador escribe su usuario y contraseña en el equipo del vendedor. Nada se guarda. */
export function ApprovalModal({
  discountType, discountValue, discountNio, discountPercent, limitPercent, onApproved, onCancel,
}: ApprovalModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !username.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const response = await posRequest<ApprovalResponse>('/api/v1/pos/discount-approvals', {
        method: 'POST',
        body: { username: username.trim(), password },
      })
      onApproved({ ...response, type: discountType, value: discountValue })
    } catch (caught) {
      setPassword('')
      setError(errorMessage(caught, 'No fue posible validar la aprobación.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Aprobación de descuento"
      size="sm"
      onClose={onCancel}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="submit" form="pv-approval-form" className="pv-btn pv-btn-primary" disabled={busy || !username.trim() || !password}>
            {busy ? 'Validando…' : 'Aprobar descuento'}
          </button>
        </>
      )}
    >
      <form id="pv-approval-form" onSubmit={(event) => { void submit(event) }} className="pv-form">
        <p className="pv-note">
          El descuento de <strong>{formatNio(discountNio)}</strong> ({discountPercent}%) supera el límite de {limitPercent}% del vendedor.
          Un administrador debe autorizarlo con su usuario y contraseña. La contraseña no se guarda.
        </p>
        <label>Usuario del administrador
          <input data-autofocus value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" autoCapitalize="none" />
        </label>
        <label>Contraseña
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="pv-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
