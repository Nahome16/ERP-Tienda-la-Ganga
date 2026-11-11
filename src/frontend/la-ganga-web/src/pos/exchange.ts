import type { ExchangeLookup, ExchangeOption, ExchangeRequest, ExchangeableLine } from '../lib/apiTypes'

/** Lo que la cajera eligió para una prenda del recibo: cuántas regresan y qué talla/color se llevan. */
export type ExchangeChoice = { quantity: number; newVariantId: string | null }

export type ExchangeChoices = Record<string, ExchangeChoice>

/** Deja solo los dígitos del número de recibo («V-000123», «123», «v 123»). Vacío si no hay ninguno. */
export function normalizeReceiptNumber(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  return digits
}

/** Tallas o colores que se pueden entregar a cambio de una prenda (activas, otra variante y con existencia). */
export function exchangeOptions(line: ExchangeableLine): ExchangeOption[] {
  return line.options.filter((option) => option.isActive && option.variantId !== line.variantId)
}

export function optionLabel(option: Pick<ExchangeOption, 'sizeName' | 'colorName'>): string {
  return `Talla ${option.sizeName} · ${option.colorName}`
}

/** Mensaje de error de una elección, o null si está bien (o si la prenda no se cambia). */
export function choiceError(line: ExchangeableLine, choice: ExchangeChoice | undefined): string | null {
  if (!choice || choice.quantity <= 0) return null
  if (!Number.isInteger(choice.quantity)) return 'La cantidad debe ser un número entero.'
  if (choice.quantity > line.available) {
    return line.available === 0
      ? 'Esta prenda ya se cambió por completo.'
      : `Solo se pueden cambiar ${line.available} ${line.available === 1 ? 'unidad' : 'unidades'}.`
  }
  if (!choice.newVariantId) return 'Elegí la talla o el color que se lleva.'
  const option = line.options.find((candidate) => candidate.variantId === choice.newVariantId)
  if (!option || !option.isActive) return 'Esa talla ya no está disponible.'
  if (option.variantId === line.variantId) return 'Elegí una talla o color distinto al que regresa.'
  if (option.stock < choice.quantity) {
    return option.stock <= 0 ? 'No hay existencia de esa talla.' : `Solo hay ${option.stock} en existencia de esa talla.`
  }
  return null
}

/** Prendas con algo elegido para cambiar. */
export function selectedLines(lookup: ExchangeLookup, choices: ExchangeChoices) {
  return lookup.lines.filter((line) => (choices[line.saleLineId]?.quantity ?? 0) > 0)
}

/**
 * Arma la solicitud del cambio. Devuelve los errores por línea si algo no es
 * válido, o si no se eligió ninguna prenda.
 */
export function buildExchangeRequest(
  lookup: ExchangeLookup,
  choices: ExchangeChoices,
  options: { clientExchangeId: string; cashSessionId: string | null; note: string },
): { request: ExchangeRequest; errors: null } | { request: null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const lines = selectedLines(lookup, choices)
  for (const line of lines) {
    const error = choiceError(line, choices[line.saleLineId])
    if (error) errors[line.saleLineId] = error
  }
  if (lines.length === 0) errors.form = 'Elegí al menos una prenda para cambiar.'
  if (Object.keys(errors).length > 0) return { request: null, errors }
  const note = options.note.trim()
  return {
    errors: null,
    request: {
      clientExchangeId: options.clientExchangeId,
      saleId: lookup.saleId,
      cashSessionId: options.cashSessionId,
      note: note ? note.slice(0, 500) : null,
      items: lines.map((line) => {
        const choice = choices[line.saleLineId] as ExchangeChoice
        return { saleLineId: line.saleLineId, quantity: choice.quantity, newVariantId: choice.newVariantId as string }
      }),
    },
  }
}

/** Texto del plazo para la cajera: «Compra de hace 2 días · plazo 4 días». */
export function windowText(lookup: Pick<ExchangeLookup, 'daysSinceSale' | 'windowDays'>): string {
  const ago = lookup.daysSinceSale <= 0 ? 'de hoy' : lookup.daysSinceSale === 1 ? 'de ayer' : `de hace ${lookup.daysSinceSale} días`
  return `Compra ${ago} · plazo de ${lookup.windowDays} ${lookup.windowDays === 1 ? 'día' : 'días'}`
}
