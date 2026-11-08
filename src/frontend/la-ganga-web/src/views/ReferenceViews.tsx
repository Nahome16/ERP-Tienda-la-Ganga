import { useState, type ReactNode } from 'react'
import type React from 'react'
import { formatCordobas } from '../demoData'

type HeaderProps = {
  eyebrow: string
  title: string
  actions?: ReactNode
  summary?: string
}

function ViewHeader({ eyebrow, title, actions, summary }: HeaderProps) {
  return (
    <header className="page-header reference-header">
      <div><p className="page-kicker">{eyebrow} · <b>Datos simulados</b></p><h1>{title}</h1>{summary && <p className="page-summary">{summary}</p>}</div>
      {actions && <div className="page-actions reference-actions">{actions}</div>}
    </header>
  )
}

function ActionButton({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return <button className={primary ? 'primary-button' : 'secondary-button'} type="button">{children}</button>
}

function Tag({ children, tone = 'calm' }: { children: ReactNode; tone?: 'calm' | 'warning' | 'dark' }) {
  return <span className={`status-tag ${tone}`}>{children}</span>
}

const clients = [
  { initials: 'ML', name: 'María López', phone: '8812-4471', total: 38920, tier: 'Oro' },
  { initials: 'CR', name: 'Carlos Ruiz', phone: '8760-1123', total: 21400, tier: 'Plata' },
  { initials: 'AG', name: 'Ana Gutiérrez', phone: '8455-9087', total: 14250, tier: 'Plata' },
  { initials: 'JP', name: 'José Pérez', phone: '8901-3345', total: 6780, tier: 'Bronce' },
  { initials: 'LM', name: 'Lucía Mendoza', phone: '8622-7781', total: 9120, tier: 'Bronce' },
]

export function CashView() {
  const [counts, setCounts] = useState<Record<number, number>>({ 1000: 9, 500: 5, 200: 5, 100: 4, 50: 3, 20: 2, 10: 3, 5: 2, 1: 10 })
  const total = Object.entries(counts).reduce((sum, [value, count]) => sum + Number(value) * count, 0)
  function change(value: number, amount: number) {
    setCounts((current) => ({ ...current, [value]: Math.max(0, (current[value] ?? 0) + amount) }))
  }

  return (
    <main className="admin-page reference-page">
      <ViewHeader eyebrow="Caja 1 · turno de demostración" title="Cierre de caja" actions={<><ActionButton>Registrar salida</ActionButton><ActionButton primary>Cerrar turno</ActionButton></>} />
      <section className="kpi-grid"><article className="kpi-card"><span>Fondo inicial</span><strong>C$ 2,000.00</strong></article><article className="kpi-card"><span>Ventas del turno</span><strong>C$ 31,480.00</strong></article><article className="kpi-card"><span>Tickets</span><strong>41</strong></article><article className="kpi-card"><span>Devoluciones</span><strong>C$ 690.00</strong></article></section>
      <section className="reference-split wide-left">
        <div className="reference-stack">
          <article className="panel-card reference-card"><h2>Cuadre por forma de pago</h2><div className="table-scroll"><table><thead><tr><th>Forma de pago</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead><tbody><tr><td>Efectivo</td><td>C$ 13,160.00</td><td>C$ 13,140.00</td><td><Tag tone="warning">−C$ 20.00</Tag></td></tr><tr><td>Transferencia</td><td>C$ 4,500.00</td><td>C$ 4,500.00</td><td><Tag>Cuadra</Tag></td></tr><tr><td>Otros métodos</td><td colSpan={3}>Pendientes de confirmar</td></tr></tbody></table></div></article>
          <article className="panel-card reference-card"><h2>Conteo de efectivo</h2><p className="card-note">Ajustá cada denominación. Esta vista no confirma un cierre real.</p><div className="cash-count-grid">{Object.entries(counts).sort(([a], [b]) => Number(b) - Number(a)).map(([rawValue, count]) => { const value = Number(rawValue); return <div className="cash-count" key={value}><strong>C$ {value.toLocaleString('es-NI')}</strong><button type="button" onClick={() => change(value, -1)}>−</button><b>{count}</b><button type="button" onClick={() => change(value, 1)}>＋</button><span>{formatCordobas(value * count)}</span></div> })}</div><div className="reference-total"><span>Total contado</span><strong>{formatCordobas(total)}</strong></div></article>
        </div>
        <aside className="reference-stack"><article className="panel-card reference-card"><h2>Movimientos de efectivo</h2><ul className="simple-list"><li><span><strong>Fondo inicial</strong><small>8:00 a. m.</small></span><b>+C$ 2,000</b></li><li><span><strong>Ventas en efectivo</strong><small>24 tickets</small></span><b>+C$ 12,350</b></li><li><span><strong>Salida: mensajería</strong><small>Con recibo</small></span><b>−C$ 500</b></li></ul></article><article className="dark-reference-card"><h2>Vista previa · Cierre Z</h2><div className="receipt-preview">TIENDA LA GANGA<br />CIERRE DE DEMOSTRACIÓN<br />--------------------<br />Tickets ........ 41<br />Efectivo .... C$ {total.toLocaleString('es-NI')}</div><button type="button">Imprimir vista previa</button></article></aside>
      </section>
    </main>
  )
}

export function ClientsView() {
  const [selected, setSelected] = useState(0)
  const client = clients[selected] ?? clients[0]!
  return (
    <main className="admin-page reference-page">
      <ViewHeader eyebrow={`${clients.length} clientes en la vista previa`} title="Clientes" actions={<><label className="global-search"><span>⌕</span><input placeholder="Nombre o teléfono" /></label><ActionButton primary>＋ Nuevo cliente</ActionButton></>} />
      <section className="reference-split clients-layout">
        <article className="panel-card reference-card"><div className="filter-pills"><button className="active" type="button">Todos</button><button type="button">Frecuentes</button><button type="button">Cumpleaños</button><button type="button">Sin compras recientes</button></div><div className="client-list">{clients.map((item, index) => <button className={selected === index ? 'client-row active' : 'client-row'} key={item.name} type="button" onClick={() => setSelected(index)}><span className="reference-avatar">{item.initials}</span><span><strong>{item.name}</strong><small>{item.phone} · historial simulado</small></span><b>{formatCordobas(item.total)}</b><Tag tone={item.tier === 'Oro' ? 'warning' : 'calm'}>{item.tier}</Tag></button>)}</div></article>
        <aside className="client-profile"><header><span className="reference-avatar large">{client.initials}</span><div><h2>{client.name}</h2><p>{client.phone} · ficha de demostración</p></div></header><div className="profile-stats"><span><small>Compras</small><strong>23</strong></span><span><small>Total</small><strong>{formatCordobas(client.total)}</strong></span><span><small>Ticket prom.</small><strong>C$ 1,692</strong></span></div><section><h3>Tallas que usa</h3><div className="chip-row"><Tag>Blusas M</Tag><Tag>Pantalón 30</Tag><Tag>Vestidos S</Tag></div></section><section><h3>Últimas compras</h3><ul className="simple-list"><li><span><strong>#00127</strong><small>Camisa Oxford M</small></span><b>C$ 2,881.50</b></li><li><span><strong>#00098</strong><small>Vestido lino S</small></span><b>C$ 1,890.00</b></li></ul></section><div className="profile-actions"><ActionButton>Preparar WhatsApp</ActionButton><ActionButton primary>Nueva venta</ActionButton></div></aside>
      </section>
    </main>
  )
}

const productRows = [
  ['Blanco · XS', 'CAM-OXF-BLA-XS', '7501234560103', '3'],
  ['Blanco · S', 'CAM-OXF-BLA-S', '7501234560110', '5'],
  ['Blanco · M', 'CAM-OXF-BLA-M', '7501234560127', '8'],
  ['Celeste · M', 'CAM-OXF-CEL-M', '7501234560202', '6'],
]

export function ProductsView() {
  return (
    <main className="admin-page reference-page">
      <ViewHeader eyebrow="Productos / Nuevo producto" title="Camisa Oxford" actions={<><ActionButton>Cancelar</ActionButton><button className="dark-button" type="button">Guardar borrador</button><ActionButton primary>Publicar producto</ActionButton></>} />
      <section className="reference-split product-editor-layout"><div className="reference-stack"><article className="panel-card reference-card"><h2>Información general</h2><div className="form-grid"><label><span>Nombre</span><input defaultValue="Camisa Oxford" /></label><label><span>Categoría</span><select defaultValue="Camisas"><option>Camisas</option></select></label><label><span>Marca</span><select defaultValue="Pendiente"><option>Pendiente</option></select></label><label><span>Proveedor</span><select defaultValue="Sin asignar"><option>Sin asignar</option></select></label><label><span>Precio de venta</span><input defaultValue="C$ 1,150.00" /></label><label><span>Costo unitario</span><input placeholder="Pendiente de proporcionar" /></label></div></article><article className="panel-card reference-card"><div className="section-title-row"><h2>Atributos y variantes</h2><Tag tone="warning">5 tallas × 3 colores</Tag></div><h3>Tallas</h3><div className="choice-row">{['XS','S','M','L','XL'].map((size) => <button className="selected" key={size} type="button">{size}</button>)}<button type="button">＋ Talla</button></div><h3>Colores</h3><div className="choice-row"><button type="button">○ Blanco</button><button type="button">● Celeste</button><button type="button">● Negro</button><button type="button">＋ Color</button></div><div className="table-scroll"><table><thead><tr><th>Variante</th><th>SKU</th><th>Código de barras</th><th>Stock inicial</th></tr></thead><tbody>{productRows.map((row) => <tr key={row[1]}>{row.map((cell) => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div></article></div><aside className="reference-stack"><article className="panel-card reference-card"><h2>Fotos</h2><div className="photo-placeholder">♧<strong>Foto principal</strong></div><button className="upload-button" type="button">＋ Subir fotografía</button><p className="card-note">Hasta cuatro fotografías reales del producto.</p></article><article className="panel-card reference-card"><h2>Etiqueta</h2><div className="label-preview"><strong>Tienda La Ganga</strong><span>Camisa Oxford · Celeste</span><b>M  C$ 1,150</b><i>||||| || ||||| |||</i><small>7 501234 560127</small></div><ActionButton>Imprimir vista previa</ActionButton></article></aside></section>
    </main>
  )
}

export function PurchasesView() {
  return (
    <main className="admin-page reference-page">
      <ViewHeader eyebrow="Compras / OC-0092" title="Orden de compra OC-0092" actions={<><ActionButton>Descargar PDF</ActionButton><button className="dark-button" type="button">Recibir con escáner</button><ActionButton primary>Enviar al proveedor</ActionButton></>} />
      <div className="process-steps"><span className="active"><b>1</b>Borrador</span><span><b>2</b>Enviada</span><span><b>3</b>Recibida parcial</span><span><b>4</b>Recibida</span></div>
      <section className="reference-split wide-left"><article className="panel-card reference-card"><div className="section-title-row"><h2>Pedido por curva de tallas</h2><div className="filter-pills"><button className="active" type="button">Estándar 1-2-3-2-1</button><button type="button">Personalizada</button></div></div><div className="purchase-lines">{['Camisa Oxford · Blanco','Camisa Oxford · Celeste','Jeans recto · Gris','Vestido lino · Terracota'].map((name, index) => <div className="purchase-line" key={name}><span><i className={`sample-color c${index}`} /><strong>{name}</strong></span><span className="curve-cells">{[1,2,3,2,1].map((value, position) => <b key={position}>{['XS','S','M','L','XL'][position]}<small>{value + (index % 2)}</small></b>)}</span><strong>{formatCordobas([9360,9360,12420,10080][index] ?? 0)}</strong></div>)}</div><div className="reference-total"><span>Total de demostración</span><strong>C$ 41,220.00</strong></div></article><aside className="reference-stack"><article className="panel-card reference-card"><h2>Proveedor</h2><h3>Sin confirmar</h3><p className="card-note">Contacto, condiciones de crédito y fecha de entrega se definirán al registrar el proveedor real.</p></article><article className="dark-reference-card"><h2>Sugerencias según ventas</h2><ul className="dark-list"><li>Jeans recto · Gris 34 <b>+6</b></li><li>Falda plisada · Vino <b>+12</b></li><li>Camisa Oxford · Celeste <b>+4</b></li></ul><button type="button">Agregar sugerencias</button></article></aside></section>
    </main>
  )
}

export function PromotionsView() {
  const [discount, setDiscount] = useState(30)
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Promociones comerciales" title="Promociones" actions={<ActionButton primary>＋ Nueva promoción</ActionButton>} /><section className="reference-split promotion-layout"><div className="promotion-list">{['Liquidación de temporada','2×1 en camisetas básicas','Cumpleaños del cliente','Promoción sin fecha'].map((name, index) => <button className={index === 0 ? 'active' : ''} key={name} type="button"><strong>{name}</strong><Tag tone={index === 0 ? 'warning' : 'calm'}>{index === 0 ? 'Borrador' : 'Propuesta'}</Tag><span>Reglas pendientes de aprobación</span></button>)}</div><article className="panel-card reference-card promotion-editor"><div className="section-title-row"><h2>Liquidación de temporada</h2><Tag tone="warning">Editando demostración</Tag></div><h3>Tipo de promoción</h3><div className="promotion-types"><button className="active" type="button">% de descuento</button><button type="button">Monto fijo</button><button type="button">2×1</button><button type="button">Combo</button></div><h3>Descuento</h3><div className="discount-control"><button type="button" onClick={() => setDiscount(Math.max(0, discount - 5))}>−</button><strong>{discount}%</strong><button type="button" onClick={() => setDiscount(Math.min(100, discount + 5))}>＋</button><span>Debe validarse contra permisos y margen autorizado.</span></div><div className="form-grid"><label><span>Aplica a</span><select><option>Colección seleccionada</option></select></label><label><span>Vigencia</span><input placeholder="Pendiente de confirmar" /></label></div><div className="ticket-promo-preview"><small>ASÍ SE VERÍA EN EL TICKET</small><strong>Vestido lino · Terracota · S</strong><span>Descuento de demostración −{discount}%</span></div><div className="editor-actions"><ActionButton>Guardar borrador</ActionButton><ActionButton primary>Programar promoción</ActionButton></div></article></section></main>
  )
}

export function BranchesView() {
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="1 ubicación confirmada" title="Sucursales" actions={<><ActionButton>＋ Nueva ubicación</ActionButton><ActionButton primary>Nuevo traslado</ActionButton></>} /><section className="branch-grid"><article className="panel-card branch-card"><div className="section-title-row"><h2>Tienda Managua</h2><Tag>En línea</Tag></div><p>Local físico confirmado · cantidad de cajas pendiente</p><div className="profile-stats"><span><small>Ventas hoy</small><strong>C$ —</strong></span><span><small>Stock</small><strong>98 und. simuladas</strong></span></div><div className="progress-row"><span>Configuración de ubicación</span><b>En curso</b><i><em style={{ width: '58%' }} /></i></div></article><article className="future-branch"><span>Etapa futura</span><h2>Bodega o mercadería en casa</h2><p>No se creará otra ubicación hasta confirmar si debe manejar existencias separadas.</p></article></section><section className="reference-split wide-left"><article className="panel-card reference-card"><h2>Traslados entre ubicaciones</h2><div className="empty-reference"><strong>Aún no hay traslados</strong><p>Se habilitarán cuando exista más de una ubicación de inventario.</p></div></article><article className="panel-card reference-card"><h2>Dónde hay stock</h2><p className="card-note">Por ahora toda la disponibilidad oficial corresponde a Tienda Managua.</p><div className="stock-location-row"><strong>Camisa Oxford · Celeste</strong><span>Managua</span><b>8 und.</b></div></article></section></main>
  )
}

export function OnlineStoreView() {
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Catálogo y pedidos digitales" title="Tienda en línea" actions={<><ActionButton>Editar catálogo</ActionButton><ActionButton primary>Vista del cliente</ActionButton></>} /><section className="kpi-grid"><article className="kpi-card"><span>Pedidos web hoy</span><strong>—</strong><small>Módulo futuro</small></article><article className="kpi-card"><span>Por preparar</span><strong>—</strong></article><article className="kpi-card"><span>Delivery</span><strong>—</strong></article><article className="kpi-card"><span>Productos publicados</span><strong>0 / 6 demo</strong></article></section><section className="reference-split wide-left"><div className="reference-stack"><article className="panel-card reference-card"><h2>Pedidos digitales</h2><div className="table-scroll"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Entrega</th><th>Pago</th><th>Estado</th></tr></thead><tbody><tr><td>#W-1043</td><td>Cliente de muestra</td><td>Recoger · Managua</td><td>Pendiente</td><td><Tag tone="warning">Nuevo</Tag></td></tr><tr><td>#W-1042</td><td>Consulta por WhatsApp</td><td>Delivery</td><td>Por verificar</td><td><Tag>Preparando</Tag></td></tr></tbody></table></div></article><article className="panel-card reference-card"><h2>Canales de venta</h2><div className="channel-grid"><span>☑ Catálogo web</span><span>☑ WhatsApp</span><span>□ Instagram</span><span>□ Facebook</span></div><p className="card-note">Las integraciones automáticas se habilitarán por separado. El primer catálogo prepara el pedido para WhatsApp.</p></article></div><article className="catalog-preview"><div className="catalog-image">♧</div><h2>Camisa Oxford <span>C$ 1,150</span></h2><p>Color: Celeste</p><div className="choice-row"><button type="button">S</button><button className="selected" type="button">M</button><button type="button">L</button></div><p>Disponibilidad simulada en Tienda Managua.</p><button type="button">Preparar pedido por WhatsApp</button></article></section></main>
  )
}

export function ReportsView() {
  const heat = [[4,18,34,27,11],[3,21,46,41,14],[5,15,29,24,12],[1,8,17,13,6]]
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Período de demostración" title="Reportes" actions={<><ActionButton>Excel</ActionButton><button className="dark-button" type="button">PDF</button></>} /><section className="reports-layout"><aside className="panel-card report-menu"><h3>REPORTES</h3>{['Ventas por período','Historial de ventas','Ventas por talla y color','Ventas por vendedor','Margen por categoría','Rotación de inventario','Productos lentos','Cierres de caja'].map((name, index) => <button className={index === 2 ? 'active' : ''} type="button" key={name}>{name}</button>)}</aside><div className="reference-stack"><article className="panel-card reference-card"><div className="section-title-row"><h2>Unidades vendidas por talla y color · Camisas</h2><span>Más oscuro = más vendido</span></div><div className="heatmap"><span /><b>XS</b><b>S</b><b>M</b><b>L</b><b>XL</b>{['Blanco','Celeste','Negro','Rayas azul'].map((color, row) => <div className="heatmap-row" key={color}><strong>{color}</strong>{heat[row]!.map((value) => <span key={value} style={{ '--heat': `${Math.min(.9, .12 + value / 60)}` } as React.CSSProperties}>{value}</span>)}</div>)}</div><p className="card-note">La lectura real aparecerá cuando existan ventas confirmadas.</p></article><div className="reference-split"><article className="panel-card reference-card"><h2>Ventas por vendedor</h2>{['Sofía Martínez','Diego Rivas','Laura Castillo','Andrés Mora'].map((name, index) => <div className="progress-row" key={name}><span>{name}</span><b>{[142300,128900,116400,84200][index]?.toLocaleString('es-NI')}</b><i><em style={{ width: `${[100,90,82,59][index]}%` }} /></i></div>)}</article><article className="panel-card reference-card"><h2>Productos lentos · 45+ días</h2><ul className="simple-list"><li><span><strong>Blazer lino · Beige</strong><small>Datos simulados</small></span><Tag tone="warning">Revisar</Tag></li><li><span><strong>Pantalón cargo · Oliva</strong><small>Datos simulados</small></span><Tag tone="warning">Revisar</Tag></li></ul></article></div></div></section></main>
  )
}

export function AccountingView() {
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Alcance adicional · informativo" title="Contabilidad" actions={<><ActionButton>Exportar libro de ventas</ActionButton><ActionButton primary>Registrar gasto</ActionButton></>} /><div className="scope-warning"><strong>Este módulo no constituye contabilidad formal ni declaración fiscal.</strong><span>Impuestos, facturación electrónica y reglas fiscales necesitan definición y revisión profesional antes de programarse.</span></div><section className="kpi-grid"><article className="kpi-card"><span>Ingresos netos</span><strong>C$ —</strong></article><article className="kpi-card"><span>Costo de ventas</span><strong>C$ —</strong></article><article className="kpi-card"><span>Gastos operativos</span><strong>C$ —</strong></article><article className="kpi-card dark-kpi"><span>Resultado operativo</span><strong>C$ —</strong></article></section><section className="reference-split thirds"><article className="panel-card reference-card"><h2>Resumen fiscal</h2><div className="empty-reference"><strong>Reglas pendientes</strong><p>No se asumirá IVA ni formato de factura sin confirmación.</p></div></article><article className="panel-card reference-card"><h2>Por cobrar</h2><ul className="simple-list"><li><span><strong>Ventas a crédito</strong><small>Saldo real pendiente</small></span><b>C$ —</b></li><li><span><strong>Abonos</strong><small>No cuentan como nueva venta</small></span><b>C$ —</b></li></ul></article><article className="panel-card reference-card"><h2>Por pagar</h2><div className="empty-reference"><strong>Sin proveedores reales</strong><p>Se completará al registrar compras.</p></div></article></section></main>
  )
}

