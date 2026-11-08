import type { AppView, CurrentUser } from '../types'

export const administratorRole = 'Administrador'
export const sellerRole = 'Vendedor'

/** Orden en que se ofrecen las pantallas en el menú. */
export const allViews: AppView[] = [
  'panel', 'pos', 'caja', 'ventas', 'reportes', 'productos', 'inventario', 'catalogos',
  'equipo', 'configuracion', 'auditoria',
]

/**
 * Permisos que habilitan cada pantalla (basta uno de la lista). El servidor
 * vuelve a comprobar cada permiso en la API; esto solo decide qué se muestra.
 * El vendedor solo recibe el punto de venta: sus permisos de lectura no abren
 * pantallas administrativas.
 */
const viewPermissions: Record<AppView, string[]> = {
  panel: ['cash.report.read'],
  pos: ['sale.create'],
  caja: ['cash.report.read'],
  ventas: ['sale.read'],
  // Sin inventory.read: el vendedor tiene ese permiso y solo debe ver el punto de venta.
  reportes: ['sale.read', 'inventory.kardex.read', 'cash.report.read'],
  productos: ['product.create', 'product.edit'],
  inventario: ['inventory.adjust', 'inventory.kardex.read'],
  catalogos: ['catalog.manage'],
  equipo: ['user.manage'],
  configuracion: ['settings.manage'],
  auditoria: ['audit.read'],
}

export function hasPermission(user: CurrentUser, permission: string) {
  return user.permissions.includes(permission)
}

export function isAppView(value: string): value is AppView {
  return allViews.some((view) => view === value)
}

export function allowedViews(user: CurrentUser): AppView[] {
  return allViews.filter((view) => viewPermissions[view].some((permission) => hasPermission(user, permission)))
}

/** Pantallas con menú lateral (todo excepto el punto de venta). */
export function shellViews(user: CurrentUser) {
  return allowedViews(user).filter((view) => view !== 'pos')
}

/** Primera pantalla después de iniciar sesión, o null si la cuenta no tiene ninguna. */
export function landingView(user: CurrentUser): AppView | null {
  const allowed = allowedViews(user)
  if (allowed.includes('panel')) return 'panel'
  return allowed.find((view) => view !== 'pos') ?? (allowed.includes('pos') ? 'pos' : null)
}

export function resolveView(user: CurrentUser, requested: AppView): AppView | null {
  return allowedViews(user).includes(requested) ? requested : landingView(user)
}
