import { ShieldCheck } from 'lucide-react'
import { PasswordInput } from '../components/PasswordInput'

import type { Approver } from './approver'

/**
 * Usuario y contraseña de quien autoriza (el administrador) dentro de la misma ventana de la
 * caja. Se envían junto con la acción; el servidor los comprueba en ese momento.
 */
export function AuthorizationFields({ value, onChange, action, disabled }: {
  value: Approver
  onChange: (value: Approver) => void
  /** «esta anulación», «este cambio de talla». */
  action: string
  disabled?: boolean
}) {
  return (
    <fieldset className="pv-auth">
      <legend><ShieldCheck size={16} strokeWidth={2} aria-hidden="true" />Autorización del administrador</legend>
      <p className="pv-hint">Para {action} el administrador escribe su usuario y contraseña aquí.</p>
      <div className="pv-auth-grid">
        <label className="pv-field">
          <span>Usuario</span>
          <input value={value.username} onChange={(event) => onChange({ ...value, username: event.target.value })} autoComplete="off" autoCapitalize="none" disabled={disabled} />
        </label>
        <label className="pv-field">
          <span>Contraseña</span>
          <PasswordInput value={value.password} onChange={(event) => onChange({ ...value, password: event.target.value })} autoComplete="new-password" disabled={disabled} />
        </label>
      </div>
    </fieldset>
  )
}
