import { useMemo, useState } from 'react'
import { ApiError } from '../lib/api'
import type { CatalogItem } from '../lib/catalogApi'
import type { ProductInput } from './adminApi'
import { parseDecimal } from './csv'
import { messageFrom } from './format'
import type { Catalogs } from './useCatalogs'

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // Los detalles por campo a veces repiten el mismo texto del mensaje principal.
    const details = [...new Set(Object.values(error.fieldErrors).flat())].filter((detail) => detail !== error.message)
    return details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message
  }
  return messageFrom(error)
}

/** Colores creados desde el diálogo: se suman a los del catálogo hasta que la lista se recargue. */
type CatalogList = keyof Catalogs

/** Catálogos creados desde el diálogo (colores, tallas, marcas…): se suman hasta que la lista se recargue. */
export function useCatalogsWithNewColors(base: Catalogs) {
  const [extra, setExtra] = useState<{ list: CatalogList; item: CatalogItem }[]>([])
  const catalogs = useMemo(() => {
    const merged = { ...base }
    for (const { list, item } of extra) {
      if (!merged[list].some((existing) => existing.id === item.id)) merged[list] = [...merged[list], item]
    }
    return merged
  }, [base, extra])
  const add = (list: CatalogList, item: CatalogItem) => setExtra((current) => [...current, { list, item }])
  return { catalogs, add, addColor: (color: CatalogItem) => add('colors', color) }
}

export type ProductFields = { name: string; categoryId: string; brandId: string; cutId: string; basePrice: string; barcode: string; referenceCode: string }

export function validateFields(fields: ProductFields): { input: ProductInput | null; error: string | null } {
  if (!fields.name.trim()) return { input: null, error: 'Escribí el nombre del producto.' }
  if (!fields.categoryId) return { input: null, error: 'Elegí la categoría.' }
  if (!fields.brandId) return { input: null, error: 'Elegí la marca.' }
  // Vacío = precio pendiente (se guarda en 0 y no se puede vender hasta completarlo).
  const basePrice = fields.basePrice.trim() === '' ? 0 : parseDecimal(fields.basePrice)
  if (basePrice === null || basePrice < 0) return { input: null, error: 'El precio de venta no puede ser negativo (dejalo vacío si lo vas a poner después).' }
  return {
    input: { name: fields.name.trim(), categoryId: fields.categoryId, brandId: fields.brandId, cutId: fields.cutId || null, basePrice, barcode: fields.barcode.trim(), referenceCode: fields.referenceCode.trim() },
    error: null,
  }
}