export function TeamView() {
  const permissions = ['Vender y cobrar','Aplicar descuentos','Hacer devoluciones','Ver costos y márgenes','Ajustar inventario','Cerrar caja','Ver reportes','Configurar el sistema']
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Usuarios y permisos" title="Equipo" actions={<><ActionButton>Reglas de comisión</ActionButton><ActionButton primary>＋ Invitar persona</ActionButton></>} /><section className="team-cards"><article><span className="reference-avatar">AD</span><div><strong>Administrador</strong><small>Cuenta inicial</small></div><b>Todos los permisos</b></article><article className="pending-team"><span>＋</span><div><strong>Vendedores</strong><small>Cantidad pendiente de confirmar</small></div></article></section><article className="panel-card reference-card"><div className="section-title-row"><h2>Roles y permisos</h2><span>La API valida cada permiso</span></div><div className="table-scroll"><table className="permission-table"><thead><tr><th>Permiso</th><th>Vendedor</th><th>Administrador</th></tr></thead><tbody>{permissions.map((permission, index) => <tr key={permission}><td>{permission}</td><td><span className={index === 0 ? 'permission on' : 'permission'}>{index === 0 ? '✓' : '−'}</span></td><td><span className="permission on">✓</span></td></tr>)}</tbody></table></div><p className="card-note">Los descuentos, devoluciones y cierre de caja requieren reglas específicas antes de habilitarse al vendedor.</p></article></main>
  )
}

