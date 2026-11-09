import type { CurrentUser } from '../types'
import { deleteMeta, getMeta, loadAnyCashSession, setMeta } from '../pos/storage'

// Usuario guardado en el equipo para poder abrir el POS sin conexión.
// Solo se guardan id, usuario, nombre, roles y permisos: nunca contraseñas ni cookies.

const USER_KEY = 'user'

type StoredUser = CurrentUser & { savedAtUtc: string }

export async function saveCachedUser(user: CurrentUser): Promise<void> {
  const stored: StoredUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roles: [...user.roles],
    permissions: [...user.permissions],
    mustChangePassword: user.mustChangePassword,
    savedAtUtc: new Date().toISOString(),
  }
  await setMeta<StoredUser>(USER_KEY, stored)
}

export async function loadCachedUser(): Promise<CurrentUser | null> {
  const stored = await getMeta<StoredUser>(USER_KEY)
  if (!stored) return null
  return {
    id: stored.id,
    username: stored.username,
    displayName: stored.displayName,
    roles: stored.roles,
    permissions: stored.permissions,
    mustChangePassword: stored.mustChangePassword ?? false,
  }
}

export async function clearCachedUser(): Promise<void> {
  await deleteMeta(USER_KEY)
}

/**
 * Usuario con el que se puede entrar al POS sin conexión: debe estar guardado,
 * poder vender y tener una caja abierta a su nombre en este equipo.
 * Devuelve null si falta cualquier cosa (entonces se muestra el login normal).
 */
export async function restoreOfflineUser(): Promise<CurrentUser | null> {
  try {
    const user = await loadCachedUser()
    if (!user || user.mustChangePassword || !user.permissions.includes('sale.create')) return null
    const cash = await loadAnyCashSession()
    if (!cash || cash.userId !== user.id || cash.session.closedAtUtc) return null
    return user
  } catch {
    return null
  }
}
