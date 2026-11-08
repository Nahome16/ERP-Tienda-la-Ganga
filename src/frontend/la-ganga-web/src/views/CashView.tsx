import type { CurrentUser } from '../types'

// Esqueleto: lo reemplaza la implementación real de la pantalla.
export function CashView({ user }: { user: CurrentUser }) {
  return (
    <main className="admin-page">
      <header className="page-header"><div><h1>Caja y cierres</h1><p className="page-summary">En construcción · {user.displayName}</p></div></header>
    </main>
  )
}
