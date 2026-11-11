/**
 * Paleta de colores de ropa con su tono de muestra. La misma lista (nombres y
 * tonos) la carga el servidor en el catálogo (`CatalogSeeder`). Sirve para
 * elegir rápido al crear un color y para dar un tono a los colores que no lo
 * tienen guardado.
 */
export type PaletteColor = { name: string; hex: string }

export const clothingPalette: PaletteColor[] = [
  { name: 'Negro', hex: '#111111' },
  { name: 'Blanco', hex: '#FFFFFF' },
  { name: 'Hueso', hex: '#F2EBDD' },
  { name: 'Crema', hex: '#F3E5C3' },
  { name: 'Beige', hex: '#D9C3A0' },
  { name: 'Caqui', hex: '#B5A36E' },
  { name: 'Camel', hex: '#B9874B' },
  { name: 'Café', hex: '#6B4226' },
  { name: 'Chocolate', hex: '#4A2C1D' },
  { name: 'Gris claro', hex: '#C9C9C9' },
  { name: 'Gris', hex: '#8A8A8A' },
  { name: 'Gris oscuro', hex: '#4A4A4A' },
  { name: 'Plomo', hex: '#5E6670' },
  { name: 'Azul', hex: '#1F5FBF' },
  { name: 'Azul claro', hex: '#7FB2E5' },
  { name: 'Azul oscuro', hex: '#1B2F5C' },
  { name: 'Azul marino', hex: '#14213D' },
  { name: 'Celeste', hex: '#9CD3F0' },
  { name: 'Turquesa', hex: '#2BB7B3' },
  { name: 'Petróleo', hex: '#1F5A66' },
  { name: 'Mezclilla', hex: '#3E5F8A' },
  { name: 'Verde', hex: '#2E8B57' },
  { name: 'Verde claro', hex: '#9BD39B' },
  { name: 'Verde oscuro', hex: '#1F4D2E' },
  { name: 'Verde olivo', hex: '#6B7A3A' },
  { name: 'Verde menta', hex: '#A8E6CF' },
  { name: 'Amarillo', hex: '#F2C531' },
  { name: 'Mostaza', hex: '#C99A2E' },
  { name: 'Naranja', hex: '#EE7A2B' },
  { name: 'Coral', hex: '#F2786B' },
  { name: 'Rojo', hex: '#C62828' },
  { name: 'Vino', hex: '#6D1A2B' },
  { name: 'Terracota', hex: '#B5543A' },
  { name: 'Rosa', hex: '#F2A2B8' },
  { name: 'Rosa palo', hex: '#E8C4C4' },
  { name: 'Fucsia', hex: '#D6247A' },
  { name: 'Lila', hex: '#C3A6D8' },
  { name: 'Morado', hex: '#6A3D9A' },
  { name: 'Dorado', hex: '#C9A13B' },
  { name: 'Plateado', hex: '#BFC4C9' },
  { name: 'Multicolor', hex: '#9B7BD1' },
]

/** Quita tildes, mayúsculas y espacios de más: «  azul   OSCURO » → «azul oscuro». */
export function normalizeColorName(name: string | null | undefined): string {
  return (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ')
}

const byName = new Map(clothingPalette.map((color) => [normalizeColorName(color.name), color.hex]))
const aliases: Record<string, string> = {
  marron: 'cafe', 'azul navy': 'azul marino', navy: 'azul marino', morada: 'morado', blanca: 'blanco', negra: 'negro',
  roja: 'rojo', amarilla: 'amarillo', 'mezclilla clara': 'azul claro', 'mezclilla oscura': 'azul oscuro', jean: 'mezclilla',
  violeta: 'morado', purpura: 'morado', oliva: 'verde olivo', menta: 'verde menta', khaki: 'caqui', kaki: 'caqui',
}

/**
 * Tono sugerido para un nombre de color, o null si no se reconoce. Acepta
 * variantes comunes («Marrón», «Azul navy») y, si no hay coincidencia exacta,
 * usa el color base de la primera palabra («Rojo ladrillo» → rojo).
 */
export function suggestColorHex(name: string | null | undefined): string | null {
  if (!name) return null
  const key = normalizeColorName(name)
  if (!key) return null
  const direct = byName.get(aliases[key] ?? key)
  if (direct) return direct
  const first = key.split(' ')[0] ?? ''
  return byName.get(aliases[first] ?? first) ?? null
}

/** Tono a mostrar: el guardado, el sugerido por el nombre o un neutro. */
export function swatchFor(hex: string | null | undefined, name: string | null | undefined, fallback = '#D9D2C5'): string {
  return hex || suggestColorHex(name) || fallback
}

/** Muestra clara (blanco, hueso…) que necesita un borde para verse sobre fondo claro. */
export function isLightHex(hex: string): boolean {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!match) return false
  const value = parseInt(match[1] as string, 16)
  const r = (value >> 16) & 255, g = (value >> 8) & 255, b = value & 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 225
}
