import type { PosVariant } from '../lib/apiTypes'

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim()
}

export type VariantIndex = {
  variants: PosVariant[]
  byBarcode: Map<string, PosVariant>
  /** Código de fábrica del producto → producto (compartido por todas sus tallas). */
  byProductBarcode: Map<string, string>
  /** Código de fábrica de un color → producto y color (lo comparten las tallas de ese color). */
  byColorBarcode: Map<string, { productId: string; colorName: string }>
  byId: Map<string, PosVariant>
  haystacks: string[]
  categories: string[]
}

export function buildIndex(variants: PosVariant[]): VariantIndex {
  const byBarcode = new Map<string, PosVariant>()
  const byProductBarcode = new Map<string, string>()
  const byColorBarcode = new Map<string, { productId: string; colorName: string }>()
  const byId = new Map<string, PosVariant>()
  const categories = new Set<string>()
  const haystacks = variants.map((variant) => {
    byBarcode.set(normalize(variant.barcode), variant)
    if (variant.productBarcode) byProductBarcode.set(normalize(variant.productBarcode), variant.productId)
    if (variant.colorBarcode) byColorBarcode.set(normalize(variant.colorBarcode), { productId: variant.productId, colorName: variant.colorName })
    byId.set(variant.variantId, variant)
    if (variant.categoryName) categories.add(variant.categoryName)
    return ` ${normalize([
      variant.productName, variant.brandName, variant.categoryName,
      variant.sizeName, variant.colorName, variant.barcode, variant.productBarcode ?? '', variant.colorBarcode ?? '',
    ].join(' '))}`
  })
  return { variants, byBarcode, byProductBarcode, byColorBarcode, byId, haystacks, categories: [...categories].sort((a, b) => a.localeCompare(b, 'es')) }
}

/** Código exacto (sin distinguir mayúsculas ni espacios en los extremos). */
export function findByBarcode(index: VariantIndex, code: string): PosVariant | null {
  return index.byBarcode.get(normalize(code)) ?? null
}

/** Producto y color cuyo código de fábrica de color es exactamente este (se elige la talla después). */
export function findColorByBarcode(index: VariantIndex, code: string): { productId: string; colorName: string } | null {
  return index.byColorBarcode.get(normalize(code)) ?? null
}

/** Producto cuyo código de fábrica es exactamente este (se elige la talla después). */
export function findProductByBarcode(index: VariantIndex, code: string): string | null {
  return index.byProductBarcode.get(normalize(code)) ?? null
}

/**
 * Todas las palabras de la búsqueda deben aparecer en nombre, marca, talla, color, categoría o código.
 * Una palabra coincide si EMPIEZA una palabra del producto («cam» → camisa; «l» → talla L) o, desde
 * 3 letras, si aparece en cualquier parte (útil para buscar por los últimos dígitos de un código).
 */
export function searchVariants(index: VariantIndex, query: string, category: string | null = null): PosVariant[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  const result: PosVariant[] = []
  index.variants.forEach((variant, position) => {
    if (category && variant.categoryName !== category) return
    const haystack = index.haystacks[position] ?? ''
    if (tokens.every((token) => haystack.includes(` ${token}`) || (token.length >= 3 && haystack.includes(token)))) result.push(variant)
  })
  return result
}

export type LiveSearchFeedback = { tone: 'info' | 'error'; text: string }

/**
 * Mensaje que acompaña los resultados mientras se escribe o escanea. Se deriva
 * de la búsqueda visible para no dejar en pantalla el conteo de una consulta
 * anterior.
 */
export function liveSearchFeedback(query: string, productCount: number): LiveSearchFeedback | null {
  const clean = query.trim()
  if (!clean) return null
  if (productCount === 0) return { tone: 'error', text: `Sin coincidencias para «${clean}».` }
  if (productCount === 1) return { tone: 'info', text: '1 producto coincide. Elegí la talla y el color o presioná Agregar.' }
  return { tone: 'info', text: `${productCount} productos coinciden. Elegí la talla y el color.` }
}

export type ProductGroup = {
  productId: string
  productName: string
  brandName: string
  categoryName: string
  minPrice: number
  maxPrice: number
  /** Miniatura del producto (puede faltar en instantáneas antiguas). */
  imageUrl: string | null
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
      if (!group.imageUrl && variant.imageUrl) group.imageUrl = variant.imageUrl
    } else {
      groups.set(variant.productId, {
        productId: variant.productId,
        productName: variant.productName,
        brandName: variant.brandName,
        categoryName: variant.categoryName,
        minPrice: variant.price,
        maxPrice: variant.price,
        imageUrl: variant.imageUrl ?? null,
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
