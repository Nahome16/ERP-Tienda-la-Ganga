import type { PropsWithChildren } from 'react'
import type { ApiState, AppView } from '../types'

type AdminShellProps = PropsWithChildren<{
  activeView: AppView
  api: ApiState
  onNavigate: (view: AppView) => void
}>

const navigation: { label: string; view: AppView; icon: string }[] = [
  { label: 'Panel', view: 'panel', icon: '▦' },
  { label: 'Ventas', view: 'ventas', icon: '◫' },
  { label: 'Punto de venta', view: 'pos', icon: '▤' },
  { label: 'Caja', view: 'caja', icon: '▣' },
  { label: 'Historial de ventas', view: 'historial', icon: '◷' },
  { label: 'Delivery', view: 'delivery', icon: '◇' },
  { label: 'Pedidos', view: 'pedidos', icon: '▱' },
  { label: 'Clientes', view: 'clientes', icon: '◎' },
  { label: 'Compras', view: 'compras', icon: '▥' },
  { label: 'Inventario', view: 'inventario', icon: '⬡' },
]

function ConnectionLabel({ api }: { api: ApiState }) {
  if (api.kind === 'loading') return <>Comprobando API</>
  if (api.kind === 'offline') return <>Modo de vista previa</>
  return <>API conectada</>
}

export function AdminShell({ activeView, api, onNavigate, children }: AdminShellProps) {
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <button className="sidebar-brand" type="button" onClick={() => onNavigate('panel')}>
          <img src="/logo-tienda-la-ganga.png" alt="" />
          <span>
            <strong>Tienda La Ganga</strong>
            <small>Managua</small>
          </span>
        </button>

        <nav className="admin-nav" aria-label="Módulos administrativos">
          {navigation.map((item) => (
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
          <span className="account-avatar">AD</span>
          <span>
            <strong>Administrador</strong>
            <small>Acceso completo</small>
          </span>
        </div>
      </aside>

      <div className="admin-workspace">
        <div className={`preview-ribbon ${api.kind}`}>
          <span className="connection-dot" />
          <ConnectionLabel api={api} />
          <strong>Vista previa · datos simulados</strong>
        </div>
        {children}
      </div>
    </div>
  )
}
