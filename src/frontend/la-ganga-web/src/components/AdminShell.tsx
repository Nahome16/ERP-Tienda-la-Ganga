import type { PropsWithChildren } from 'react'
import type { ApiState, AppView, CurrentUser } from '../types'

type AdminShellProps = PropsWithChildren<{
  activeView: AppView
  allowedViews: AppView[]
  api: ApiState
  user: CurrentUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
}>

const navigation: { label: string; view: AppView; icon: string }[] = [
  { label: 'Panel', view: 'panel', icon: '▦' },
  { label: 'Punto de venta', view: 'pos', icon: '▤' },
  { label: 'Caja y cierres', view: 'caja', icon: '▣' },
  { label: 'Ventas', view: 'ventas', icon: '▥' },
  { label: 'Productos', view: 'productos', icon: '♧' },
  { label: 'Inventario', view: 'inventario', icon: '⬡' },
  { label: 'Catálogos', view: 'catalogos', icon: '☰' },
  { label: 'Equipo', view: 'equipo', icon: '♙' },
  { label: 'Configuración', view: 'configuracion', icon: '☷' },
  { label: 'Auditoría', view: 'auditoria', icon: '⌕' },
]

function ConnectionLabel({ api }: { api: ApiState }) {
  if (api.kind === 'loading') return <>Comprobando API</>
  if (api.kind === 'offline') return <>Sin conexión con el servidor</>
  return <>API conectada</>
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es') || 'LG'
}

export function AdminShell({ activeView, allowedViews, api, user, onNavigate, onLogout, children }: AdminShellProps) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="sidebar-brand" type="button" onClick={() => onNavigate(allowedViews.includes('panel') ? 'panel' : allowedViews[0])}>
          <img src="/logo-tienda-la-ganga.png" alt="" />
          <span>
            <strong>Tienda La Ganga</strong>
            <small>Managua</small>
          </span>
        </button>

        <nav className="admin-nav" aria-label="Módulos administrativos">
          {navigation.filter((item) => allowedViews.includes(item.view)).map((item) => (
            <button
              className={activeView === item.view ? 'admin-nav-item active' : 'admin-nav-item'}
              key={item.view}
              type="button"
              onClick={() => onNavigate(item.view)}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-account">
          <span className="account-avatar">{initials(user.displayName)}</span>
          <span>
            <strong>{user.displayName}</strong>
            <small>{user.roles.join(' · ')}</small>
          </span>
          <button type="button" onClick={onLogout} title="Cerrar sesión" aria-label="Cerrar sesión">↪</button>
        </div>
      </aside>

      <div className="admin-workspace">
        <div className={`preview-ribbon ${api.kind}`}>
          <span className="connection-dot" />
          <ConnectionLabel api={api} />
          <strong>Datos reales · base de datos</strong>
        </div>
        {children}
      </div>
    </div>
  )
}
