import { useRef, useState, type FormEvent } from 'react'
import { QuickCreate } from './QuickCreate'
import type { CatalogItem } from '../lib/catalogApi'
import { ScanBarcode } from 'lucide-react'
import { ScanResult } from './ScanResult'
import { ApiError } from '../lib/api'
import type { CurrentUser } from '../types'
import { hasPermission } from '../lib/access'
import type { ProductDetail, ProductListItem, Variant } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { addVariant, createProduct, getProductByBarcode, getVariantByBarcode, updateProduct, updateVariant } from './adminApi'
import { parseDecimal } from './csv'
import { blockEnterSubmit } from './forms'
import { addDays, managuaToday } from './format'
import { PendingImages } from './ImageManager'
import { uploadPendingImages, type UploadReport } from './imageApi'
import { Dialog, Notice, Swatch } from './ui'
import type { Catalogs } from './useCatalogs'
import { categoryOptions } from './useCatalogs'
import { VariantBuilder } from './VariantBuilder'
import { assignScannedBarcodes, builderToInputs, combosOf, draftBarcodes, emptyBuilder, withDefaultCost, type BuilderState } from './variantBuilderLogic'
import { PartnerSelect, PartnersHint } from './PartnerSelect'
import { usePartners } from './usePartners'
import { describeError, useCatalogsWithNewColors, validateFields, type ProductFields } from './productForm'

type ScanMessage = { tone: 'ok' | 'warn' | 'error'; text: string; productId?: string; code?: string }



