import { describe, expect, it } from 'vitest'
import type { ExchangeLookup, ExchangeableLine } from '../lib/apiTypes'
import { buildExchangeRequest, choiceError, exchangeOptions, normalizeReceiptNumber, windowText } from './exchange'

function line(overrides: Partial<ExchangeableLine> = {}): ExchangeableLine {
  return {
    saleLineId: 'line-1', variantId: 'v-m', productId: 'p-1', productName: 'Camisa', sizeName: 'M', colorName: 'Azul',
    barcode: '100', quantity: 2, alreadyExchanged: 0, available: 2, unitPrice: 500,
    options: [
      { variantId: 'v-m', sizeName: 'M', colorName: 'Azul', colorHex: null, barcode: '100', stock: 3, price: 500, isActive: true },
      { variantId: 'v-l', sizeName: 'L', colorName: 'Azul', colorHex: null, barcode: '101', stock: 1, price: 500, isActive: true },
      { variantId: 'v-xl', sizeName: 'XL', colorName: 'Azul', colorHex: null, barcode: '102', stock: 5, price: 500, isActive: false },
    ],
    ...overrides,
  }
}

function lookup(lines: ExchangeableLine[] = [line()]): ExchangeLookup {
  return {
    saleId: 'sale-1', saleNumber: 'V-000012', saleCreatedAtUtc: '2026-11-08T15:00:00Z', status: 'Confirmed', totalNio: 1000,
    daysSinceSale: 1, windowDays: 4, canExchange: true, blockedReason: null, lines, exchanges: [],
  }
}

describe('normalizeReceiptNumber', () => {
  it('acepta el formato del recibo, solo dígitos o con espacios', () => {
    expect(normalizeReceiptNumber('V-000123')).toBe('123')
    expect(normalizeReceiptNumber(' v 45 ')).toBe('45')
    expect(normalizeReceiptNumber('0000')).toBe('0')
    expect(normalizeReceiptNumber('abc')).toBe('')
  })
})

describe('exchangeOptions', () => {
  it('excluye la misma variante y las inactivas', () => {
    expect(exchangeOptions(line()).map((option) => option.variantId)).toEqual(['v-l'])
  })
})

describe('choiceError', () => {
  it('no marca error si la prenda no se cambia', () => {
    expect(choiceError(line(), undefined)).toBeNull()
    expect(choiceError(line(), { quantity: 0, newVariantId: null })).toBeNull()
  })

  it('valida cantidad, talla elegida y existencia', () => {
    expect(choiceError(line(), { quantity: 3, newVariantId: 'v-l' })).toMatch(/Solo se pueden cambiar 2/)
    expect(choiceError(line({ available: 0 }), { quantity: 1, newVariantId: 'v-l' })).toMatch(/ya se cambió/)
    expect(choiceError(line(), { quantity: 1, newVariantId: null })).toMatch(/Elegí la talla/)
    expect(choiceError(line(), { quantity: 1, newVariantId: 'v-m' })).toMatch(/distinto/)
    expect(choiceError(line(), { quantity: 1, newVariantId: 'v-xl' })).toMatch(/no está disponible/)
    expect(choiceError(line(), { quantity: 2, newVariantId: 'v-l' })).toMatch(/Solo hay 1/)
    expect(choiceError(line(), { quantity: 1, newVariantId: 'v-l' })).toBeNull()
  })
})

describe('buildExchangeRequest', () => {
  const base = { clientExchangeId: 'c-1', cashSessionId: 's-1', note: '  ' }

  it('pide al menos una prenda', () => {
    const result = buildExchangeRequest(lookup(), {}, base)
    expect(result.errors?.form).toBeDefined()
  })

  it('arma la solicitud solo con las prendas elegidas', () => {
    const other = line({ saleLineId: 'line-2' })
    const result = buildExchangeRequest(lookup([line(), other]), { 'line-1': { quantity: 1, newVariantId: 'v-l' }, 'line-2': { quantity: 0, newVariantId: null } }, base)
    expect(result.request).toEqual({
      clientExchangeId: 'c-1', saleId: 'sale-1', cashSessionId: 's-1', note: null,
      items: [{ saleLineId: 'line-1', quantity: 1, newVariantId: 'v-l' }],
    })
  })

  it('devuelve el error de la línea inválida', () => {
    const result = buildExchangeRequest(lookup(), { 'line-1': { quantity: 1, newVariantId: null } }, base)
    expect(result.request).toBeNull()
    expect(result.errors?.['line-1']).toMatch(/Elegí la talla/)
  })
})

describe('windowText', () => {
  it('describe la antigüedad de la compra', () => {
    expect(windowText({ daysSinceSale: 0, windowDays: 4 })).toBe('Compra de hoy · plazo de 4 días')
    expect(windowText({ daysSinceSale: 1, windowDays: 1 })).toBe('Compra de ayer · plazo de 1 día')
    expect(windowText({ daysSinceSale: 3, windowDays: 4 })).toBe('Compra de hace 3 días · plazo de 4 días')
  })
})
