import type { Variant } from '../lib/apiTypes'

/** Lo vendido de una variante (ventas confirmadas). `soldCostNio` es null si la cuenta no ve costos. */
export type VariantSales = { variantId: string; soldUnits: number; soldRevenueNio: number; soldCostNio: number | null }

export type BalanceGroup = {
  key: string
  /** «Tallas 30, 32, 34 · todos los colores». */
  label: string
  price: number
  cost: number | null
  /** Precio distinto del de la mayoría de las tallas del producto. */
  special: boolean
  variants: number
  units: number
  costTotal: number | null
  saleValue: number
  expectedProfit: number | null
  margin: number | null
  soldUnits: number
  soldRevenue: number
  soldCost: number | null
  soldProfit: number | null
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/**
 * Agrupa las tallas y colores de un producto por precio y costo (por ejemplo «30 a 38» a un
 * precio y «40 a 44» a otro) y calcula, de lo que hay en existencia, el costo total, el valor de
 * venta y la ganancia esperada; y de lo vendido, los ingresos y la ganancia real.
 */
export function productBalance(variants: Variant[], sales: VariantSales[]): { groups: BalanceGroup[]; total: BalanceGroup } {
  const salesById = new Map(sales.map((item) => [item.variantId, item]))
  const allColors = new Set(variants.map((variant) => variant.colorName))
  const groupsMap = new Map<string, Variant[]>()
  for (const variant of variants) {
    const key = `${variant.price}|${variant.cost ?? ''}`
    groupsMap.set(key, [...(groupsMap.get(key) ?? []), variant])
  }
  // El precio «normal» es el que tiene más variantes; los demás se marcan como especiales.
  const counts = [...groupsMap.values()].map((list) => list.length)
  const usual = [...groupsMap.entries()].find(([, list]) => list.length === Math.max(...counts))?.[1][0]?.price

  const groups = [...groupsMap.entries()].map(([key, list]) => {
    const sizes = [...new Set(list.map((variant) => variant.sizeName))]
    const colors = [...new Set(list.map((variant) => variant.colorName))]
    const colorText = colors.length === allColors.size && allColors.size > 1 ? 'todos los colores' : colors.join(', ')
    return summarize(key, `Tallas ${sizes.join(', ')} · ${colorText}`, list, salesById, list[0]?.price !== usual && groupsMap.size > 1)
  }).sort((a, b) => a.price - b.price)

  return { groups, total: summarize('total', 'Total', variants, salesById, false) }
}

function summarize(key: string, label: string, list: Variant[], salesById: Map<string, VariantSales>, special: boolean): BalanceGroup {
  const units = sum(list.map((variant) => Math.max(variant.stock, 0)))
  const costKnown = list.every((variant) => variant.cost !== null && variant.cost !== undefined)
  const costTotal = costKnown ? sum(list.map((variant) => Math.max(variant.stock, 0) * (variant.cost ?? 0))) : null
  const saleValue = sum(list.map((variant) => Math.max(variant.stock, 0) * variant.price))
  const sold = list.map((variant) => salesById.get(variant.id)).filter((item): item is VariantSales => Boolean(item))
  const soldCostKnown = sold.every((item) => item.soldCostNio !== null)
  const soldRevenue = sum(sold.map((item) => item.soldRevenueNio))
  const soldCost = soldCostKnown ? sum(sold.map((item) => item.soldCostNio ?? 0)) : null
  const expectedProfit = costTotal === null ? null : saleValue - costTotal
  return {
    key,
    label,
    price: list[0]?.price ?? 0,
    cost: costKnown ? list[0]?.cost ?? null : null,
    special,
    variants: list.length,
    units,
    costTotal,
    saleValue,
    expectedProfit,
    margin: expectedProfit === null || saleValue === 0 ? null : expectedProfit / saleValue,
    soldUnits: sum(sold.map((item) => item.soldUnits)),
    soldRevenue,
    soldCost,
    soldProfit: soldCost === null ? null : soldRevenue - soldCost,
  }
}
