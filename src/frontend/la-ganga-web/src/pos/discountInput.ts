import type { DiscountType } from '../lib/apiTypes'

/**
 * Valida el descuento escrito en el carrito. Devuelve el mensaje en español si el valor no sirve
 * (texto, negativo, porcentaje mayor a 100 o monto mayor al subtotal); null si es válido o está vacío.
 */
export function discountProblem(type: DiscountType, text: string, subtotalNio: number): string | null {
  const cleaned = text.trim().replace(/\s/g, '').replace(',', '.')
  if (cleaned === '') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return 'El descuento debe ser un número.'
  if (value < 0) return 'El descuento no puede ser negativo.'
  if (type === 'Percent' && value > 100) return 'El descuento no puede ser mayor a 100%.'
  if (type === 'Amount' && subtotalNio > 0 && value > subtotalNio) return 'El descuento no puede ser mayor al subtotal.'
  return null
}