export function SettingsView() {
  return (
    <main className="admin-page reference-page"><ViewHeader eyebrow="Parámetros del negocio" title="Configuración" actions={<ActionButton primary>Guardar borrador</ActionButton>} /><section className="settings-grid"><article className="panel-card reference-card"><h2>Identidad de la tienda</h2><div className="form-grid"><label><span>Nombre comercial</span><input defaultValue="Tienda La Ganga" /></label><label><span>Teléfono</span><input defaultValue="88892478" /></label><label><span>Zona horaria</span><input value="America/Managua" readOnly /></label><label><span>Moneda</span><input value="Córdoba nicaragüense (C$)" readOnly /></label></div></article><article className="panel-card reference-card"><h2>Decisiones pendientes</h2><ul className="decision-list"><li><span>Ubicaciones de inventario</span><Tag tone="warning">Confirmar casa/bodega</Tag></li><li><span>Métodos de pago</span><Tag tone="warning">Pendiente</Tag></li><li><span>Ventas a crédito</span><Tag tone="warning">Pendiente</Tag></li><li><span>Límite de descuento</span><Tag tone="warning">Pendiente</Tag></li><li><span>Método de costos</span><Tag tone="warning">Pendiente</Tag></li></ul></article><article className="panel-card reference-card"><h2>Catálogos editables</h2><div className="settings-links"><button type="button">Tallas</button><button type="button">Colores</button><button type="button">Marcas</button><button type="button">Categorías</button><button type="button">Cortes</button></div></article><article className="panel-card reference-card"><h2>Seguridad y respaldo</h2><p className="card-note">Sesiones individuales, permisos en servidor, auditoría, respaldos y restauración comprobada.</p><div className="settings-links"><button type="button">Usuarios</button><button type="button">Auditoría</button><button type="button">Respaldos</button></div></article></section></main>
  )
}
