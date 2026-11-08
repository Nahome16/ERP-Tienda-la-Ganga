import { ApiError } from '../lib/api'

export const managuaZone = 'America/Managua'

const dateFormat = new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeZone: managuaZone })
const timeFormat = new Intl.DateTimeFormat('es-NI', { timeStyle: 'short', timeZone: managuaZone })
const dateTimeFormat = new Intl.DateTimeFormat('es-NI', { dateStyle: 'medium', timeStyle: 'short', timeZone: managuaZone })
const isoDateFormat = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: managuaZone })

/** Fecha de hoy en Managua como YYYY-MM-DD. */
export function managuaToday(now: Date = new Date()): string {
  return isoDateFormat.format(now)
}

/** Suma días a una fecha YYYY-MM-DD (sin zonas horarias de por medio). */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : '—'
}

export function formatTime(iso: string | null | undefined): string {
  return iso ? timeFormat.format(new Date(iso)) : '—'
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—'
}

/** «2026-11-10» → «10 nov 2026» (la fecha ya es de Managua, no se convierte). */
export function formatIsoDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  return dateFormat.format(new Date(Date.UTC(year, month - 1, day, 18)))
}

export function messageFrom(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return 'Ocurrió un error inesperado. Intentá de nuevo.'
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/** Número entero con separador de miles. */
export function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
}

export const channelLabels: Record<string, string> = { Store: 'Tienda', WhatsApp: 'WhatsApp', Facebook: 'Facebook' }
export const methodLabels: Record<string, string> = { Cash: 'Efectivo', Transfer: 'Transferencia', Card: 'POS / Tarjeta' }

export const kardexLabels: Record<string, string> = {
  InitialStock: 'Existencia inicial',
  Entry: 'Entrada',
  Adjustment: 'Ajuste',
  Loss: 'Pérdida',
  Sale: 'Venta',
  SaleVoid: 'Anulación de venta',
}

/** Primeros caracteres de un identificador para mostrarlo en tablas. */
export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
