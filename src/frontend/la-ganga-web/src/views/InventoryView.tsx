import { useMemo, useState } from 'react'
import { demoProducts, formatCordobas } from '../demoData'

type InventoryRow = {
  color: string
  colorHex: string
  name: string
  sku: string
  sizes: { size: string; stock: number }[]
}

function buildRows(): InventoryRow[] {
  return demoProducts.flatMap((product) => {
    const colors = [...new Set(product.stock.map((stock) => stock.color))]
    return colors.map((color) => {
      const stocks = product.stock.filter((stock) => stock.color === color)
      return {
        color,
        colorHex: stocks[0]?.colorHex ?? '#ded7c9',
        name: product.name,
        sku: `${product.sku}-${color.slice(0, 3).toLocaleUpperCase('es')}`,
        sizes: stocks.map((stock) => ({ size: stock.size, stock: stock.stock })),
      }
    })
  })
}

const rows = buildRows()

export function InventoryView() {
  const [lowOnly, setLowOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [scanMessage, setScanMessage] = useState('Esperando código de barras')
  const visibleRows = useMemo(() => rows.filter((row) => {
    const matchesQuery = `${row.name} ${row.color} ${row.sku}`.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es'))
    const isLow = row.sizes.some((size) => size.stock <= 2)
    return matchesQuery && (!lowOnly || isLow)
  }), [lowOnly, query])
  const totalUnits = rows.reduce((total, row) => total + row.sizes.reduce((sum, size) => sum + size.stock, 0), 0)
  const lowVariants = rows.reduce((total, row) => total + row.sizes.filter((size) => size.stock > 0 && size.stock <= 2).length, 0)
  const soldOutVariants = rows.reduce((total, row) => total + row.sizes.filter((size) => size.stock === 0).length, 0)
  const inventoryValue = demoProducts.reduce((total, product) => total + product.stock.reduce((sum, stock) => sum + stock.stock * product.price, 0), 0)

  function scanBarcode(value: string) {
    const product = demoProducts.find((item) => item.barcode === value.trim())
    if (!product) {
      setScanMessage('Código no encontrado · no se modificó el inventario')
      return
    }
    setQuery(product.name)
    setScanMessage(`${product.name} identificado · pendiente de confirmar operación`)
  }

  return (
    <main className="admin-page inventory-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Inventario · Tienda Managua</p>
          <h1>Inventario</h1>
          <p className="page-summary">Existencias por variante, talla y color.</p>
        </div>
        <div className="page-actions inventory-actions">
          <button className="secondary-button" type="button">Imprimir etiquetas</button>
          <button className="dark-button" type="button">Conteo físico</button>
          <button className="primary-button" type="button">＋ Nuevo producto</button>
        </div>
      </header>

      <div className="inventory-tabs" role="tablist" aria-label="Secciones de inventario">
        <button className="active" role="tab" aria-selected="true" type="button">Stock por variante</button>
        <button role="tab" aria-selected="false" type="button">Entradas y salidas</button>
        <button role="tab" aria-selected="false" type="button">Conteos</button>
        <button role="tab" aria-selected="false" type="button">Ajustes y mermas</button>
      </div>

      <section className="kpi-grid inventory-kpis" aria-label="Indicadores de inventario simulados">
        <article className="kpi-card"><span>Unidades en tienda</span><strong>{totalUnits}</strong><small>Datos simulados</small></article>
        <article className="kpi-card"><span>Valor a precio de venta</span><strong>{formatCordobas(inventoryValue)}</strong><small>El costo real todavía no fue proporcionado</small></article>
        <article className="kpi-card"><span>Variantes con stock bajo</span><strong>{lowVariants}</strong><small>Entre 1 y 2 unidades</small></article>
        <article className="kpi-card"><span>Variantes agotadas</span><strong>{soldOutVariants}</strong><small>Requieren reposición</small></article>
      </section>

      <section className="inventory-layout">
        <article className="panel-card inventory-table-card">
          <div className="inventory-filters">
            <label><span>Ubicación</span><select aria-label="Ubicación de inventario"><option>Tienda Managua</option></select></label>
            <label className="inventory-search"><span>Buscar</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Producto, color o SKU" /></label>
            <label className="check-field"><input type="checkbox" checked={lowOnly} onChange={(event) => setLowOnly(event.target.checked)} /> Sólo stock bajo</label>
          </div>
          <div className="table-scroll">
            <table className="inventory-table">
              <thead><tr><th>Producto / color</th><th>SKU</th><th>Stock por talla</th><th>Total</th></tr></thead>
              <tbody>
                {visibleRows.map((row) => {
                  const total = row.sizes.reduce((sum, size) => sum + size.stock, 0)
                  return (
                    <tr key={`${row.name}-${row.color}`}>
                      <td><span className="inventory-product"><i style={{ background: row.colorHex }} /><span><strong>{row.name}</strong><small>{row.color}</small></span></span></td>
                      <td><code>{row.sku}</code></td>
                      <td><span className="stock-cells">{row.sizes.map((size) => <span className={size.stock === 0 ? 'sold-out' : size.stock <= 2 ? 'low' : size.stock >= 6 ? 'good' : ''} key={size.size}><small>{size.size}</small><strong>{size.stock}</strong></span>)}</span></td>
                      <td><strong>{total}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="stock-legend"><span><i className="sold" /> Agotado</span><span><i className="low" /> 1–2</span><span><i className="medium" /> 3–5</span><span><i className="good" /> 6 o más</span></div>
        </article>

        <aside className="inventory-aside">
          <article className="scan-inventory-card">
            <span className="eyebrow-light">Escaneo rápido</span>
            <h2>Identificar una variante</h2>
            <p>El escaneo prepara la operación. El stock sólo cambia al confirmarla y generar el movimiento de Kardex.</p>
            <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); scanBarcode(String(data.get('barcode') ?? '')); event.currentTarget.reset() }}>
              <input name="barcode" inputMode="numeric" placeholder="Escaneá un código" aria-label="Código de barras para inventario" />
              <button type="submit">Identificar</button>
            </form>
            <strong className="scan-feedback">{scanMessage}</strong>
          </article>

          <article className="panel-card movements-card">
            <div className="card-heading"><div><h2>Movimientos recientes</h2><p>Kardex de demostración</p></div></div>
            <ul>
              <li><b>+8</b><span><strong>Existencia inicial</strong><small>Camisa Oxford · hoy</small></span></li>
              <li><b>−1</b><span><strong>Venta de prueba</strong><small>Jeans recto · hoy</small></span></li>
              <li><b>+2</b><span><strong>Devolución</strong><small>Vestido lino · ayer</small></span></li>
            </ul>
          </article>
        </aside>
      </section>
    </main>
  )
}
