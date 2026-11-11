import { describe, expect, it } from 'vitest'
import { code128Bars, code128Values } from './code128'

describe('code128', () => {
  it('calcula el dígito de verificación con inicio B («PJJ123C» = 55)', () => {
    const values = code128Values('PJJ123C')
    expect(values[0]).toBe(104)
    expect(values.at(-2)).toBe(55)
    expect(values.at(-1)).toBe(106)
  })

  it('el número del recibo mide 11 módulos por carácter más inicio, verificación y fin', () => {
    const { width, bars } = code128Bars('V-000123')
    expect(width).toBe(11 * (1 + 8 + 1) + 13)
    expect(bars[0]).toEqual([0, 2])
  })

  it('rechaza caracteres fuera de ASCII', () => {
    expect(() => code128Values('Ñ')).toThrow()
  })
})
