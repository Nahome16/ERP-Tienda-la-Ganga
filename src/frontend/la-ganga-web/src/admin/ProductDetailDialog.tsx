import { useState } from 'react'
import { ApiError } from '../lib/api'
import { hasPermission } from '../lib/access'
import type { ProductDetail, Variant } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { deleteProduct, getProduct, setColorBarcode, updateProduct, updateVariant } from './adminApi'
import { messageFrom } from './format'
import { ImageManager } from './ImageManager'
import { useFetch } from './hooks'
import { LabelsDialog, type LabelVariant } from './LabelsDialog'
import { AddVariantsDialog, EditProductDialog, EditVariantDialog } from './ProductDialogs'
import { ReceiveStockDialog } from './ReceiveStockDialog'
import { Dialog, LoadError, Notice, Spinner, Swatch, Tag } from './ui'
import type { Catalogs } from './useCatalogs'

type Props = {
  productId: string
  user: CurrentUser
  catalogs: Catalogs
  openLabels?: boolean
  onClose: () => void
  onChanged: () => void
}

type Nested =
  | { kind: 'edit-product' }
  | { kind: 'edit-variant'; variant: Variant }
  | { kind: 'add-variants' }
  | { kind: 'labels' }
  | { kind: 'receive' }
  | { kind: 'delete' }
  | null

