import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import { hasPermission } from '../lib/access'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { adjustInventory, getKardex, getVariantByBarcode } from './adminApi'
import { formatDateTime, kardexLabels, messageFrom } from './format'
import { useFetch } from './hooks'
import { buildEntryExtras } from './partners'
import { PartnerSelect, PartnersHint } from './PartnerSelect'
import { Dialog, LoadError, Notice, Pagination, Spinner, Tag } from './ui'
import { usePartners } from './usePartners'

export type PanelVariant = {
  variantId: string
  productName: string
  sizeName: string
  colorName: string
  barcode: string
  price: number
  stock: number
  cost?: number | null
}

type Kind = 'Entry' | 'Adjustment' | 'Loss'
const kindLabels: Record<Kind, string> = {
  Entry: 'Entrada (suma existencias)',
  Adjustment: 'Ajuste (corrección, con + o −)',
  Loss: 'Pérdida (resta existencias)',
}

const kardexPageSize = 10

/** Ficha de una variante: existencia, Kardex paginado y formulario de movimiento. */
export function VariantPanel({ user, variant, lowThreshold, onClose, onChanged }: {
  user: CurrentUser; variant: PanelVariant; lowThreshold: number; onClose: () => void; onChanged: () => void
}) {
  const canKardex = hasPermission(user, 'inventory.kardex.read')
  const canAdjust = hasPermission(user, 'inventory.adjust')
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canPartners = hasPermission(user, 'investment.read')
  const [stock, setStock] = useState(variant.stock)
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<Kind>('Entry')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [unitCost, setUnitCost] = useState(variant.cost == null ? '' : String(variant.cost))
  const [unitPrice, setUnitPrice] = useState(String(variant.price))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const partnerList = usePartners('active', canPartners && canAdjust)

  const kardex = useFetch(
    `kardex|${variant.variantId}|${page}`,
    (signal) => getKardex(variant.variantId, page, kardexPageSize, signal),
    canKardex,
  )

  const amount = Number(quantity.replace(',', '.'))
  const validAmount = quantity.trim() !== '' && Number.isInteger(amount) && amount !== 0 && (kind === 'Adjustment' || amount > 0)
  const delta = !validAmount ? 0 : kind === 'Loss' ? -Math.abs(amount) : kind === 'Entry' ? Math.abs(amount) : amount
  const resulting = stock + delta
  const negative = validAmount && resulting < 0
  // Socio, costo y precio solo aplican a las entradas (Entrada o ajuste con cantidad positiva).
  const isEntry = kind === 'Entry' || (kind === 'Adjustment' && validAmount && amount > 0)
  const showEntryFields = canPartners && (kind === 'Entry' || (kind === 'Adjustment' && !(validAmount && amount < 0)))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (!validAmount) { setError(kind === 'Adjustment' ? 'Escribí una cantidad entera distinta de cero (con − para restar).' : 'Escribí una cantidad entera mayor que cero.'); return }
    if (reason.trim().length < 3) { setError('El motivo es obligatorio: contá brevemente qué pasó.'); return }
    if (negative) { setError('El saldo no puede quedar negativo con un ajuste manual.'); return }
    let extras = {}
    if (canPartners && isEntry) {
      const built = buildEntryExtras({ partnerId, cost: unitCost, price: unitPrice })
      if (built.error) { setError(built.error); return }
      extras = built.extras
    }
    setSaving(true)
    try {
      await adjustInventory({ variantId: variant.variantId, kind, delta, reason: reason.trim(), ...extras })
      let newStock = resulting
      try { newStock = (await getVariantByBarcode(variant.barcode)).stock } catch { /* se usa el saldo calculado */ }
      setStock(newStock)
      setDone(`Movimiento registrado. Saldo actual: ${newStock}.`)
      setQuantity('')
      setReason('')
      setPage(1)
      kardex.reload()
      onChanged()
    } catch (caught) {
      setError(caught instanceof ApiError && caught.code === 'negative_stock' ? 'El saldo no puede quedar negativo con un ajuste manual.' : messageFrom(caught))
    } finally {
      setSaving(false)
    }
  }

  const statusTag = stock < 0
    ? <Tag tone="danger">Requiere revisión</Tag>
    : stock === 0 ? <Tag tone="danger">Agotado</Tag>
      : stock <= lowThreshold ? <Tag tone="warn">Bajo stock</Tag> : <Tag tone="ok">Disponible</Tag>

  return (
    <Dialog wide title={variant.productName} subtitle={`Talla ${variant.sizeName} · ${variant.colorName} · ${variant.barcode}`} onClose={onClose}>
      <div className="adm-actions" style={{ marginBottom: 12 }}>
        <span>Existencia <strong className={stock < 0 ? 'adm-neg' : undefined} style={{ fontSize: '1.2rem' }}>{stock}</strong></span>
        {statusTag}
        <span>Precio <strong>{formatNio(variant.price)}</strong></span>
        {canCost && variant.cost != null && <span>Costo <strong>{formatNio(variant.cost)}</strong></span>}
      </div>
      {stock < 0 && <Notice tone="warn">El saldo es negativo: se vendió más de lo que había registrado. Revisá el Kardex y corregí con una entrada o un ajuste.</Notice>}

      <div className="adm-split">
        <section>
          <h3 className="adm-card-title">Kardex</h3>
          {!canKardex && <Notice tone="info">Tu cuenta no tiene permiso para consultar el Kardex.</Notice>}
          {canKardex && (
            <>
              {kardex.error && <LoadError message={kardex.error} onRetry={kardex.reload} />}
              <div className="table-scroll">
                <table className="adm-table">
                  <thead><tr><th>Fecha</th><th>Tipo</th><th className="numeric">Cant.</th><th className="numeric">Saldo</th><th>Detalle</th></tr></thead>
                  <tbody>
                    {kardex.loading && !kardex.data && <tr><td colSpan={5}><Spinner /></td></tr>}
                    {kardex.data && kardex.data.items.length === 0 && <tr><td colSpan={5} className="adm-empty">Sin movimientos todavía.</td></tr>}
                    {kardex.data?.items.map((row, index) => (
                      <tr key={`${row.createdAtUtc}-${index}`}>
                        <td>{formatDateTime(row.createdAtUtc)}</td>
                        <td>{kardexLabels[row.type] ?? row.type}</td>
                        <td className={row.quantity < 0 ? 'numeric adm-neg' : 'numeric'}>{row.quantity > 0 ? `+${row.quantity}` : row.quantity}</td>
                        <td className={row.balanceAfter < 0 ? 'numeric adm-neg' : 'numeric'}>{row.balanceAfter}</td>
                        <td>
                          {row.saleNumber && <b>{row.saleNumber}</b>}
                          {row.reason && <span>{row.saleNumber ? ' · ' : ''}{row.reason}</span>}
                          <small className="row-sub">{row.userName}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {kardex.data && <Pagination page={kardex.data.page} totalPages={kardex.data.totalPages} totalCount={kardex.data.totalCount} onPage={setPage} noun="movimientos" />}
            </>
          )}
        </section>

        {canAdjust && (
          <section>
            <h3 className="adm-card-title">Registrar movimiento</h3>
            <form className="adm-form" onSubmit={(event) => { void submit(event) }}>
              <label className="adm-field">
                <span>Tipo</span>
                <select value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
                  {(Object.keys(kindLabels) as Kind[]).map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}
                </select>
              </label>
              <label className="adm-field">
                <span>{kind === 'Adjustment' ? 'Cantidad (ej. 3 o -2)' : 'Cantidad'}</span>
                <input type="number" step={1} value={quantity} onChange={(event) => setQuantity(event.target.value)} aria-invalid={negative} />
              </label>
              <label className="adm-field">
                <span>Motivo (obligatorio)</span>
                <textarea value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Ej. Llegó pedido, conteo físico, prenda dañada" />
              </label>
              {showEntryFields && (
                <fieldset className="adm-section inv-entry-fields">
                  <legend>Datos de la entrada</legend>
                  <div className="inv-entry-body">
                    <PartnersHint error={partnerList.error} empty={!partnerList.loading && !partnerList.error && partnerList.partners.length === 0} onRetry={partnerList.reload} />
                    {partnerList.partners.length > 0 && <PartnerSelect partners={partnerList.partners} value={partnerId} onChange={setPartnerId} />}
                    <div className="adm-grid-2">
                      <label className="adm-field">
                        <span>Costo unitario (C$)</span>
                        <input type="number" min={0} step="0.01" inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
                        <small>{variant.cost == null ? 'Vacío = sin costo registrado.' : 'Vacío = costo actual de la variante.'}</small>
                      </label>
                      <label className="adm-field">
                        <span>Precio de venta dado (C$)</span>
                        <input type="number" min={0} step="0.01" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                        <small>Vacío = precio actual ({formatNio(variant.price)}).</small>
                      </label>
                    </div>
                  </div>
                </fieldset>
              )}
              <div className="adm-row strong">
                <span>Saldo resultante</span>
                <b className={negative ? 'adm-neg' : undefined}>{stock} → {validAmount ? resulting : stock}</b>
              </div>
              {negative && <small className="adm-neg">El saldo no puede quedar negativo.</small>}
              {error && <Notice tone="error">{error}</Notice>}
              {done && <Notice tone="ok">{done}</Notice>}
              <button type="submit" className="primary-button" disabled={saving || negative}>{saving ? 'Guardando…' : 'Registrar movimiento'}</button>
            </form>
          </section>
        )}
      </div>
    </Dialog>
  )
}
