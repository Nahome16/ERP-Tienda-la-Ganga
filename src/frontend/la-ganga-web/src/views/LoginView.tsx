import { useState, type FormEvent } from 'react'
import type { ApiState } from '../types'
import { ShieldCheck } from 'lucide-react'

type LoginViewProps = {
  api: ApiState
  error: string | null
  isSubmitting: boolean
  previewEnabled: boolean
  onLogin: (username: string, password: string) => Promise<void>
  onPreview: (role: 'Administrador' | 'Vendedor') => void
}

export function LoginView({
  api,
  error,
  isSubmitting,
  previewEnabled,
  onLogin,
  onPreview,
}: LoginViewProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void onLogin(username, password)
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand">
          <img src="/logo-tienda-la-ganga.png" alt="Logo de Tienda La Ganga" />
          <div><span>ERP COMERCIAL</span><strong>Tienda La Ganga</strong><small>Managua, Nicaragua</small></div>
        </div>
        <div className="login-message">
          <span className="login-eyebrow">Productos · Ventas · Inventario</span>
          <h1>Todo el negocio en un solo lugar.</h1>
          <p>Ingresá con tu cuenta personal. La experiencia se adapta automáticamente a tu rol.</p>
        </div>
        <div className="login-security-note">
          <ShieldCheck size={18} strokeWidth={1.75} aria-hidden="true" />
          <p><strong>Acceso protegido</strong><small>Las contraseñas no se guardan en el navegador.</small></p>
        </div>
      </section>

      <section className="login-form-panel">
        <div className="login-form-wrap">
          <div className={`login-api-state ${api.kind}`}>
            <i />
            {api.kind === 'ready' && 'Sistema disponible'}
            {api.kind === 'loading' && 'Comprobando el sistema…'}
            {api.kind === 'offline' && 'API local sin conexión'}
          </div>
          <header>
            <p>Bienvenido</p>
            <h2>Iniciar sesión</h2>
            <span>Usá el usuario y contraseña asignados por el administrador.</span>
          </header>

          <form className="login-form" onSubmit={submit}>
            <label>
              <span>Usuario</span>
              <input
                autoComplete="username"
                autoFocus
                maxLength={64}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Tu nombre de usuario"
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                autoComplete="current-password"
                maxLength={256}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Tu contraseña"
              />
            </label>
            {error && <div className="login-error" role="alert">{error}</div>}
            <button className="login-button" disabled={isSubmitting || api.kind === 'offline'} type="submit">
              {isSubmitting ? 'Validando…' : 'Entrar al sistema'}
            </button>
          </form>

          {previewEnabled && (
            <div className="preview-access">
              <div><span>Vista previa local</span><small>No crea una sesión ni guarda operaciones.</small></div>
              <div className="preview-buttons">
                <button type="button" onClick={() => onPreview('Administrador')}>Ver como administrador</button>
                <button type="button" onClick={() => onPreview('Vendedor')}>Ver como vendedor</button>
              </div>
            </div>
          )}

          <footer>Uso exclusivo del personal autorizado de Tienda La Ganga.</footer>
        </div>
      </section>
    </main>
  )
}
