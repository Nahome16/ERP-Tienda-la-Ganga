import type { DiscountType, SaleRequestPayment, StoreSettings } from './apiTypes'

/**
 * Redondeo a 2 decimales con «mitad hacia arriba» (igual que
 * MidpointRounding.AwayFromZero en el servidor). Trabaja en centavos enteros
 * para evitar errores de coma flotante.
 */
export function round2(value: number): number {
  const sign = value < 0 ? -1 : 1
  return (sign * Math.round(Math.abs(value) * 100 + Number.EPSILON * 100)) / 100
}

export const nioFormat = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'NIO', minimumFractionDigits: 2 })
export const usdFormat = new Intl.NumberFormat('es-NI', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

/** «C$ 1,234.50» */
export function formatNio(value: number): string {
  return `C$ ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

/** «US$ 20.00» */
export function formatUsd(value: number): string {
  return `US$ ${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`
}

export type TotalsInput = {
  lines: { quantity: number; unitPrice: number }[]
  discount: { type: DiscountType; value: number } | null
  /** Costo del envío: se suma al total después del descuento (el descuento es solo sobre la ropa). */
  shippingNio?: number
}

export type SaleTotals = {
  subtotalNio: number
  discountNio: number
  shippingNio: number
  totalNio: number
  /** Descuento expresado como porcentaje del subtotal (para comparar con el límite del vendedor). */
  discountPercent: number
}

/** Mismas reglas que el servidor: ver docs/30-mvp-contrato-api.md, sección 4. */
export function computeTotals({ lines, discount, shippingNio: shipping = 0 }: TotalsInput): SaleTotals {
  const subtotalNio = round2(lines.reduce((sum, line) => sum + round2(line.quantity * line.unitPrice), 0))
  let discountNio = 0
  if (discount && subtotalNio > 0) {
    discountNio = discount.type === 'Percent'
      ? round2((subtotalNio * Math.min(Math.max(discount.value, 0), 100)) / 100)
      : Math.min(round2(Math.max(discount.value, 0)), subtotalNio)
  }
  const shippingNio = round2(Math.max(shipping, 0))
  const totalNio = round2(subtotalNio - discountNio + shippingNio)
  const discountPercent = subtotalNio > 0 ? round2((discountNio / subtotalNio) * 100) : 0
  return { subtotalNio, discountNio, shippingNio, totalNio, discountPercent }
}

/** Valor de un pago en córdobas (los dólares se convierten con la tasa del pago). */
export function paymentNio(payment: Pick<SaleRequestPayment, 'currency' | 'amount' | 'exchangeRate'>): number {
  return payment.currency === 'USD' ? round2(payment.amount * (payment.exchangeRate ?? 0)) : round2(payment.amount)
}

export function computePayments(totalNio: number, payments: SaleRequestPayment[]) {
  const paidNio = round2(payments.reduce((sum, payment) => sum + paymentNio(payment), 0))
  return {
    paidNio,
    changeNio: round2(Math.max(0, paidNio - totalNio)),
    pendingNio: round2(Math.max(0, totalNio - paidNio)),
  }
}

export function discountExceedsLimit(totals: SaleTotals, settings: Pick<StoreSettings, 'sellerDiscountLimitPercent'>) {
  return totals.discountPercent > settings.sellerDiscountLimitPercent
}
