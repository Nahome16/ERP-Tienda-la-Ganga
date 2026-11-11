import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, CircleUser } from 'lucide-react'

export type UserMenuItem = { label: string; icon: ReactNode; onSelect: () => void; danger?: boolean }

/**
 * Menú con el nombre de quien atiende la caja: agrupa las acciones de inicio y cierre
 * (volver al panel, cerrar caja, cerrar sesión) para que la barra muestre solo lo de cada venta.
 */
export function UserMenu({ name, items }: { name: string; items: UserMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>('.pv-user-toggle')?.focus() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  return (
    <div className="pv-user" ref={root}>
      <button
        type="button" className="pv-btn pv-btn-secondary pv-top-btn pv-user-toggle" aria-haspopup="menu" aria-expanded={open}
        aria-label={`Menú de ${name}`} title="Panel, cerrar caja y cerrar sesión" onClick={() => setOpen((value) => !value)}
      >
        <CircleUser size={18} strokeWidth={1.75} aria-hidden="true" />
        <span className="pv-btn-label pv-user-name">{name}</span>
        <ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="pv-user-menu" role="menu" aria-label={`Menú de ${name}`}>
          {items.map((item) => (
            <button
              key={item.label} type="button" role="menuitem" className={item.danger ? 'is-danger' : undefined}
              onClick={() => { setOpen(false); item.onSelect() }}
            >
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
