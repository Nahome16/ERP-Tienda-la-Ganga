import { useEffect, useRef, type PropsWithChildren, type ReactNode } from 'react'
import './admin.css'

type DialogProps = PropsWithChildren<{
  title: string
  onClose: () => void
  wide?: boolean
  footer?: ReactNode
  subtitle?: string
}>

const focusable = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Diálogo accesible: Esc lo cierra, el foco queda dentro y vuelve al botón que lo abrió. */
export function Dialog({ title, subtitle, onClose, wide, footer, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current
    const first = node?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea')
    ;(first ?? node?.querySelector<HTMLElement>(focusable))?.focus()
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        // El diálogo más reciente (el último del documento) es el que se cierra.
        const dialogs = document.querySelectorAll('.adm-dialog')
        if (dialogs[dialogs.length - 1] !== node) return
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !node || !node.contains(document.activeElement)) return
      const items = Array.from(node.querySelectorAll<HTMLElement>(focusable)).filter((item) => item.offsetParent !== null)
      if (items.length === 0) return
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus() }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="adm-backdrop" role="presentation">
      <div ref={ref} className={wide ? 'adm-dialog wide' : 'adm-dialog'} role="dialog" aria-modal="true" aria-label={title}>
        <header className="adm-dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        <div className="adm-dialog-body">{children}</div>
        {footer && <footer className="adm-dialog-foot">{footer}</footer>}
      </div>
    </div>
  )
}

export function Notice({ tone, children }: PropsWithChildren<{ tone: 'ok' | 'error' | 'warn' | 'info' }>) {
  return <div className={`adm-notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="adm-notice error" role="alert">
      {message}
      {onRetry && <button type="button" onClick={onRetry}>Reintentar</button>}
    </div>
  )
}

export function Pagination({ page, totalPages, totalCount, onPage, noun = 'registros' }: {
  page: number; totalPages: number; totalCount: number; onPage: (page: number) => void; noun?: string
}) {
  if (totalCount === 0) return null
  return (
    <div className="catalog-pagination">
      <span>Página {page} de {Math.max(totalPages, 1)} · {totalCount} {noun}</span>
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Anterior</button>
      <button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Siguiente</button>
    </div>
  )
}

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return <p className="adm-loading" role="status">{label}</p>
}

export function Tag({ tone = 'neutral', children }: PropsWithChildren<{ tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }>) {
  return <span className={`adm-tag ${tone}`}>{children}</span>
}

export function Kpi({ label, value, hint, tone, onClick }: {
  label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'danger' | 'ok'; onClick?: () => void
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </>
  )
  return onClick
    ? <button type="button" className={`kpi-card adm-kpi clickable ${tone ?? ''}`} onClick={onClick}>{body}</button>
    : <div className={`kpi-card adm-kpi ${tone ?? ''}`}>{body}</div>
}

/** Fila etiqueta/valor para detalles. */
export function Row({ label, children, strong }: PropsWithChildren<{ label: string; strong?: boolean }>) {
  return <div className={strong ? 'adm-row strong' : 'adm-row'}><span>{label}</span><b>{children}</b></div>
}

export function Swatch({ hex }: { hex: string | null }) {
  return <i className="adm-swatch" style={{ background: hex ?? 'transparent' }} aria-hidden="true" />
}
