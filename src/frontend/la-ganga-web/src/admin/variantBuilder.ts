import type { CatalogItem } from '../lib/catalogApi'
import { parseDecimal } from './csv'
import type { VariantInput } from './adminApi'

export type Draft = { qty: string; price: string; cost: string; barcode: string }
export type BuilderState = { sizeIds: string[]; colorIds: string[]; drafts: Record<string, Draft> }

export const emptyBuilder: BuilderState = { sizeIds: [], colorIds: [], drafts: {} }
export const emptyDraft: Draft = { qty: '', price: '', cost: '', barcode: '' }
export const comboKey = (sizeId: string, colorId: string) => `${sizeId}|${colorId}`

export type Combo = { key: string; size: CatalogItem; color: CatalogItem }

/** Combinaciones talla × color elegidas, en el orden de los catálogos. */
export function combosOf(state: BuilderState, sizes: CatalogItem[], colors: CatalogItem[]): Combo[] {
  const chosenSizes = sizes.filter((size) => state.sizeIds.includes(size.id))
  const chosenColors = colors.filter((color) => state.colorIds.includes(color.id))
  return chosenSizes.flatMap((size) => chosenColors.map((color) => ({ key: comboKey(size.id, color.id), size, color })))
}

export function draftOf(state: BuilderState, key: string): Draft {
  return state.drafts[key] ?? emptyDraft
}

export function setDraft(state: BuilderState, key: string, patch: Partial<Draft>): BuilderState {
  return { ...state, drafts: { ...state.drafts, [key]: { ...draftOf(state, key), ...patch } } }
}

export function toggleId(list: string[], id: string, on: boolean): string[] {
  return on ? (list.includes(id) ? list : [...list, id]) : list.filter((item) => item !== id)
}

/** Convierte el borrador en variantes para la API y lista los problemas por variante. */
export function builderToInputs(
  state: BuilderState, sizes: CatalogItem[], colors: CatalogItem[], existing: Set<string>, canCost: boolean,
): { inputs: VariantInput[]; errors: string[]; totalUnits: number } {
  const inputs: VariantInput[] = []
  const errors: string[] = []
  const barcodes = new Map<string, string>()
  let totalUnits = 0
  for (const combo of combosOf(state, sizes, colors)) {
    if (existing.has(combo.key)) continue
    const draft = draftOf(state, combo.key)
    const label = `${combo.size.name} / ${combo.color.name}`
    const qtyText = draft.qty.trim()
    const quantity = qtyText === '' ? 0 : parseDecimal(qtyText)
    if (quantity === null || !Number.isInteger(quantity) || quantity < 0) errors.push(`${label}: la cantidad debe ser un entero de cero o más.`)
    const price = draft.price.trim() === '' ? null : parseDecimal(draft.price)
    if (draft.price.trim() !== '' && (price === null || price <= 0)) errors.push(`${label}: el precio especial debe ser mayor que cero.`)
    const cost = canCost && draft.cost.trim() !== '' ? parseDecimal(draft.cost) : null
    if (canCost && draft.cost.trim() !== '' && (cost === null || cost < 0)) errors.push(`${label}: el costo no es válido.`)
    const barcode = draft.barcode.trim()
    if (barcode) {
      const other = barcodes.get(barcode)
      if (other) errors.push(`${label}: el código ${barcode} se repite con ${other}.`)
      else barcodes.set(barcode, label)
    }
    inputs.push({
      sizeId: combo.size.id, colorId: combo.color.id, barcode: barcode || null,
      priceOverride: price, cost, initialQuantity: quantity ?? 0,
    })
    totalUnits += quantity ?? 0
  }
  return { inputs, errors, totalUnits }
}