export function ProductDetailDialog({ productId, user, catalogs, openLabels, onClose, onChanged }: Props) {
  const canEdit = hasPermission(user, 'product.edit')
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canImages = hasPermission(user, 'product.images.manage')
  const canReceive = hasPermission(user, 'inventory.adjust')
  const canDelete = hasPermission(user, 'product.archive')
  const { data: product, error, loading, reload } = useFetch<ProductDetail>(`product|${productId}`, (signal) => getProduct(productId, signal))
  const [nested, setNested] = useState<Nested>(openLabels ? { kind: 'labels' } : null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function changed(text?: string) {
    if (text) setNotice({ tone: 'ok', text })
    reload()
    onChanged()
  }

  async function guard(action: () => Promise<void>) {
    setBusy(true)
    setNotice(null)
    try {
      await action()
    } catch (caught) {
      setNotice({ tone: 'error', text: messageFrom(caught) })
      if (caught instanceof ApiError && caught.code === 'version_conflict') reload()
    } finally {
      setBusy(false)
    }
  }

  function toggleProduct(current: ProductDetail) {
    void guard(async () => {
      await updateProduct(current, {
        name: current.name, categoryId: current.categoryId, brandId: current.brandId,
        cutId: current.cutId, basePrice: current.basePrice, isActive: !current.isActive,
      })
      changed(current.isActive ? 'El producto quedó inactivo: ya no aparece en el punto de venta.' : 'El producto quedó activo.')
    })
  }

  function toggleVariant(variant: Variant) {
    void guard(async () => {
      await updateVariant(variant, {
        barcode: variant.barcode, priceOverride: variant.priceOverride, isActive: !variant.isActive,
        ...(canCost && variant.cost !== undefined ? { cost: variant.cost } : {}),
      })
      changed(variant.isActive ? 'La variante quedó inactiva.' : 'La variante quedó activa.')
    })
  }

  const labelVariants: LabelVariant[] = product
    ? product.variants.map((variant) => ({
      variantId: variant.id, productName: product.name, sizeName: variant.sizeName, colorName: variant.colorName,
      barcode: variant.barcode, price: variant.price, stock: variant.stock,
    }))
    : []

  return (
    <>
      <Dialog
        wide
        title={product?.name ?? 'Producto'}
        subtitle={product ? `${product.categoryName} · ${product.brandName}${product.cutName ? ` · Corte ${product.cutName}` : ''}` : undefined}
        onClose={onClose}
        footer={product && (
          <>
            {canDelete && <button type="button" className="link-button danger" disabled={busy} onClick={() => setNested({ kind: 'delete' })}>Eliminar producto</button>}
            {canReceive && <button type="button" className="secondary-button" onClick={() => setNested({ kind: 'receive' })}>Ingresar mercadería</button>}
            {canEdit && <button type="button" className="secondary-button" disabled={busy} onClick={() => toggleProduct(product)}>{product.isActive ? 'Inactivar producto' : 'Activar producto'}</button>}
            {canEdit && <button type="button" className="secondary-button" onClick={() => setNested({ kind: 'add-variants' })}>Agregar variantes</button>}
            {canEdit && <button type="button" className="secondary-button" onClick={() => setNested({ kind: 'edit-product' })}>Editar producto</button>}
            <button type="button" className="primary-button" disabled={product.variants.length === 0} onClick={() => setNested({ kind: 'labels' })}>Etiquetas</button>
          </>
        )}
      >
        {loading && !product && <Spinner label="Cargando producto…" />}
        {error && <LoadError message={error} onRetry={reload} />}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {product && (
          <>
            <div className="adm-actions" style={{ marginBottom: 12 }}>
              <Tag tone={product.isActive ? 'ok' : 'neutral'}>{product.isActive ? 'Activo' : 'Inactivo'}</Tag>
              <span>Precio base <strong>{formatNio(product.basePrice)}</strong></span>
              {product.barcode && <span>Código de fábrica <strong>{product.barcode}</strong></span>}
              <span>Existencia total <strong className={product.totalStock < 0 ? 'adm-neg' : undefined}>{product.totalStock}</strong></span>
              <span>{product.variantCount} variante{product.variantCount === 1 ? '' : 's'}</span>
            </div>
            <FactoryCodes product={product} canEdit={canEdit} onChanged={(text) => changed(text)} />
            <ImageManager key={product.id} productId={product.id} images={product.images ?? []} canManage={canImages} onChanged={onChanged} />
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr>
                    <th>Talla</th><th>Color</th><th title="Código que genera el sistema para cada talla y color (etiquetas propias)">Código interno</th><th className="numeric">Precio</th>
                    {canCost && <th className="numeric">Costo</th>}
                    <th className="numeric">Existencia</th><th>Estado</th>
                    {canEdit && <th className="actions-col"><span className="visually-hidden">Acciones</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {product.variants.length === 0 && <tr><td colSpan={8} className="adm-empty">Este producto no tiene variantes.</td></tr>}
                  {product.variants.map((variant) => (
                    <tr key={variant.id} className={variant.isActive ? (variant.stock < 0 ? 'neg-row' : undefined) : 'inactive-row'}>
                      <td>{variant.sizeName}</td>
                      <td><Swatch hex={variant.colorHex} name={variant.colorName} /> {variant.colorName}</td>
                      <td className="adm-mono">{variant.barcode}</td>
                      <td className="numeric">{formatNio(variant.price)}{variant.priceOverride !== null && <small className="row-sub">precio especial</small>}</td>
                      {canCost && <td className="numeric">{variant.cost === null || variant.cost === undefined ? '—' : formatNio(variant.cost)}</td>}
                      <td className={variant.stock < 0 ? 'numeric adm-neg' : 'numeric'}>{variant.stock}{variant.stock < 0 && <small className="row-sub">requiere revisión</small>}</td>
                      <td><Tag tone={variant.isActive ? 'ok' : 'neutral'}>{variant.isActive ? 'Activa' : 'Inactiva'}</Tag></td>
                      {canEdit && (
                        <td className="actions-col">
                          <button type="button" className="link-button" onClick={() => setNested({ kind: 'edit-variant', variant })}>Editar</button>
                          <button type="button" className="link-button" disabled={busy} onClick={() => toggleVariant(variant)}>{variant.isActive ? 'Inactivar' : 'Activar'}</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Dialog>

      {product && nested?.kind === 'edit-product' && (
        <EditProductDialog
          product={product} catalogs={catalogs}
          onClose={() => setNested(null)} onConflict={reload}
          onSaved={() => { setNested(null); changed('Se guardaron los cambios del producto.') }}
        />
      )}
      {product && nested?.kind === 'edit-variant' && (
        <EditVariantDialog
          variant={nested.variant} canCost={canCost}
          label={`${product.name} · ${nested.variant.sizeName} / ${nested.variant.colorName}`}
          onClose={() => setNested(null)} onConflict={reload}
          onSaved={() => { setNested(null); changed('Se guardaron los cambios de la variante.') }}
        />
      )}
      {product && nested?.kind === 'add-variants' && (
        <AddVariantsDialog
          product={product} catalogs={catalogs} user={user}
          onClose={() => setNested(null)} onChanged={() => changed()}
          onDone={() => { setNested(null); changed('Se agregaron las variantes.') }}
        />
      )}
      {product && nested?.kind === 'delete' && (
        <DeleteProductDialog
          product={product}
          onClose={() => setNested(null)}
          onDeactivate={product.isActive && canEdit ? () => { setNested(null); toggleProduct(product) } : undefined}
          onDeleted={() => { onChanged(); onClose() }}
        />
      )}
      {product && nested?.kind === 'receive' && (
        <ReceiveStockDialog productId={product.id} user={user} catalogs={catalogs} onClose={() => { setNested(null); reload() }} onChanged={() => { reload(); onChanged() }} />
      )}
      {product && nested?.kind === 'labels' && (
        <LabelsDialog title={product.name} variants={labelVariants} onClose={() => setNested(null)} />
      )}
    </>
  )
}

/** Confirmación para eliminar un producto. Solo procede si nunca se vendió. */
function DeleteProductDialog({ product, onClose, onDeleted, onDeactivate }: {
  product: ProductDetail
  onClose: () => void
  onDeleted: () => void
  /** Si se puede, ofrece desactivar en lugar de eliminar (producto con ventas). */
  onDeactivate?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; hasSales: boolean } | null>(null)
  const units = product.variants.reduce((sum, variant) => sum + Math.max(variant.stock, 0), 0)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await deleteProduct(product.id)
      onDeleted()
    } catch (caught) {
      setError({ text: messageFrom(caught), hasSales: caught instanceof ApiError && caught.code === 'product_has_sales' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Eliminar producto"
      subtitle={product.name}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button>
          {error?.hasSales
            ? onDeactivate && <button type="button" className="primary-button" onClick={onDeactivate}>Desactivar producto</button>
            : <button type="button" className="adm-danger-button" onClick={() => { void confirm() }} disabled={busy}>{busy ? 'Eliminando…' : 'Eliminar definitivamente'}</button>}
        </>
      )}
    >
      {error
        ? <Notice tone="error">{error.text}</Notice>
        : (
          <>
            <p>Se va a borrar <strong>{product.name}</strong> con todo lo suyo. No se puede deshacer:</p>
            <ul className="adm-delete-list">
              <li>{product.variants.length} {product.variants.length === 1 ? 'talla/color' : 'tallas y colores'} y sus códigos de barras</li>
              <li>{units} {units === 1 ? 'unidad' : 'unidades'} en existencia, su Kardex y las entradas de socios</li>
              {product.images.length > 0 && <li>{product.images.length} {product.images.length === 1 ? 'foto' : 'fotos'}</li>}
            </ul>
            <p className="adm-help">Solo se pueden eliminar productos que nunca se vendieron (por ejemplo, creados por error). Si ya tiene ventas, desactivalo: deja de aparecer en la caja y se conserva el historial.</p>
          </>
        )}
    </Dialog>
  )
}

/**
 * Códigos de fábrica del producto: uno para todo el producto o uno por color. En caja,
 * escanearlos abre el producto (o el color) para elegir la talla. Las tallas tienen además
 * un código interno propio para las etiquetas.
 */
function FactoryCodes({ product, canEdit, onChanged }: { product: ProductDetail; canEdit: boolean; onChanged: (text: string) => void }) {
  const colors = [...new Map(product.variants.map((variant) => [variant.colorId, { id: variant.colorId, name: variant.colorName, hex: variant.colorHex }])).values()]
  const codes = new Map((product.colorBarcodes ?? []).map((item) => [item.colorId, item.barcode]))
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!product.barcode && codes.size === 0 && !canEdit) return null

  async function save(colorId: string) {
    setBusy(true)
    setError(null)
    try {
      await setColorBarcode(product.id, colorId, value.trim())
      setEditing(null)
      onChanged(value.trim() ? 'Código del color guardado.' : 'Código del color quitado.')
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="adm-factory-codes" aria-label="Códigos de fábrica">
      <h3>Códigos de fábrica <small>Al escanearlos en caja se elige la talla</small></h3>
      <div className="adm-factory-row">
        <span>Todo el producto</span>
        {product.barcode ? <code>{product.barcode}</code> : <em>Sin código</em>}
        {canEdit && <small>Se cambia en «Editar producto».</small>}
      </div>
      {colors.map((color) => (
        <div className="adm-factory-row" key={color.id}>
          <span><Swatch hex={color.hex} name={color.name} /> {color.name}</span>
          {editing === color.id
            ? (
              <form className="adm-factory-edit" onSubmit={(event) => { event.preventDefault(); void save(color.id) }}>
                <input autoFocus value={value} maxLength={64} placeholder="Escaneá o escribí el código" aria-label={`Código del color ${color.name}`} onChange={(event) => setValue(event.target.value)} />
                <button type="submit" className="secondary-button" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
                <button type="button" className="link-button" onClick={() => { setEditing(null); setError(null) }} disabled={busy}>Cancelar</button>
              </form>
            )
            : (
              <>
                {codes.get(color.id) ? <code>{codes.get(color.id)}</code> : <em>Sin código</em>}
                {canEdit && <button type="button" className="link-button" onClick={() => { setEditing(color.id); setValue(codes.get(color.id) ?? ''); setError(null) }}>{codes.get(color.id) ? 'Cambiar' : 'Agregar código del color'}</button>}
              </>
            )}
        </div>
      ))}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}
