import { describe, expect, it } from 'vitest'
import { clothingPalette, isLightHex, normalizeColorName, suggestColorHex, swatchFor } from './colorPalette'

describe('colorPalette', () => {
  it('no repite nombres y todos los tonos son #RRGGBB', () => {
    const names = clothingPalette.map((color) => normalizeColorName(color.name))
    expect(new Set(names).size).toBe(names.length)
    for (const color of clothingPalette) expect(color.hex).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('reconoce nombres con tildes, mayúsculas, alias y una palabra base', () => {
    expect(suggestColorHex('Café')).toBe('#6B4226')
    expect(suggestColorHex('  azul   OSCURO ')).toBe('#1B2F5C')
    expect(suggestColorHex('Marrón')).toBe('#6B4226')
    expect(suggestColorHex('Rojo ladrillo')).toBe('#C62828')
    expect(suggestColorHex('Estampado tropical')).toBeNull()
    expect(suggestColorHex(null)).toBeNull()
  })

  it('usa el tono guardado antes que el sugerido', () => {
    expect(swatchFor('#123456', 'Negro')).toBe('#123456')
    expect(swatchFor(null, 'Negro')).toBe('#111111')
    expect(swatchFor(null, 'Estampado')).toBe('#D9D2C5')
  })

  it('detecta tonos claros', () => {
    expect(isLightHex('#FFFFFF')).toBe(true)
    expect(isLightHex('#111111')).toBe(false)
  })
})
