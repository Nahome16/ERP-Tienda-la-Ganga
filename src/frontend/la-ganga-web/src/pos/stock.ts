import type { PosSnapshot } from '../lib/apiTypes'
import type { OutboxEntry } from './types'

/**
 * Unidades vendidas en este equipo que la instantánea todavía NO descuenta:
 *  - ventas pendientes, en envío o que requieren atención (no están en el servidor);
 *  - ventas enviadas DESPUÉS de generarse la instantánea (el servidor las recibió
 *    luego, así que la copia local aún no las refleja).
 */
export function pendingUnits(entries: OutboxEntry[], snapshot: Pick<PosSnapshot, 'generatedAtUtc'> | null): Map<string, number> {
  const units = new Map<string, number>()
  const generatedAt = snapshot ? Date.parse(snapshot.generatedAtUtc) : 0
  for (const entry of entries) {
    if (entry.status === 'sent') {
      const receivedAt = entry.serverSale ? Date.parse(entry.serverSale.receivedAtUtc) : Number.NaN
      // Sin hora del servidor no sabemos si ya está en la instantánea: se asume que sí.
      if (!Number.isFinite(receivedAt) || receivedAt <= generatedAt) continue
    }
    for (const line of entry.request.lines) {
      units.set(line.variantId, (units.get(line.variantId) ?? 0) + line.quantity)
    }
  }
  return units
}

/** Existencia conocida = instantánea − ventas aún no reflejadas en ella. */
export function availableStock(stockInSnapshot: number, variantId: string, pending: Map<string, number>): number {
  return stockInSnapshot - (pending.get(variantId) ?? 0)
}
