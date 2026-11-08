import type { SaleRequestPayment } from '../lib/apiTypes'
import { computePayments, paymentNio, round2 } from '../lib/money'

export type PaymentForm = {
  cashNio: string
  cashUsd: string
  transfer: string
  bank: string
  reference: string
  card: string
}

export const emptyPaymentForm = (bank = ''): PaymentForm => ({ cashNio: '', cashUsd: '', transfer: '', bank, reference: '', card: '' })

/** Acepta «12,50» y «12.50». Lo inválido o negativo cuenta como 0. */
export function parseAmount(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return 0
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? round2(value) : 0
}

/** Pagos tal como los entiende la API: lo entregado, en la moneda indicada. */
export function buildPayments(form: PaymentForm, usdRate: number): SaleRequestPayment[] {
  const payments: SaleRequestPayment[] = []
  const cashNio = parseAmount(form.cashNio)
  const cashUsd = parseAmount(form.cashUsd)
  const transfer = parseAmount(form.transfer)
  const card = parseAmount(form.card)
  if (cashNio > 0) payments.push({ method: 'Cash', currency: 'NIO', amount: cashNio, exchangeRate: null, bank: null, reference: null })
  if (cashUsd > 0) payments.push({ method: 'Cash', currency: 'USD', amount: cashUsd, exchangeRate: usdRate, bank: null, reference: null })
  if (transfer > 0) {
    payments.push({
      method: 'Transfer', currency: 'NIO', amount: transfer, exchangeRate: null,
      bank: form.bank.trim() || null, reference: form.reference.trim() || null,
    })
  }
  if (card > 0) payments.push({ method: 'Card', currency: 'NIO', amount: card, exchangeRate: null, bank: null, reference: null })
  return payments
}

export type PaymentEvaluation = {
  paidNio: number
  pendingNio: number
  changeNio: number
  cashNio: number
  nonCashNio: number
  /** true si se puede confirmar el cobro. */
  valid: boolean
  /** Motivo por el que no se puede confirmar (null si está bien o si solo falta dinero). */
  error: string | null
}

/**
 * Reglas del cobro (mismas que el servidor, un poco más estrictas):
 *  - pagado ≥ total;
 *  - el cambio solo sale del efectivo y se entrega en córdobas, así que
 *    transferencia + tarjeta no pueden superar el total;
 *  - transferencia con varios bancos exige elegir el banco.
 */
export function evaluatePayments(totalNio: number, payments: SaleRequestPayment[], banksAvailable = true): PaymentEvaluation {
  const { paidNio, pendingNio, changeNio } = computePayments(totalNio, payments)
  const cashNio = round2(payments.filter((payment) => payment.method === 'Cash').reduce((sum, payment) => sum + paymentNio(payment), 0))
  const nonCashNio = round2(paidNio - cashNio)
  let error: string | null = null
  if (nonCashNio > totalNio) {
    error = 'La transferencia y la tarjeta no pueden superar el total: el cambio solo se da del efectivo.'
  } else if (banksAvailable && payments.some((payment) => payment.method === 'Transfer' && !payment.bank)) {
    error = 'Elegí el banco de la transferencia.'
  }
  const valid = totalNio > 0 && pendingNio === 0 && error === null && payments.length > 0
  return { paidNio, pendingNio, changeNio, cashNio, nonCashNio, valid, error }
}

/** Equivalente en córdobas de un monto en dólares con la tasa dada. */
export function usdToNio(usd: number, rate: number): number {
  return round2(usd * rate)
}
