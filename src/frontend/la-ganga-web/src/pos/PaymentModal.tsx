import { useMemo, useState, type FormEvent } from 'react'
import type { SaleRequestPayment, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd, round2 } from '../lib/money'
import { Modal } from './Modal'
import {
  buildPayments, emptyPaymentForm, evaluatePayments, parseAmount, usdToNio, type PaymentForm,
} from './payments'

type PaymentModalProps = {
  totalNio: number
  settings: StoreSettings
  busy: boolean
  error: string | null
  onConfirm: (payments: SaleRequestPayment[]) => void
  onCancel: () => void
}

const bills = [50, 100, 200, 500, 1000]

function amountText(value: number): string {
  return value > 0 ? String(round2(value)) : ''
}

export function PaymentModal({ totalNio, settings, busy, error, onConfirm, onCancel }: PaymentModalProps) {
  const [form, setForm] = useState<PaymentForm>(() => emptyPaymentForm(settings.banks[0] ?? ''))
  const rate = settings.usdRate

  const payments = useMemo(() => buildPayments(form, rate), [form, rate])
  const evaluation = useMemo(
    () => evaluatePayments(totalNio, payments, settings.banks.length > 0),
    [totalNio, payments, settings.banks.length],
  )

  function update(patch: Partial<PaymentForm>) {
    setForm((current) => ({ ...current, ...patch }))
  }

  /** Lo que falta por cubrir sin contar el campo indicado. */
  function remainingWithout(field: 'cashNio' | 'cashUsd' | 'transfer' | 'card'): number {
    const others = buildPayments({ ...form, [field]: '' }, rate)
    return evaluatePayments(totalNio, others).pendingNio
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (evaluation.valid && !busy) onConfirm(payments)
  }

  const usdAmount = parseAmount(form.cashUsd)
  const status = evaluation.pendingNio > 0
    ? { label: 'Pendiente', value: formatNio(evaluation.pendingNio), tone: 'warn' }
    : { label: 'Cambio', value: formatNio(evaluation.changeNio), tone: 'ok' }

  return (
    <Modal
      title="Cobrar"
      size="lg"
      onClose={onCancel}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onCancel} disabled={busy}>Cancelar (Esc)</button>
          <button type="submit" form="pv-payment-form" className="pv-btn pv-btn-primary pv-btn-xl" disabled={!evaluation.valid || busy}>
            {busy ? 'Guardando…' : `Confirmar cobro ${formatNio(totalNio)}`}
          </button>
        </>
      )}
    >
      <form id="pv-payment-form" onSubmit={submit} className="pv-payment">
        <div className="pv-pay-summary" aria-live="polite">
          <div><span>Total</span><strong>{formatNio(totalNio)}</strong></div>
          <div><span>Pagado</span><strong>{formatNio(evaluation.paidNio)}</strong></div>
          <div className={`pv-pay-${status.tone}`}><span>{status.label}</span><strong data-testid="pay-status">{status.value}</strong></div>
        </div>

        <div className="pv-pay-grid">
          <div className="pv-pay-method">
            <label htmlFor="pay-cash-nio">Efectivo C$</label>
            <input id="pay-cash-nio" data-autofocus inputMode="decimal" autoComplete="off" value={form.cashNio} onChange={(event) => update({ cashNio: event.target.value })} placeholder="0.00" />
            <div className="pv-chips" aria-label="Montos rápidos en córdobas">
              <button type="button" onClick={() => update({ cashNio: amountText(remainingWithout('cashNio')) })}>Exacto</button>
              {bills.map((bill) => (
                <button type="button" key={bill} onClick={() => update({ cashNio: String(bill) })}>{bill}</button>
              ))}
            </div>
          </div>

          <div className="pv-pay-method">
            <label htmlFor="pay-cash-usd">Efectivo US$ <small>(tasa {rate})</small></label>
            <input id="pay-cash-usd" inputMode="decimal" autoComplete="off" value={form.cashUsd} onChange={(event) => update({ cashUsd: event.target.value })} placeholder="0.00" />
            <p className="pv-hint">{usdAmount > 0 ? `${formatUsd(usdAmount)} = ${formatNio(usdToNio(usdAmount, rate))}` : 'Los dólares se convierten a córdobas con la tasa del día.'}</p>
            <div className="pv-chips">
              {[5, 10, 20, 50, 100].map((bill) => (
                <button type="button" key={bill} onClick={() => update({ cashUsd: String(bill) })}>{bill}</button>
              ))}
            </div>
          </div>

          <div className="pv-pay-method">
            <label htmlFor="pay-transfer">Transferencia C$</label>
            <input id="pay-transfer" inputMode="decimal" autoComplete="off" value={form.transfer} onChange={(event) => update({ transfer: event.target.value })} placeholder="0.00" />
            <div className="pv-row-2">
              <select aria-label="Banco de la transferencia" value={form.bank} onChange={(event) => update({ bank: event.target.value })}>
                {settings.banks.length === 0 && <option value="">Sin bancos configurados</option>}
                {settings.banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
              </select>
              <input aria-label="Referencia de la transferencia" placeholder="Referencia (opcional)" autoComplete="off" value={form.reference} onChange={(event) => update({ reference: event.target.value })} />
            </div>
            <div className="pv-chips">
              <button type="button" onClick={() => update({ transfer: amountText(remainingWithout('transfer')) })}>Todo lo pendiente</button>
            </div>
          </div>

          <div className="pv-pay-method">
            <label htmlFor="pay-card">Tarjeta C$ <small>(terminal externa)</small></label>
            <input id="pay-card" inputMode="decimal" autoComplete="off" value={form.card} onChange={(event) => update({ card: event.target.value })} placeholder="0.00" />
            <p className="pv-hint">Cobrá primero en la terminal y acá solo registrá el monto.</p>
            <div className="pv-chips">
              <button type="button" onClick={() => update({ card: amountText(remainingWithout('card')) })}>Todo lo pendiente</button>
            </div>
          </div>
        </div>

        {evaluation.error && <p className="pv-error" role="alert">{evaluation.error}</p>}
        {error && <p className="pv-error" role="alert">{error}</p>}
        <button type="button" className="pv-link" onClick={() => setForm(emptyPaymentForm(settings.banks[0] ?? ''))}>Limpiar pagos</button>
      </form>
    </Modal>
  )
}
