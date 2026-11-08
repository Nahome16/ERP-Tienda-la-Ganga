import type { PosVariant } from '../lib/apiTypes'

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

export type VariantIndex = {
  variants: PosVariant[]
  byBarcode: Map<string, PosVariant>
  byId: Map<string, PosVariant>
  haystacks: string[]
  categories: string[]
}

export function buildIndex(variants: PosVariant[]): VariantIndex {
  const byBarcode = new Map<string, PosVariant>()
  const byId = new Map<string, PosVariant>()
  const categories = new Set<string>()
  const haystacks = variants.map((variant) => {
    byBarcode.set(normalize(variant.barcode), variant)
    byId.set(variant.variantId, variant)
    if (variant.categoryName) categories.add(variant.categoryName)
    return normalize([
      variant.productName, variant.brandName, variant.categoryName,
      variant.sizeName, variant.colorName, variant.barcode,
    ].join(' '))
  })
  return { variants, byBarcode, byId, haystacks, categories: [...categories].sort((a, b) => a.localeCompare(b, 'es')) }
}

/** Código exacto (sin distinguir mayúsculas ni espacios en los extremos). */
export function findByBarcode(index: VariantIndex, code: string): PosVariant | null {
  return index.byBarcode.get(normalize(code)) ?? null
}

/** Todas las palabras de la búsqueda deben aparecer en nombre, marca, talla, color, categoría o código. */
export function searchVariants(index: VariantIndex, query: string, category: string | null = null): PosVariant[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  const result: PosVariant[] = []
  index.variants.forEach((variant, position) => {
    if (category && variant.categoryName !== category) return
    const haystack = index.haystacks[position] ?? ''
    if (tokens.every((token) => haystack.includes(token))) result.push(variant)
  })
  return result
}

export type ProductGroup = {
  productId: string
  productName: string
  brandName: string
  categoryName: string
  minPrice: number
  maxPrice: number
  variants: PosVariant[]
}

/** Agrupa variantes por producto (ordenado por nombre) con variantes ordenadas por color y talla. */
export function groupByProduct(variants: PosVariant[]): ProductGroup[] {
  const groups = new Map<string, ProductGroup>()
  for (const variant of variants) {
    const group = groups.get(variant.productId)
    if (group) {
      group.variants.push(variant)
      group.minPrice = Math.min(group.minPrice, variant.price)
      group.maxPrice = Math.max(group.maxPrice, variant.price)
    } else {
      groups.set(variant.productId, {
        productId: variant.productId,
        productName: variant.productName,
        brandName: variant.brandName,
        categoryName: variant.categoryName,
        minPrice: variant.price,
        maxPrice: variant.price,
        variants: [variant],
      })
    }
  }
  const list = [...groups.values()]
  for (const group of list) {
    group.variants.sort((a, b) => a.colorName.localeCompare(b.colorName, 'es') || a.sizeName.localeCompare(b.sizeName, 'es', { numeric: true }))
  }
  return list.sort((a, b) => a.productName.localeCompare(b.productName, 'es'))
}
