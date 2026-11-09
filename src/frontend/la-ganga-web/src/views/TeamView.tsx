import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError } from '../lib/api'
import {
  createUser,
  listRoles,
  listUsers,
  passwordMinLength,
  permissionLabels,
  resetPassword,
  roleDescriptions,
  updateUser,
  type Role,
  type UserSummary,
} from '../lib/usersApi'
import type { CurrentUser } from '../types'
import { Plus } from 'lucide-react'

type DataState =
  | { key: number; kind: 'ready'; users: UserSummary[]; roles: Role[] }
  | { key: number; kind: 'error'; message: string }

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserSummary }
  | { kind: 'password'; user: UserSummary }
  | null

const dateFormat = new Intl.DateTimeFormat('es-NI', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Managua',
})

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('es') || '?'
}

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Ocurrió un error inesperado. Intentá de nuevo.'
}

export function TeamView({ currentUser, isPreview }: { currentUser: CurrentUser; isPreview: boolean }) {
  const [refreshCount, setRefreshCount] = useState(0)
  const [data, setData] = useState<DataState | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (isPreview) return
    const controller = new AbortController()
    Promise.all([listUsers(controller.signal), listRoles(controller.signal)])
      .then(([users, roles]) => setData({ key: refreshCount, kind: 'ready', users, roles }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setData({ key: refreshCount, kind: 'error', message: errorText(error) })
      })
    return () => controller.abort()
  }, [isPreview, refreshCount])

  const ready = data?.kind === 'ready' ? data : null
  const loading = data?.key !== refreshCount && !ready

  function done(message: string) {
    setDialog(null)
    setNotice(message)
    setRefreshCount((count) => count + 1)
  }

  return (
    <main className="admin-page team-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Usuarios y permisos · <b className="live-data">Datos reales</b></p>
          <h1>Equipo</h1>
          <p className="page-summary">Una cuenta por persona. Los permisos se comprueban en el servidor en cada solicitud.</p>
        </div>
        {!isPreview && ready && (
          <div className="page-actions">
            <button className="primary-button" type="button" onClick={() => setDialog({ kind: 'create' })}><Plus size={16} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Nueva cuenta</button>
          </div>
        )}
      </header>

      {isPreview && (
        <section className="panel-card catalog-empty">
          <h2>Necesitás una sesión real</h2>
          <p>La vista previa no se conecta a la base de datos. Iniciá sesión con una cuenta administradora.</p>
        </section>
      )}

      {notice && <p className="catalog-notice ok" role="status">{notice}</p>}
      {data?.kind === 'error' && (
        <div className="catalog-notice error" role="alert">
          {data.message} <button type="button" onClick={() => setRefreshCount((count) => count + 1)}>Reintentar</button>
        </div>
      )}
      {loading && !isPreview && <p className="muted-text">Cargando cuentas…</p>}

      {ready && (
        <div className="team-layout">
          <section className="panel-card catalog-card">
            <h2 className="team-section-title">Cuentas ({ready.users.length})</h2>
            <ul className="team-list">
              {ready.users.map((user) => (
                <li key={user.id} className={user.isActive ? undefined : 'inactive'}>
                  <span className="account-avatar team-avatar">{initials(user.displayName)}</span>
                  <div className="team-person">
                    <strong>
                      {user.displayName}
                      {user.id === currentUser.id && <span className="team-you">vos</span>}
                    </strong>
                    <small>@{user.username} · {user.lastLoginAtUtc ? `último acceso ${dateFormat.format(new Date(user.lastLoginAtUtc))}` : 'todavía no inició sesión'}</small>
                    <span className="team-roles">
                      {user.roles.map((role) => <span key={role.id} className="team-role">{role.name}</span>)}
                      {!user.isActive && <span className="catalog-status">Inactiva</span>}
                    </span>
                  </div>
                  <div className="team-actions">
                    <button type="button" className="link-button" onClick={() => setDialog({ kind: 'edit', user })}>Editar</button>
                    <button type="button" className="link-button" onClick={() => setDialog({ kind: 'password', user })}>Contraseña</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <aside className="panel-card catalog-card">
            <h2 className="team-section-title">Roles</h2>
            {ready.roles.map((role) => (
              <details key={role.id} className="team-role-detail">
                <summary>
                  <strong>{role.name}</strong>
                  <small>{role.permissions.length} permisos</small>
                </summary>
                {roleDescriptions[role.name] && <p className="card-note">{roleDescriptions[role.name]}</p>}
                <ul>
                  {role.permissions.map((permission) => <li key={permission}>{permissionLabels[permission] ?? permission}</li>)}
                </ul>
              </details>
            ))}
            <p className="field-hint">Los descuentos, la caja y los abonos se agregarán a los roles cuando se definan sus reglas.</p>
          </aside>
        </div>
      )}

      {ready && dialog?.kind === 'create' && (
        <UserDialog roles={ready.roles} currentUserId={currentUser.id} onClose={() => setDialog(null)} onSaved={(user) => done(`Se creó la cuenta de ${user.displayName}.`)} />
      )}
      {ready && dialog?.kind === 'edit' && (
        <UserDialog roles={ready.roles} user={dialog.user} currentUserId={currentUser.id} onClose={() => setDialog(null)} onSaved={(user) => done(`Se guardaron los cambios de ${user.displayName}.`)} />
      )}
      {dialog?.kind === 'password' && (
        <PasswordDialog user={dialog.user} onClose={() => setDialog(null)} onSaved={(user) => done(`Se cambió la contraseña de ${user.displayName}. Sus sesiones abiertas se cerraron.`)} />
      )}
    </main>
  )
}

function Dialog({ title, onClose, onSubmit, children }: { title: string; onClose: () => void; onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="catalog-dialog-backdrop" role="presentation" onClick={onClose}>
      <form className="catalog-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={onSubmit}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        {children}
      </form>
    </div>
  )
}

type UserDialogProps = {
  roles: Role[]
  user?: UserSummary
  currentUserId: string
  onClose: () => void
  onSaved: (user: UserSummary) => void
}

function UserDialog({ roles, user, currentUserId, onClose, onSaved }: UserDialogProps) {
  const isSelf = user?.id === currentUserId
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [roleIds, setRoleIds] = useState<string[]>(user?.roles.map((role) => role.id) ?? [])
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  function toggleRole(id: string) {
    setRoleIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})
    if (roleIds.length === 0) {
      setFieldErrors({ roleIds: ['Asigná al menos un rol.'] })
      return
    }
    if (!user && password.length < passwordMinLength) {
      setFieldErrors({ password: [`La contraseña debe tener al menos ${passwordMinLength} caracteres.`] })
      return
    }

    setSaving(true)
    try {
      const saved = user
        ? await updateUser(user.id, { displayName, roleIds, isActive })
        : await createUser({ username, displayName, password, roleIds })
      onSaved(saved)
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) setFieldErrors(caught.fieldErrors)
      else setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => fieldErrors[field]?.[0]

  return (
    <Dialog title={user ? `Editar cuenta de ${user.displayName}` : 'Nueva cuenta'} onClose={onClose} onSubmit={(event) => { void submit(event) }}>
      <label className="catalog-field">
        <span>Nombre visible</span>
        <input value={displayName} maxLength={120} onChange={(event) => setDisplayName(event.target.value)} required autoFocus aria-invalid={Boolean(fieldError('displayName'))} />
        {fieldError('displayName') && <small className="field-error">{fieldError('displayName')}</small>}
      </label>

      {user ? (
        <p className="field-hint">Usuario: <b>@{user.username}</b> (no se puede cambiar)</p>
      ) : (
        <>
          <label className="catalog-field">
            <span>Usuario para iniciar sesión</span>
            <input value={username} maxLength={64} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder="ej. maria.lopez" onChange={(event) => setUsername(event.target.value)} required aria-invalid={Boolean(fieldError('username'))} />
            <small className="field-hint">Letras sin acentos, números, punto, guion o guion bajo.</small>
            {fieldError('username') && <small className="field-error">{fieldError('username')}</small>}
          </label>
          <label className="catalog-field">
            <span>Contraseña inicial</span>
            <div className="swatch-input">
              <input type={showPassword ? 'text' : 'password'} value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required aria-invalid={Boolean(fieldError('password'))} />
              <button type="button" className="link-button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
            </div>
            <small className="field-hint">Mínimo {passwordMinLength} caracteres. Entregala a la persona en privado.</small>
            {fieldError('password') && <small className="field-error">{fieldError('password')}</small>}
          </label>
        </>
      )}

      <fieldset className="catalog-field role-options">
        <legend>Roles</legend>
        {roles.map((role) => {
          const lockedAdmin = isSelf && role.name === 'Administrador' && roleIds.includes(role.id)
          return (
            <label key={role.id} className="role-option">
              <input type="checkbox" checked={roleIds.includes(role.id)} disabled={lockedAdmin} onChange={() => toggleRole(role.id)} />
              <span>
                <strong>{role.name}</strong>
                <small>{roleDescriptions[role.name] ?? `${role.permissions.length} permisos`}</small>
              </span>
            </label>
          )
        })}
        {isSelf && <small className="field-hint">No podés quitarte el rol Administrador ni desactivar tu propia cuenta.</small>}
        {fieldError('roleIds') && <small className="field-error">{fieldError('roleIds')}</small>}
      </fieldset>

      {user && (
        <label className="role-option">
          <input type="checkbox" checked={isActive} disabled={isSelf} onChange={(event) => setIsActive(event.target.checked)} />
          <span>
            <strong>Cuenta activa</strong>
            <small>Desactivarla cierra sus sesiones y le impide entrar. Su historial se conserva.</small>
          </span>
        </label>
      )}

      {error && <p className="catalog-notice error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
      </footer>
    </Dialog>
  )
}

function PasswordDialog({ user, onClose, onSaved }: { user: UserSummary; onClose: () => void; onSaved: (user: UserSummary) => void }) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      onSaved(await resetPassword(user.id, password))
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog title={`Nueva contraseña para ${user.displayName}`} onClose={onClose} onSubmit={(event) => { void submit(event) }}>
      <label className="catalog-field">
        <span>Nueva contraseña</span>
        <input type="password" value={password} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} required autoFocus />
      </label>
      <label className="catalog-field">
        <span>Repetila</span>
        <input type="password" value={confirmation} autoComplete="new-password" onChange={(event) => setConfirmation(event.target.value)} required />
      </label>
      <p className="field-hint">Las sesiones abiertas de esta cuenta se cerrarán.</p>
      {error && <p className="catalog-notice error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Cambiar contraseña'}</button>
      </footer>
    </Dialog>
  )
}