export function ProductFieldsForm({ fields, onChange, catalogs, extraCategory, extraBrand, hidePrice = false, hideBarcode = false, onCatalogCreated }: {
  fields: ProductFields
  /** Con permiso de catálogos: crear marca, categoría o corte al momento. */
  onCatalogCreated?: (list: 'brands' | 'cuts' | 'categories', item: CatalogItem) => void
  /** El alta pide el precio de venta al final, en «Ingreso». */
  hidePrice?: boolean
  /** El sistema genera el código: no se pide el de fábrica. */
  hideBarcode?: boolean
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
        <div className="adm-field">
          <span>Categoría</span>
          <select aria-label="Categoría" value={fields.categoryId} required onChange={(event) => onChange({ ...fields, categoryId: event.target.value })}>
            <option value="">Elegí una categoría</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          {onCatalogCreated && (
            <QuickCreate
              kind="categories" label="categoría"
              parents={categoryOptions(catalogs.categories).map((item) => ({ id: item.id, label: item.label }))}
              onCreated={(item) => { onCatalogCreated('categories', item); onChange({ ...fields, categoryId: item.id }) }}
            />
          )}
        </div>
        <div className="adm-field">
          <span>Marca</span>
          <select aria-label="Marca" value={fields.brandId} required onChange={(event) => onChange({ ...fields, brandId: event.target.value })}>
            <option value="">Elegí una marca</option>
            {brandOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {onCatalogCreated && <QuickCreate kind="brands" label="marca" onCreated={(item) => { onCatalogCreated('brands', item); onChange({ ...fields, brandId: item.id }) }} />}
        </div>
        <div className="adm-field">
          <span>Corte (opcional)</span>
          <select aria-label="Corte" value={fields.cutId} onChange={(event) => onChange({ ...fields, cutId: event.target.value })}>
            <option value="">Sin corte</option>
            {catalogs.cuts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          {onCatalogCreated && <QuickCreate kind="cuts" label="corte" masculine onCreated={(item) => { onCatalogCreated('cuts', item); onChange({ ...fields, cutId: item.id }) }} />}
        </div>
        {!hideBarcode && <label className="adm-field">
          <span>Código de fábrica (opcional)</span>
          <input
            value={fields.barcode} maxLength={64} inputMode="text" autoComplete="off" placeholder="Igual para todas las tallas"
            onChange={(event) => onChange({ ...fields, barcode: event.target.value })}
          />
          <small>Al escanearlo en caja se abre el producto y se elige la talla.</small>
        </label>}
        <label className="adm-field">
          <span>Cód. ref. del proveedor (opcional)</span>
          <input
            value={fields.referenceCode} maxLength={64} autoComplete="off" placeholder="El código con el que te factura"
            onChange={(event) => onChange({ ...fields, referenceCode: event.target.value })}
          />
          <small>Queda ligado a este producto: sirve para buscarlo y cuadrar con la factura.</small>
        </label>
        {!hidePrice && (
          <label className="adm-field">
            <span>Precio de venta (C$)</span>
            <input type="number" min={0} step="0.01" value={fields.basePrice} placeholder="Vacío = poner después" onChange={(event) => onChange({ ...fields, basePrice: event.target.value })} />
            {Number(fields.basePrice || 0) === 0 && <small className="adm-warn-text">Sin precio no se puede vender en caja.</small>}
          </label>
        )}
      </div>
    </>
  )
}

/** ¿A quién pertenece un código? A una talla de un producto, a un producto entero o a nadie (null). */
async function findCodeOwner(code: string): Promise<{ productId?: string; label: string } | null> {
  try {
    const variant = await getVariantByBarcode(code)
    return { productId: variant.productId ?? undefined, label: `«${variant.productName}» (talla ${variant.sizeName} · ${variant.colorName})` }
  } catch (caught) {
    if (!(caught instanceof ApiError && caught.status === 404)) throw caught
  }
  try {
    const { product, colorId } = await getProductByBarcode(code)
    const color = colorId ? product.colorBarcodes?.find((item) => item.colorId === colorId)?.colorName : null
    return { productId: product.id, label: color ? `«${product.name}» (color ${color})` : `«${product.name}» (código del producto)` }
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 404) return null
    throw caught
  }
}

/** Alta de producto con su matriz de variantes. */
export function CreateProductDialog({ user, catalogs: baseCatalogs, onClose, onCreated, initialBarcode, onOpenExisting }: {
  user: CurrentUser; catalogs: Catalogs; onClose: () => void
  /** `images` solo viene si se eligieron fotos; `failed` lista las que no se pudieron subir. */
  onCreated: (product: ProductDetail, images?: UploadReport) => void
  /** Código escaneado que no existía: se asigna a la primera variante. */
  initialBarcode?: string
  /** Abre la ficha de un producto que ya tiene el código escaneado. */
  onOpenExisting?: (productId: string) => void
}) {
  const canImages = hasPermission(user, 'product.images.manage')
  const canCreateColors = hasPermission(user, 'catalog.manage')
  const { catalogs, add: addCatalog, addColor } = useCatalogsWithNewColors(baseCatalogs)
  const [pending, setPending] = useState<File[]>([])
  const [progress, setProgress] = useState<string | null>(null)
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const canPartners = hasPermission(user, 'investment.read')
  const [fields, setFields] = useState<ProductFields>({ name: '', categoryId: '', brandId: '', cutId: '', basePrice: '', barcode: initialBarcode?.trim() ?? '', referenceCode: '' })
  // Cómo vienen los códigos de fábrica: uno para todo el producto (lo más común), uno por color o uno por talla.
  const [codeMode, setCodeMode] = useState<'product' | 'color' | 'size' | 'generate'>('product')
  // Sin código de fábrica: generar uno por talla y color (recomendado) o uno para todo el producto.
  const [generateScope, setGenerateScope] = useState<'variant' | 'product'>('variant')
  const generating = codeMode === 'generate'
  const codePerSize = codeMode === 'size'
  // Códigos por color: colorId → código. Los escaneados sin color elegido esperan en `pendingColorCodes`.
  const [colorCodes, setColorCodes] = useState<Record<string, string>>({})
  const [pendingColorCodes, setPendingColorCodes] = useState<string[]>([])
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Códigos escaneados que esperan una variante (todavía no se eligió talla y color).
  const [pendingCodes, setPendingCodes] = useState<string[]>([])
  const [scan, setScan] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMessage, setScanMessage] = useState<ScanMessage | null>(
    initialBarcode?.trim() ? { tone: 'ok', text: `Código nuevo ${initialBarcode.trim()}: quedó como código del producto (sirve para todas las tallas). Completá los datos.` } : null,
  )
  const scanRef = useRef<HTMLInputElement>(null)

  // Sección «Ingreso»: costo general y fecha (el socio va en builder.partnerId).
  const [entryCost, setEntryCost] = useState('')
  const today = managuaToday()
  const [receivedOn, setReceivedOn] = useState(today)
  const partnerList = usePartners('active', canPartners)

  const combos = combosOf(builder, catalogs.sizes, catalogs.colors)
  const withCost = canCost ? withDefaultCost(builder, combos, entryCost) : builder
  const built = builderToInputs(withCost, catalogs.sizes, catalogs.colors, new Set(), canCost, canPartners)
  const needsInitialPermission = built.totalUnits > 0 && !canInitial

  /**
   * Cambia cómo vienen los códigos. El código ya escaneado como «de todo el producto» (por
   * ejemplo, al abrir el alta desde Inventario) pasa al primer color o a la primera talla,
   * para que no quede repetido en dos lugares.
   */
  function switchCodeMode(mode: 'product' | 'color' | 'size' | 'generate') {
    const productCode = fields.barcode.trim()
    if (mode === 'generate') {
      if (productCode || pendingCodes.length > 0 || Object.values(colorCodes).some((code) => code.trim())) {
        setScanMessage({ tone: 'warn', text: 'Se quitaron los códigos escaneados: al guardar, el sistema genera los códigos nuevos.' })
      }
      setFields({ ...fields, barcode: '' })
      setColorCodes({})
      setPendingColorCodes([])
      setPendingCodes([])
      setCodeMode(mode)
      return
    }
    if (mode !== 'product' && productCode) {
      setFields({ ...fields, barcode: '' })
      if (mode === 'color') {
        const target = builder.colorIds.find((colorId) => !colorCodes[colorId]?.trim())
        if (target) setColorCodes({ ...colorCodes, [target]: productCode })
        else setPendingColorCodes([productCode, ...pendingColorCodes])
        setScanMessage({ tone: 'ok', text: `El código ${productCode} pasó a ser el código del ${target ? 'primer color' : 'primer color que marques'}.` })
      } else {
        changeBuilder(builder, [productCode, ...pendingCodes])
        setScanMessage({ tone: 'ok', text: `El código ${productCode} pasó a la primera talla sin código.` })
      }
    }
    setCodeMode(mode)
  }

  /** Aplica el cambio del borrador y coloca los códigos escaneados que estaban esperando. */
  function changeBuilder(next: BuilderState, codes: string[] = pendingCodes) {
    if (pendingColorCodes.length > 0) {
      const queue = [...pendingColorCodes]
      const nextCodes = { ...colorCodes }
      for (const colorId of next.colorIds) {
        if (queue.length === 0) break
        if (!nextCodes[colorId]?.trim()) nextCodes[colorId] = queue.shift() as string
      }
      setColorCodes(nextCodes)
      setPendingColorCodes(queue)
    }
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
    if (pendingCodes.includes(code) || pendingColorCodes.includes(code) || Object.values(colorCodes).includes(code) || draftBarcodes(builder).has(code) || fields.barcode.trim() === code) {
      setScanMessage({ tone: 'warn', code, text: 'Ya lo escaneaste para este producto; no hace falta otra vez.' })
      return
    }
    setScanning(true)
    try {
      const owner = await findCodeOwner(code)
      if (owner) {
        setScanMessage({ tone: 'warn', code, productId: owner.productId, text: `Ya pertenece a ${owner.label}. Si es la misma prenda, abrí ese producto y agregale las tallas o la existencia ahí.` })
      } else if (codeMode === 'color') {
        const target = builder.colorIds.find((colorId) => !colorCodes[colorId]?.trim())
        if (target) {
          setColorCodes({ ...colorCodes, [target]: code })
          const colorName = catalogs.colors.find((color) => color.id === target)?.name ?? 'el color'
          setScanMessage({ tone: 'ok', code, text: `Quedó para el color ${colorName} (todas sus tallas).` })
        } else {
          setPendingColorCodes([...pendingColorCodes, code])
          setScanMessage({ tone: 'ok', code, text: 'Se asigna al próximo color que marques abajo.' })
        }
      } else if (!codePerSize) {
        const previous = fields.barcode.trim()
        setFields({ ...fields, barcode: code })
        setScanMessage({
          tone: 'ok', code,
          text: previous ? `Reemplazó al código anterior (${previous}). Sirve para todas las tallas.` : 'Quedó como código del producto: sirve para todas las tallas.',
        })
      } else {
        const placed = changeBuilder(builder, [...pendingCodes, code])
        setScanMessage({
          tone: 'ok', code,
          text: placed.leftover.includes(code)
            ? 'Se asigna cuando elijas talla y color abajo.'
            : 'Quedó en la siguiente talla sin código: revisalo en la tabla de cantidades.',
        })
      }
    } catch (caught) {
      setScanMessage({ tone: 'error', code, text: describeError(caught) })
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
    const productCode = fields.barcode.trim()
    const repeatedColor = productCode ? catalogs.colors.find((color) => builder.colorIds.includes(color.id) && colorCodes[color.id]?.trim() === productCode) : undefined
    if (repeatedColor) {
      setError(`El código ${productCode} está como código de todo el producto y también del color ${repeatedColor.name}. Dejalo en uno solo: borralo de «Código de fábrica» si cada color trae el suyo.`)
      return
    }
    const colorValues = builder.colorIds.map((colorId) => colorCodes[colorId]?.trim()).filter(Boolean)
    if (new Set(colorValues).size !== colorValues.length) {
      setError('Dos colores tienen el mismo código. Cada color debe tener uno distinto (si todos comparten el mismo, usá «Uno para todo el producto»).')
      return
    }
    if (pendingColorCodes.length > 0) {
      setError(`Hay códigos de color sin color (${pendingColorCodes.join(', ')}). Marcá más colores o quitalos.`)
      return
    }
    if (pendingCodes.length > 0) {
      setError(`Hay ${pendingCodes.length === 1 ? 'un código escaneado' : `${pendingCodes.length} códigos escaneados`} sin variante (${pendingCodes.join(', ')}). Agregá más tallas o colores, o quitalos.`)
      return
    }
    if (needsInitialPermission) { setError('Tu cuenta no puede registrar existencia inicial. Dejá las cantidades en cero.'); return }
    if (canCost && entryCost.trim() !== '' && (parseDecimal(entryCost) === null || (parseDecimal(entryCost) as number) < 0)) {
      setError('El costo por unidad no es válido.')
      return
    }
    if (built.totalUnits > 0 && (!receivedOn || receivedOn > today || receivedOn < addDays(today, -365))) {
      setError('La fecha de ingreso no puede ser futura ni de hace más de un año.')
      return
    }
    setSaving(true)
    let created: ProductDetail
    try {
      const colorBarcodes = builder.colorIds
        .map((colorId) => ({ colorId, barcode: colorCodes[colorId]?.trim() ?? '' }))
        .filter((item) => item.barcode)
      created = await createProduct(generating
        // Códigos generados por el sistema: no se manda ningún código de fábrica.
        ? {
            ...input, barcode: '', variants: built.inputs.map((variant) => ({ ...variant, barcode: null })),
            ...(built.totalUnits > 0 ? { receivedOn } : {}), generateProductBarcode: generateScope === 'product',
          }
        : {
            ...input, variants: built.inputs, ...(built.totalUnits > 0 ? { receivedOn } : {}),
            ...(colorBarcodes.length > 0 ? { colorBarcodes } : {}),
          })
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
      <h3 className="adm-step"><span>1</span>Producto</h3>
      {!generating && <form className="adm-scanzone" onSubmit={(event) => { void submitScan(event) }} role="search" onClick={() => scanRef.current?.focus()}>
        <div className="adm-scanzone-head">
          <span className="adm-scanzone-icon" aria-hidden="true"><ScanBarcode size={20} strokeWidth={1.75} /></span>
          <div>
            <strong>Escaneá la etiqueta de la prenda</strong>
            <small>Apuntá el lector al código de barras. Es opcional: si no trae código, el sistema genera uno.</small>
          </div>
          <span className={`adm-scanzone-status${scanning ? ' is-busy' : ''}`} aria-live="polite">
            <i aria-hidden="true" />
            {scanning ? 'Buscando…' : <><span className="when-ready">Listo para escanear</span><span className="when-idle">Tocá aquí para escanear</span></>}
          </span>
        </div>
        <div className="adm-scanzone-field">
          <input
            ref={scanRef} autoFocus value={scan} onChange={(event) => setScan(event.target.value)} inputMode="numeric" autoComplete="off"
            placeholder="Código de barras" aria-label="Escanear código de la prenda"
          />
          <button type="submit" className="primary-button" disabled={scanning || !scan.trim()}>{scanning ? 'Buscando…' : 'Agregar código'}</button>
        </div>
      </form>}
      {scanMessage && (
        <ScanResult
          message={scanMessage}
          onOpenExisting={scanMessage.productId && onOpenExisting ? () => onOpenExisting(scanMessage.productId as string) : undefined}
          onDismiss={() => { setScanMessage(null); scanRef.current?.focus() }}
        />
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
      <fieldset className="adm-scan-modes">
        <legend>¿Cómo viene el código de la prenda?</legend>
        <label><input type="radio" name="code-mode" checked={codeMode === 'product'} onChange={() => switchCodeMode('product')} /> Uno para todo el producto</label>
        <label><input type="radio" name="code-mode" checked={codeMode === 'color'} onChange={() => switchCodeMode('color')} /> Uno por color</label>
        <label><input type="radio" name="code-mode" checked={codeMode === 'size'} onChange={() => switchCodeMode('size')} /> Uno por talla</label>
        <label><input type="radio" name="code-mode" checked={generating} onChange={() => switchCodeMode('generate')} /> No tiene código: generar</label>
      </fieldset>
      {generating && (
        <fieldset className="adm-generate">
          <legend>¿Qué código genero?</legend>
          <label className={generateScope === 'variant' ? 'is-on' : undefined}>
            <input type="radio" name="generate-scope" checked={generateScope === 'variant'} onChange={() => setGenerateScope('variant')} />
            <span><b>Uno por talla y color</b> <em>(recomendado)</em><small>Al escanearlo en caja entra directo la talla y el color correctos.</small></span>
          </label>
          <label className={generateScope === 'product' ? 'is-on' : undefined}>
            <input type="radio" name="generate-scope" checked={generateScope === 'product'} onChange={() => setGenerateScope('product')} />
            <span><b>Uno para todo el producto</b><small>Una sola etiqueta para todas las prendas; en caja se elige la talla y el color.</small></span>
          </label>
          <p className="adm-help">Los códigos se crean al guardar y quedan en <b>Inventario → Etiquetas</b> para imprimirlos.</p>
        </fieldset>
      )}
      {pendingColorCodes.length > 0 && (
        <p className="adm-scan-pending">
          Códigos de color por asignar: {pendingColorCodes.map((code) => (
            <span key={code} className="adm-scan-chip">
              {code}
              <button type="button" aria-label={`Quitar ${code}`} onClick={() => setPendingColorCodes((current) => current.filter((item) => item !== code))}>×</button>
            </span>
          ))}
        </p>
      )}
      <form id="create-product-form" className="adm-form" onKeyDown={blockEnterSubmit} onSubmit={(event) => { void submit(event) }}>
        <ProductFieldsForm fields={fields} onChange={setFields} catalogs={catalogs} hidePrice hideBarcode={generating} onCatalogCreated={canCreateColors ? addCatalog : undefined} />

        <h3 className="adm-step"><span>2</span>Colores, tallas y cantidades</h3>
        <VariantBuilder
          catalogs={catalogs} state={builder} onChange={(next) => { changeBuilder(next) }} canCost={canCost} canPartners={canPartners} externalEntry
          onColorCreated={canCreateColors ? addColor : undefined}
          onSizesCreated={canCreateColors ? (group, sizes) => { if (group) addCatalog('sizeGroups', group); sizes.forEach((size) => addCatalog('sizes', size)) } : undefined}
        />
        {(codeMode === 'color' || Object.values(colorCodes).some((code) => code.trim())) && builder.colorIds.length > 0 && (
          <div className="adm-color-codes">
            <p className="adm-help" style={{ margin: 0 }}>Código de fábrica de cada color (lo comparten todas sus tallas). Escaneá en el campo de arriba o escribilo aquí.</p>
            {catalogs.colors.filter((color) => builder.colorIds.includes(color.id)).map((color) => (
              <label key={color.id} className="adm-color-code">
                <span><Swatch hex={color.swatchHex} name={color.name} /> {color.name}</span>
                <input
                  value={colorCodes[color.id] ?? ''} maxLength={64} autoComplete="off" placeholder="Sin código"
                  aria-label={`Código del color ${color.name}`}
                  onChange={(event) => setColorCodes({ ...colorCodes, [color.id]: event.target.value })}
                />
              </label>
            ))}
          </div>
        )}

        <h3 className="adm-step"><span>3</span>Ingreso: socio, costo y precio</h3>
        <div className="adm-grid-2">
          {canPartners && partnerList.partners.length > 0 && (
            <PartnerSelect
              partners={partnerList.partners} value={builder.partnerId} label="Socio que ingresa el producto"
              onChange={(partnerId) => setBuilder({ ...builder, partnerId })}
            />
          )}
          <label className="adm-field">
            <span>Fecha de ingreso</span>
            <input type="date" value={receivedOn} max={today} min={addDays(today, -365)} onChange={(event) => setReceivedOn(event.target.value)} />
          </label>
          {canCost && (
            <label className="adm-field">
              <span>Costo por unidad (C$)</span>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={entryCost} onChange={(event) => setEntryCost(event.target.value)} placeholder="Lo que costó cada prenda" />
            </label>
          )}
          <label className="adm-field">
            <span>Precio de venta (C$)</span>
            <input type="number" min={0} step="0.01" inputMode="decimal" value={fields.basePrice} placeholder="Opcional: ponelo después" onChange={(event) => setFields({ ...fields, basePrice: event.target.value })} />
            {fields.basePrice.trim() === '' && <small>Queda «precio pendiente»: no se vende hasta completarlo.</small>}
          </label>
        </div>
        {canPartners && <PartnersHint error={partnerList.error} empty={!partnerList.loading && !partnerList.error && partnerList.partners.length === 0} onRetry={partnerList.reload} />}
        <EntrySummary units={built.totalUnits} variants={built.inputs.length} cost={canCost ? parseDecimal(entryCost) : null} price={parseDecimal(fields.basePrice)} />
        <p className="adm-help">Si una talla o color tiene otro costo, precio o socio, cambialo en «Precio especial, costo… por variante» del paso 2.</p>

        {canImages && <h3 className="adm-step"><span>4</span>Fotos (opcional)</h3>}
        {canImages && <PendingImages onChange={setPending} />}
        {needsInitialPermission && <Notice tone="warn">Tu cuenta no tiene permiso para registrar existencia inicial: dejá las cantidades vacías.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}

/** Resumen del ingreso: unidades, inversión al costo y valor a precio de venta. */
function EntrySummary({ units, variants, cost, price }: { units: number; variants: number; cost: number | null; price: number | null }) {
  if (units === 0) return null
  return (
    <div className="adm-entry-summary" role="status">
      <div><span>Unidades</span><strong>{units}</strong><small>{variants} {variants === 1 ? 'variante' : 'variantes'}</small></div>
      {cost !== null && cost >= 0 && <div><span>Inversión al costo</span><strong>{formatNio(units * cost)}</strong></div>}
      {price !== null && price > 0 && <div><span>Valor a precio de venta</span><strong>{formatNio(units * price)}</strong></div>}
      {cost !== null && price !== null && price > 0 && cost >= 0 && <div><span>Ganancia esperada</span><strong>{formatNio(units * (price - cost))}</strong></div>}
    </div>
  )
}

/** Edita los datos del producto (nombre, categoría, marca, corte, precio base). */
export function EditProductDialog({ product, catalogs, onClose, onSaved, onConflict }: {
  product: ProductListItem; catalogs: Catalogs; onClose: () => void; onSaved: (product: ProductListItem) => void; onConflict: () => void
}) {
  const [fields, setFields] = useState<ProductFields>({
    name: product.name, categoryId: product.categoryId, brandId: product.brandId,
    cutId: product.cutId ?? '', basePrice: product.basePrice > 0 ? String(product.basePrice) : '', barcode: product.barcode ?? '',
    referenceCode: product.referenceCode ?? '',
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
export function AddVariantsDialog({ product, catalogs: baseCatalogs, user, onClose, onDone, onChanged }: {
  product: ProductDetail; catalogs: Catalogs; user: CurrentUser; onClose: () => void; onDone: () => void; onChanged: () => void
}) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const canPartners = hasPermission(user, 'investment.read')
  const { catalogs, add: addCatalog, addColor } = useCatalogsWithNewColors(baseCatalogs)
  const canCreateColors = hasPermission(user, 'catalog.manage')
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
        <VariantBuilder catalogs={catalogs} state={builder} onChange={setBuilder} canCost={canCost} canPartners={canPartners} existing={existing} onColorCreated={canCreateColors ? addColor : undefined}
          onSizesCreated={canCreateColors ? (group, sizes) => { if (group) addCatalog('sizeGroups', group); sizes.forEach((size) => addCatalog('sizes', size)) } : undefined} />
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
