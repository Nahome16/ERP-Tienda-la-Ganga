export type AppView =
  | 'panel'
  | 'ventas'
  | 'pos'
  | 'caja'
  | 'historial'
  | 'delivery'
  | 'pedidos'
  | 'clientes'
  | 'compras'
  | 'inventario'

export type HealthStatus = {
  service: string
  status: 'healthy'
  timeZone: string
  checkedAtUtc: string
}

export type ApiState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: HealthStatus }
  | { kind: 'offline' }
