import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { SaleRequestPayment, StoreSettings } from '../lib/apiTypes'
import { formatNio, formatUsd, paymentNio } from '../lib/money'
import { Modal } from './Modal'
import { Banknote, CircleCheck, CreditCard, Landmark, TriangleAlert, X } from 'lucide-react'
import {
  amountForPending, checkDraft, currencyLabel, currencyShort, describePayment, emptyDraft, evaluatePayments, methodLabel,
  parseAmount, payCurrencies, payMethods, quickBills, usdToNio, type PayCurrency, type PayMethod, type PaymentDraft,
} from './payments'

type PaymentModalProps = {
  totalNio: number
  settings: StoreSettings
  busy: boolean
  error: string | null
  onConfirm: (payments: SaleRequestPayment[]) => void
  onCancel: () => void
}

const methodIcons = { Cash: Banknote, Transfer: Landmark, Card: CreditCard } as const

const methodKeys: Record<string, PayMethod> = { F1: 'Cash', F2: 'Transfer', F3: 'Card', 1: 'Cash', 2: 'Transfer', 3: 'Card' }

function formatMoney(currency: PayCurrency, value: number): string {
  return currency === 'USD' ? formatUsd(value) : formatNio(value)
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

export function PaymentModal({ totalNio, settings, busy, error, onConfirm, onCancel }: PaymentModalProps) {
  const rate = settings.usdRate
  const banksAvailable = settings.banks.length > 0
  const [payments, setPayments] = useState<SaleRequestPayment[]>([])
  const [draft, setDraft] = useState<PaymentDraft>(() => emptyDraft(settings.banks[0] ?? ''))
  const amountRef = useRef<HTMLInputElement>(null)

  const evaluation = useMemo(() => evaluatePayments(totalNio, payments, banksAvailable), [totalNio, payments, banksAvailable])
  const check = useMemo(() => checkDraft(totalNio, payments, draft, rate, banksAvailable), [totalNio, payments, draft, rate, banksAvailable])
  const draftAmount = parseAmount(draft.amount)
  const { method, currency } = draft

  const selectMethod = useCallback((next: PayMethod) => {
    setDraft((current) => (current.method === next ? current : { ...current, method: next, amount: '' }))
    amountRef.current?.focus()
  }, [])
  const selectCurrency = useCallback((next: PayCurrency) => {
    setDraft((current) => (current.currency === next ? current : { ...current, currency: next, amount: '' }))
    amountRef.current?.focus()
  }, [])

  // Atajos: F1/F2/F3 cambian de método y F4 alterna la moneda (funcionan aun escribiendo en un campo);
  // 1/2/3 hacen lo mismo cuando el foco no está en un campo de texto.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const next = methodKeys[event.key]
      if (next && (event.key.startsWith('F') || !isTypingTarget(event.target))) {
        event.preventDefault()
        selectMethod(next)
      } else if (event.key === 'F4') {
        event.preventDefault()
        setDraft((current) => ({ ...current, currency: current.currency === 'NIO' ? 'USD' : 'NIO', amount: '' }))
        amountRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectMethod])

  function update(patch: Partial<PaymentDraft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  function addDraft() {
    if (!check.payment) return
    const payment = check.payment
    setPayments((current) => [...current, payment])
    setDraft((current) => ({ ...current, amount: '', reference: '' }))
    amountRef.current?.focus()
  }

  function confirm() {
    if (evaluation.valid && !busy) onConfirm(payments)
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    if (draftAmount > 0) addDraft()
    else confirm()
  }

  /** Flechas izquierda/derecha entre las opciones de un grupo (pestañas o monedas). */
  function arrowNav<T>(event: KeyboardEvent<HTMLElement>, options: T[], current: T, pick: (value: T) => void) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const index = options.indexOf(current)
    const next = options[(index + step + options.length) % options.length]
    if (next !== undefined) pick(next)
  }

  const pendingFill = amountForPending(evaluation.pendingNio, currency, method, rate)
  const status = evaluation.pendingNio > 0
    ? { label: 'Pendiente', value: formatNio(evaluation.pendingNio), tone: 'warn' }
    : { label: 'Cambio', value: formatNio(evaluation.changeNio), tone: 'ok' }
  const draftEquivalent = currency === 'USD' && draftAmount > 0 ? usdToNio(draftAmount, rate) : 0

  return (
    <Modal
      title="Cobrar"
      size="lg"
      onClose={onCancel}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-secondary" onClick={onCancel} disabled={busy}>Cancelar (Esc)</button>
          <button type="button" className="pv-btn pv-btn-primary pv-btn-xl" onClick={confirm} disabled={!evaluation.valid || busy}>
            {busy ? 'Guardando…' : `Confirmar cobro ${formatNio(totalNio)}`}
          </button>
        </>
      )}
    >
      <div className="pv-payment" onKeyDown={onPanelKeyDown}>
        <div className="pv-pay-summary" aria-live="polite">
          <div><span>Total</span><strong>{formatNio(totalNio)}</strong></div>
          <div><span>Pagado</span><strong>{formatNio(evaluation.paidNio)}</strong></div>
          <div className={`pv-pay-${status.tone}`}><span>{status.label}</span><strong data-testid="pay-status">{status.value}</strong></div>
        </div>

        <div className="pv-pay-body">
          <div className="pv-pay-entry">
            <div className="pv-tabs" role="tablist" aria-label="Método de pago" onKeyDown={(event) => arrowNav(event, payMethods, method, selectMethod)}>
              {payMethods.map((item, index) => (
                <button
                  type="button" role="tab" key={item} id={`pay-tab-${item}`}
                  aria-selected={method === item} aria-controls="pay-panel" tabIndex={method === item ? 0 : -1}
                  className={method === item ? 'is-active' : ''} onClick={() => selectMethod(item)}
                >
                  {(() => { const Icon = methodIcons[item]; return <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> })()}
                  {methodLabel[item]} <kbd>F{index + 1}</kbd>
                </button>
              ))}
            </div>

            <div id="pay-panel" role="tabpanel" aria-labelledby={`pay-tab-${method}`} className="pv-pay-panel">
              <div className="pv-seg" role="radiogroup" aria-label="Moneda del pago" onKeyDown={(event) => arrowNav(event, payCurrencies, currency, selectCurrency)}>
                {payCurrencies.map((item) => (
                  <button
                    type="button" role="radio" key={item} aria-checked={currency === item} tabIndex={currency === item ? 0 : -1}
                    className={currency === item ? 'is-active' : ''} onClick={() => selectCurrency(item)}
                  >
                    {currencyLabel[item]}
                  </button>
                ))}
                <kbd className="pv-seg-key" title="Alterna la moneda">F4</kbd>
              </div>

              {currency === 'USD' && (
                <p className="pv-rate" aria-live="polite">
                  Tasa del día: <b>{rate}</b>
                  {draftAmount > 0 && <> · {formatUsd(draftAmount)} = <b>{formatNio(draftEquivalent)}</b></>}
                </p>
              )}

              <label htmlFor="pay-amount">Monto en {currencyShort[currency]} ({methodLabel[method].toLowerCase()})</label>
              <input
                id="pay-amount" ref={amountRef} data-autofocus inputMode="decimal" autoComplete="off" placeholder="0.00"
                className="pv-pay-amount" value={draft.amount} onChange={(event) => update({ amount: event.target.value })}
              />

              {method === 'Cash' && (
                <div className="pv-chips" aria-label={`Montos rápidos en ${currencyLabel[currency]}`}>
                  <button type="button" disabled={pendingFill <= 0} onClick={() => update({ amount: String(pendingFill) })}>Exacto</button>
                  {quickBills[currency].map((bill) => (
                    <button type="button" key={bill} onClick={() => update({ amount: String(bill) })}>{bill}</button>
                  ))}
                </div>
              )}

              {method === 'Transfer' && (
                <>
                  <div className="pv-row-2">
                    <select aria-label="Banco de la transferencia" value={draft.bank} onChange={(event) => update({ bank: event.target.value })}>
                      {settings.banks.length === 0 && <option value="">Sin bancos configurados</option>}
                      {settings.banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                    </select>
                    <input
                      aria-label="Referencia de la transferencia" placeholder="Referencia (opcional)" autoComplete="off"
                      value={draft.reference} onChange={(event) => update({ reference: event.target.value })}
                    />
                  </div>
                  <div className="pv-chips">
                    <button type="button" disabled={pendingFill <= 0} onClick={() => update({ amount: String(pendingFill) })}>Todo lo pendiente</button>
                  </div>
                </>
              )}

              {method === 'Card' && (
                <>
                  <p className="pv-hint">Terminal externa: cobrá primero en la terminal y acá solo registrá el monto.</p>
                  <div className="pv-chips">
                    <button type="button" disabled={pendingFill <= 0} onClick={() => update({ amount: String(pendingFill) })}>Todo lo pendiente</button>
                  </div>
                </>
              )}

              {method !== 'Cash' && <p className="pv-hint">No puede pasarse del total: solo el efectivo da cambio.</p>}
              {check.error && <p className="pv-hint pv-warn" role="status"><TriangleAlert size={14} strokeWidth={1.75} aria-hidden="true" /><span>{check.error}</span></p>}
              {check.payment && check.changeNio > 0 && (
                <p className="pv-hint pv-ok" role="status"><CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" /><span>Con este pago el cambio será {formatNio(check.changeNio)} (siempre en córdobas).</span></p>
              )}

              <button type="button" className="pv-btn pv-btn-secondary pv-add-pay" disabled={!check.payment} onClick={addDraft}>
                Agregar pago <kbd>Enter</kbd>
              </button>
            </div>
          </div>

          <aside className="pv-pay-list-box" aria-label="Pagos agregados">
            <h3>Pagos agregados</h3>
            {payments.length === 0
              ? <p className="pv-hint">Todavía no agregaste pagos. Podés combinar métodos y monedas.</p>
              : (
                <ul className="pv-pay-list">
                  {payments.map((payment, index) => {
                    const label = `${describePayment(payment)} ${formatMoney(payment.currency, payment.amount)}`
                    return (
                      <li key={`${payment.method}-${index}`} data-testid="pay-line">
                        <span className="pv-pay-line-icon" aria-hidden="true">{(() => { const Icon = methodIcons[payment.method]; return <Icon size={18} strokeWidth={1.75} /> })()}</span>
                        <div className="pv-pay-line-main">
                          <strong>{methodLabel[payment.method]}</strong>
                          <span>
                            {payment.currency === 'USD' ? 'US$' : 'C$'}
                            {payment.method === 'Transfer' && payment.bank ? ` · ${payment.bank}` : ''}
                            {payment.reference ? ` · ref. ${payment.reference}` : ''}
                          </span>
                        </div>
                        <div className="pv-pay-line-amount">
                          <b>{formatMoney(payment.currency, payment.amount)}</b>
                          {payment.currency === 'USD' && <span>= {formatNio(paymentNio(payment))}</span>}
                        </div>
                        <button
                          type="button" className="pv-icon-button" aria-label={`Quitar pago: ${label}`}
                          onClick={() => setPayments((current) => current.filter((_, position) => position !== index))}
                        >
                          <X size={16} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            {payments.length > 0 && (
              <button type="button" className="pv-link" onClick={() => setPayments([])}>Limpiar pagos</button>
            )}
            {evaluation.valid && <p className="pv-hint pv-ok" role="status"><CircleCheck size={14} strokeWidth={1.75} aria-hidden="true" /><span>Cobro completo. Presioná Enter o «Confirmar cobro».</span></p>}
          </aside>
        </div>

        {evaluation.error && <p className="pv-error" role="alert">{evaluation.error}</p>}
        {error && <p className="pv-error" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
