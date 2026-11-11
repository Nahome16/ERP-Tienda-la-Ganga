import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import { hasPermission } from '../lib/access'
import type { ProductDetail } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { adjustInventory, getProduct } from './adminApi'
import { blockEnterSubmit } from './forms'
import { messageFrom } from './format'
import { useFetch } from './hooks'
import { ImageManager } from './ImageManager'
import { buildEntryExtras } from './partners'
import { PartnerSelect, PartnersHint } from './PartnerSelect'
import { AddVariantsDialog, EditProductDialog } from './ProductDialogs'
import { fillQuantities, parseReceiveQuantities } from './receiveStock'
import { Dialog, LoadError, Notice, Spinner, Swatch, Tag } from './ui'
import type { Catalogs } from './useCatalogs'
import { usePartners } from './usePartners'

type Props = {
  productId: string
  user: CurrentUser
  catalogs: Catalogs
  onClose: () => void
  /** Se avisa cuando algo cambió (existencias, fotos, datos) para refrescar las listas. */
  onChanged: () => void
}

type Nested = 'edit' | 'variants' | null

/**
 * «Ingresar mercadería» de un producto: cantidades por talla y color, quién la ingresó, costo y
 * precio; y desde el mismo lugar, fotos, edición del producto y tallas o colores nuevos.
 */
