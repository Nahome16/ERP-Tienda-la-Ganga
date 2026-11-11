import type {
  CashSession, Sale, SaleChannel, SaleRequest, SaleRequestPayment, StoreSettings,
} from '../lib/apiTypes'
import { computePayments, computeTotals, paymentNio, round2 } from '../lib/money'
import type { CartLine, DiscountInput } from './types'

/** GUID v4. `crypto.randomUUID` solo existe en contextos seguros (https/localhost), por eso el respaldo. */
export function newClientSaleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes)
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Referencia mientras no hay número oficial: «#» + primeros 6 caracteres del clientSaleId. */
export function shortRef(clientSaleId: string): string {
  return `#${clientSaleId.slice(0, 6).toUpperCase()}`
}

export type BuildSaleInput = {
  clientSaleId: string
  cashSessionId: string
  channel: SaleChannel
  createdAtUtc: string
  isOffline: boolean
  lines: CartLine[]
  discount: DiscountInput | null
  discountApprovalId: string | null
  payments: SaleRequestPayment[]
  note: string | null
  /** Nombre del cliente para el recibo (opcional). */
  customerName?: string | null
}

export function buildSaleRequest(input: BuildSaleInput): SaleRequest {
  return {
    clientSaleId: input.clientSaleId,
    cashSessionId: input.cashSessionId,
    channel: input.channel,
    createdAtUtc: input.createdAtUtc,
    isOffline: input.isOffline,
    lines: input.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity, unitPrice: line.unitPrice })),
    discount: input.discount && input.discount.value > 0 ? { type: input.discount.type, value: input.discount.value } : null,
    discountApprovalId: input.discountApprovalId,
    payments: input.payments,
    note: input.note && input.note.trim() ? input.note.trim() : null,
    customerName: input.customerName && input.customerName.trim() ? input.customerName.trim().slice(0, 120) : null,
  }
}

/** Arma una `Sale` en el equipo (sin número oficial) para mostrar y reimprimir el recibo. */
export function buildLocalSale(
  request: SaleRequest,
  cartLines: CartLine[],
  context: { session: Pick<CashSession, 'registerName'>; sellerName: string; settings: Pick<StoreSettings, 'usdRate'> },
): Sale {
  const totals = computeTotals({ lines: request.lines, discount: request.discount })
  const { changeNio } = computePayments(totals.totalNio, request.payments)
  return {
    id: request.clientSaleId,
    number: shortRef(request.clientSaleId),
    clientSaleId: request.clientSaleId,
    status: 'Confirmed',
    channel: request.channel,
    cashSessionId: request.cashSessionId,
    registerName: context.session.registerName,
    sellerName: context.sellerName,
    createdAtUtc: request.createdAtUtc,
    receivedAtUtc: request.createdAtUtc,
    isOffline: request.isOffline,
    subtotalNio: totals.subtotalNio,
    discountType: request.discount?.type ?? null,
    discountValue: request.discount?.value ?? null,
    discountNio: totals.discountNio,
    totalNio: totals.totalNio,
    changeNio,
    requiresReview: false,
    reviewNote: null,
    note: request.note,
    customerName: request.customerName ?? null,
    voidedAtUtc: null,
    voidedByName: null,
    voidReason: null,
    lines: request.lines.map((line) => {
      const source = cartLines.find((item) => item.variantId === line.variantId)
      return {
        variantId: line.variantId,
        productName: source?.productName ?? 'Artículo',
        sizeName: source?.sizeName ?? '',
        colorName: source?.colorName ?? '',
        barcode: source?.barcode ?? '',
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotalNio: round2(line.quantity * line.unitPrice),
      }
    }),
    payments: request.payments.map((payment) => ({
      method: payment.method,
      currency: payment.currency,
      amount: payment.amount,
      exchangeRate: payment.exchangeRate,
      amountNio: paymentNio(payment),
      bank: payment.bank,
      reference: payment.reference,
    })),
  }
}
