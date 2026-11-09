// Lógica pura del diálogo «Ingresar mercadería» de un producto (cantidades por talla y color).
import type { Variant } from '../lib/apiTypes'

export type ReceiveLine = { variantId: string; label: string; quantity: number }

export type ReceiveParse = { lines: ReceiveLine[]; totalUnits: number; error: string | null }

/**
 * Convierte las cantidades escritas por variante (id → texto) en líneas de entrada.
 * Los vacíos y los ceros se ignoran; los negativos, decimales o inválidos son un error.
 */
export function parseReceiveQuantities(variants: Variant[], quantities: Record<string, string>): ReceiveParse {
  const lines: ReceiveLine[] = []
  for (const variant of variants) {
    const text = (quantities[variant.id] ?? '').trim()
    if (text === '') continue
    const label = `${variant.sizeName} / ${variant.colorName}`
    const value = Number(text.replace(',', '.'))
    if (!Number.isInteger(value) || value < 0) {
      return { lines: [], totalUnits: 0, error: `La cantidad de ${label} debe ser un número entero, cero o mayor.` }
    }
    if (value > 100000) return { lines: [], totalUnits: 0, error: `La cantidad de ${label} es demasiado grande.` }
    if (value > 0) lines.push({ variantId: variant.id, label, quantity: value })
  }
  return { lines, totalUnits: lines.reduce((sum, line) => sum + line.quantity, 0), error: null }
}

/** Aplica una misma cantidad a todas las variantes activas (atajo para ingresos parejos). */
export function fillQuantities(variants: Variant[], value: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const variant of variants) if (variant.isActive) result[variant.id] = value
  return result
}
