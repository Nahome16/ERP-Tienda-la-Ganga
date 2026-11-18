import type { PaymentMethod, Sale, SaleChannel } from '../lib/apiTypes'
import { round2 } from '../lib/money'
import type { SaleRow } from './format'

/** Qué ventas se ven: el turno abierto o un rango de días (YYYY-MM-DD, hora de Managua). */
export type SalesPeriod = { kind: 'session' } | { kind: 'range'; from: string; to: string }

const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Managua', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Fecha de Managua (YYYY-MM-DD) de un instante. */
export function managuaDate(value: string | Date = new Date()): string {
  return isoDate.format(typeof value === 'string' ? new Date(value) : value)
}

/** Suma días a una fecha YYYY-MM-DD. */
export function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

export function quickPeriod(kind: 'today' | 'yesterday' | 'week' | 'month', today: string): SalesPeriod {
  switch (kind) {
    case 'today': return { kind: 'range', from: today, to: today }
    case 'yesterday': { const day = shiftDate(today, -1); return { kind: 'range', from: day, to: day } }
    case 'week': return { kind: 'range', from: shiftDate(today, -6), to: today }
    case 'month': return { kind: 'range', from: `${today.slice(0, 7)}-01`, to: today }
  }
}

/** Mueve un período de un solo día (o un rango) hacia atrás o adelante, sin pasar de hoy. */
export function stepPeriod(period: SalesPeriod, direction: -1 | 1, today: string): SalesPeriod {
  if (period.kind === 'session') return quickPeriod(direction < 0 ? 'yesterday' : 'today', today)
  const length = dayDiff(period.from, period.to) + 1
  const to = shiftDate(period.to, direction * length)
  if (to > today) return { kind: 'range', from: shiftDate(today, -(length - 1)), to: today }
  return { kind: 'range', from: shiftDate(period.from, direction * length), to }
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

const longDate = new Intl.DateTimeFormat('es-NI', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
const shortDate = new Intl.DateTimeFormat('es-NI', { timeZone: 'UTC', day: 'numeric', month: 'short' })
const asUtc = (date: string) => new Date(`${date}T12:00:00Z`)

/** «Hoy», «Ayer», «martes 17 de noviembre» o «10 nov – 17 nov». */
export function describePeriod(period: SalesPeriod, today: string): string {
  if (period.kind === 'session') return 'Turno actual'
  if (period.from === period.to) {
    if (period.from === today) return 'Hoy'
    if (period.from === shiftDate(today, -1)) return 'Ayer'
    return longDate.format(asUtc(period.from))
  }
  return `${shortDate.format(asUtc(period.from))} – ${shortDate.format(asUtc(period.to))}`
}

export const monthName = (month: string) =>
  new Intl.DateTimeFormat('es-NI', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(asUtc(`${month}-01`))

/** Semanas (lunes a domingo) que muestran un mes completo; los días de los bordes son de los meses vecinos. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`
  const weekday = (asUtc(first).getUTCDay() + 6) % 7 // lunes = 0
  let day = shiftDate(first, -weekday)
  const weeks: string[][] = []
  do {
    const week: string[] = []
    for (let index = 0; index < 7; index += 1) { week.push(day); day = shiftDate(day, 1) }
    weeks.push(week)
  } while (day.slice(0, 7) === month)
  return weeks
}

export function shiftMonth(month: string, delta: number): string {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, value - 1 + delta, 1))
  return date.toISOString().slice(0, 7)
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/**
 * Busca por número de recibo (V-000123 o solo 123), cliente, prenda (nombre, talla, color),
 * destino del envío o monto (650 o 650.50).
 */
export function searchSales(rows: SaleRow[], query: string): SaleRow[] {
  const text = normalize(query.trim())
  if (!text) return rows
  // «V-000123», «v123», «#123» o solo «123»: número de recibo.
  const receipt = /^[v#]?\s*-?\s*[0-9]+$/.test(text) ? text.replace(/[^0-9]/g, '').replace(/^0+/, '') : ''
  const amount = /^[0-9.,\s]+$/.test(text) ? Number(text.replace(/[\s,]/g, '')) : Number.NaN
  return rows.filter(({ sale }) => {
    if (receipt && sale.number.replace(/[^0-9]/g, '').replace(/^0+/, '').includes(receipt)) return true
    if (!Number.isNaN(amount) && Math.abs(sale.totalNio - amount) < 0.005) return true
    const haystack = normalize([
      sale.number, sale.customerName ?? '', sale.shipping?.destination ?? '', sale.shipping?.recipient ?? '',
      ...sale.lines.map((line) => `${line.productName} ${line.sizeName} ${line.colorName}`),
    ].join(' '))
    return text.split(/\s+/).every((word) => haystack.includes(word))
  })
}

export type SalesSummary = {
  count: number
  totalNio: number
  voidedCount: number
  voidedNio: number
  byMethod: Record<PaymentMethod, number>
  byChannel: Record<SaleChannel, { count: number; totalNio: number }>
  shippingCount: number
  shippingNio: number
  units: number
}

/** Resumen de las ventas mostradas. Las anuladas van aparte y no suman. El efectivo descuenta el vuelto. */
export function summarizeSales(sales: Sale[]): SalesSummary {
  const summary: SalesSummary = {
    count: 0, totalNio: 0, voidedCount: 0, voidedNio: 0,
    byMethod: { Cash: 0, Card: 0, Transfer: 0 },
    byChannel: { Store: { count: 0, totalNio: 0 }, WhatsApp: { count: 0, totalNio: 0 }, Facebook: { count: 0, totalNio: 0 } },
    shippingCount: 0, shippingNio: 0, units: 0,
  }
  for (const sale of sales) {
    if (sale.status === 'Voided') {
      summary.voidedCount += 1
      summary.voidedNio = round2(summary.voidedNio + sale.totalNio)
      continue
    }
    summary.count += 1
    summary.totalNio = round2(summary.totalNio + sale.totalNio)
    summary.units += sale.lines.reduce((sum, line) => sum + line.quantity, 0)
    for (const payment of sale.payments) summary.byMethod[payment.method] = round2(summary.byMethod[payment.method] + payment.amountNio)
    summary.byMethod.Cash = round2(summary.byMethod.Cash - sale.changeNio)
    const channel = summary.byChannel[sale.channel]
    channel.count += 1
    channel.totalNio = round2(channel.totalNio + sale.totalNio)
    if (sale.shipping) {
      summary.shippingCount += 1
      summary.shippingNio = round2(summary.shippingNio + sale.shipping.costNio)
    }
  }
  return summary
}

/** ¿La venta cae dentro del período? (para sumar las ventas guardadas en este equipo que aún no suben). */
export function inPeriod(sale: Sale, period: SalesPeriod, sessionId: string): boolean {
  if (period.kind === 'session') return sale.cashSessionId === sessionId
  const day = managuaDate(sale.createdAtUtc)
  return day >= period.from && day <= period.to
}
