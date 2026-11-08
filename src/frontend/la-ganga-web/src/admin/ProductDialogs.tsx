import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import type { CurrentUser } from '../types'
import { hasPermission } from '../lib/access'
import type { ProductDetail, ProductListItem, Variant } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { addVariant, createProduct, updateProduct, updateVariant, type ProductInput } from './adminApi'
import { parseDecimal } from './csv'
import { messageFrom } from './format'
import { Dialog, Notice } from './ui'
import type { Catalogs } from './useCatalogs'
import { categoryOptions } from './useCatalogs'
import { VariantBuilder } from './VariantBuilder'
import { builderToInputs, emptyBuilder, type BuilderState } from './variantBuilder'

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Object.values(error.fieldErrors).flat()
    return details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message
  }
  return messageFrom(error)
}

type ProductFields = { name: string; categoryId: string; brandId: string; cutId: string; basePrice: string }

function ProductFieldsForm({ fields, onChange, catalogs, extraCategory, extraBrand }: {
  fields: ProductFields
  onChange: (fields: ProductFields) => void
  catalogs: Catalogs
  extraCategory?: { id: string; name: string }
  extraBrand?: { id: string; name: string }
}) {
  const categories = categoryOptions(catalogs.categories)
  if (extraCategory && !categories.some((item) => item.id === extraCategory.id)) categories.push({ id: extraCategory.id, label: `${extraCategory.name} (inactiva)` })
  const brands = [...catalogs.brands]
  const brandOptions = brands.map((brand) => ({ id: brand.id, name: brand.name }))
  if (extraBrand && !brandOptions.some((item) => item.id === extraBrand.id)) brandOptions.push({ id: extraBrand.id, name: `${extraBrand.name} (inactiva)` })
  return (
    <>
      <label className="adm-field">
        <span>Nombre del producto</span>
        <input value={fields.name} maxLength={200} required onChange={(event) => onChange({ ...fields, name: event.target.value })} data-autofocus />
      </label>
      <div className="adm-grid-2">
        <label className="adm-field">
          <span>Categoría</span>
          <select value={fields.categoryId} required onChange={(event) => onChange({ ...fields, categoryId: event.target.value })}>
            <option value="">Elegí una categoría</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Marca</span>
          <select value={fields.brandId} required onChange={(event) => onChange({ ...fields, brandId: event.target.value })}>
            <option value="">Elegí una marca</option>
            {brandOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Corte (opcional)</span>
          <select value={fields.cutId} onChange={(event) => onChange({ ...fields, cutId: event.target.value })}>
            <option value="">Sin corte</option>
            {catalogs.cuts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="adm-field">
          <span>Precio base (C$)</span>
          <input type="number" min={0} step="0.01" required value={fields.basePrice} onChange={(event) => onChange({ ...fields, basePrice: event.target.value })} />
        </label>
      </div>
    </>
  )
}

function validateFields(fields: ProductFields): { input: ProductInput | null; error: string | null } {
  if (!fields.name.trim()) return { input: null, error: 'Escribí el nombre del producto.' }
  if (!fields.categoryId) return { input: null, error: 'Elegí la categoría.' }
  if (!fields.brandId) return { input: null, error: 'Elegí la marca.' }
  const basePrice = parseDecimal(fields.basePrice)
  if (basePrice === null || basePrice <= 0) return { input: null, error: 'El precio base debe ser mayor que cero.' }
  return {
    input: { name: fields.name.trim(), categoryId: fields.categoryId, brandId: fields.brandId, cutId: fields.cutId || null, basePrice },
    error: null,
  }
}

/** Alta de producto con su matriz de variantes. */
export function CreateProductDialog({ user, catalogs, onClose, onCreated }: {
  user: CurrentUser; catalogs: Catalogs; onClose: () => void; onCreated: (product: ProductDetail) => void
}) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const [fields, setFields] = useState<ProductFields>({ name: '', categoryId: '', brandId: '', cutId: '', basePrice: '' })
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const built = builderToInputs(builder, catalogs.sizes, catalogs.colors, new Set(), canCost)
  const needsInitialPermission = built.totalUnits > 0 && !canInitial

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const { input, error: fieldError } = validateFields(fields)
    if (!input) { setError(fieldError); return }
    if (built.inputs.length === 0) { setError('Elegí al menos una talla y un color para crear las variantes.'); return }
    if (built.errors.length > 0) { setError(built.errors[0]); return }
    if (needsInitialPermission) { setError('Tu cuenta no puede registrar existencia inicial. Dejá las cantidades en cero.'); return }
    setSaving(true)
    try {
      onCreated(await createProduct({ ...input, variants: built.inputs }))
    } catch (caught) {
      setError(describeError(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      wide
      title="Nuevo producto"
      subtitle="Los productos nacen activos. La existencia inicial queda registrada en el Kardex."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="create-product-form" className="primary-button" disabled={saving}>
            {saving ? 'Guardando…' : `Crear producto (${built.inputs.length} variante${built.inputs.length === 1 ? '' : 's'}, ${built.totalUnits} u.)`}
          </button>
        </>
      )}
    >
      <form id="create-product-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <ProductFieldsForm fields={fields} onChange={setFields} catalogs={catalogs} />
        <VariantBuilder catalogs={catalogs} state={builder} onChange={setBuilder} canCost={canCost} />
        {needsInitialPermission && <Notice tone="warn">Tu cuenta no tiene permiso para registrar existencia inicial: dejá las cantidades vacías.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

/** Edita los datos del producto (nombre, categoría, marca, corte, precio base). */
export function EditProductDialog({ product, catalogs, onClose, onSaved, onConflict }: {
  product: ProductListItem; catalogs: Catalogs; onClose: () => void; onSaved: (product: ProductListItem) => void; onConflict: () => void
}) {
  const [fields, setFields] = useState<ProductFields>({
    name: product.name, categoryId: product.categoryId, brandId: product.brandId,
    cutId: product.cutId ?? '', basePrice: String(product.basePrice),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const { input, error: fieldError } = validateFields(fields)
    if (!input) { setError(fieldError); return }
    setSaving(true)
    try {
      onSaved(await updateProduct(product, { ...input, isActive: product.isActive }))
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'version_conflict') {
        setError('Otra persona cambió este producto mientras lo editabas. Cerrá y volvé a abrirlo para ver la versión actual.')
        onConflict()
      } else setError(describeError(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Editar producto"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="edit-product-form" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </>
      )}
    >
      <form id="edit-product-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <ProductFieldsForm
          fields={fields} onChange={setFields} catalogs={catalogs}
          extraCategory={{ id: product.categoryId, name: product.categoryName }}
          extraBrand={{ id: product.brandId, name: product.brandName }}
        />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

/** Edita una variante: código de barras, precio especial, costo y estado. */
export function EditVariantDialog({ variant, label, canCost, onClose, onSaved, onConflict }: {
  variant: Variant; label: string; canCost: boolean; onClose: () => void; onSaved: () => void; onConflict: () => void
}) {
  const [barcode, setBarcode] = useState(variant.barcode)
  const [price, setPrice] = useState(variant.priceOverride === null ? '' : String(variant.priceOverride))
  const [cost, setCost] = useState(variant.cost === null || variant.cost === undefined ? '' : String(variant.cost))
  const [isActive, setIsActive] = useState(variant.isActive)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!barcode.trim()) { setError('El código de barras no puede quedar vacío.'); return }
    const priceOverride = price.trim() === '' ? null : parseDecimal(price)
    if (price.trim() !== '' && (priceOverride === null || priceOverride <= 0)) { setError('El precio especial debe ser mayor que cero (o dejalo vacío).'); return }
    const costValue = cost.trim() === '' ? null : parseDecimal(cost)
    if (canCost && cost.trim() !== '' && (costValue === null || costValue < 0)) { setError('El costo no es válido.'); return }
    setSaving(true)
    try {
      await updateVariant(variant, { barcode: barcode.trim(), priceOverride, isActive, ...(canCost ? { cost: costValue } : {}) })
      onSaved()
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'version_conflict') {
        setError('Otra persona cambió esta variante mientras la editabas. Se recargó el producto: cerrá y volvé a abrirla.')
        onConflict()
      } else setError(describeError(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Editar variante"
      subtitle={label}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="edit-variant-form" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </>
      )}
    >
      <form id="edit-variant-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <label className="adm-field">
          <span>Código de barras</span>
          <input value={barcode} onChange={(event) => setBarcode(event.target.value)} className="adm-mono" data-autofocus />
          <small>Cambiarlo obliga a reimprimir la etiqueta.</small>
        </label>
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>Precio especial (C$)</span>
            <input type="number" min={0} step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
            <small>Vacío = usa el precio base. Hoy se vende a {formatNio(variant.price)}.</small>
          </label>
          {canCost && (
            <label className="adm-field">
              <span>Costo (C$)</span>
              <input type="number" min={0} step="0.01" value={cost} onChange={(event) => setCost(event.target.value)} />
            </label>
          )}
        </div>
        <label className="adm-chip" style={{ width: 'fit-content' }}>
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          Variante activa (aparece en el punto de venta)
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

/** Agrega variantes nuevas (talla × color) a un producto existente, una por una. */
export function AddVariantsDialog({ product, catalogs, user, onClose, onDone, onChanged }: {
  product: ProductDetail; catalogs: Catalogs; user: CurrentUser; onClose: () => void; onDone: () => void; onChanged: () => void
}) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const existing = new Set(product.variants.map((variant) => `${variant.sizeId}|${variant.colorId}`))
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const built = builderToInputs(builder, catalogs.sizes, catalogs.colors, existing, canCost)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (built.inputs.length === 0) { setError('Elegí tallas y colores que el producto todavía no tenga.'); return }
    if (built.errors.length > 0) { setError(built.errors[0]); return }
    if (built.totalUnits > 0 && !canInitial) { setError('Tu cuenta no puede registrar existencia inicial. Dejá las cantidades vacías.'); return }
    setSaving(true)
    let created = 0
    try {
      for (const input of built.inputs) {
        await addVariant(product.id, input)
        created += 1
        setProgress(created)
      }
      onDone()
    } catch (caught) {
      setError(`${describeError(caught)}${created > 0 ? ` Ya se agregaron ${created} variante${created === 1 ? '' : 's'}; revisá el producto antes de reintentar.` : ''}`)
      if (created > 0) onChanged()
      setSaving(false)
    }
  }

  return (
    <Dialog
      wide
      title="Agregar variantes"
      subtitle={product.name}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="add-variants-form" className="primary-button" disabled={saving}>
            {saving ? `Guardando ${progress}/${built.inputs.length}…` : `Agregar ${built.inputs.length} variante${built.inputs.length === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    >
      <form id="add-variants-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <VariantBuilder catalogs={catalogs} state={builder} onChange={setBuilder} canCost={canCost} existing={existing} />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
