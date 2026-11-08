import { apiRequest } from './api'

export type RoleReference = { id: string; name: string }

export type UserSummary = {
  id: string
  username: string
  displayName: string
  isActive: boolean
  roles: RoleReference[]
  createdAtUtc: string
  lastLoginAtUtc: string | null
}

export type Role = { id: string; name: string; permissions: string[] }

export const permissionLabels: Record<string, string> = {
  'catalog.read': 'Consultar catálogos',
  'catalog.manage': 'Administrar catálogos',
  'product.read': 'Consultar productos',
  'product.create': 'Crear productos',
  'product.edit': 'Editar productos',
  'product.status.manage': 'Activar o inactivar productos',
  'product.archive': 'Archivar productos',
  'product.images.manage': 'Administrar fotos',
  'inventory.read': 'Consultar existencias',
  'inventory.kardex.read': 'Consultar Kardex',
  'inventory.cost.read': 'Ver costos y valoración',
  'inventory.initial.confirm': 'Registrar existencia inicial',
  'inventory.adjust': 'Registrar ajustes',
  'inventory.adjust.authorize': 'Autorizar ajustes',
  'user.manage': 'Administrar cuentas y roles',
}

export const roleDescriptions: Record<string, string> = {
  Administrador: 'Acceso total: panel, punto de venta, costos y cuentas.',
  Vendedor: 'Solo punto de venta. Consulta productos y existencias, sin costos.',
  'Encargado de inventario': 'Productos, catálogos e inventario. Sin costos ni cuentas.',
}

export const passwordMinLength = 12

export function listUsers(signal?: AbortSignal) {
  return apiRequest<UserSummary[]>('/api/v1/users', { signal })
}

export function listRoles(signal?: AbortSignal) {
  return apiRequest<Role[]>('/api/v1/users/roles', { signal })
}

export function createUser(input: { username: string; displayName: string; password: string; roleIds: string[] }) {
  return apiRequest<UserSummary>('/api/v1/users', { method: 'POST', body: input })
}

export function updateUser(id: string, input: { displayName: string; roleIds: string[]; isActive: boolean }) {
  return apiRequest<UserSummary>(`/api/v1/users/${id}`, { method: 'PUT', body: input })
}

export function resetPassword(id: string, password: string) {
  return apiRequest<UserSummary>(`/api/v1/users/${id}/password`, { method: 'POST', body: { password } })
}
