import { describe, expect, it } from 'vitest'
import type { PosVariant } from '../lib/apiTypes'
import { addToCart, cartUnits, setLineQuantity } from './cart'
import { buildSaleRequest, buildLocalSale } from './sale'
import { buildIndex, findByBarcode, groupByProduct, searchVariants } from './search'
import { availableStock } from './stock'

const variant = (over: Partial<PosVariant>): PosVariant => ({
  variantId: 'v1', productId: 'p1', productName: 'Camisa Oxford', categoryName: 'Camisas', brandName: 'Ganga',
  sizeName: 'M', colorName: 'Azul oscuro', colorHex: null, barcode: '0012345', price: 350, stock: 3, ...over,
})
const variants = [
  variant({}),
  variant({ variantId: 'v2', sizeName: 'L', barcode: 'ABC-2' }),
  variant({ variantId: 'v3', productId: 'p2', productName: 'Jean Slim', categoryName: 'Pantalones', brandName: 'Denim', sizeName: '32', colorName: 'Negro', barcode: '777', price: 600 }),
]

describe('carrito', () => {
  it('escanear dos veces suma cantidad y 0 quita la línea', () => {
    let lines = addToCart([], variants[0] as PosVariant)
    lines = addToCart(lines, variants[0] as PosVariant)
    expect(lines).toHaveLength(1)
    expect(cartUnits(lines)).toBe(2)
    expect(setLineQuantity(lines, 'v1', 5)[0]?.quantity).toBe(5)
    expect(setLineQuantity(lines, 'v1', 0)).toEqual([])
  })

  it('el stock disponible descuenta pendientes', () => {
    expect(availableStock(5, 'v1', new Map([['v1', 2]]))).toBe(3)
    expect(availableStock(1, 'v1', new Map([['v1', 3]]))).toBe(-2)
  })
})

describe('búsqueda local', () => {
  const index = buildIndex(variants)

  it('código exacto conserva ceros iniciales y no distingue mayúsculas', () => {
    expect(findByBarcode(index, ' 0012345 ')?.variantId).toBe('v1')
    expect(findByBarcode(index, 'abc-2')?.variantId).toBe('v2')
    expect(findByBarcode(index, '12345')).toBeNull()
  })

  it('busca por nombre, color, talla y sin acentos', () => {
    expect(searchVariants(index, 'camisa azul').map((v) => v.variantId)).toEqual(['v1', 'v2'])
    expect(searchVariants(index, 'camisa L').map((v) => v.variantId)).toEqual(['v2'])
    expect(searchVariants(index, 'DENIM negro')).toHaveLength(1)
    expect(searchVariants(index, 'zzz')).toHaveLength(0)
    expect(searchVariants(index, '', 'Pantalones')).toHaveLength(1)
  })

  it('agrupa por producto', () => {
    const groups = groupByProduct(variants)
    expect(groups.map((g) => g.productName)).toEqual(['Camisa Oxford', 'Jean Slim'])
    expect(groups[0]?.variants).toHaveLength(2)
  })
})

describe('venta local', () => {
  it('arma la solicitud y la venta con referencia provisional', () => {
    const lines = addToCart([], variants[0] as PosVariant, 2)
    const request = buildSaleRequest({
      clientSaleId: 'abcdef12-0000-4000-8000-000000000000', cashSessionId: 'cs', channel: 'WhatsApp',
      createdAtUtc: '2026-11-10T15:00:00Z', isOffline: true, lines, discount: { type: 'Percent', value: 10 },
      discountApprovalId: null,
      payments: [{ method: 'Cash', currency: 'NIO', amount: 700, exchangeRate: null, bank: null, reference: null }],
      note: '  ',
    })
    expect(request.note).toBeNull()
    expect(request.lines).toEqual([{ variantId: 'v1', quantity: 2, unitPrice: 350 }])
    const sale = buildLocalSale(request, lines, { session: { registerName: 'Caja 1' }, sellerName: 'Ana', settings: { usdRate: 36.7 } })
    expect(sale.number).toBe('#ABCDEF')
    expect(sale.subtotalNio).toBe(700)
    expect(sale.discountNio).toBe(70)
    expect(sale.totalNio).toBe(630)
    expect(sale.changeNio).toBe(70)
    expect(sale.lines[0]?.productName).toBe('Camisa Oxford')
  })
})
