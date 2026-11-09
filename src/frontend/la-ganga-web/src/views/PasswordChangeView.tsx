import { useState, type FormEvent } from 'react'
import { changeOwnPassword, passwordMinLength } from '../lib/usersApi'
import type { CurrentUser } from '../types'

export function PasswordChangeView({ user, onChanged, onLogout }: {
  user: CurrentUser
  onChanged: (user: CurrentUser) => void
  onLogout: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password.length < passwordMinLength) {
      setError(`La contraseña debe tener al menos ${passwordMinLength} caracteres.`)
      return
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setSaving(true)
    try {
      onChanged(await changeOwnPassword(null, password))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible guardar la contraseña.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <img src="/logo-tienda-la-ganga.png" alt="Logo de Tienda La Ganga" />
          <div><span>ERP COMERCIAL</span><strong>Tienda La Ganga</strong><small>Managua, Nicaragua</small></div>
        </div>
        <div className="login-message">
          <span className="login-eyebrow">Primer acceso protegido</span>
          <h1>Creá tu contraseña personal.</h1>
          <p>El código ya fue verificado. Antes de entrar al panel debés guardar una contraseña que solo vos conozcás.</p>
        </div>
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <header><p>{user.displayName}</p><h2>Nueva contraseña</h2><span>Mínimo {passwordMinLength} caracteres.</span></header>
          <form className="login-form" onSubmit={(event) => { void submit(event) }}>
            <label><span>Nueva contraseña</span><input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>
            <label><span>Repetí la contraseña</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-button" disabled={saving} type="submit">{saving ? 'Guardando…' : 'Guardar y entrar'}</button>
            <button className="secondary-button" type="button" onClick={onLogout}>Salir</button>
          </form>
        </div>
      </section>
    </main>
  )
}
