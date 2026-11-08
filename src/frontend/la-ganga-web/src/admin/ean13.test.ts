import { describe, expect, it } from 'vitest'
import { barRuns, barcodeModules, checkDigit, isValidEan13, normalizeBarcode, withCheckDigit } from './ean13'

describe('EAN-13', () => {
  it('calcula el dígito de verificación', () => {
    expect(checkDigit('400638133393')).toBe(1)
    expect(checkDigit('590123412345')).toBe(7)
    expect(withCheckDigit('400638133393')).toBe('4006381333931')
  })
  it('valida códigos', () => {
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
    expect(isValidEan13('400638133393')).toBe(false)
  })
  it('genera 95 módulos con guardas y el patrón conocido', () => {
    const modules = barcodeModules('4006381333931')
    expect(modules).toHaveLength(95)
    expect(modules.startsWith('101')).toBe(true)
    expect(modules.slice(45, 50)).toBe('01010')
    expect(modules.endsWith('101')).toBe(true)
    // 4006381333931: el primer dígito (4) fija la paridad LGLLGG en la mitad izquierda.
    const expected = ['101', '0001101', '0100111', '0101111', '0111101', '0001001', '0110011', '01010']
    expect(modules.slice(0, 50)).toBe(expected.join(''))
    // Mitad derecha en código R: 3,3,3,9,3,1.
    expect(modules.slice(50, 92)).toBe(['1000010', '1000010', '1000010', '1110100', '1000010', '1100110'].join(''))
  })
  it('normaliza UPC-A y EAN-8', () => {
    expect(normalizeBarcode('036000291452')).toEqual({ kind: 'EAN-13', digits: '0036000291452' })
    expect(normalizeBarcode('96385074')).toEqual({ kind: 'EAN-8', digits: '96385074' })
    expect(normalizeBarcode('ABC123')).toBeNull()
    expect(barcodeModules('96385074')).toHaveLength(67)
  })
  it('agrupa barras contiguas', () => {
    expect(barRuns('1100111')).toEqual([[0, 2], [4, 3]])
  })
})
