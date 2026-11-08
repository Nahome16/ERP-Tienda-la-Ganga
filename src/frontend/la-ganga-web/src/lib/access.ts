import type { AppView, CurrentUser } from '../types'

export const administratorRole = 'Administrador'
export const sellerRole = 'Vendedor'

export const allViews: AppView[] = [
  'panel', 'pos', 'caja', 'inventario', 'productos', 'compras', 'clientes',
  'promociones', 'sucursales', 'tienda', 'reportes', 'contabilidad', 'equipo',
  'configuracion', 'catalogos',
]

/**
 * Pantallas del panel que se habilitan por permiso a quien no es
 * administrador. El servidor vuelve a comprobar cada permiso; esto solo
 * decide qué se muestra en el menú.
 */
const viewPermissions: [AppView, string][] = [
  ['inventario', 'inventory.adjust'],
  ['productos', 'product.create'],
  ['catalogos', 'catalog.manage'],
  ['equipo', 'user.manage'],
]

export function isAppView(value: string): value is AppView {
  return allViews.some((view) => view === value)
}

export function allowedViews(user: CurrentUser): AppView[] {
  if (user.roles.includes(administratorRole)) return allViews
  const views = viewPermissions
    .filter(([, permission]) => user.permissions.includes(permission))
    .map(([view]) => view)
  if (user.roles.includes(sellerRole)) views.push('pos')
  return views
}

/** Pantallas con menú lateral (todo excepto el punto de venta). */
export function shellViews(user: CurrentUser) {
  return allowedViews(user).filter((view) => view !== 'pos')
}

/** Primera pantalla después de iniciar sesión, o null si la cuenta no tiene ninguna. */
export function landingView(user: CurrentUser): AppView | null {
  if (user.roles.includes(administratorRole)) return 'panel'
  const allowed = allowedViews(user)
  return allowed.find((view) => view !== 'pos') ?? (allowed.includes('pos') ? 'pos' : null)
}

export function resolveView(user: CurrentUser, requested: AppView): AppView | null {
  return allowedViews(user).includes(requested) ? requested : landingView(user)
}
