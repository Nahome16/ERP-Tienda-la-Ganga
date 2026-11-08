export type AppView =
  | 'panel'
  | 'pos'
  | 'caja'
  | 'ventas'
  | 'inventario'
  | 'productos'
  | 'equipo'
  | 'configuracion'
  | 'catalogos'
  | 'auditoria'

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
