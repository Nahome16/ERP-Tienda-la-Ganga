// Utilidades de «socio» para inventario, creación de productos e importación (docs/30, sección 11).
import type { PartnerUnits } from '../lib/apiTypes'

/** Valor del filtro de Inventario para «solo lo que no tiene socio». */
export const noPartnerFilter = 'none'

/** Parámetro `partnerId` de GET /inventory: vacío = sin filtro. */
export function partnerFilterParam(value: string): string | undefined {
  return value === '' ? undefined : value
}

/** «Socio A: 5 · Sin socio: 2». Ignora los grupos sin unidades; vacío si no hay ninguno. */
export function partnerUnitsLabel(partners: PartnerUnits[] | undefined): string {
  return (partners ?? [])
    .filter((item) => item.units !== 0)
    .map((item) => `${item.name || 'Sin socio'}: ${item.units}`)
    .join(' · ')
}

/** Los elementos de `catalogsCreated` que el servidor marca como «Socio: …», separados de los demás. */
export function splitCreated(created: string[]): { partners: string[]; catalogs: string[] } {
  const partners: string[] = []
  const catalogs: string[] = []
  for (const item of created) {
    const match = /^socio\s*:\s*(.+)$/i.exec(item.trim())
    if (match) partners.push(match[1].trim())
    else catalogs.push(item)
  }
  return { partners, catalogs }
}

/** Texto numérico del formulario a número (coma o punto); null si está vacío o no es válido. */
export function parseMoneyField(text: string): number | null {
  const clean = text.trim().replace(',', '.')
  if (clean === '') return null
  const value = Number(clean)
  return Number.isFinite(value) ? value : null
}

export type EntryExtras = { partnerId?: string; unitCost?: number; unitPrice?: number }

/**
 * Campos extra de una entrada de mercadería (socio, costo y precio). Devuelve el error de
 * validación en español si el costo o el precio escritos no son válidos.
 */
export function buildEntryExtras(input: { partnerId: string; cost: string; price: string }): { extras: EntryExtras; error: string | null } {
  const extras: EntryExtras = {}
  if (input.partnerId) extras.partnerId = input.partnerId
  const cost = parseMoneyField(input.cost)
  if (input.cost.trim() !== '') {
    if (cost === null || cost < 0) return { extras: {}, error: 'El costo unitario no es válido.' }
    extras.unitCost = cost
  }
  const price = parseMoneyField(input.price)
  if (input.price.trim() !== '') {
    if (price === null || price <= 0) return { extras: {}, error: 'El precio de venta debe ser mayor que cero.' }
    extras.unitPrice = price
  }
  return { extras, error: null }
}
