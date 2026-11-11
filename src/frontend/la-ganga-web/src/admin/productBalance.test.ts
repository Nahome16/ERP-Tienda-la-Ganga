import { describe, expect, it } from 'vitest'
import type { Variant } from '../lib/apiTypes'
import { productBalance } from './productBalance'

function variant(id: string, sizeName: string, colorName: string, price: number, cost: number | null, stock: number): Variant {
  return {
    id, productId: 'p', sizeId: sizeName, sizeName, colorId: colorName, colorName, colorHex: null, barcode: id,
    priceOverride: null, price, stock, isActive: true, version: 1, cost,
  } as Variant
}

describe('productBalance', () => {
  const variants = [
    variant('a30', '30', 'Azul', 450, 300, 5),
    variant('a32', '32', 'Azul', 450, 300, 4),
    variant('n30', '30', 'Negro', 450, 300, 3),
    variant('a40', '40', 'Azul', 580, 395, 2),
    variant('n40', '40', 'Negro', 580, 395, -1),
  ]

  it('agrupa por precio y costo y marca el precio especial', () => {
    const { groups } = productBalance(variants, [])
    expect(groups.map((group) => [group.label, group.special])).toEqual([
      ['Tallas 30, 32 · todos los colores', false],
      ['Tallas 40 · todos los colores', true],
    ])
    const normal = groups[0]!
    expect(normal.units).toBe(12)
    expect(normal.costTotal).toBe(3600)
    expect(normal.saleValue).toBe(5400)
    expect(normal.expectedProfit).toBe(1800)
    expect(normal.margin).toBeCloseTo(1 / 3)
    // La existencia negativa no cuenta como unidades disponibles.
    expect(groups[1]!.units).toBe(2)
  })

  it('suma lo vendido y la ganancia real; sin costo no inventa ganancia', () => {
    const { total } = productBalance(variants, [
      { variantId: 'a30', soldUnits: 2, soldRevenueNio: 900, soldCostNio: 600 },
      { variantId: 'a40', soldUnits: 1, soldRevenueNio: 580, soldCostNio: 395 },
    ])
    expect(total.soldUnits).toBe(3)
    expect(total.soldRevenue).toBe(1480)
    expect(total.soldProfit).toBe(485)
    const hidden = productBalance([variant('x', 'M', 'Azul', 100, null, 3)], [{ variantId: 'x', soldUnits: 1, soldRevenueNio: 100, soldCostNio: null }])
    expect(hidden.total.expectedProfit).toBeNull()
    expect(hidden.total.soldProfit).toBeNull()
  })
})
