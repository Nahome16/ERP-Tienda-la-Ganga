import type { Sale, SaleChannel } from '../lib/apiTypes'
import type { OutboxEntry } from './types'

export const channelLabel: Record<SaleChannel, string> = { Store: 'Tienda', WhatsApp: 'WhatsApp', Facebook: 'Facebook' }
export const channels: SaleChannel[] = ['Store', 'WhatsApp', 'Facebook']

const managua = { timeZone: 'America/Managua' } as const

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('es-NI', { ...managua, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('es-NI', { ...managua, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso))
}

/** «hace 3 min», «hace 2 h», «hace unos segundos». */
export function timeAgo(iso: string | null, nowMs: number): string {
  if (!iso) return 'nunca'
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (seconds < 45) return 'hace unos segundos'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.floor(hours / 24)
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`
}

export type SaleStatusKind = 'pending' | 'sent' | 'review' | 'voided' | 'attention'

export type SaleRow = {
  clientSaleId: string
  sale: Sale
  status: SaleStatusKind
  label: string
  detail: string | null
  entry: OutboxEntry | null
}

const statusLabels: Record<SaleStatusKind, string> = {
  pending: 'Pendiente de envío',
  sent: 'Enviada',
  review: 'Requiere revisión',
  voided: 'Anulada',
  attention: 'Requiere atención',
}

/**
 * Une las ventas de la cola local con las que devolvió el servidor (por clientSaleId).
 * La versión del servidor manda (puede estar anulada o en revisión).
 */
export function mergeSales(entries: OutboxEntry[], serverSales: Sale[]): SaleRow[] {
  const rows = new Map<string, SaleRow>()
  for (const entry of entries) {
    const base = entry.serverSale ?? entry.localSale
    let status: SaleStatusKind
    let detail: string | null = null
    if (entry.status === 'attention') {
      status = 'attention'
      detail = entry.lastError
    } else if (entry.status === 'sent') {
      status = base.status === 'Voided' ? 'voided' : base.requiresReview ? 'review' : 'sent'
      detail = base.reviewNote
    } else {
      status = 'pending'
      detail = entry.lastError
    }
    rows.set(entry.clientSaleId, { clientSaleId: entry.clientSaleId, sale: base, status, label: statusLabels[status], detail, entry })
  }
  for (const sale of serverSales) {
    const status: SaleStatusKind = sale.status === 'Voided' ? 'voided' : sale.requiresReview ? 'review' : 'sent'
    const previous = rows.get(sale.clientSaleId)
    rows.set(sale.clientSaleId, {
      clientSaleId: sale.clientSaleId, sale, status, label: statusLabels[status],
      detail: status === 'voided' ? sale.voidReason : sale.reviewNote, entry: previous?.entry ?? null,
    })
  }
  return [...rows.values()].sort((a, b) => Date.parse(b.sale.createdAtUtc) - Date.parse(a.sale.createdAtUtc))
}
