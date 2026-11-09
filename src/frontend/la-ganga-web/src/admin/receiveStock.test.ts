import { describe, expect, it } from 'vitest'
import type { Variant } from '../lib/apiTypes'
import { fillQuantities, parseReceiveQuantities } from './receiveStock'

const variant = (id: string, size: string, color: string, isActive = true) => ({ id, sizeName: size, colorName: color, isActive }) as unknown as Variant
const variants = [variant('a', 'S', 'Negro'), variant('b', 'M', 'Negro'), variant('c', 'L', 'Azul', false)]

describe('parseReceiveQuantities', () => {
  it('ignora vacíos y ceros y suma las unidades', () => {
    const result = parseReceiveQuantities(variants, { a: '3', b: '', c: '0' })
    expect(result.error).toBeNull()
    expect(result.lines).toEqual([{ variantId: 'a', label: 'S / Negro', quantity: 3 }])
    expect(result.totalUnits).toBe(3)
  })
  it('acepta varias variantes', () => {
    const result = parseReceiveQuantities(variants, { a: '2', b: '5' })
    expect(result.totalUnits).toBe(7)
    expect(result.lines).toHaveLength(2)
  })
  it('rechaza decimales, negativos y texto', () => {
    expect(parseReceiveQuantities(variants, { a: '1.5' }).error).toContain('S / Negro')
    expect(parseReceiveQuantities(variants, { b: '-2' }).error).toContain('M / Negro')
    expect(parseReceiveQuantities(variants, { a: 'abc' }).error).not.toBeNull()
  })
  it('sin cantidades no hay líneas ni error', () => {
    expect(parseReceiveQuantities(variants, {})).toEqual({ lines: [], totalUnits: 0, error: null })
  })
})

describe('fillQuantities', () => {
  it('solo llena las variantes activas', () => {
    expect(fillQuantities(variants, '4')).toEqual({ a: '4', b: '4' })
  })
})
