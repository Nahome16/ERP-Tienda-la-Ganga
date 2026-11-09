import { useRef, useState, type FormEvent } from 'react'
import { ScanBarcode } from 'lucide-react'
import { ApiError } from '../lib/api'
import type { CurrentUser } from '../types'
import { hasPermission } from '../lib/access'
import type { ProductDetail, ProductListItem, Variant } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { addVariant, createProduct, getVariantByBarcode, updateProduct, updateVariant, type ProductInput } from './adminApi'
import { parseDecimal } from './csv'
import { blockEnterSubmit } from './forms'
import { messageFrom } from './format'
import { PendingImages } from './ImageManager'
import { uploadPendingImages, type UploadReport } from './imageApi'
import { Dialog, Notice } from './ui'
import type { Catalogs } from './useCatalogs'
import { categoryOptions } from './useCatalogs'
import { VariantBuilder } from './VariantBuilder'
import { assignScannedBarcodes, builderToInputs, combosOf, draftBarcodes, emptyBuilder, type BuilderState } from './variantBuilderLogic'

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Object.values(error.fieldErrors).flat()
    return details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message
  }
  return messageFrom(error)
}

type ScanMessage = { tone: 'ok' | 'warn' | 'error'; text: string; productId?: string }

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
export function CreateProductDialog({ user, catalogs, onClose, onCreated, initialBarcode, onOpenExisting }: {
  user: CurrentUser; catalogs: Catalogs; onClose: () => void
  /** `images` solo viene si se eligieron fotos; `failed` lista las que no se pudieron subir. */
  onCreated: (product: ProductDetail, images?: UploadReport) => void
  /** Código escaneado que no existía: se asigna a la primera variante. */
  initialBarcode?: string
  /** Abre la ficha de un producto que ya tiene el código escaneado. */
  onOpenExisting?: (productId: string) => void
}) {
  const canImages = hasPermission(user, 'product.images.manage')
  const [pending, setPending] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const canPartners = hasPermission(user, 'investment.read')
  const [fields, setFields] = useState<ProductFields>({ name: '', categoryId: '', brandId: '', cutId: '', basePrice: '' })
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Códigos escaneados que esperan una variante (todavía no se eligió talla y color).
  const [pendingCodes, setPendingCodes] = useState<string[]>(() => (initialBarcode?.trim() ? [initialBarcode.trim()] : []))
  const [scan, setScan] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<ScanMessage | null>(
    initialBarcode?.trim() ? { tone: 'ok', text: `Código nuevo ${initialBarcode.trim()}: completá los datos y elegí talla y color; se asigna a la primera variante.` } : null,
  )
  const scanRef = useRef<HTMLInputElement>(null)

  const built = builderToInputs(builder, catalogs.sizes, catalogs.colors, new Set(), canCost, canPartners)
  const needsInitialPermission = built.totalUnits > 0 && !canInitial

  /** Aplica el cambio del borrador y coloca los códigos escaneados que estaban esperando. */
  function changeBuilder(next: BuilderState, codes: string[] = pendingCodes) {
    const placed = assignScannedBarcodes(next, combosOf(next, catalogs.sizes, catalogs.colors), codes)
    setBuilder(placed.state)
    setPendingCodes(placed.leftover)
    if (codes === pendingCodes && placed.leftover.length < codes.length) {
      setScanMessage({ tone: 'ok', text: 'Códigos escaneados asignados a las variantes: revisalos en la tabla de cantidades.' })
    }
    return placed
  }

  async function submitScan(event: FormEvent) {
    event.preventDefault()
    const code = scan.trim()
    if (!code) return
    setScan('')
    if (pendingCodes.includes(code) || draftBarcodes(builder).has(code)) {
      setScanMessage({ tone: 'warn', text: `El código ${code} ya está en este producto.` })
      return
    }
    setScanning(true)
    try {
      const found = await getVariantByBarcode(code)
      setScanMessage({
        tone: 'warn', productId: found.productId ?? undefined,
        text: `El código ${code} ya pertenece a «${found.productName}» (talla ${found.sizeName} · ${found.colorName}).`,
      })
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        const placed = changeBuilder(builder, [...pendingCodes, code])
        setScanMessage({
          tone: 'ok',
          text: placed.leftover.includes(code)
            ? `Código ${code} listo: se asigna cuando elijas talla y color.`
            : `Código ${code} asignado a la siguiente variante sin código.`,
        })
      } else {
        setScanMessage({ tone: 'error', text: describeError(caught) })
      }
    } finally {
      setScanning(false)
      scanRef.current?.focus()
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const { input, error: fieldError } = validateFields(fields)
    if (!input) { setError(fieldError); return }
    if (built.inputs.length === 0) { setError('Elegí al menos una talla y un color para crear las variantes.'); return }
    if (built.errors.length > 0) { setError(built.errors[0]); return }
    if (pendingCodes.length > 0) {
      setError(`Hay ${pendingCodes.length === 1 ? 'un código escaneado' : `${pendingCodes.length} códigos escaneados`} sin variante (${pendingCodes.join(', ')}). Agregá más tallas o colores, o quitalos.`)
      return
    }
    if (needsInitialPermission) { setError('Tu cuenta no puede registrar existencia inicial. Dejá las cantidades en cero.'); return }
    setSaving(true)
    let created: ProductDetail
    try {
      created = await createProduct({ ...input, variants: built.inputs })
    } catch (caught) {
      setError(describeError(caught))
      setSaving(false)
      return
    }
    // El producto ya existe: si alguna foto falla, se avisa y se reintenta desde el detalle.
    if (canImages && pending.length > 0) {
      const report = await uploadPendingImages(created.id, pending, (done, total) => setProgress(`Subiendo imágenes (${Math.min(done + 1, total)} de ${total})…`))
      onCreated(created, report)
    } else {
      onCreated(created)
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
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>Cancelar</button>
          <button type="submit" form="create-product-form" className="primary-button" disabled={saving}>
            {saving ? (progress ?? 'Guardando…') : `Crear producto (${built.inputs.length} variante${built.inputs.length === 1 ? '' : 's'}, ${built.totalUnits} u.)`}
          </button>
        </>
      )}
    >
      <form className="adm-scanner adm-scanner-dialog" onSubmit={(event) => { void submitScan(event) }} role="search">
        <ScanBarcode size={20} strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={scanRef} value={scan} onChange={(event) => setScan(event.target.value)} inputMode="numeric" autoComplete="off"
          placeholder="Escaneá la etiqueta de la prenda (opcional)" aria-label="Escanear código de la prenda"
        />
        <button type="submit" className="secondary-button" disabled={scanning || !scan.trim()}>{scanning ? 'Buscando…' : 'Agregar código'}</button>
      </form>
      {scanMessage && (
        <Notice tone={scanMessage.tone}>
          {scanMessage.text}
          {scanMessage.productId && onOpenExisting && (
            <> <button type="button" className="link-button" onClick={() => onOpenExisting(scanMessage.productId as string)}>Abrir ese producto</button></>
          )}
        </Notice>
      )}
      {pendingCodes.length > 0 && (
        <p className="adm-scan-pending">
          Códigos por asignar: {pendingCodes.map((code) => (
            <span key={code} className="adm-scan-chip">
              {code}
              <button type="button" aria-label={`Quitar ${code}`} onClick={() => setPendingCodes((current) => current.filter((item) => item !== code))}>×</button>
            </span>
          ))}
        </p>
      )}
      <p className="adm-scan-hint">Si la prenda no trae código, dejalo vacío: el sistema genera uno para imprimir la etiqueta.</p>
      <form id="create-product-form" className="adm-form" onKeyDown={blockEnterSubmit} onSubmit={(event) => { void submit(event) }}>
        <ProductFieldsForm fields={fields} onChange={setFields} catalogs={catalogs} />
        <VariantBuilder catalogs={catalogs} state={builder} onChange={(next) => { changeBuilder(next) }} canCost={canCost} canPartners={canPartners} />
        {canImages && <PendingImages onChange={setPending} />}
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
  const canPartners = hasPermission(user, 'investment.read')
  const existing = new Set(product.variants.map((variant) => `${variant.sizeId}|${variant.colorId}`))
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const built = builderToInputs(builder, catalogs.sizes, catalogs.colors, existing, canCost, canPartners)

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
      <form id="add-variants-form" className="adm-form" onKeyDown={blockEnterSubmit} onSubmit={(event) => { void submit(event) }}>
        <VariantBuilder catalogs={catalogs} state={builder} onChange={setBuilder} canCost={canCost} canPartners={canPartners} existing={existing} />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
