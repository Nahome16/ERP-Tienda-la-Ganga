import type { CurrentUser } from '../types'

// Esqueleto: lo reemplaza la implementación real de la pantalla.
export function SalesView({ user }: { user: CurrentUser }) {
  return (
    <main className="admin-page">
      <header className="page-header"><div><h1>Ventas</h1><p className="page-summary">En construcción · {user.displayName}</p></div></header>
    </main>
  )
}
