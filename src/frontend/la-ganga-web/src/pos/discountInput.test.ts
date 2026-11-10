import { describe, expect, it } from 'vitest'
import { discountProblem } from './discountInput'

describe('discountProblem', () => {
  it('acepta vacío, cero y valores normales', () => {
    expect(discountProblem('Percent', '', 1000)).toBeNull()
    expect(discountProblem('Percent', '0', 1000)).toBeNull()
    expect(discountProblem('Percent', '10', 1000)).toBeNull()
    expect(discountProblem('Percent', '100', 1000)).toBeNull()
    expect(discountProblem('Amount', '250,50', 1000)).toBeNull()
    expect(discountProblem('Amount', '1000', 1000)).toBeNull()
  })
  it('rechaza negativos', () => {
    expect(discountProblem('Percent', '-5', 1000)).toMatch(/negativo/)
    expect(discountProblem('Amount', '-1', 1000)).toMatch(/negativo/)
  })
  it('rechaza más de 100% y montos mayores al subtotal', () => {
    expect(discountProblem('Percent', '101', 1000)).toMatch(/100%/)
    expect(discountProblem('Amount', '1000.01', 1000)).toMatch(/subtotal/)
  })
  it('rechaza texto', () => {
    expect(discountProblem('Percent', 'abc', 1000)).toMatch(/número/)
  })
})
