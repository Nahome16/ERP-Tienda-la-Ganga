import { useState } from 'react'
import { hasPermission } from '../lib/access'
import { listUsers } from '../lib/usersApi'
import type { CurrentUser } from '../types'
import { listAudit } from '../admin/adminApi'
import { formatDateTime, shortId } from '../admin/format'
import { useFetch } from '../admin/hooks'
import { LoadError, Pagination, Spinner, Tag } from '../admin/ui'

const pageSize = 30

const auditActionLabels: Record<string, string> = {
  'sale.confirmed': 'Venta registrada',
  'sale.voided': 'Venta anulada',
  'sale.review_resolved': 'Revisión de venta resuelta',
  'discount.approved': 'Descuento autorizado',
  'cash.opened': 'Caja abierta',
  'cash.closed': 'Caja cerrada',
  'inventory.adjusted': 'Ajuste de inventario',
  'product.created': 'Producto creado',
  'product.updated': 'Producto actualizado',
  'product.imported': 'Productos importados',
  'settings.updated': 'Configuración actualizada',
  'user.created': 'Usuario creado',
  'user.updated': 'Usuario actualizado',
  'user.password_reset': 'Contraseña restablecida',
}

const entityLabels: Record<string, string> = {
  Sale: 'Venta', CashSession: 'Caja', Product: 'Producto', ProductVariant: 'Variante', Variant: 'Variante',
  InventoryMovement: 'Inventario', StoreSettings: 'Configuración', Settings: 'Configuración', User: 'Usuario',
  DiscountApproval: 'Descuento', ProductImport: 'Importación',
}

function actionTone(action: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (action.includes('voided')) return 'danger'
  if (action.includes('review') || action.includes('adjusted') || action.includes('password') || action.includes('discount')) return 'warn'
  if (action.includes('confirmed') || action.includes('created') || action.includes('opened')) return 'ok'
  if (action.includes('closed') || action.includes('updated') || action.includes('imported')) return 'info'
  return 'neutral'
}

export function AuditView({ user }: { user: CurrentUser }) {
  const canUsers = hasPermission(user, 'user.manage')
  const [entityType, setEntityType] = useState('')
  const [userId, setUserId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [knownTypes, setKnownTypes] = useState<string[]>([])

  const users = useFetch('audit-users', (signal) => listUsers(signal), canUsers)
  const audit = useFetch(`audit|${entityType}|${userId}|${from}|${to}|${page}`, async (signal) => {
    const result = await listAudit({ entityType, userId, from, to, page, pageSize }, signal)
    // Los tipos de entidad disponibles se aprenden de lo que devuelve el servidor.
    setKnownTypes((current) => {
      const next = new Set([...current, ...result.items.map((row) => row.entityType)])
      return next.size === current.length ? current : Array.from(next).sort()
    })
    return result
  })

  const rows = audit.data?.items ?? []
  const typeOptions = Array.from(new Set([...knownTypes, ...(entityType ? [entityType] : [])])).sort()
  const rangeInvalid = Boolean(from && to && from > to)

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Administración · <b className="live-data">Datos reales</b></p>
          <h1>Auditoría</h1>
          <p className="page-summary">Quién hizo qué y cuándo. Las fechas son de Managua.</p>
        </div>
      </header>

      <section className="panel-card adm-card">
        <div className="adm-toolbar">
          <label className="adm-field-inline"><span>Tipo</span>
            <select value={entityType} onChange={(event) => { setEntityType(event.target.value); setPage(1) }} aria-label="Filtrar por tipo de entidad">
              <option value="">Todos</option>
              {typeOptions.map((type) => <option key={type} value={type}>{entityLabels[type] ?? type}</option>)}
            </select>
          </label>
          {canUsers && (
            <label className="adm-field-inline"><span>Usuario</span>
              <select value={userId} onChange={(event) => { setUserId(event.target.value); setPage(1) }} aria-label="Filtrar por usuario">
                <option value="">Todos</option>
                {users.data?.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
              </select>
            </label>
          )}
          <label className="adm-field-inline"><span>Desde</span>
            <input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setPage(1) }} />
          </label>
          <label className="adm-field-inline"><span>Hasta</span>
            <input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setPage(1) }} />
          </label>
          {(entityType || userId || from || to) && (
            <button type="button" className="link-button" onClick={() => { setEntityType(''); setUserId(''); setFrom(''); setTo(''); setPage(1) }}>Quitar filtros</button>
          )}
        </div>
        {rangeInvalid && <p className="adm-neg">La fecha «Desde» no puede ser posterior a «Hasta».</p>}
        {audit.error && <LoadError message={audit.error} onRetry={audit.reload} />}

        <div className="table-scroll">
          <table className="adm-table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
            <tbody>
              {audit.loading && rows.length === 0 && <tr><td colSpan={5}><Spinner label="Cargando auditoría…" /></td></tr>}
              {!audit.loading && !audit.error && rows.length === 0 && <tr><td colSpan={5} className="adm-empty">No hay registros con estos filtros.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.occurredAtUtc)}</td>
                  <td>{row.userName}</td>
                  <td><Tag tone={actionTone(row.action)}>{auditActionLabels[row.action] ?? row.action}</Tag></td>
                  <td>{entityLabels[row.entityType] ?? row.entityType}<small className="row-sub adm-mono" title={row.entityId}>{shortId(row.entityId)}</small></td>
                  <td>{row.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {audit.data && <Pagination page={audit.data.page} totalPages={audit.data.totalPages} totalCount={audit.data.totalCount} onPage={setPage} noun="registros" />}
      </section>
    </main>
  )
}
