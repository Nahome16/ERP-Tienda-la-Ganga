// Llamadas tipadas de las pantallas administrativas. Contrato: docs/30-mvp-contrato-api.md
import { apiRequest } from '../lib/api'
import type {
  AuditRow, CashConsolidated, CashSummary, CloseSessionRequest, ImportResult, ImportRow, InventoryRow, InventorySummary,
  KardexRow, PageResult, ProductDetail, ProductListItem, Sale, StoreSettings, Variant,
} from '../lib/apiTypes'

const v1 = '/api/v1'

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

// ---- Configuración ----
export const getSettings = (signal?: AbortSignal) => apiRequest<StoreSettings>(`${v1}/settings`, { signal })
export const putSettings = (settings: StoreSettings) => apiRequest<StoreSettings>(`${v1}/settings`, { method: 'PUT', body: settings })

// ---- Cajas ----
export const getConsolidated = (date: string, signal?: AbortSignal) =>
  apiRequest<CashConsolidated>(`${v1}/cash/consolidated${query({ date })}`, { signal })
export const getSessionSummary = (id: string, signal?: AbortSignal) =>
  apiRequest<CashSummary>(`${v1}/cash/sessions/${id}/summary`, { signal })
export const listSessions = (from: string, to: string, signal?: AbortSignal) =>
  apiRequest<CashSummary[]>(`${v1}/cash/sessions${query({ from, to })}`, { signal })
export const closeSession = (id: string, body: CloseSessionRequest) =>
  apiRequest<CashSummary>(`${v1}/cash/sessions/${id}/close`, { method: 'POST', body })

// ---- Ventas ----
export type SalesFilter = {
  from: string; to: string; sessionId: string; status: string; needsReview: boolean; number: string
  page: number; pageSize: number
}
export const listSales = (filter: SalesFilter, signal?: AbortSignal) =>
  apiRequest<PageResult<Sale>>(`${v1}/sales${query({ ...filter, number: filter.number.trim() })}`, { signal })
export const voidSale = (id: string, reason: string) =>
  apiRequest<Sale>(`${v1}/sales/${id}/void`, { method: 'POST', body: { reason } })
export const resolveSaleReview = (id: string, note: string) =>
  apiRequest<Sale>(`${v1}/sales/${id}/resolve-review`, { method: 'POST', body: { note } })

// ---- Productos ----
export type ProductFilter = { search: string; categoryId: string; brandId: string; status: string; page: number; pageSize: number }
export const listProducts = (filter: ProductFilter, signal?: AbortSignal) =>
  apiRequest<PageResult<ProductListItem>>(`${v1}/products${query({ ...filter, search: filter.search.trim() })}`, { signal })
export const getProduct = (id: string, signal?: AbortSignal) => apiRequest<ProductDetail>(`${v1}/products/${id}`, { signal })

export type VariantInput = {
  sizeId: string; colorId: string; barcode: string | null; priceOverride: number | null
  cost: number | null; initialQuantity: number
}
export type ProductInput = { name: string; categoryId: string; brandId: string; cutId: string | null; basePrice: number }

export const createProduct = (input: ProductInput & { variants: VariantInput[] }) =>
  apiRequest<ProductDetail>(`${v1}/products`, { method: 'POST', body: input })
export const updateProduct = (product: { id: string; version: number }, input: ProductInput & { isActive: boolean }) =>
  apiRequest<ProductListItem>(`${v1}/products/${product.id}`, { method: 'PUT', body: input, ifMatch: product.version })
export const addVariant = (productId: string, input: VariantInput) =>
  apiRequest<Variant>(`${v1}/products/${productId}/variants`, { method: 'POST', body: input })
export const updateVariant = (
  variant: { id: string; version: number },
  input: { barcode: string; priceOverride: number | null; isActive: boolean; cost?: number | null },
) => apiRequest<Variant>(`${v1}/variants/${variant.id}`, { method: 'PUT', body: input, ifMatch: variant.version })

export type VariantByBarcode = Variant & { productName: string }
export const getVariantByBarcode = (barcode: string, signal?: AbortSignal) =>
  apiRequest<VariantByBarcode>(`${v1}/variants/by-barcode/${encodeURIComponent(barcode)}`, { signal })

export const importProducts = (body: { dryRun: boolean; createMissingCatalogs: boolean; rows: ImportRow[] }) =>
  apiRequest<ImportResult>(`${v1}/products/import`, { method: 'POST', body })

// ---- Inventario ----
export const getInventorySummary = (signal?: AbortSignal) => apiRequest<InventorySummary>(`${v1}/inventory/summary`, { signal })
export type InventoryFilter = { search: string; filter: string; page: number; pageSize: number }
export const listInventory = (filter: InventoryFilter, signal?: AbortSignal) =>
  apiRequest<PageResult<InventoryRow>>(`${v1}/inventory${query({ ...filter, search: filter.search.trim() })}`, { signal })
export const getKardex = (variantId: string, page: number, pageSize: number, signal?: AbortSignal) =>
  apiRequest<PageResult<KardexRow>>(`${v1}/inventory/variants/${variantId}/kardex${query({ page, pageSize })}`, { signal })
export const adjustInventory = (body: { variantId: string; kind: 'Entry' | 'Adjustment' | 'Loss'; delta: number; reason: string }) =>
  apiRequest<unknown>(`${v1}/inventory/adjustments`, { method: 'POST', body })

// ---- Auditoría ----
export type AuditFilter = { entityType: string; userId: string; from: string; to: string; page: number; pageSize: number }
export const listAudit = (filter: AuditFilter, signal?: AbortSignal) =>
  apiRequest<PageResult<AuditRow>>(`${v1}/audit${query(filter)}`, { signal })
