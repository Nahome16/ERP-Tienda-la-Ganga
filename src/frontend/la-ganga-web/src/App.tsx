import { useEffect, useState } from 'react'
import { AdminShell } from './components/AdminShell'
import { allowedViews, isAppView, landingView, resolveView, shellViews } from './lib/access'
import type { ApiState, AppView, AuthState, CurrentUser, HealthStatus } from './types'
import { CatalogsView } from './views/CatalogsView'
import { DashboardView } from './views/DashboardView'
import { InventoryView } from './views/InventoryView'
import { LoginView } from './views/LoginView'
import { PosView } from './views/PosView'
import { TeamView } from './views/TeamView'
import { AuditView } from './views/AuditView'
import { CashView } from './views/CashView'
import { ProductsView } from './views/ProductsView'
import { SalesView } from './views/SalesView'
import { SettingsView } from './views/SettingsView'

function viewFromHash(): AppView {
  const value = window.location.hash.replace('#', '')
  return isAppView(value) ? value : 'panel'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string'
    && typeof candidate.username === 'string'
    && typeof candidate.displayName === 'string'
    && isStringArray(candidate.roles)
    && isStringArray(candidate.permissions)
}

function isHealthStatus(value: unknown): value is HealthStatus {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return candidate.status === 'healthy'
    && typeof candidate.service === 'string'
    && typeof candidate.timeZone === 'string'
    && typeof candidate.checkedAtUtc === 'string'
}

function loginResponseUser(value: unknown): CurrentUser | null {
  if (typeof value !== 'object' || value === null) return null
  return isCurrentUser((value as Record<string, unknown>).user)
    ? (value as { user: CurrentUser }).user
    : null
}

function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix))
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null
}

function SessionLoader() {
  return (
    <main className="session-loader">
      <img src="/logo-tienda-la-ganga.png" alt="Tienda La Ganga" />
      <span />
      <p>Preparando tu espacio de trabajo…</p>
    </main>
  )
}

function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' })
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' })
  const [view, setView] = useState<AppView>(() => viewFromHash())
  const [loginError, setLoginError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`Estado HTTP inesperado: ${response.status}`)
        const payload: unknown = await response.json()
        if (!isHealthStatus(payload)) throw new Error('Respuesta de salud inválida')
        setApi({ kind: 'ready', data: payload })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setApi({ kind: 'offline' })
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()

    async function restoreSession() {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (response.status === 401) {
          setAuth({ kind: 'unauthenticated' })
          return
        }
        if (!response.ok) throw new Error(`Estado HTTP inesperado: ${response.status}`)
        const payload: unknown = await response.json()
        if (!isCurrentUser(payload)) throw new Error('Respuesta de sesión inválida')
        setAuth({ kind: 'authenticated', user: payload })
        const nextView = resolveView(payload, viewFromHash()) ?? 'panel'
        setView(nextView)
        window.history.replaceState(null, '', `#${nextView}`)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        // TODO(offline): si no hay red y existe un usuario guardado en el equipo, entrar en modo sin conexión.
        setAuth({ kind: 'unauthenticated' })
      }
    }

    void restoreSession()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    function handleHashChange() {
      const requested = viewFromHash()
      if (auth.kind === 'authenticated') {
        const allowed = resolveView(auth.user, requested) ?? requested
        if (allowed !== requested) window.history.replaceState(null, '', `#${allowed}`)
        setView(allowed)
        return
      }
      setView(requested)
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [auth])

  function navigate(nextView: AppView, user?: CurrentUser) {
    const current = user ?? (auth.kind === 'authenticated' ? auth.user : null)
    if (current && !allowedViews(current).includes(nextView)) return
    setView(nextView)
    window.history.replaceState(null, '', `#${nextView}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function login(username: string, password: string) {
    setIsSubmitting(true)
    setLoginError(null)
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) {
        const title = typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).title === 'string'
          ? String((payload as Record<string, unknown>).title)
          : 'No fue posible iniciar sesión.'
        throw new Error(title)
      }
      const user = loginResponseUser(payload)
      if (!user) throw new Error('La respuesta del servidor no contiene una sesión válida.')
      setAuth({ kind: 'authenticated', user })
      navigate(landingView(user) ?? 'panel', user)
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'No fue posible iniciar sesión.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function logout() {
    if (auth.kind !== 'authenticated') return
    const csrfToken = readCookie('la_ganga_csrf')
    if (!csrfToken) return
    try {
      const response = await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': csrfToken },
      })
      if (!response.ok) throw new Error(`Estado HTTP inesperado: ${response.status}`)
      setAuth({ kind: 'unauthenticated' })
      navigate('panel')
    } catch {
      setLoginError('No se pudo cerrar la sesión. Comprobá la conexión e intentá nuevamente.')
    }
  }

  if (auth.kind === 'loading') return <SessionLoader />
  if (auth.kind === 'unauthenticated') {
    return (
      <LoginView
        api={api}
        error={loginError}
        isSubmitting={isSubmitting}
        previewEnabled={false}
        onLogin={login}
        onPreview={() => undefined}
      />
    )
  }

  const user = auth.user
  const allowed = allowedViews(user)
  const panelViews = shellViews(user)

  if (allowed.length === 0) {
    return (
      <main className="access-denied">
        <img src="/logo-tienda-la-ganga.png" alt="" />
        <h1>Cuenta sin espacio asignado</h1>
        <p>El administrador debe asignar un rol válido antes de usar el sistema.</p>
        <button type="button" onClick={() => { void logout() }}>Cerrar sesión</button>
      </main>
    )
  }

  if (panelViews.length === 0 || view === 'pos') {
    return (
      <PosView
        api={api}
        user={user}
        canReturnToAdmin={panelViews.length > 0}
        onNavigate={navigate}
        onLogout={() => { void logout() }}
      />
    )
  }

  return (
    <AdminShell activeView={view} allowedViews={allowed} api={api} user={user} onNavigate={navigate} onLogout={() => { void logout() }}>
      {view === 'panel' && <DashboardView user={user} onNavigate={navigate} />}
      {view === 'caja' && <CashView user={user} />}
      {view === 'ventas' && <SalesView user={user} />}
      {view === 'productos' && <ProductsView user={user} />}
      {view === 'inventario' && <InventoryView user={user} />}
      {view === 'catalogos' && <CatalogsView user={user} isPreview={false} />}
      {view === 'equipo' && <TeamView currentUser={user} isPreview={false} />}
      {view === 'configuracion' && <SettingsView user={user} onOpenCatalogs={() => navigate('catalogos')} />}
      {view === 'auditoria' && <AuditView user={user} />}
    </AdminShell>
  )
}

export default App
