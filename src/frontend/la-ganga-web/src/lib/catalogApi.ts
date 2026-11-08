import { apiRequest } from './api'

export type CatalogKind = 'categories' | 'brands' | 'cuts' | 'size-groups' | 'sizes' | 'colors'

export type CatalogStatus = 'active' | 'inactive' | 'all'

export type CatalogItem = {
  id: string
  name: string
  isActive: boolean
  sortOrder: number
  version: number
  parentId: string | null
  sizeGroupId: string | null
  swatchHex: string | null
  updatedAtUtc: string
}

export type CatalogPage = {
  items: CatalogItem[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export type CatalogInput = {
  name: string
  sortOrder?: number
  isActive?: boolean
  parentId?: string | null
  sizeGroupId?: string | null
  swatchHex?: string | null
}

export const catalogLabels: Record<CatalogKind, { plural: string; singular: string; create: string }> = {
  categories: { plural: 'Categorías', singular: 'categoría', create: 'Nueva categoría' },
  brands: { plural: 'Marcas', singular: 'marca', create: 'Nueva marca' },
  cuts: { plural: 'Cortes', singular: 'corte', create: 'Nuevo corte' },
  'size-groups': { plural: 'Grupos de tallas', singular: 'grupo de tallas', create: 'Nuevo grupo de tallas' },
  sizes: { plural: 'Tallas', singular: 'talla', create: 'Nueva talla' },
  colors: { plural: 'Colores', singular: 'color', create: 'Nuevo color' },
}

const base = '/api/v1/catalog'

export function listCatalog(
  kind: CatalogKind,
  params: { status: CatalogStatus; search?: string; page?: number; pageSize?: number; sizeGroupId?: string },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ status: params.status })
  if (params.search?.trim()) query.set('search', params.search.trim())
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  if (params.sizeGroupId) query.set('sizeGroupId', params.sizeGroupId)
  return apiRequest<CatalogPage>(`${base}/${kind}?${query.toString()}`, { signal })
}

/** Carga todas las páginas (máximo 100 por página) de un catálogo. */
export async function listAllCatalog(kind: CatalogKind, status: CatalogStatus, signal?: AbortSignal) {
  const items: CatalogItem[] = []
  let page = 1
  let totalPages = 1
  do {
    const result = await listCatalog(kind, { status, page, pageSize: 100 }, signal)
    items.push(...result.items)
    totalPages = result.totalPages
    page += 1
  } while (page <= totalPages)
  return items
}

export function createCatalogItem(kind: CatalogKind, input: CatalogInput) {
  return apiRequest<CatalogItem>(`${base}/${kind}`, { method: 'POST', body: input })
}

export function updateCatalogItem(kind: CatalogKind, item: CatalogItem, input: CatalogInput) {
  return apiRequest<CatalogItem>(`${base}/${kind}/${item.id}`, { method: 'PUT', body: input, ifMatch: item.version })
}

export function setCatalogItemActive(kind: CatalogKind, item: CatalogItem, isActive: boolean) {
  const action = isActive ? 'activate' : 'inactivate'
  return apiRequest<CatalogItem>(`${base}/${kind}/${item.id}/${action}`, { method: 'POST', ifMatch: item.version })
}