export function ReceiveStockDialog({ productId, user, catalogs, onClose, onChanged }: Props) {
  const canAdjust = hasPermission(user, 'inventory.adjust')
  const canEdit = hasPermission(user, 'product.edit')
  const canImages = hasPermission(user, 'product.images.manage')
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canPartners = hasPermission(user, 'investment.read')
  const { data: product, error: loadError, loading, reload } = useFetch<ProductDetail>(`receive|${productId}`, (signal) => getProduct(productId, signal))
  const partnerList = usePartners('active', canPartners && canAdjust)
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [fillValue, setFillValue] = useState('')
  const [reason, setReason] = useState('Ingreso de mercadería')
  const [partnerId, setPartnerId] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [nested, setNested] = useState<Nested>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const variants = product?.variants ?? []
  const parsed = parseReceiveQuantities(variants, quantities)

  function refreshed(text?: string) {
    if (text) setDone(text)
    reload()
    onChanged()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(null)
    if (parsed.error) { setError(parsed.error); return }
    if (parsed.lines.length === 0) { setError('Escribí la cantidad que ingresa en al menos una talla y color.'); return }
    if (reason.trim().length < 3) { setError('El motivo es obligatorio: por ejemplo «Llegó pedido».'); return }
    let extras = {}
    if (canPartners) {
      const built = buildEntryExtras({ partnerId, cost: unitCost, price: unitPrice })
      if (built.error) { setError(built.error); return }
      extras = built.extras
    }
    setSaving(true)
    let registered = 0
    const remaining = { ...quantities }
    try {
      for (const line of parsed.lines) {
        await adjustInventory({ variantId: line.variantId, kind: 'Entry', delta: line.quantity, reason: reason.trim(), ...extras })
        registered += line.quantity
        delete remaining[line.variantId]
        setQuantities({ ...remaining })
      }
      setDone(`Se registraron ${registered} prenda${registered === 1 ? '' : 's'} en ${parsed.lines.length} variante${parsed.lines.length === 1 ? '' : 's'}. Ya están en el Kardex.`)
    } catch (caught) {
      setError(`${caught instanceof ApiError ? caught.message : messageFrom(caught)}${registered > 0 ? ` Ya se registraron ${registered} prenda${registered === 1 ? '' : 's'}; las que faltan siguen escritas para reintentar.` : ''}`)
    } finally {
      setSaving(false)
      if (registered > 0) { reload(); onChanged() }
    }
  }

  const unitsLabel = `${parsed.totalUnits} prenda${parsed.totalUnits === 1 ? '' : 's'}`

  return (
    <>
      <Dialog
        wide
        title={product ? `Ingresar mercadería · ${product.name}` : 'Ingresar mercadería'}
        subtitle={product ? `${product.categoryName} · ${product.brandName} · Precio base ${formatNio(product.basePrice)}` : undefined}
        onClose={onClose}
        footer={product && (
          <>
            <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cerrar</button>
            {canAdjust && (
              <button type="submit" form="receive-stock-form" className="primary-button" disabled={saving || variants.length === 0}>
                {saving ? 'Registrando…' : `Registrar ingreso (${unitsLabel})`}
              </button>
            )}
          </>
        )}
      >
        {loading && !product && <Spinner label="Cargando producto…" />}
        {loadError && <LoadError message={loadError} onRetry={reload} />}
        {product && (
          <div className="adm-form">
            <details className="adm-section" open={(product.images ?? []).length === 0}>
              <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Fotos del producto · {(product.images ?? []).length} de 4 (tocá para ver o cambiar)</summary>
              <div style={{ marginTop: 10 }}>
                <ImageManager key={product.id} productId={product.id} images={product.images ?? []} canManage={canImages} onChanged={onChanged} />
              </div>
            </details>

            <div className="adm-actions">
              <Tag tone={product.isActive ? 'ok' : 'neutral'}>{product.isActive ? 'Activo' : 'Inactivo'}</Tag>
              <span>Existencia total <strong className={product.totalStock < 0 ? 'adm-neg' : undefined}>{product.totalStock}</strong></span>
              <span>{product.variantCount} variante{product.variantCount === 1 ? '' : 's'}</span>
              {canEdit && <button type="button" className="secondary-button" style={{ marginLeft: 'auto' }} onClick={() => setNested('edit')}>Editar datos del producto</button>}
              {canEdit && <button type="button" className="secondary-button" onClick={() => setNested('variants')}>Agregar talla o color nuevo</button>}
            </div>

            {!canAdjust && <Notice tone="info">Tu cuenta no tiene permiso para registrar entradas de inventario.</Notice>}

            <form id="receive-stock-form" className="adm-form" onKeyDown={blockEnterSubmit} onSubmit={(event) => { void submit(event) }}>
              <section className="adm-section">
                <h3>Cantidad que ingresa por talla y color</h3>
                {variants.length === 0 && <p className="adm-help">Este producto no tiene tallas ni colores todavía. Usá «Agregar talla o color nuevo».</p>}
                {variants.length > 0 && canAdjust && (
                  <div className="adm-actions" style={{ marginBottom: 8 }}>
                    <label className="adm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <span>Misma cantidad para todas</span>
                      <input type="number" min={0} step={1} inputMode="numeric" value={fillValue} style={{ width: 90 }} onChange={(event) => setFillValue(event.target.value)} aria-label="Misma cantidad para todas las variantes" />
                    </label>
                    <button type="button" className="secondary-button" onClick={() => setQuantities(fillQuantities(variants, fillValue))}>Aplicar</button>
                    <button type="button" className="link-button" onClick={() => { setQuantities({}); setFillValue('') }}>Limpiar</button>
                  </div>
                )}
                {variants.length > 0 && (
                  <div className="table-scroll">
                    <table className="adm-table">
                      <thead>
                        <tr><th>Talla</th><th>Color</th><th>Código</th><th className="numeric">Existencia</th><th className="numeric">Ingresan</th></tr>
                      </thead>
                      <tbody>
                        {variants.map((variant) => (
                          <tr key={variant.id} className={variant.isActive ? undefined : 'inactive-row'}>
                            <td>{variant.sizeName}</td>
                            <td><Swatch hex={variant.colorHex} name={variant.colorName} /> {variant.colorName}</td>
                            <td className="adm-mono">{variant.barcode}</td>
                            <td className={variant.stock < 0 ? 'numeric adm-neg' : 'numeric'}>{variant.stock}</td>
                            <td className="numeric">
                              <input
                                type="number" min={0} step={1} inputMode="numeric" value={quantities[variant.id] ?? ''}
                                disabled={!canAdjust || saving}
                                aria-label={`Cantidad que ingresa de talla ${variant.sizeName} color ${variant.colorName}`}
                                onChange={(event) => setQuantities({ ...quantities, [variant.id]: event.target.value })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {canAdjust && variants.length > 0 && (
                <section className="adm-section">
                  <h3>Datos de la entrada</h3>
                  <label className="adm-field">
                    <span>Motivo (obligatorio)</span>
                    <input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
                  </label>
                  {canPartners && (
                    <>
                      <PartnersHint error={partnerList.error} empty={!partnerList.loading && !partnerList.error && partnerList.partners.length === 0} onRetry={partnerList.reload} />
                      {partnerList.partners.length > 0 && <PartnerSelect partners={partnerList.partners} value={partnerId} onChange={setPartnerId} />}
                      <div className="adm-grid-2">
                        <label className="adm-field">
                          <span>Costo unitario (C$)</span>
                          <input type="number" min={0} step="0.01" inputMode="decimal" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
                          <small>Vacío = sin costo registrado{canCost ? ' o el costo actual de cada variante' : ''}.</small>
                        </label>
                        <label className="adm-field">
                          <span>Precio de venta dado (C$)</span>
                          <input type="number" min={0} step="0.01" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                          <small>Vacío = el precio actual de cada variante.</small>
                        </label>
                      </div>
                    </>
                  )}
                </section>
              )}
              {error && <Notice tone="error">{error}</Notice>}
              {done && <Notice tone="ok">{done}</Notice>}
            </form>
          </div>
        )}
      </Dialog>

      {product && nested === 'edit' && (
        <EditProductDialog
          product={product} catalogs={catalogs} onClose={() => setNested(null)} onConflict={reload}
          onSaved={() => { setNested(null); refreshed('Se guardaron los cambios del producto.') }}
        />
      )}
      {product && nested === 'variants' && (
        <AddVariantsDialog
          product={product} catalogs={catalogs} user={user} onClose={() => setNested(null)} onChanged={() => refreshed()}
          onDone={() => { setNested(null); refreshed('Se agregaron las tallas y colores nuevos. Ya podés cargarles cantidad.') }}
        />
      )}
    </>
  )
}
