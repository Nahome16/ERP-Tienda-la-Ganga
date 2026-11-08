import { useMemo, useRef, useState } from 'react'
import { demoCategories, demoProducts, formatCordobas, type DemoProduct, type StockCell } from '../demoData'
import type { ApiState, AppView, CurrentUser } from '../types'

type PosViewProps = {
  api: ApiState
  user: CurrentUser
  canReturnToAdmin: boolean
  onNavigate: (view: AppView) => void
  onLogout: () => void
}

type CartLine = {
  key: string
  productId: string
  name: string
  color: string
  size: string
  quantity: number
  unitPrice: number
  available: number
}

function lineFrom(product: DemoProduct, stock: StockCell): CartLine {
  return {
    key: `${product.id}-${stock.color}-${stock.size}`,
    productId: product.id,
    name: product.name,
    color: stock.color,
    size: stock.size,
    quantity: 1,
    unitPrice: product.price,
    available: stock.stock,
  }
}

export function PosView({ api, user, canReturnToAdmin, onNavigate, onLogout }: PosViewProps) {
  const scannerRef = useRef<HTMLInputElement>(null)
  const [category, setCategory] = useState('Todo')
  const [selectedProductId, setSelectedProductId] = useState(demoProducts[0]?.id ?? '')
  const [scanValue, setScanValue] = useState('')
  const [scanMessage, setScanMessage] = useState('Escáner listo')
  const [cart, setCart] = useState<CartLine[]>(() => {
    const first = demoProducts[0]
    const second = demoProducts[1]
    if (!first || !second || !first.stock[1] || !second.stock[1]) return []
    return [lineFrom(first, first.stock[1]), lineFrom(second, second.stock[1])]
  })

  const filteredProducts = useMemo(
    () => demoProducts.filter((product) => category === 'Todo' || product.category === category),
    [category],
  )
  const selectedProduct = demoProducts.find((product) => product.id === selectedProductId) ?? demoProducts[0]
  const subtotal = cart.reduce((total, line) => total + line.unitPrice * line.quantity, 0)
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0)

  function addVariant(product: DemoProduct, stock: StockCell) {
    if (stock.stock < 1) return
    const key = `${product.id}-${stock.color}-${stock.size}`
    setCart((current) => {
      const found = current.find((line) => line.key === key)
      if (!found) return [...current, lineFrom(product, stock)]
      if (found.quantity >= found.available) return current
      return current.map((line) => line.key === key ? { ...line, quantity: line.quantity + 1 } : line)
    })
    setScanMessage(`${product.name} · ${stock.color} · ${stock.size}`)
  }

  function updateQuantity(key: string, change: number) {
    setCart((current) => current.flatMap((line) => {
      if (line.key !== key) return [line]
      const quantity = line.quantity + change
      if (quantity < 1) return []
      return [{ ...line, quantity: Math.min(quantity, line.available) }]
    }))
  }

  function submitScan() {
    const query = scanValue.trim()
    if (!query) {
      scannerRef.current?.focus()
      return
    }
    const exact = demoProducts.find((product) => product.barcode === query)
    if (exact) {
      const available = exact.stock.find((stock) => stock.stock > 0)
      setSelectedProductId(exact.id)
      if (available) addVariant(exact, available)
      else setScanMessage('Variante agotada')
      setScanValue('')
      return
    }
    const byName = demoProducts.find((product) => product.name.toLocaleLowerCase('es').includes(query.toLocaleLowerCase('es')))
    if (byName) {
      setSelectedProductId(byName.id)
      setScanMessage('Producto encontrado · elegí talla y color')
    } else {
      setScanMessage('Código no encontrado · no se creó ningún producto')
    }
    setScanValue('')
  }

  return (
    <main className="pos-page">
      <header className="pos-topbar">
        <div className="pos-title-group">
          {canReturnToAdmin && <button type="button" onClick={() => onNavigate('panel')} aria-label="Volver al panel">‹</button>}
          <img src="/logo-tienda-la-ganga.png" alt="" />
          <div><span>Panel</span><h1>Punto de venta</h1></div>
          <small>Caja 1 · Managua · {user.displayName}</small>
        </div>
        <div className="pos-statuses">
          <span className={api.kind === 'ready' ? 'online' : 'offline'}>
            <i /> {api.kind === 'ready' ? 'En línea · sincronizado' : 'Vista previa · API sin conexión'}
          </span>
          <span>Turno de demostración</span>
          <button className="pos-logout" type="button" onClick={onLogout}>Cerrar sesión</button>
        </div>
      </header>

      <div className="pos-layout">
        <section className="pos-catalog">
          <form className="scanner-field" onSubmit={(event) => { event.preventDefault(); submitScan() }}>
            <span className="barcode-icon" aria-hidden="true">▥</span>
            <input
              ref={scannerRef}
              value={scanValue}
              onChange={(event) => setScanValue(event.target.value)}
              placeholder="Escaneá el código o buscá por nombre / SKU"
              aria-label="Escanear código de barras o buscar producto"
            />
            <button type="submit">{scanMessage}</button>
          </form>

          <div className="category-pills" aria-label="Filtrar productos por categoría">
            {demoCategories.map((item) => (
              <button className={category === item ? 'active' : ''} key={item} type="button" onClick={() => setCategory(item)}>{item}</button>
            ))}
          </div>

          <div className="product-strip">
            {filteredProducts.map((product) => {
              const colors = [...new Map(product.stock.map((stock) => [stock.color, stock.colorHex])).entries()]
              return (
                <button
                  className={selectedProduct?.id === product.id ? 'product-tile active' : 'product-tile'}
                  key={product.id}
                  type="button"
                  onClick={() => setSelectedProductId(product.id)}
                >
                  <span className="product-visual"><span aria-hidden="true">♧</span><span className="swatches">{colors.slice(0, 3).map(([name, hex]) => <i key={name} style={{ background: hex }} />)}</span></span>
                  <strong>{product.name}</strong>
                  <b>{formatCordobas(product.price)}</b>
                  <small>{product.stock.length} variantes</small>
                </button>
              )
            })}
          </div>

          {selectedProduct && (
            <article className="variant-matrix-card">
              <div className="matrix-heading">
                <div><h2>{selectedProduct.name}</h2><strong>{formatCordobas(selectedProduct.price)}</strong></div>
                <p>Tocá una variante para agregarla. El número indica el stock simulado.</p>
              </div>
              <div className="variant-grid">
                {[...new Set(selectedProduct.stock.map((stock) => stock.color))].map((color) => (
                  <div className="variant-row" key={color}>
                    <span className="variant-color">
                      <i style={{ background: selectedProduct.stock.find((stock) => stock.color === color)?.colorHex }} />
                      {color}
                    </span>
                    <div className="variant-cells">
                      {selectedProduct.stock.filter((stock) => stock.color === color).map((stock) => (
                        <button
                          className={stock.stock === 0 ? 'sold-out' : stock.stock <= 2 ? 'low' : ''}
                          disabled={stock.stock === 0}
                          key={`${stock.color}-${stock.size}`}
                          type="button"
                          onClick={() => addVariant(selectedProduct, stock)}
                        >
                          <span>{stock.size}</span><strong>{stock.stock}</strong><small>{stock.stock === 0 ? 'agotado' : stock.stock <= 2 ? 'últimas' : 'en stock'}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="matrix-legend"><span><i className="available" /> Disponible</span><span><i className="low" /> Quedan 1–2</span><span><i className="sold" /> Agotado</span></div>
            </article>
          )}
        </section>

        <aside className="ticket-panel">
          <div className="ticket-heading"><div><span>Venta actual</span><h2>Ticket nuevo</h2></div><strong>{itemCount} artículos</strong></div>
          <div className="customer-card"><span className="customer-avatar">ML</span><div><strong>María López</strong><small>Cliente de demostración</small></div><button type="button">Cambiar</button></div>

          <div className="cart-lines">
            {cart.length === 0 && <div className="empty-cart"><strong>Carrito vacío</strong><p>Escaneá un código o elegí una variante.</p></div>}
            {cart.map((line) => (
              <article className="cart-line" key={line.key}>
                <div><strong>{line.name}</strong><small>{line.color} · {line.size}</small><span>{formatCordobas(line.unitPrice)}</span></div>
                <div className="quantity-control"><button type="button" onClick={() => updateQuantity(line.key, -1)}>−</button><b>{line.quantity}</b><button type="button" onClick={() => updateQuantity(line.key, 1)}>＋</button></div>
                <strong>{formatCordobas(line.unitPrice * line.quantity)}</strong>
              </article>
            ))}
          </div>

          <div className="ticket-summary">
            <div><span>Subtotal</span><strong>{formatCordobas(subtotal)}</strong></div>
            <div><span>Descuento</span><strong>—</strong></div>
            <div><span>Impuestos</span><strong>Por configurar</strong></div>
            <div className="ticket-total"><span>Total</span><strong>{formatCordobas(subtotal)}</strong></div>
            <p>Métodos mostrados como propuesta; deben confirmarse.</p>
            <div className="payment-options"><button type="button">Efectivo</button><button className="active" type="button">Transferencia</button><button type="button">Combinado</button></div>
            <button className="charge-button" type="button" disabled={cart.length === 0}>Cobrar {formatCordobas(subtotal)}</button>
          </div>
        </aside>
      </div>
    </main>
  )
}
