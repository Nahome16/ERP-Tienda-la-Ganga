import type { ReactNode } from 'react'
import type { Partner } from '../lib/apiTypes'

/** Selector «Socio que ingresó la mercadería» (valor vacío = Sin socio). */
export function PartnerSelect({ partners, value, onChange, label = 'Socio que ingresó la mercadería', ariaLabel, compact, noneOption = true, children }: {
  partners: Partner[]
  value: string
  onChange: (value: string) => void
  label?: string
  /** Para selectores dentro de una tabla, sin etiqueta visible. */
  ariaLabel?: string
  compact?: boolean
  /** Con false no agrega «Sin socio» (valor vacío); lo hacen los `children`. */
  noneOption?: boolean
  children?: ReactNode
}) {
  const options = (
    <>
      {children}
      {noneOption && <option value="">Sin socio</option>}
      {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}{partner.isActive ? '' : ' (inactivo)'}</option>)}
    </>
  )
  if (compact) {
    return <select value={value} aria-label={ariaLabel ?? label} onChange={(event) => onChange(event.target.value)}>{options}</select>
  }
  return (
    <label className="adm-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>{options}</select>
    </label>
  )
}

/** Aviso cuando no hay socios o no se pudieron cargar; no bloquea el formulario. */
export function PartnersHint({ error, empty, onRetry }: { error: string | null; empty: boolean; onRetry: () => void }) {
  if (error) {
    return (
      <div className="adm-notice warn" role="status">
        No se pudo cargar la lista de socios ({error}). Podés continuar «Sin socio».
        <button type="button" onClick={onRetry}>Reintentar</button>
      </div>
    )
  }
  if (empty) {
    return (
      <p className="adm-help" style={{ margin: 0 }}>
        Todavía no hay socios activos. Creá socios en <a href="#socios">Socios e inversión</a> para asignar quién ingresó la mercadería.
      </p>
    )
  }
  return null
}
