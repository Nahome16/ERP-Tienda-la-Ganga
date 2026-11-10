import { describe, expect, it } from 'vitest'
import { flattenVariantLookup, type VariantLookupResponse } from './adminApi'

const response = {
  productName: 'Camisa Polo',
  variant: { id: 'v1', productId: 'p1', sizeName: 'M', colorName: 'Negro', barcode: '2000000000015', price: 450, stock: 7, cost: 200, version: 3 },
} as unknown as VariantLookupResponse

describe('flattenVariantLookup', () => {
  it('deja los datos de la variante al nivel principal (regresión: «undefined» y «C$ NaN» al escanear)', () => {
    const flat = flattenVariantLookup(response)
    expect(flat.productName).toBe('Camisa Polo')
    expect(flat.id).toBe('v1')
    expect(flat.productId).toBe('p1')
    expect(flat.barcode).toBe('2000000000015')
    expect(flat.price).toBe(450)
    expect(flat.stock).toBe(7)
    expect(flat.sizeName).toBe('M')
  })
  it('no deja una propiedad `variant` anidada', () => {
    expect('variant' in flattenVariantLookup(response)).toBe(false)
  })
})
