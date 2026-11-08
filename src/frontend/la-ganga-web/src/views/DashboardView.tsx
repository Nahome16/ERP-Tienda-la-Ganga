import type { AppView, CurrentUser } from '../types'

// Esqueleto: lo reemplaza la implementación real del panel.
export function DashboardView({ user, onNavigate }: { user: CurrentUser; onNavigate: (view: AppView) => void }) {
  return (
    <main className="admin-page dashboard-page">
      <header className="page-header"><div><h1>Panel</h1><p className="page-summary">En construcción · {user.displayName}</p></div>
        <div className="page-actions"><button className="primary-button" type="button" onClick={() => onNavigate('pos')}>Nueva venta</button></div></header>
    </main>
  )
}
