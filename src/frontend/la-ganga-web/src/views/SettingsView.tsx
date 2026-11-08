import type { CurrentUser } from '../types'

// Esqueleto: lo reemplaza la implementación real de la pantalla.
export function SettingsView({ user, onOpenCatalogs }: { user: CurrentUser; onOpenCatalogs: () => void }) {
  return (
    <main className="admin-page">
      <header className="page-header"><div><h1>Configuración</h1><p className="page-summary">En construcción · {user.displayName}</p></div>
        <div className="page-actions"><button className="secondary-button" type="button" onClick={onOpenCatalogs}>Catálogos</button></div></header>
    </main>
  )
}
