import { useEffect, useState } from 'react'

type HealthStatus = {
  service: string
  status: 'healthy'
  timeZone: string
  checkedAtUtc: string
}

type ApiState =
  | { kind: 'loading' }
  | { kind: 'ready'; data: HealthStatus }
  | { kind: 'offline' }

const modules = [
  { name: 'Productos', detail: 'Prendas, variantes y fotografías', state: 'Siguiente' },
  { name: 'Inventario', detail: 'Existencias por talla y color', state: 'Siguiente' },
  { name: 'Punto de venta', detail: 'Carrito, cobro y comprobantes', state: 'Planificado' },
  { name: 'Clientes', detail: 'Historial, saldos y seguimiento', state: 'Planificado' },
]

function App() {
  const [api, setApi] = useState<ApiState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`Estado HTTP inesperado: ${response.status}`)
        const data = (await response.json()) as HealthStatus
        setApi({ kind: 'ready', data })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setApi({ kind: 'offline' })
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo-tienda-la-ganga.png" alt="Logo de Tienda La Ganga" />
          <div>
            <span>TIENDA</span>
            <strong>LA GANGA</strong>
          </div>
        </div>

        <nav aria-label="Navegación principal">
          <a className="nav-item active" href="#inicio">Inicio</a>
          <a className="nav-item" href="#modulos">Productos</a>
          <a className="nav-item" href="#modulos">Inventario</a>
          <span className="nav-item disabled">Ventas <small>Próximamente</small></span>
          <span className="nav-item disabled">Clientes <small>Próximamente</small></span>
        </nav>

        <div className="sidebar-footer">
          <span>Hito 1</span>
          <strong>Base técnica</strong>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p>ERP comercial</p>
            <h1>Buenos días, La Ganga</h1>
          </div>
          <div className="user-pill" aria-label="Sesión de demostración">
            <span>Administrador</span>
            <b>LG</b>
          </div>
        </header>

        <section className="hero" id="inicio">
          <div className="hero-copy">
            <span className="eyebrow">Construcción por módulos</span>
            <h2>Una sola fuente confiable para productos e inventario.</h2>
            <p>
              La estructura inicial está preparada para registrar cada prenda una vez y
              reutilizar sus variantes en las operaciones futuras de la tienda.
            </p>
            <div className="hero-actions">
              <button type="button" disabled>Registrar producto</button>
              <span>Se habilitará en el siguiente hito</span>
            </div>
          </div>

          <div className={`status-card ${api.kind}`} aria-live="polite">
            <span className="status-dot" />
            <div>
              <small>Estado del sistema</small>
              {api.kind === 'loading' && <strong>Comprobando API…</strong>}
              {api.kind === 'offline' && <strong>API sin conexión</strong>}
              {api.kind === 'ready' && <strong>Base técnica conectada</strong>}
              <p>
                {api.kind === 'ready'
                  ? `${api.data.service} · ${api.data.timeZone}`
                  : 'Iniciá la API local para completar la conexión.'}
              </p>
            </div>
          </div>
        </section>

        <section className="section" id="modulos">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Ruta del primer lanzamiento</span>
              <h2>Módulos del negocio</h2>
            </div>
            <span className="progress-label">1 de 4 en preparación</span>
          </div>

          <div className="module-grid">
            {modules.map((module, index) => (
              <article className={index < 2 ? 'module-card next' : 'module-card'} key={module.name}>
                <div className="module-number">0{index + 1}</div>
                <span className="module-state">{module.state}</span>
                <h3>{module.name}</h3>
                <p>{module.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="principles">
          <div>
            <span className="eyebrow">Reglas protegidas desde el inicio</span>
            <h2>Confianza antes que velocidad.</h2>
          </div>
          <ul>
            <li>Inventario por combinación exacta de talla y color.</li>
            <li>Operaciones confirmadas de manera completa o ninguna.</li>
            <li>Sin costos ni existencias de demostración.</li>
          </ul>
        </section>
      </main>
    </div>
  )
}

export default App
