import type { CurrentUser } from '../types'

// Esqueleto: lo reemplaza la implementación real del módulo Socios e inversión.
export function InvestmentView({ user }: { user: CurrentUser }) {
  return (
    <main className="admin-page">
      <header className="page-header"><div><h1>Socios e inversión</h1><p className="page-summary">En construcción · {user.displayName}</p></div></header>
    </main>
  )
}
