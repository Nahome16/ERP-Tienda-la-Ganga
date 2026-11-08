import { describe, expect, it } from 'vitest'
import { buildEntryExtras, parseMoneyField, partnerFilterParam, partnerUnitsLabel, splitCreated } from './partners'

describe('partnerFilterParam', () => {
  it('vacío = sin filtro; id o «none» pasan tal cual', () => {
    expect(partnerFilterParam('')).toBeUndefined()
    expect(partnerFilterParam('none')).toBe('none')
    expect(partnerFilterParam('abc')).toBe('abc')
  })
})

describe('partnerUnitsLabel', () => {
  it('une los socios con unidades y omite los de cero', () => {
    expect(partnerUnitsLabel([
      { partnerId: 'a', name: 'Socio A', units: 5 },
      { partnerId: 'b', name: 'Socio B', units: 0 },
      { partnerId: null, name: 'Sin socio', units: 2 },
    ])).toBe('Socio A: 5 · Sin socio: 2')
  })
  it('nombre vacío = Sin socio; sin datos = texto vacío', () => {
    expect(partnerUnitsLabel([{ partnerId: null, name: '', units: 3 }])).toBe('Sin socio: 3')
    expect(partnerUnitsLabel(undefined)).toBe('')
    expect(partnerUnitsLabel([])).toBe('')
  })
})

describe('splitCreated', () => {
  it('separa «Socio: …» de los catálogos', () => {
    expect(splitCreated(['Categoría: Blusas', 'Socio: Ana', 'Socio : Luis', 'Marca: X'])).toEqual({
      partners: ['Ana', 'Luis'], catalogs: ['Categoría: Blusas', 'Marca: X'],
    })
    expect(splitCreated([])).toEqual({ partners: [], catalogs: [] })
  })
})

describe('parseMoneyField', () => {
  it('acepta coma o punto y devuelve null si está vacío o es inválido', () => {
    expect(parseMoneyField('12,5')).toBe(12.5)
    expect(parseMoneyField(' 380 ')).toBe(380)
    expect(parseMoneyField('')).toBeNull()
    expect(parseMoneyField('abc')).toBeNull()
  })
})

describe('buildEntryExtras', () => {
  it('envía socio, costo y precio escritos', () => {
    expect(buildEntryExtras({ partnerId: 'p1', cost: '380', price: '650,5' })).toEqual({ extras: { partnerId: 'p1', unitCost: 380, unitPrice: 650.5 }, error: null })
  })
  it('sin socio y con campos vacíos no manda nada (el servidor usa los actuales)', () => {
    expect(buildEntryExtras({ partnerId: '', cost: '', price: '' })).toEqual({ extras: {}, error: null })
  })
  it('acepta costo cero pero no precio cero ni negativos', () => {
    expect(buildEntryExtras({ partnerId: '', cost: '0', price: '' }).extras).toEqual({ unitCost: 0 })
    expect(buildEntryExtras({ partnerId: '', cost: '-1', price: '' }).error).toContain('costo')
    expect(buildEntryExtras({ partnerId: '', cost: '', price: '0' }).error).toContain('precio')
    expect(buildEntryExtras({ partnerId: '', cost: 'x', price: '' }).error).toContain('costo')
  })
})
