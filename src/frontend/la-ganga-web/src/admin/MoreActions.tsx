import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export type MoreAction = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }

/**
 * Botón «Más acciones» que agrupa las acciones de uso ocasional (socio, inactivar, eliminar…)
 * para que el pie de la ficha muestre solo las de todos los días.
 */
export function MoreActions({ actions, label = 'Más acciones' }: { actions: MoreAction[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>('.adm-more-toggle')?.focus() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey, true)
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey, true) }
  }, [open])

  if (actions.length === 0) return null
  return (
    <div className="adm-more" ref={root}>
      <button type="button" className="secondary-button adm-more-toggle" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        {label}<ChevronDown size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="adm-more-menu" role="menu" aria-label={label}>
          {actions.map((action) => (
            <button
              key={action.label} type="button" role="menuitem" disabled={action.disabled}
              className={action.danger ? 'is-danger' : undefined}
              onClick={() => { setOpen(false); action.onSelect() }}
            >
              <span>{action.label}</span>
              {action.hint && <small>{action.hint}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
