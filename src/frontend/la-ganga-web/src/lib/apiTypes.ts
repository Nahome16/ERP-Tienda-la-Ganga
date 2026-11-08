// Tipos del contrato de API del MVP. Fuente de verdad: docs/30-mvp-contrato-api.md

export type SaleChannel = 'Store' | 'WhatsApp' | 'Facebook'
export type PaymentMethod = 'Cash' | 'Transfer' | 'Card'
export type Currency = 'NIO' | 'USD'
export type DiscountType = 'Percent' | 'Amount'

export type StoreSettings = {
  usdRate: number
  storeName: string
  storeAddress: string
  storePhone: string
  receiptFooter: string
  banks: string[]
  sellerDiscountLimitPercent: number
  lowStockThreshold: number
}

export type PosVariant = {
  variantId: string
  productId: string
  productName: string
  categoryName: string
  brandName: string
  sizeName: string
  colorName: string
  colorHex: string | null
  barcode: string
  price: number
  stock: number
  /** Miniatura de la imagen principal del producto (URL relativa) o null. */
  imageUrl?: string | null
}

export type PosSnapshot = {
  generatedAtUtc: string
  settings: StoreSettings
  variants: PosVariant[]
}

export type CashRegisterInfo = {
  id: string
  name: string
  openSession: { id: string; openedAtUtc: string; openedByName: string } | null
}

export type CashSession = {
  id: string
  registerId: string
  registerName: string
  openedAtUtc: string
  openedByUserId: string
  openedByName: string
  openingFloatNio: number
  openingFloatUsd: number
  closedAtUtc: string | null
  closedByName: string | null
  countedCashNio: number | null
  countedCashUsd: number | null
  closingNotes: string | null
}

export type CashTotals = {
  salesCount: number
  voidedCount: number
  voidedTotalNio: number
  reviewCount: number
  grossTotalNio: number
  discountTotalNio: number
  netTotalNio: number
  cashNioTendered: number
  cashUsdTendered: number
  cashUsdEquivalentNio: number
  changeGivenNio: number
  cashTotalNio: number
  transferTotalNio: number
  cardTotalNio: number
  transfersByBank: { bank: string; totalNio: number }[]
  byChannel: { channel: SaleChannel; salesCount: number; totalNio: number }[]
}

export type CashSummary = {
  session: CashSession
  totals: CashTotals
  expectedCashNio: number
  expectedCashUsd: number
  differenceCashNio: number | null
  differenceCashUsd: number | null
}

export type CashConsolidated = {
  date: string
  sessions: CashSummary[]
  totals: CashTotals
  expectedCashNio: number
  expectedCashUsd: number
  countedCashNio: number | null
  countedCashUsd: number | null
  openSessionsCount: number
}

export type SaleRequestLine = { variantId: string; quantity: number; unitPrice: number }

export type SaleRequestPayment = {
  method: PaymentMethod
  currency: Currency
  amount: number
  exchangeRate: number | null
  bank: string | null
  reference: string | null
}

export type SaleRequest = {
  clientSaleId: string
  cashSessionId: string
  channel: SaleChannel
  createdAtUtc: string
  isOffline: boolean
  lines: SaleRequestLine[]
  discount: { type: DiscountType; value: number } | null
  discountApprovalId: string | null
  payments: SaleRequestPayment[]
  note: string | null
}

export type SaleLine = {
  variantId: string
  productName: string
  sizeName: string
  colorName: string
  barcode: string
  quantity: number
  unitPrice: number
  lineTotalNio: number
}

export type SalePayment = {
  method: PaymentMethod
  currency: Currency
  amount: number
  exchangeRate: number | null
  amountNio: number
  bank: string | null
  reference: string | null
}

export type Sale = {
  id: string
  number: string
  clientSaleId: string
  status: 'Confirmed' | 'Voided'
  channel: SaleChannel
  cashSessionId: string
  registerName: string
  sellerName: string
  createdAtUtc: string
  receivedAtUtc: string
  isOffline: boolean
  subtotalNio: number
  discountType: DiscountType | null
  discountValue: number | null
  discountNio: number
  totalNio: number
  changeNio: number
  requiresReview: boolean
  reviewNote: string | null
  note: string | null
  voidedAtUtc: string | null
  voidedByName: string | null
  voidReason: string | null
  lines: SaleLine[]
  payments: SalePayment[]
}

export type SaleResult = { alreadyProcessed: boolean; sale: Sale }

export type PageResult<T> = {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export type ProductListItem = {
  id: string
  name: string
  categoryId: string
  categoryName: string
  brandId: string
  brandName: string
  cutId: string | null
  cutName: string | null
  basePrice: number
  isActive: boolean
  variantCount: number
  totalStock: number
  version: number
  /** Miniatura de la imagen principal (URL relativa) o null. */
  primaryImageUrl: string | null
}

export type Variant = {
  id: string
  productId: string
  sizeId: string
  sizeName: string
  colorId: string
  colorName: string
  colorHex: string | null
  barcode: string
  priceOverride: number | null
  price: number
  stock: number
  isActive: boolean
  version: number
  cost?: number | null
}

export type ProductImage = {
  id: string
  url: string
  thumbUrl: string
  isPrimary: boolean
  sortOrder: number
}

export type ProductDetail = ProductListItem & { variants: Variant[]; images: ProductImage[] }

export type ImportRow = {
  productName: string
  category: string
  brand: string
  cut: string | null
  size: string
  color: string
  barcode: string | null
  price: number
  cost: number | null
  quantity: number
}

export type ImportResult = {
  dryRun: boolean
  productsCreated: number
  variantsCreated: number
  unitsLoaded: number
  catalogsCreated: string[]
  errors: { row: number; message: string }[]
}

export type InventorySummary = {
  totalUnits: number
  totalVariants: number
  lowStockCount: number
  outOfStockCount: number
  negativeCount: number
}

export type InventoryRow = {
  variantId: string
  productId: string
  productName: string
  categoryName: string
  sizeName: string
  colorName: string
  barcode: string
  price: number
  stock: number
  cost?: number | null
  stockValue?: number | null
}

export type KardexType = 'InitialStock' | 'Entry' | 'Adjustment' | 'Loss' | 'Sale' | 'SaleVoid'

export type KardexRow = {
  type: KardexType
  quantity: number
  balanceAfter: number
  reason: string | null
  saleNumber: string | null
  userName: string
  createdAtUtc: string
}

export type AuditRow = {
  id: string
  occurredAtUtc: string
  userName: string
  action: string
  entityType: string
  entityId: string
  summary: string
}
