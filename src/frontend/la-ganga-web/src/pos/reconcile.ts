import type { CashSummary, CloseSessionRequest } from '../lib/apiTypes'
import { round2 } from '../lib/money'
import { parseAmount } from './payments'

export type ReconMethod = 'Cash' | 'Transfer' | 'Card'
export type ReconCurrency = 'NIO' | 'USD'
export type DiffTone = 'ok' | 'short' | 'over' | 'none'

/** Una fila de conciliación: un método en una moneda. */
export type ReconRow = {
  method: ReconMethod
  currency: ReconCurrency
  expected: number
  /** Lo contado / verificado (null = no se verificó). */
  counted: number | null
  /** verificado − esperado (null = no verificado). */
  difference: number | null
}

export const reconMethodTitle: Record<ReconMethod, string> = {
  Cash: 'Arqueo de efectivo',
  Transfer: 'Transferencias (banco)',
  Card: 'Tarjeta (cierre de lote)',
}

/** Texto vacío = no verificado (null); lo escrito (incluido 0) = verificado. */
export function parseOptionalAmount(text: string): number | null {
  if (!text.trim()) return null
  return parseAmount(text)
}

export function diffTone(difference: number | null): DiffTone {
  if (difference === null) return 'none'
  if (difference === 0) return 'ok'
  return difference < 0 ? 'short' : 'over'
}

export const diffLabel: Record<DiffTone, string> = { ok: 'Cuadra', short: 'Falta', over: 'Sobra', none: 'No verificado' }

/** verificado − esperado, redondeado; null si no se verificó. */
export function difference(expected: number, counted: number | null): number | null {
  return counted === null ? null : round2(counted - expected)
}

export type CloseInputs = {
  countedCashNio: number
  countedCashUsd: number
  notes: string
  transferNio: string
  transferUsd: string
  cardNio: string
  cardUsd: string
}

/** Solicitud de cierre: los campos de transferencia y tarjeta solo viajan si la persona escribió un valor. */
export function buildCloseRequest(inputs: CloseInputs): CloseSessionRequest {
  const request: CloseSessionRequest = {
    countedCashNio: inputs.countedCashNio,
    countedCashUsd: inputs.countedCashUsd,
    notes: inputs.notes.trim(),
  }
  const transferNio = parseOptionalAmount(inputs.transferNio)
  const transferUsd = parseOptionalAmount(inputs.transferUsd)
  const cardNio = parseOptionalAmount(inputs.cardNio)
  const cardUsd = parseOptionalAmount(inputs.cardUsd)
  if (transferNio !== null) request.countedTransferNio = transferNio
  if (transferUsd !== null) request.countedTransferUsd = transferUsd
  if (cardNio !== null) request.countedCardNio = cardNio
  if (cardUsd !== null) request.countedCardUsd = cardUsd
  return request
}

/** Las seis filas (3 métodos × 2 monedas) de un cierre ya hecho, con lo que devolvió el servidor. */
export function reconciliationRows(summary: CashSummary): ReconRow[] {
  const { session } = summary
  return [
    { method: 'Cash', currency: 'NIO', expected: summary.expectedCashNio, counted: session.countedCashNio, difference: summary.differenceCashNio },
    { method: 'Cash', currency: 'USD', expected: summary.expectedCashUsd, counted: session.countedCashUsd, difference: summary.differenceCashUsd },
    { method: 'Transfer', currency: 'NIO', expected: summary.expectedTransferNio, counted: session.countedTransferNio, difference: summary.differenceTransferNio },
    { method: 'Transfer', currency: 'USD', expected: summary.expectedTransferUsd, counted: session.countedTransferUsd, difference: summary.differenceTransferUsd },
    { method: 'Card', currency: 'NIO', expected: summary.expectedCardNio, counted: session.countedCardNio, difference: summary.differenceCardNio },
    { method: 'Card', currency: 'USD', expected: summary.expectedCardUsd, counted: session.countedCardUsd, difference: summary.differenceCardUsd },
  ]
}

export type Expected = Pick<CashSummary,
  'expectedCashNio' | 'expectedCashUsd' | 'expectedTransferNio' | 'expectedTransferUsd' | 'expectedCardNio' | 'expectedCardUsd'>

export type Counted = {
  cashNio: number
  cashUsd: number
  transferNio: number | null
  transferUsd: number | null
  cardNio: number | null
  cardUsd: number | null
}

/** Las mismas seis filas, pero en vivo: con lo esperado por el sistema y lo que la persona lleva escrito. */
export function liveRows(expected: Expected, counted: Counted): ReconRow[] {
  const row = (method: ReconMethod, currency: ReconCurrency, exp: number, value: number | null): ReconRow => (
    { method, currency, expected: exp, counted: value, difference: difference(exp, value) }
  )
  return [
    row('Cash', 'NIO', expected.expectedCashNio, counted.cashNio),
    row('Cash', 'USD', expected.expectedCashUsd, counted.cashUsd),
    row('Transfer', 'NIO', expected.expectedTransferNio, counted.transferNio),
    row('Transfer', 'USD', expected.expectedTransferUsd, counted.transferUsd),
    row('Card', 'NIO', expected.expectedCardNio, counted.cardNio),
    row('Card', 'USD', expected.expectedCardUsd, counted.cardUsd),
  ]
}

/** «Cuadra», «Falta C$ 10.00», «Sobra US$ 2.00» o «No verificado». */
export function diffText(value: number | null, format: (amount: number) => string): string {
  const tone = diffTone(value)
  if (value === null || tone === 'ok' || tone === 'none') return diffLabel[tone]
  return `${diffLabel[tone]} ${format(Math.abs(value))}`
}

/**
 * Filas que vale la pena mostrar: se omiten las monedas sin movimiento ni verificación
 * (el efectivo en córdobas siempre se muestra: es el arqueo principal).
 */
export function visibleRows(rows: ReconRow[]): ReconRow[] {
  return rows.filter((row) => (row.method === 'Cash' && row.currency === 'NIO')
    || row.expected !== 0 || (row.counted !== null && row.counted !== 0))
}
