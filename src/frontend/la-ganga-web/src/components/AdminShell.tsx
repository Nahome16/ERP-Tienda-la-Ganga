import { useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { ChevronDown, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, ScanBarcode, X } from 'lucide-react'
import { locate, navHome, visibleGroups, type NavItem } from '../lib/navigation'
import type { ApiState, AppView, CurrentUser } from '../types'
import './shell.css'

type AdminShellProps = PropsWithChildren<{
  activeView: AppView
  allowedViews: AppView[]
  api: ApiState
  user: CurrentUser
  onNavigate: (view: AppView) => void
  onLogout: () => void
}>

const GROUPS_KEY = 'lg.nav.groups'
const RAIL_KEY = 'lg.nav.rail'

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* sin almacenamiento (modo privado): el menú funciona igual */
  }
}

function connectionText(api: ApiState) {
  if (api.kind === 'loading') return 'Comprobando conexión'
  if (api.kind === 'offline') return 'Sin conexión con el servidor'
  return 'Conectado'
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es') || 'LG'
}

export function AdminShell({ activeView, allowedViews, api, user, onNavigate, onLogout, children }: AdminShellProps) {
  const groups = visibleGroups(allowedViews)
  const here = locate(activeView)
  const [open, setOpen] = useState<Record<string, boolean>>(() => readStored<Record<string, boolean>>(GROUPS_KEY, {}))
  const [rail, setRail] = useState<boolean>(() => readStored<boolean>(RAIL_KEY, false))
  const [drawer, setDrawer] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const firstLink = useRef<HTMLAnchorElement>(null)

  // La categoría de la pantalla actual siempre está abierta; el resto recuerda lo que se dejó.
  const activeGroupId = here?.group?.id
  const isOpen = (id: string) => id === activeGroupId || open[id] === true

  const toggleGroup = (id: string) => {
    setOpen((current) => {
      const next = { ...current, [id]: !(id === activeGroupId || current[id] === true) }
      writeStored(GROUPS_KEY, next)
      return next
    })
  }

  const toggleRail = () => {
    setRail((current) => {
      writeStored(RAIL_KEY, !current)
      return !current
    })
  }

  const closeDrawer = () => {
    setDrawer(false)
    menuButton.current?.focus()
  }

  // Cajón del celular: Esc lo cierra, el fondo no se desplaza y el foco entra al menú.
  useEffect(() => {
    if (!drawer) return undefined
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawer(false)
      menuButton.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    firstLink.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [drawer])

  const go = (view: AppView) => {
    setDrawer(false)
    onNavigate(view)
  }

  const renderLink = (item: NavItem, index = -1) => {
    const Icon = item.icon
    const active = activeView === item.view
    return (
      <a
        key={item.view}
        ref={index === 0 ? firstLink : undefined}
        className={`nav-link${active ? ' is-active' : ''}`}
        href={`#${item.view}`}
        aria-current={active ? 'page' : undefined}
        title={rail ? item.label : undefined}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return
          event.preventDefault()
          go(item.view)
        }}
      >
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="nav-label">{item.label}</span>
      </a>
    )
  }

  const homeAllowed = allowedViews.includes(navHome.view)
  const posAllowed = allowedViews.includes('pos')

  return (
    <div className={`shell${rail ? ' is-rail' : ''}`}>
      <div className={`shell-scrim${drawer ? ' is-open' : ''}`} onClick={closeDrawer} aria-hidden="true" />

      <aside className={`shell-sidebar${drawer ? ' is-open' : ''}`} aria-label="Navegación principal">
        <div className="shell-brand">
          <button className="brand-button" type="button" onClick={() => go(homeAllowed ? 'panel' : allowedViews[0])} aria-label="Ir al inicio">
            <img src="/logo-tienda-la-ganga.png" alt="" width={36} height={36} />
            <span className="brand-text">
              <strong>Tienda La Ganga</strong>
              <small>Managua</small>
            </span>
          </button>
          <button className="icon-button only-mobile" type="button" onClick={closeDrawer} aria-label="Cerrar menú">
            <X size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <nav className="shell-nav" aria-label="Módulos">
          {homeAllowed && <div className="nav-top">{renderLink(navHome, drawer ? 0 : -1)}</div>}

          {groups.map((group) => {
            const expanded = isOpen(group.id)
            const panelId = `nav-group-${group.id}`
            const containsActive = group.id === activeGroupId
            return (
              <div className={`nav-group${containsActive ? ' has-active' : ''}`} key={group.id}>
                <button
                  className="nav-group-head"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  title={rail ? group.label : undefined}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span className="nav-label">{group.label}</span>
                  <ChevronDown className="group-chevron" size={16} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <div className="nav-group-items" id={panelId} hidden={!expanded && !rail}>
                  {group.items.map((item) => renderLink(item))}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="shell-account">
          <span className="account-avatar" aria-hidden="true">{initials(user.displayName)}</span>
          <span className="account-text">
            <strong>{user.displayName}</strong>
            <small>{user.roles.join(' · ')}</small>
          </span>
          <button className="icon-button" type="button" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
            <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <button className="rail-toggle only-desktop" type="button" onClick={toggleRail} aria-pressed={rail} aria-label={rail ? 'Expandir menú' : 'Contraer menú'}>
          {rail ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden="true" />}
          <span className="nav-label">Contraer menú</span>
        </button>
      </aside>

      <div className="shell-main">
        <header className="shell-topbar">
          <button ref={menuButton} className="icon-button only-mobile" type="button" onClick={() => setDrawer(true)} aria-label="Abrir menú" aria-expanded={drawer}>
            <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>

          <nav className="crumbs" aria-label="Ubicación">
            {here?.group && (
              <>
                <span className="crumb-group">{here.group.label}</span>
                <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </>
            )}
            <strong aria-current="page">{here?.item.label ?? 'Panel'}</strong>
          </nav>

          <div className="topbar-right">
            <span className={`status-pill is-${api.kind}`} role="status">
              <span className="status-dot" aria-hidden="true" />
              <span className="status-text">{connectionText(api)}</span>
            </span>
            {posAllowed && activeView !== 'panel' && (
              <button className="icon-button only-mobile" type="button" onClick={() => go('pos')} aria-label="Abrir el punto de venta" title="Punto de venta">
                <ScanBarcode size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
