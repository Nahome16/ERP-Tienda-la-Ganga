import type { CashConsolidated, CashSummary } from '../lib/apiTypes'
import { formatNio, formatUsd, round2 } from '../lib/money'

export type RecCurrency = 'NIO' | 'USD'
export type RecKey = 'cash' | 'transfer' | 'card'

/** Una moneda de un método: lo esperado según las ventas contra lo verificado. */
export type RecLine = {
  currency: RecCurrency
  expected: number
  /** null = todavía no se contó / no se verificó. */
  counted: number | null
  /** verificado − esperado; null si no hay verificado. */
  difference: number | null
}

export type RecMethod = {
  key: RecKey
  title: string
  /** Nombre de la fuente de verificación: «Contado», «Verificado en banco»… */
  countedLabel: string
  lines: [RecLine, RecLine]
}

export type RecTone = 'ok' | 'bad' | 'muted'
export type RecStatus = { tone: RecTone; label: string; details: string[] }

export const currencyNames: Record<RecCurrency, string> = { NIO: 'Córdobas (C$)', USD: 'Dólares (US$)' }

export function formatMoney(currency: RecCurrency, value: number): string {
  return currency === 'NIO' ? formatNio(value) : formatUsd(value)
}

export function differenceText(currency: RecCurrency, value: number): string {
  return `${value > 0 ? 'Sobra' : 'Falta'} ${formatMoney(currency, Math.abs(round2(value)))}`
}

const titles: Record<RecKey, { title: string; countedLabel: string }> = {
  cash: { title: 'Efectivo', countedLabel: 'Contado' },
  transfer: { title: 'Transferencias', countedLabel: 'Verificado en banco' },
  card: { title: 'Tarjeta (POS)', countedLabel: 'Cierre de lote' },
}

function method(key: RecKey, nio: RecLine, usd: RecLine): RecMethod {
  return { key, ...titles[key], lines: [nio, usd] }
}

const line = (currency: RecCurrency, expected: number, counted: number | null, difference: number | null): RecLine =>
  ({ currency, expected, counted, difference })

/** Conciliación de una caja a partir de su resumen. */
export function methodsFromSummary(summary: CashSummary): RecMethod[] {
  const { session } = summary
  return [
    method('cash',
      line('NIO', summary.expectedCashNio, session.countedCashNio, summary.differenceCashNio),
      line('USD', summary.expectedCashUsd, session.countedCashUsd, summary.differenceCashUsd)),
    method('transfer',
      line('NIO', summary.expectedTransferNio, session.countedTransferNio, summary.differenceTransferNio),
      line('USD', summary.expectedTransferUsd, session.countedTransferUsd, summary.differenceTransferUsd)),
    method('card',
      line('NIO', summary.expectedCardNio, session.countedCardNio, summary.differenceCardNio),
      line('USD', summary.expectedCardUsd, session.countedCardUsd, summary.differenceCardUsd)),
  ]
}

const diffOf = (counted: number | null, expected: number) => (counted === null ? null : round2(counted - expected))

/** Conciliación del día completo a partir del consolidado. */
export function methodsFromConsolidated(data: CashConsolidated): RecMethod[] {
  return [
    method('cash',
      line('NIO', data.expectedCashNio, data.countedCashNio, diffOf(data.countedCashNio, data.expectedCashNio)),
      line('USD', data.expectedCashUsd, data.countedCashUsd, diffOf(data.countedCashUsd, data.expectedCashUsd))),
    method('transfer',
      line('NIO', data.expectedTransferNio, data.countedTransferNio, diffOf(data.countedTransferNio, data.expectedTransferNio)),
      line('USD', data.expectedTransferUsd, data.countedTransferUsd, diffOf(data.countedTransferUsd, data.expectedTransferUsd))),
    method('card',
      line('NIO', data.expectedCardNio, data.countedCardNio, diffOf(data.countedCardNio, data.expectedCardNio)),
      line('USD', data.expectedCardUsd, data.countedCardUsd, diffOf(data.countedCardUsd, data.expectedCardUsd))),
  ]
}

/**
 * Estado resumido de un método: Pendiente (caja abierta), No verificado,
 * Cuadra o la diferencia (Falta / Sobra) por moneda.
 */
export function methodStatus(item: RecMethod, open: boolean): RecStatus {
  if (open) return { tone: 'muted', label: 'Pendiente', details: [] }
  const diffs = item.lines.filter((entry) => entry.difference !== null && round2(entry.difference) !== 0)
  if (diffs.length > 0) {
    const label = diffs.length === 1 ? (diffs[0].difference! > 0 ? 'Sobra' : 'Falta') : 'Diferencia'
    return { tone: 'bad', label, details: diffs.map((entry) => differenceText(entry.currency, entry.difference!)) }
  }
  const verified = item.lines.filter((entry) => entry.counted !== null)
  if (verified.length === 0) return { tone: 'muted', label: 'No verificado', details: [] }
  const missing = item.lines.filter((entry) => entry.counted === null && entry.expected !== 0)
  if (missing.length > 0) {
    return { tone: 'muted', label: 'Verificado en parte', details: missing.map((entry) => `${entry.currency === 'NIO' ? 'C$' : 'US$'} sin verificar`) }
  }
  return { tone: 'ok', label: 'Cuadra', details: [] }
}

/** Texto de una línea para el cierre impreso. */
export function lineCountedText(entry: RecLine, open: boolean): string {
  if (entry.counted !== null) return formatMoney(entry.currency, entry.counted)
  return open ? 'Pendiente' : 'No verificado'
}

export function lineDifferenceText(entry: RecLine, open: boolean): string {
  if (entry.difference === null) return open ? 'Pendiente' : 'No verificado'
  const rounded = round2(entry.difference)
  return rounded === 0 ? 'Cuadra' : differenceText(entry.currency, rounded)
}
