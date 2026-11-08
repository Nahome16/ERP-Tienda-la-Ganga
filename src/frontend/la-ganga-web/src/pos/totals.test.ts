import { describe, expect, it } from 'vitest'
import { computeTotals, discountExceedsLimit, round2 } from '../lib/money'

describe('computeTotals', () => {
  const lines = [{ quantity: 2, unitPrice: 350 }, { quantity: 1, unitPrice: 199.99 }]

  it('suma líneas sin descuento', () => {
    expect(computeTotals({ lines, discount: null })).toEqual({
      subtotalNio: 899.99, discountNio: 0, totalNio: 899.99, discountPercent: 0,
    })
  })

  it('aplica descuento por porcentaje y redondea mitad hacia arriba', () => {
    const totals = computeTotals({ lines, discount: { type: 'Percent', value: 10 } })
    // 899.99 * 10% = 89.999 → 90.00
    expect(totals.discountNio).toBe(90)
    expect(totals.totalNio).toBe(809.99)
    expect(totals.discountPercent).toBe(10)
  })

  it('aplica descuento por monto fijo y lo limita al subtotal', () => {
    expect(computeTotals({ lines, discount: { type: 'Amount', value: 100 } }).totalNio).toBe(799.99)
    const capped = computeTotals({ lines, discount: { type: 'Amount', value: 5000 } })
    expect(capped.discountNio).toBe(899.99)
    expect(capped.totalNio).toBe(0)
  })

  it('el porcentaje equivalente de un monto fijo se compara con el límite del vendedor', () => {
    const totals = computeTotals({ lines: [{ quantity: 1, unitPrice: 1000 }], discount: { type: 'Amount', value: 120 } })
    expect(totals.discountPercent).toBe(12)
    expect(discountExceedsLimit(totals, { sellerDiscountLimitPercent: 10 })).toBe(true)
    expect(discountExceedsLimit({ ...totals, discountPercent: 10 }, { sellerDiscountLimitPercent: 10 })).toBe(false)
  })

  it('ignora porcentajes fuera de rango', () => {
    expect(computeTotals({ lines, discount: { type: 'Percent', value: 150 } }).totalNio).toBe(0)
    expect(computeTotals({ lines, discount: { type: 'Percent', value: -5 } }).discountNio).toBe(0)
  })

  it('round2 no tiene errores de coma flotante', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})
