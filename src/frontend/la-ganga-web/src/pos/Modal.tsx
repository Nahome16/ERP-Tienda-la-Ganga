import { useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

type ModalProps = {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Si es true, Esc y el fondo no cierran (p. ej. mientras se envía algo). */
  locked?: boolean
}

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, footer, size = 'md', locked = false }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const lockedRef = useRef(locked)

  useEffect(() => {
    onCloseRef.current = onClose
    lockedRef.current = locked
  })

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog?.querySelector<HTMLElement>(focusable)
    first?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        if (!lockedRef.current) onCloseRef.current()
        return
      }
      if (event.key === 'Tab' && dialog) {
        const items = [...dialog.querySelectorAll<HTMLElement>(focusable)]
        if (items.length === 0) return
        const firstItem = items[0]
        const lastItem = items[items.length - 1]
        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault()
          lastItem?.focus()
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault()
          firstItem?.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="pv-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !locked) onClose() }}>
      <div className={`pv-modal pv-modal-${size}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
        <header className="pv-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="pv-icon-button" onClick={onClose} disabled={locked} aria-label="Cerrar"><X size={20} strokeWidth={1.75} aria-hidden="true" /></button>
        </header>
        <div className="pv-modal-body">{children}</div>
        {footer && <footer className="pv-modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}
