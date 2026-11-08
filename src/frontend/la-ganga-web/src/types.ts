export type AppView =
  | 'panel'
  | 'pos'
  | 'caja'
  | 'inventario'
  | 'productos'
  | 'compras'
  | 'clientes'
  | 'promociones'
  | 'sucursales'
  | 'tienda'
  | 'reportes'
  | 'contabilidad'
  | 'equipo'
  | 'configuracion'
  | 'catalogos'

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

export type CurrentUser = {
  id: string
  username: string
  displayName: string
  roles: string[]
  permissions: string[]
}

export type AuthState =
  | { kind: 'loading' }
  | { kind: 'unauthenticated' }
  | { kind: 'authenticated'; user: CurrentUser }
  | { kind: 'preview'; user: CurrentUser }
