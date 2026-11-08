import type { PosVariant } from '../lib/apiTypes'
import type { CartLine } from './types'

export function lineFromVariant(variant: PosVariant, quantity = 1): CartLine {
  return {
    variantId: variant.variantId,
    productId: variant.productId,
    productName: variant.productName,
    sizeName: variant.sizeName,
    colorName: variant.colorName,
    colorHex: variant.colorHex,
    barcode: variant.barcode,
    unitPrice: variant.price,
    quantity,
  }
}

/** Suma `quantity` unidades de la variante (escanear dos veces suma cantidad). */
export function addToCart(lines: CartLine[], variant: PosVariant, quantity = 1): CartLine[] {
  const found = lines.find((line) => line.variantId === variant.variantId)
  if (!found) return [...lines, lineFromVariant(variant, quantity)]
  return lines.map((line) => line.variantId === variant.variantId ? { ...line, quantity: line.quantity + quantity } : line)
}

/** Cambia la cantidad de una línea; 0 o menos la quita. */
export function setLineQuantity(lines: CartLine[], variantId: string, quantity: number): CartLine[] {
  const whole = Math.floor(quantity)
  if (!Number.isFinite(whole) || whole < 1) return lines.filter((line) => line.variantId !== variantId)
  return lines.map((line) => line.variantId === variantId ? { ...line, quantity: whole } : line)
}

export function removeLine(lines: CartLine[], variantId: string): CartLine[] {
  return lines.filter((line) => line.variantId !== variantId)
}

export function cartQuantity(lines: CartLine[], variantId: string): number {
  return lines.find((line) => line.variantId === variantId)?.quantity ?? 0
}

export function cartUnits(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0)
}
