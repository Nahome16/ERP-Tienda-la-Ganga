import { describe, expect, it } from 'vitest'
import type { Sale } from '../lib/apiTypes'
import type { SaleRow } from './format'
import { describePeriod, monthGrid, quickPeriod, searchSales, stepPeriod, summarizeSales } from './salesPeriod'

const sale = (patch: Partial<Sale>): Sale => ({
  id: 's', clientSaleId: patch.number ?? 'c', number: 'V-000001', cashSessionId: 'cs', registerName: 'Caja 1', sellerName: 'Ana',
  channel: 'Store', status: 'Confirmed', subtotalNio: 0, discountNio: 0, totalNio: 0, changeNio: 0, createdAtUtc: '2026-11-18T15:00:00Z',
  isOffline: false, requiresReview: false, reviewNote: null, discount: null, lines: [], payments: [], customerName: null, voidedAtUtc: null,
  voidReason: null, shipping: null,
  ...patch,
} as Sale)
const row = (value: Sale): SaleRow => ({ clientSaleId: value.clientSaleId, sale: value, status: 'sent', label: 'Enviada', detail: null, entry: null })

describe('períodos', () => {
  it('botones rápidos', () => {
    expect(quickPeriod('today', '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-18', to: '2026-11-18' })
    expect(quickPeriod('yesterday', '2026-11-01')).toEqual({ kind: 'range', from: '2026-10-31', to: '2026-10-31' })
    expect(quickPeriod('week', '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-12', to: '2026-11-18' })
    expect(quickPeriod('month', '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-01', to: '2026-11-18' })
  })

  it('‹ › mueven el día o el rango completo sin pasar de hoy', () => {
    expect(stepPeriod({ kind: 'range', from: '2026-11-18', to: '2026-11-18' }, -1, '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-17', to: '2026-11-17' })
    expect(stepPeriod({ kind: 'range', from: '2026-11-12', to: '2026-11-18' }, -1, '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-05', to: '2026-11-11' })
    expect(stepPeriod({ kind: 'range', from: '2026-11-15', to: '2026-11-15' }, 1, '2026-11-15')).toEqual({ kind: 'range', from: '2026-11-15', to: '2026-11-15' })
    expect(stepPeriod({ kind: 'session' }, -1, '2026-11-18')).toEqual({ kind: 'range', from: '2026-11-17', to: '2026-11-17' })
  })

  it('nombres del período', () => {
    expect(describePeriod({ kind: 'session' }, '2026-11-18')).toBe('Turno actual')
    expect(describePeriod({ kind: 'range', from: '2026-11-18', to: '2026-11-18' }, '2026-11-18')).toBe('Hoy')
    expect(describePeriod({ kind: 'range', from: '2026-11-17', to: '2026-11-17' }, '2026-11-18')).toBe('Ayer')
  })

  it('el calendario empieza en lunes y cubre el mes', () => {
    const weeks = monthGrid('2026-11')
    expect(weeks[0][0]).toBe('2026-10-26')
    expect(weeks.flat()).toContain('2026-11-30')
    expect(weeks.every((week) => week.length === 7)).toBe(true)
  })
})

describe('buscar y resumir ventas', () => {
  const sales = [
    sale({ number: 'V-000123', totalNio: 650, customerName: 'María Pérez', lines: [{ variantId: 'v', productName: 'Camisa Oxford', sizeName: 'M', colorName: 'Azul', quantity: 1, unitPrice: 650, lineTotalNio: 650 }] as Sale['lines'],
      payments: [{ method: 'Cash', currency: 'NIO', amount: 700, exchangeRate: null, amountNio: 700, bank: null, reference: null }], changeNio: 50 }),
    sale({ number: 'V-000124', totalNio: 1280, channel: 'WhatsApp', shipping: { costNio: 80, destination: 'Masaya', recipient: null, phone: null, carrier: null },
      lines: [{ variantId: 'w', productName: 'Pantalón Jean', sizeName: '32', colorName: 'Azul', quantity: 2, unitPrice: 600, lineTotalNio: 1200 }] as Sale['lines'],
      payments: [{ method: 'Transfer', currency: 'NIO', amount: 1280, exchangeRate: null, amountNio: 1280, bank: 'BAC', reference: null }] }),
    sale({ number: 'V-000125', totalNio: 300, status: 'Voided' }),
  ]
  const rows = sales.map(row)

  it('busca por recibo, cliente, prenda, destino o monto', () => {
    expect(searchSales(rows, '123').map((item) => item.sale.number)).toEqual(['V-000123'])
    expect(searchSales(rows, 'v-000124').map((item) => item.sale.number)).toEqual(['V-000124'])
    expect(searchSales(rows, 'maria').map((item) => item.sale.number)).toEqual(['V-000123'])
    expect(searchSales(rows, 'jean 32').map((item) => item.sale.number)).toEqual(['V-000124'])
    expect(searchSales(rows, 'masaya').map((item) => item.sale.number)).toEqual(['V-000124'])
    expect(searchSales(rows, '1280').map((item) => item.sale.number)).toEqual(['V-000124'])
    expect(searchSales(rows, '')).toHaveLength(3)
  })

  it('resume sin contar las anuladas y descontando el vuelto del efectivo', () => {
    const summary = summarizeSales(sales)
    expect(summary.count).toBe(2)
    expect(summary.totalNio).toBe(1930)
    expect(summary.units).toBe(3)
    expect(summary.byMethod).toEqual({ Cash: 650, Card: 0, Transfer: 1280 })
    expect(summary.byChannel.WhatsApp).toEqual({ count: 1, totalNio: 1280 })
    expect(summary.shippingCount).toBe(1)
    expect(summary.shippingNio).toBe(80)
    expect(summary.voidedCount).toBe(1)
    expect(summary.voidedNio).toBe(300)
  })
})
