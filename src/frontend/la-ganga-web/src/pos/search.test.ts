import { describe, expect, it } from 'vitest'
import type { PosVariant } from '../lib/apiTypes'
import { buildIndex, findByBarcode, findColorByBarcode, findProductByBarcode, searchVariants } from './search'

function variant(overrides: Partial<PosVariant>): PosVariant {
  return {
    variantId: 'v', productId: 'p-kalua', productName: 'Pantalón Kalua', categoryName: 'Pantalones', brandName: 'Kalua',
    sizeName: '15', colorName: 'Azul oscuro', colorHex: null, barcode: '2000000000017', price: 690, stock: 3,
    productBarcode: '7451234567890', ...overrides,
  }
}

const index = buildIndex([
  variant({ variantId: 'v15', sizeName: '15', barcode: '2000000000017' }),
  variant({ variantId: 'v17', sizeName: '17', barcode: '2000000000024' }),
  variant({ variantId: 'c1', productId: 'p-camisa', productName: 'Camisa Oxford', barcode: '2000000000031', productBarcode: null }),
  variant({ variantId: 'z30n', productId: 'p-zolo', productName: 'Pantalón Zolo', colorName: 'Negro', sizeName: '30', barcode: '2000000000048', productBarcode: null, colorBarcode: '7450000000011' }),
  variant({ variantId: 'z32n', productId: 'p-zolo', productName: 'Pantalón Zolo', colorName: 'Negro', sizeName: '32', barcode: '2000000000055', productBarcode: null, colorBarcode: '7450000000011' }),
  variant({ variantId: 'z30a', productId: 'p-zolo', productName: 'Pantalón Zolo', colorName: 'Azul', sizeName: '30', barcode: '2000000000062', productBarcode: null, colorBarcode: '7450000000028' }),
])

describe('códigos en la caja', () => {
  it('el código de una talla agrega esa talla', () => {
    expect(findByBarcode(index, '2000000000024')?.variantId).toBe('v17')
    expect(findProductByBarcode(index, '2000000000024')).toBeNull()
  })

  it('el código de fábrica del producto abre el producto, no una talla', () => {
    expect(findByBarcode(index, '7451234567890')).toBeNull()
    expect(findProductByBarcode(index, ' 7451234567890 ')).toBe('p-kalua')
  })

  it('la búsqueda también encuentra por el código de fábrica', () => {
    expect(searchVariants(index, '7451234567890').map((item) => item.variantId)).toEqual(['v15', 'v17'])
  })

  it('el código de un color abre el producto en ese color', () => {
    expect(findByBarcode(index, '7450000000011')).toBeNull()
    expect(findProductByBarcode(index, '7450000000011')).toBeNull()
    expect(findColorByBarcode(index, '7450000000011')).toEqual({ productId: 'p-zolo', colorName: 'Negro' })
    expect(findColorByBarcode(index, '7450000000028')).toEqual({ productId: 'p-zolo', colorName: 'Azul' })
  })
})
