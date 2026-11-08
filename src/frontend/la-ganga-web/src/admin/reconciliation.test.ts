import { describe, expect, it } from 'vitest'
import { methodStatus, type RecMethod } from './reconciliation'

const method = (nio: [number, number | null, number | null], usd: [number, number | null, number | null]): RecMethod => ({
  key: 'transfer', title: 'Transferencias', countedLabel: 'Verificado en banco',
  lines: [
    { currency: 'NIO', expected: nio[0], counted: nio[1], difference: nio[2] },
    { currency: 'USD', expected: usd[0], counted: usd[1], difference: usd[2] },
  ],
})

describe('methodStatus', () => {
  it('es «Pendiente» mientras la caja está abierta', () => {
    expect(methodStatus(method([100, null, null], [0, null, null]), true).label).toBe('Pendiente')
  })
  it('es «No verificado» si no se escribió nada', () => {
    expect(methodStatus(method([100, null, null], [20, null, null]), false).label).toBe('No verificado')
  })
  it('cuadra cuando lo verificado coincide y lo no verificado no tenía movimiento', () => {
    expect(methodStatus(method([100, 100, 0], [0, null, null]), false).label).toBe('Cuadra')
  })
  it('indica falta y sobra por moneda', () => {
    const status = methodStatus(method([100, 90, -10], [20, 25, 5]), false)
    expect(status.label).toBe('Diferencia')
    expect(status.details).toEqual(['Falta C$ 10.00', 'Sobra US$ 5.00'])
  })
  it('marca verificación parcial si falta una moneda con movimiento', () => {
    expect(methodStatus(method([100, 100, 0], [20, null, null]), false).label).toBe('Verificado en parte')
  })
})
