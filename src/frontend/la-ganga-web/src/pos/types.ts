import type { CashSession, DiscountType, PosSnapshot, Sale, SaleChannel, SaleRequest } from '../lib/apiTypes'

/** Instantánea guardada en el equipo y cuándo se descargó (reloj del equipo). */
export type StoredSnapshot = { snapshot: PosSnapshot; fetchedAtUtc: string }

/** Estados de una venta en la cola local. */
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'attention'

export type OutboxEntry = {
  /** Orden de llegada (autoincremental de IndexedDB). */
  seq: number
  clientSaleId: string
  userId: string
  userName: string
  status: OutboxStatus
  request: SaleRequest
  /** Venta armada en el equipo para mostrar y reimprimir el recibo. */
  localSale: Sale
  createdAt: string
  attempts: number
  /** Epoch ms: no reintentar antes de esta hora (retroceso exponencial). */
  nextAttemptAt: number | null
  lastError: string | null
  errorCode: string | null
  errorStatus: number | null
  sentAt: string | null
  /** Venta guardada por el servidor, con su número oficial. */
  serverSale: Sale | null
  alreadyProcessed: boolean
}

export type NewOutboxEntry = Pick<OutboxEntry, 'clientSaleId' | 'userId' | 'userName' | 'request' | 'localSale'>

export type ConnectionStatus = 'online' | 'offline'

export type CartLine = {
  variantId: string
  productId: string
  productName: string
  sizeName: string
  colorName: string
  colorHex: string | null
  barcode: string
  unitPrice: number
  quantity: number
}

export type DiscountInput = { type: DiscountType; value: number }

export type DiscountApproval = {
  approvalId: string
  approverName: string
  expiresAtUtc: string
  /** Descuento para el que se pidió la aprobación. */
  type: DiscountType
  value: number
}

export type CartDraft = {
  key: 'cartDraft'
  userId: string
  lines: CartLine[]
  channel: SaleChannel
  discount: DiscountInput | null
  note: string
}

export type CachedCashSession = { key: 'cashSession'; userId: string; session: CashSession }
