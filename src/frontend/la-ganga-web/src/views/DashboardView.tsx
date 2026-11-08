import type { AppView } from '../types'

type DashboardViewProps = {
  onNavigate: (view: AppView) => void
}

const hourlySales = [18, 27, 35, 51, 42, 29, 39, 58, 72, 63, 31]
const categorySales = [
  { name: 'Pantalones', value: 32 },
  { name: 'Camisas y blusas', value: 27 },
  { name: 'Vestidos', value: 18 },
  { name: 'Juvenil', value: 13 },
  { name: 'Otros', value: 10 },
]
const sizes = [
  { name: 'S', value: 18 },
  { name: 'M', value: 34 },
  { name: 'L', value: 28 },
  { name: 'XL', value: 14 },
]

function todayInManagua() {
  return new Intl.DateTimeFormat('es-NI', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Managua',
  }).format(new Date())
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  return (
    <main className="admin-page dashboard-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">{todayInManagua()}</p>
          <h1>Buenos días</h1>
          <p className="page-summary">Así se verá el resumen diario de Tienda La Ganga.</p>
        </div>
        <div className="page-actions">
          <label className="global-search">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Buscar en el ERP" placeholder="Buscar producto, cliente o ticket…" />
          </label>
          <button className="primary-button" type="button" onClick={() => onNavigate('pos')}>
            <span aria-hidden="true">＋</span> Nueva venta
          </button>
        </div>
      </header>

      <section className="kpi-grid" aria-label="Indicadores de demostración">
        <article className="kpi-card">
          <span>Ventas hoy</span>
          <strong>C$ 24,680</strong>
          <small className="positive">↑ 8% frente al período anterior</small>
        </article>
        <article className="kpi-card">
          <span>Tickets</span>
          <strong>31</strong>
          <small>Datos simulados para validar el diseño</small>
        </article>
        <article className="kpi-card">
          <span>Ticket promedio</span>
          <strong>C$ 796</strong>
          <small>2.1 artículos por ticket</small>
        </article>
        <article className="kpi-card">
          <span>Saldo pendiente</span>
          <strong>C$ 3,250</strong>
          <small>Se conectará con cuentas por cobrar</small>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid-top">
        <article className="panel-card sales-chart-card">
          <div className="card-heading">
            <div>
              <h2>Ventas por hora · hoy</h2>
              <p>Comportamiento de las ventas confirmadas</p>
            </div>
            <span>Hora pico: 5 p. m.</span>
          </div>
          <div className="bar-chart" aria-label="Gráfico de ventas por hora con datos simulados">
            {hourlySales.map((value, index) => (
              <div className="bar-column" key={`${value}-${index}`}>
                <span>{value}k</span>
                <div className={index === 8 ? 'bar accent' : 'bar'} style={{ height: `${value}%` }} />
                <small>{index < 4 ? index + 9 : index - 3}</small>
              </div>
            ))}
          </div>
        </article>

        <article className="panel-card category-card">
          <div className="card-heading">
            <div>
              <h2>Ventas por categoría</h2>
              <p>Participación en el período</p>
            </div>
          </div>
          <div className="category-list">
            {categorySales.map((category, index) => (
              <div className="category-row" key={category.name}>
                <span>{category.name}</span>
                <strong>{category.value}%</strong>
                <div><i className={index === 2 ? 'accent' : ''} style={{ width: `${category.value}%` }} /></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="dashboard-grid dashboard-grid-middle">
        <article className="panel-card low-stock-card">
          <div className="card-heading">
            <div>
              <h2>Stock bajo</h2>
              <p>Variantes que requieren atención</p>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('inventario')}>Ver inventario</button>
          </div>
          <ul className="stock-alerts">
            <li><span className="color-dot sky" /><span><strong>Camisa Oxford</strong><small>Celeste · S</small></span><b>1 und.</b></li>
            <li><span className="color-dot gray" /><span><strong>Jeans recto</strong><small>Gris · talla 34</small></span><b>Agotado</b></li>
            <li><span className="color-dot clay" /><span><strong>Vestido lino</strong><small>Terracota · S</small></span><b>2 und.</b></li>
            <li><span className="color-dot wine" /><span><strong>Falda plisada</strong><small>Vino · M</small></span><b>1 und.</b></li>
          </ul>
        </article>

        <article className="sizes-card">
          <div className="card-heading inverse">
            <div>
              <h2>Tallas más vendidas</h2>
              <p>Ayuda para planificar la próxima compra</p>
            </div>
          </div>
          <div className="size-chart" aria-label="Tallas más vendidas con datos simulados">
            {sizes.map((size, index) => (
              <div className="size-column" key={size.name}>
                <strong>{size.value}%</strong>
                <div className={index === 1 ? 'accent' : ''} style={{ height: `${size.value * 2.3}px` }} />
                <span>{size.name}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel-card recent-sales-card">
        <div className="card-heading">
          <div>
            <h2>Últimas ventas</h2>
            <p>Operaciones recientes de la tienda</p>
          </div>
          <button className="text-button" type="button" onClick={() => onNavigate('reportes')}>Abrir historial</button>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Ticket</th><th>Cliente</th><th>Pago</th><th>Total</th></tr></thead>
            <tbody>
              <tr><td>#00127</td><td>María López</td><td><span className="payment-tag">Transferencia</span></td><td>C$ 2,881.50</td></tr>
              <tr><td>#00126</td><td>Consumidor final</td><td><span className="payment-tag">Efectivo</span></td><td>C$ 517.50</td></tr>
              <tr><td>#00125</td><td>Carlos Ruiz</td><td><span className="payment-tag">Por confirmar</span></td><td>C$ 1,416.00</td></tr>
              <tr><td>#00124</td><td>Ana Gutiérrez</td><td><span className="payment-tag">Efectivo</span></td><td>C$ 1,322.50</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
