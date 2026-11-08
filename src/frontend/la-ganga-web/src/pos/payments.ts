import type { SaleRequestPayment } from '../lib/apiTypes'
import { formatNio, paymentNio, round2 } from '../lib/money'

export type PayMethod = SaleRequestPayment['method']
export type PayCurrency = SaleRequestPayment['currency']

export const payMethods: PayMethod[] = ['Cash', 'Transfer', 'Card']
export const payCurrencies: PayCurrency[] = ['NIO', 'USD']
export const methodLabel: Record<PayMethod, string> = { Cash: 'Efectivo', Transfer: 'Transferencia', Card: 'Tarjeta' }
export const currencyLabel: Record<PayCurrency, string> = { NIO: 'Córdobas (C$)', USD: 'Dólares (US$)' }
export const currencyShort: Record<PayCurrency, string> = { NIO: 'C$', USD: 'US$' }

/** Billetes de acceso rápido según la moneda. */
export const quickBills: Record<PayCurrency, number[]> = {
  NIO: [50, 100, 200, 500, 1000],
  USD: [5, 10, 20, 50, 100],
}

/** Lo que la persona está escribiendo antes de «Agregar pago». */
export type PaymentDraft = {
  method: PayMethod
  currency: PayCurrency
  amount: string
  bank: string
  reference: string
}

export const emptyDraft = (bank = '', method: PayMethod = 'Cash', currency: PayCurrency = 'NIO'): PaymentDraft => ({
  method, currency, amount: '', bank, reference: '',
})

/** Acepta «12,50» y «12.50». Lo inválido o negativo cuenta como 0. */
export function parseAmount(text: string): number {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!cleaned) return 0
  const value = Number(cleaned)
  return Number.isFinite(value) && value > 0 ? round2(value) : 0
}

/** Equivalente en córdobas de un monto en dólares con la tasa dada. */
export function usdToNio(usd: number, rate: number): number {
  return round2(usd * rate)
}

/** Monto «redondo» en la moneda indicada que cubre lo pendiente (efectivo: redondea hacia arriba; sin efectivo: hacia abajo, para no pasarse). */
export function amountForPending(pendingNio: number, currency: PayCurrency, method: PayMethod, usdRate: number): number {
  if (pendingNio <= 0) return 0
  if (currency === 'NIO') return round2(pendingNio)
  if (usdRate <= 0) return 0
  const exact = (pendingNio / usdRate) * 100
  // Se compensa el ruido de coma flotante antes de redondear.
  return (method === 'Cash' ? Math.ceil(exact - 1e-9) : Math.floor(exact + 1e-9)) / 100
}

/** Pago tal como lo entiende la API (lo entregado, en la moneda indicada). null si no hay monto. */
export function draftToPayment(draft: PaymentDraft, usdRate: number): SaleRequestPayment | null {
  const amount = parseAmount(draft.amount)
  if (amount <= 0) return null
  const isTransfer = draft.method === 'Transfer'
  return {
    method: draft.method,
    currency: draft.currency,
    amount,
    exchangeRate: draft.currency === 'USD' ? usdRate : null,
    bank: isTransfer ? draft.bank.trim() || null : null,
    reference: isTransfer ? draft.reference.trim() || null : null,
  }
}

export type PaymentEvaluation = {
  paidNio: number
  pendingNio: number
  changeNio: number
  /** Efectivo recibido, en córdobas equivalentes (incluye dólares en efectivo). */
  cashNio: number
  nonCashNio: number
  /** true si se puede confirmar el cobro. */
  valid: boolean
  /** Motivo por el que no se puede confirmar (null si está bien o si solo falta dinero). */
  error: string | null
}

/**
 * Reglas del cobro (las mismas del servidor):
 *  - pagado ≥ total;
 *  - solo el efectivo da cambio, siempre en córdobas, y el cambio no puede superar el
 *    efectivo recibido (en C$ equivalentes): transferencia y tarjeta no pueden dejar pagado de más;
 *  - la transferencia exige banco cuando hay bancos configurados;
 *  - todo pago en dólares lleva la tasa.
 */
export function evaluatePayments(totalNio: number, payments: SaleRequestPayment[], banksAvailable = true): PaymentEvaluation {
  const paidNio = round2(payments.reduce((sum, payment) => sum + paymentNio(payment), 0))
  const pendingNio = round2(Math.max(0, totalNio - paidNio))
  const changeNio = round2(Math.max(0, paidNio - totalNio))
  const cashNio = round2(payments.filter((payment) => payment.method === 'Cash').reduce((sum, payment) => sum + paymentNio(payment), 0))
  const nonCashNio = round2(paidNio - cashNio)
  let error: string | null = null
  if (changeNio > cashNio) {
    error = `La transferencia y la tarjeta no pueden dejar pagado de más (sobran ${formatNio(round2(changeNio - cashNio))}): el cambio solo se da del efectivo.`
  } else if (payments.some((payment) => payment.currency === 'USD' && !((payment.exchangeRate ?? 0) > 0))) {
    error = 'Falta la tasa del dólar. Sincronizá la configuración o cobrá en córdobas.'
  } else if (banksAvailable && payments.some((payment) => payment.method === 'Transfer' && !payment.bank)) {
    error = 'Elegí el banco de la transferencia.'
  }
  const valid = totalNio > 0 && pendingNio === 0 && error === null && payments.length > 0
  return { paidNio, pendingNio, changeNio, cashNio, nonCashNio, valid, error }
}

export type DraftCheck = {
  /** Pago listo para agregar a la lista (null si el borrador no se puede agregar). */
  payment: SaleRequestPayment | null
  /** Por qué no se puede agregar (null si falta el monto o si está bien). */
  error: string | null
  /** Cambio que quedaría si se agrega este pago (C$). */
  changeNio: number
}

/** Valida el borrador contra lo que ya está en la lista, con las mismas reglas del cobro. */
export function checkDraft(
  totalNio: number, existing: SaleRequestPayment[], draft: PaymentDraft, usdRate: number, banksAvailable: boolean,
): DraftCheck {
  const payment = draftToPayment(draft, usdRate)
  if (!payment) return { payment: null, error: null, changeNio: 0 }
  const after = evaluatePayments(totalNio, [...existing, payment], banksAvailable)
  // Sobrepago de transferencia/tarjeta, banco faltante o tasa faltante bloquean al agregar; la falta de dinero no.
  if (after.error) return { payment: null, error: after.error, changeNio: after.changeNio }
  return { payment, error: null, changeNio: after.changeNio }
}

/** Método y banco: «Transferencia · BAC». */
export function describePayment(payment: SaleRequestPayment): string {
  const bank = payment.method === 'Transfer' && payment.bank ? ` · ${payment.bank}` : ''
  return `${methodLabel[payment.method]}${bank}`
}
