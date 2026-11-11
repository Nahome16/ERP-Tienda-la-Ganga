import type { CatalogItem } from '../lib/catalogApi'
import { parseDecimal } from './csv'
import type { VariantInput } from './adminApi'

/**
 * `partnerId` por variante: '' = sigue el socio general, 'none' = «Sin socio» aunque haya uno general,
 * o el id de un socio.
 */
export type Draft = { qty: string; price: string; cost: string; barcode: string; partnerId: string }
/** `partnerId`: socio general de la matriz ('' = Sin socio). */
export type BuilderState = { sizeIds: string[]; colorIds: string[]; drafts: Record<string, Draft>; partnerId: string }

export const emptyBuilder: BuilderState = { sizeIds: [], colorIds: [], drafts: {}, partnerId: '' }
export const emptyDraft: Draft = { qty: '', price: '', cost: '', barcode: '', partnerId: '' }
export const draftSamePartner = ''
export const draftNoPartner = 'none'

/** Socio efectivo de una variante: el suyo si lo cambió, si no el general. null = sin socio. */
export function resolveVariantPartner(general: string, draftPartner: string): string | null {
  const chosen = draftPartner === draftSamePartner ? general : draftPartner === draftNoPartner ? '' : draftPartner
  return chosen === '' ? null : chosen
}

/** Unidades iniciales escritas en las variantes nuevas (ignora lo que no es un entero válido). */
export function totalInitialUnits(state: BuilderState, combos: Combo[], existing: Set<string> = new Set()): number {
  let total = 0
  for (const combo of combos) {
    if (existing.has(combo.key)) continue
    const value = parseDecimal(draftOf(state, combo.key).qty)
    if (value !== null && Number.isInteger(value) && value > 0) total += value
  }
  return total
}
export const comboKey = (sizeId: string, colorId: string) => `${sizeId}|${colorId}`

export type Combo = { key: string; size: CatalogItem; color: CatalogItem }

/** Combinaciones color × talla elegidas, por color y luego por talla (como se leen en la matriz). */
export function combosOf(state: BuilderState, sizes: CatalogItem[], colors: CatalogItem[]): Combo[] {
  const chosenSizes = sizes.filter((size) => state.sizeIds.includes(size.id))
  const chosenColors = colors.filter((color) => state.colorIds.includes(color.id))
  return chosenColors.flatMap((color) => chosenSizes.map((size) => ({ key: comboKey(size.id, color.id), size, color })))
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
  state: BuilderState, sizes: CatalogItem[], colors: CatalogItem[], existing: Set<string>, canCost: boolean, canPartners = false,
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
    const partnerId = canPartners && (quantity ?? 0) > 0 ? resolveVariantPartner(state.partnerId, draft.partnerId) : null
    inputs.push({
      sizeId: combo.size.id, colorId: combo.color.id, barcode: barcode || null,
      priceOverride: price, cost, initialQuantity: quantity ?? 0,
      ...(partnerId ? { partnerId } : {}),
    })
    totalUnits += quantity ?? 0
  }
  return { inputs, errors, totalUnits }
}

/** Códigos que ya tiene escritos el borrador (sin espacios). */
export function draftBarcodes(state: BuilderState): Set<string> {
  return new Set(Object.values(state.drafts).map((draft) => draft.barcode.trim()).filter(Boolean))
}

/**
 * Coloca los códigos escaneados, en orden, en las variantes nuevas que todavía
 * no tienen código. Devuelve el borrador actualizado y los códigos que no
 * entraron (por ejemplo, porque aún no se eligió talla y color).
 */
export function assignScannedBarcodes(
  state: BuilderState, combos: Combo[], codes: string[], existing: Set<string> = new Set(),
): { state: BuilderState; leftover: string[] } {
  const used = draftBarcodes(state)
  const queue = codes.map((code) => code.trim()).filter((code) => code && !used.has(code))
  let next = state
  for (const combo of combos) {
    if (queue.length === 0) break
    if (existing.has(combo.key) || draftOf(next, combo.key).barcode.trim()) continue
    next = setDraft(next, combo.key, { barcode: queue.shift() as string })
  }
  return { state: next, leftover: queue }
}

/** Pone el costo general en las variantes nuevas que no tienen un costo propio. */
export function withDefaultCost(state: BuilderState, combos: Combo[], cost: string, existing: Set<string> = new Set()): BuilderState {
  const value = cost.trim()
  if (!value) return state
  let next = state
  for (const combo of combos) {
    if (existing.has(combo.key) || draftOf(next, combo.key).cost.trim()) continue
    next = setDraft(next, combo.key, { cost: value })
  }
  return next
}

/** Unidades escritas en una celda (0 si está vacía o no es un entero válido). */
export function cellUnits(state: BuilderState, key: string): number {
  const value = parseDecimal(draftOf(state, key).qty)
  return value !== null && Number.isInteger(value) && value > 0 ? value : 0
}
