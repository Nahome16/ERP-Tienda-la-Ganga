import { describe, expect, it } from 'vitest'
import type { CurrentUser } from '../types'
import { allowedViews, landingView } from './access'

const user = (permissions: string[]) => ({ id: 'u', username: 'u', displayName: 'U', roles: [], permissions } as unknown as CurrentUser)

describe('pantallas por rol', () => {
  it('el encargado de inventario ve el punto de venta y el inventario, nada de finanzas ni ventas', () => {
    const inventoryManager = user([
      'catalog.read', 'catalog.manage', 'product.read', 'product.create', 'product.edit', 'product.status.manage', 'product.images.manage',
      'inventory.read', 'inventory.kardex.read', 'inventory.initial.confirm', 'inventory.adjust', 'inventory.cost.read',
      'investment.read', 'investment.manage', 'sale.create', 'sale.exchange', 'cash.operate',
    ])
    expect(allowedViews(inventoryManager)).toEqual(['pos', 'productos', 'inventario', 'etiquetas', 'catalogos'])
    expect(landingView(inventoryManager)).toBe('productos')
  })

  it('el vendedor solo ve el punto de venta', () => {
    expect(allowedViews(user(['catalog.read', 'product.read', 'inventory.read', 'sale.create', 'sale.exchange', 'cash.operate']))).toEqual(['pos'])
  })
})
