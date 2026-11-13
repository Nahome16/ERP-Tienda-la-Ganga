import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import type { Lot, Partner, ProductDetail, Variant } from '../lib/apiTypes'
import { hasPermission } from '../lib/access'
import { formatNio } from '../lib/money'
import { parseDecimal } from './csv'
import type { CurrentUser } from '../types'
import { addVariant, adjustInventory, applyProductCost, updateProduct, updateVariant } from './adminApi'
import { blockEnterSubmit } from './forms'
import { listLots, listPartners, lotWithPartner, updateLot } from './investmentApi'
import { ProductFieldsForm } from './ProductDialogs'
import { describeError, useCatalogsWithNewColors, validateFields, type ProductFields } from './productForm'
import { Dialog, Notice, Swatch } from './ui'
import type { Catalogs } from './useCatalogs'
import { VariantBuilder } from './VariantBuilder'
import { builderToInputs, emptyBuilder, type BuilderState } from './variantBuilderLogic'

type VariantDraft = { barcode: string; price: string; cost: string; isActive: boolean }

const draftOfVariant = (variant: Variant): VariantDraft => ({
  barcode: variant.barcode,
  price: variant.priceOverride === null ? '' : String(variant.priceOverride),
  cost: variant.cost === null || variant.cost === undefined ? '' : String(variant.cost),
  isActive: variant.isActive,
})

const sameDraft = (a: VariantDraft, b: VariantDraft) =>
  a.barcode.trim() === b.barcode.trim() && a.price.trim() === b.price.trim() && a.cost.trim() === b.cost.trim() && a.isActive === b.isActive

/**
 * «Editar producto» con la ficha completa, igual que el alta: datos y códigos, precio de venta,
 * las tallas y colores que ya tiene (código, precio especial, costo, activa), agregar tallas o
 * colores nuevos con su existencia, y el socio de las unidades. Un solo «Guardar cambios» aplica
 * todo en orden y solo lo que cambió.
 */
export function ProductFullEditDialog({ product, catalogs: baseCatalogs, user, onClose, onSaved, onPartial }: {
  product: ProductDetail
  catalogs: Catalogs
  user: CurrentUser
  onClose: () => void
  onSaved: (text: string) => void
  /** Se guardó una parte y otra falló: el padre recarga la ficha. */
  onPartial: () => void
}) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canAdjust = hasPermission(user, 'inventory.adjust')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const canPartnersRead = hasPermission(user, 'investment.read')
  const canPartnersManage = hasPermission(user, 'investment.manage')
  const canCreateCatalogs = hasPermission(user, 'catalog.manage')
  const { catalogs, add: addCatalog, addColor } = useCatalogsWithNewColors(baseCatalogs)

  const initialFields: ProductFields = {
    name: product.name, categoryId: product.categoryId, brandId: product.brandId, cutId: product.cutId ?? '',
    basePrice: product.basePrice > 0 ? String(product.basePrice) : '', barcode: product.barcode ?? '', referenceCode: product.referenceCode ?? '',
  }
  const [fields, setFields] = useState<ProductFields>(initialFields)
  const initialDrafts = Object.fromEntries(product.variants.map((variant) => [variant.id, draftOfVariant(variant)]))
  const [drafts, setDrafts] = useState<Record<string, VariantDraft>>(initialDrafts)
  // Existencia corregida por talla y color (vacío = sin cambio) y el motivo, que queda en el Kardex.
  const [stockEdits, setStockEdits] = useState<Record<string, string>>({})
  const [stockReason, setStockReason] = useState('Corrección de ingreso: se ingresó de más')
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder)
  // Costo para todas las tallas y colores (y su existencia). Vacío = no cambiar.
  const [allCost, setAllCost] = useState('')
  const [overwriteLots, setOverwriteLots] = useState(false)
  const applyingCost = canCost && allCost.trim() !== ''
  const [showAdd, setShowAdd] = useState(false)

  // Socio de las unidades (se guarda en cada entrada de mercadería).
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [partnerId, setPartnerId] = useState('')
  const [partnerScope, setPartnerScope] = useState<'unassigned' | 'all'>('unassigned')

  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!canPartnersManage) return
    const controller = new AbortController()
    Promise.all([
      listLots({ partner: '', search: product.name, onlyWithStock: false, range: { from: '', to: '' }, page: 1, pageSize: 100 }, controller.signal),
      listPartners('active', controller.signal),
    ])
      .then(([page, active]) => {
        const own = page.items.filter((lot) => lot.productId === product.id)
        setLots(own)
        setPartners(active)
        if (!own.some((lot) => !lot.partnerId)) setPartnerScope('all')
      })
      .catch(() => { if (!controller.signal.aborted) setLots([]) })
    return () => controller.abort()
  }, [canPartnersManage, product.id, product.name])

  const existing = new Set(product.variants.map((variant) => `${variant.sizeId}|${variant.colorId}`))
  const built = builderToInputs(builder, catalogs.sizes, catalogs.colors, existing, canCost, canPartnersRead)
  const fieldsChanged = JSON.stringify(fields) !== JSON.stringify(initialFields)
  // Con «costo para todas», el costo de cada fila no se manda aparte: lo pone ese costo.
  const comparable = (draft: VariantDraft, initial: VariantDraft) => applyingCost ? { ...draft, cost: initial.cost } : draft
  const changedVariants = product.variants.filter((variant) => drafts[variant.id] && !sameDraft(comparable(drafts[variant.id]!, initialDrafts[variant.id]!), initialDrafts[variant.id]!))
  const unassignedLots = lots?.filter((lot) => !lot.partnerId) ?? []
  const partnerTargets = !partnerId ? [] : partnerScope === 'unassigned' ? unassignedLots : lots ?? []
  const stockChanges = product.variants
    .map((variant) => ({ variant, target: stockEdits[variant.id] }))
    .filter((item): item is { variant: Variant; target: string } => item.target !== undefined && item.target.trim() !== '' && Number(item.target) !== item.variant.stock)
  const pending = (fieldsChanged ? 1 : 0) + changedVariants.length + built.inputs.length + (partnerTargets.length > 0 ? 1 : 0) + (applyingCost ? 1 : 0) + stockChanges.length

  function setDraft(id: string, patch: Partial<VariantDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id]!, ...patch } }))
  }

  /** Revisa todo antes de mandar nada: si algo está mal, no se guarda nada. */
  function validate(): string | null {
    const { error: fieldError } = validateFields(fields)
    if (fieldError) return fieldError
    for (const variant of changedVariants) {
      const draft = drafts[variant.id]!
      const label = `${variant.sizeName} · ${variant.colorName}`
      if (!draft.barcode.trim()) return `${label}: el código de barras no puede quedar vacío.`
      const price = draft.price.trim() === '' ? null : parseDecimal(draft.price)
      if (draft.price.trim() !== '' && (price === null || price <= 0)) return `${label}: el precio especial debe ser mayor que cero (o dejalo vacío para usar el precio base).`
      const cost = draft.cost.trim() === '' ? null : parseDecimal(draft.cost)
      if (canCost && draft.cost.trim() !== '' && (cost === null || cost < 0)) return `${label}: el costo no es válido.`
    }
    if (applyingCost) {
      const cost = parseDecimal(allCost)
      if (cost === null || cost < 0) return 'El costo para todas las tallas no es válido.'
    }
    for (const { variant, target } of stockChanges) {
      const value = Number(target)
      if (!Number.isInteger(value) || value < 0) return `${variant.sizeName} · ${variant.colorName}: la existencia debe ser un número entero (0 o más).`
    }
    if (stockChanges.length > 0 && stockReason.trim().length < 3) return 'Escribí el motivo del cambio de existencia (queda en el Kardex).'
    if (built.errors.length > 0) return built.errors[0]!
    if (built.totalUnits > 0 && !canInitial) return 'Tu cuenta no puede registrar existencia inicial: dejá vacías las cantidades de las tallas nuevas.'
    return null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (pending === 0) { setError('No hay cambios para guardar.'); return }
    const problem = validate()
    if (problem) { setError(problem); return }

    setSaving(true)
    const done: string[] = []
    try {
      if (fieldsChanged) {
        setStep('Guardando los datos del producto…')
        const { input } = validateFields(fields)
        await updateProduct(product, { ...input!, isActive: product.isActive })
        done.push('datos del producto')
      }
      for (const [index, variant] of changedVariants.entries()) {
        setStep(`Guardando tallas y colores (${index + 1}/${changedVariants.length})…`)
        const draft = drafts[variant.id]!
        const cost = draft.cost.trim() === '' ? null : parseDecimal(draft.cost)
        await updateVariant(variant, {
          barcode: draft.barcode.trim(),
          priceOverride: draft.price.trim() === '' ? null : parseDecimal(draft.price),
          isActive: draft.isActive,
          ...(canCost && !applyingCost ? { cost } : {}),
        })
      }
      if (changedVariants.length > 0) done.push(`${changedVariants.length} talla(s)/color(es)`)
      for (const [index, input] of built.inputs.entries()) {
        setStep(`Agregando tallas y colores nuevos (${index + 1}/${built.inputs.length})…`)
        await addVariant(product.id, input)
      }
      if (built.inputs.length > 0) done.push(`${built.inputs.length} variante(s) nueva(s)`)
      for (const [index, { variant, target }] of stockChanges.entries()) {
        setStep(`Corrigiendo existencias (${index + 1}/${stockChanges.length})…`)
        const delta = Number(target) - variant.stock
        // Bajar = corrección de ingreso (se descuenta de la entrada, no es pérdida); subir = ajuste.
        await adjustInventory({ variantId: variant.id, kind: delta < 0 ? 'Correction' : 'Adjustment', delta, reason: stockReason.trim() })
      }
      if (stockChanges.length > 0) done.push(`existencia de ${stockChanges.length} talla(s)/color(es)`)
      if (applyingCost) {
        setStep('Poniendo el costo a todas las tallas y su existencia…')
        const result = await applyProductCost(product.id, parseDecimal(allCost)!, overwriteLots)
        done.push(`costo en ${result.variants} talla(s)/color(es) y ${result.units} unidad(es) en existencia`)
      }
      if (partnerTargets.length > 0) {
        setStep('Asignando el socio…')
        for (const lot of partnerTargets) await updateLot(lot.id, lotWithPartner(lot, partnerId))
        done.push(`socio en ${partnerTargets.length} entrada(s)`)
      }
      onSaved(`Se guardaron los cambios: ${done.join(', ')}.`)
    } catch (caught) {
      const conflict = caught instanceof ApiError && caught.code === 'version_conflict'
      const text = conflict ? 'Otra persona cambió este producto mientras lo editabas.' : describeError(caught)
      setError(done.length > 0
        ? `${text} Ya se guardó: ${done.join(', ')}. Cerrá y volvé a abrir la ficha para seguir con lo que falta.`
        : `${text} No se guardó nada.`)
      if (done.length > 0 || conflict) onPartial()
      setSaving(false)
      setStep('')
    }
  }

  const sortedVariants = [...product.variants].sort((a, b) => a.colorName.localeCompare(b.colorName, 'es') || a.sizeName.localeCompare(b.sizeName, 'es', { numeric: true }))
  const basePrice = parseDecimal(fields.basePrice || '0') ?? 0

  return (
    <Dialog
      wide
      title="Editar producto"
      subtitle={product.name}
      onClose={saving ? () => undefined : onClose}
      footer={(
        <>
          {step && <span className="adm-help" role="status">{step}</span>}
          <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="submit" form="full-edit-form" className="primary-button" disabled={saving || pending === 0}>
            {saving ? 'Guardando…' : pending === 0 ? 'Sin cambios' : 'Guardar cambios'}
          </button>
        </>
      )}
    >
      <form id="full-edit-form" className="adm-form" onKeyDown={blockEnterSubmit} onSubmit={(event) => { void submit(event) }}>
        <h3 className="adm-step"><span>1</span>Datos, códigos y precio de venta</h3>
        <ProductFieldsForm
          fields={fields} onChange={setFields} catalogs={catalogs}
          extraCategory={{ id: product.categoryId, name: product.categoryName }}
          extraBrand={{ id: product.brandId, name: product.brandName }}
          onCatalogCreated={canCreateCatalogs ? (list, item) => addCatalog(list, item) : undefined}
        />
        {canCost && (
          <div className="adm-allcost">
            <label className="adm-field">
              <span>Costo para todas las tallas (C$)</span>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={allCost} placeholder="Vacío = no cambiar" onChange={(event) => setAllCost(event.target.value)} />
              <small>Se aplica a todas las tallas y colores y a la mercadería que ya está en existencia.</small>
            </label>
            <label className="adm-check">
              <input type="checkbox" checked={overwriteLots} disabled={!applyingCost} onChange={(event) => setOverwriteLots(event.target.checked)} />
              <span>Reemplazar también el costo de entradas que ya tenían costo<small>Si no lo marcás, solo se completa lo que no tenía costo.</small></span>
            </label>
          </div>
        )}

        <h3 className="adm-step"><span>2</span>Tallas y colores que ya tiene</h3>
        <p className="adm-help">Precio especial vacío = usa el precio base{basePrice > 0 ? ` (${formatNio(basePrice)})` : ''}. Para cambiar un color, agregá el color nuevo abajo y desactivá el anterior.</p>
        <div className="table-scroll">
          <table className="adm-table adm-edit-grid">
            <thead>
              <tr>
                <th>Color</th><th>Talla</th><th>Código de barras</th><th className="numeric">Precio especial</th>
                {canCost && <th className="numeric">Costo</th>}
                <th className="numeric">Existencia</th><th>Activa</th>
              </tr>
            </thead>
            <tbody>
              {sortedVariants.map((variant) => {
                const draft = drafts[variant.id]!
                const dirty = !sameDraft(draft, initialDrafts[variant.id]!) || stockChanges.some((item) => item.variant.id === variant.id)
                return (
                  <tr key={variant.id} className={dirty ? 'is-dirty' : undefined}>
                    <td><span className="adm-inline"><Swatch hex={variant.colorHex} /> {variant.colorName}</span></td>
                    <td>{variant.sizeName}</td>
                    <td><input className="adm-mono" value={draft.barcode} aria-label={`Código ${variant.sizeName} ${variant.colorName}`} onChange={(event) => setDraft(variant.id, { barcode: event.target.value })} /></td>
                    <td className="numeric"><input type="number" min={0} step="0.01" value={draft.price} placeholder={basePrice > 0 ? String(basePrice) : 'Base'} aria-label={`Precio especial ${variant.sizeName} ${variant.colorName}`} onChange={(event) => setDraft(variant.id, { price: event.target.value })} /></td>
                    {canCost && <td className="numeric"><input type="number" min={0} step="0.01" value={applyingCost ? allCost : draft.cost} disabled={applyingCost} placeholder="—" aria-label={`Costo ${variant.sizeName} ${variant.colorName}`} onChange={(event) => setDraft(variant.id, { cost: event.target.value })} /></td>}
                    <td className="numeric">
                      {canAdjust
                        ? <input
                            type="number" step={1} inputMode="numeric" className="adm-stock-input" value={stockEdits[variant.id] ?? String(variant.stock)}
                            aria-label={`Existencia ${variant.sizeName} ${variant.colorName}`}
                            onChange={(event) => setStockEdits((current) => ({ ...current, [variant.id]: event.target.value }))}
                          />
                        : variant.stock}
                    </td>
                    <td><input type="checkbox" checked={draft.isActive} aria-label={`Activa ${variant.sizeName} ${variant.colorName}`} onChange={(event) => setDraft(variant.id, { isActive: event.target.checked })} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {stockChanges.length > 0 && (
          <div className="adm-stock-change" role="status">
            <ul>
              {stockChanges.map(({ variant, target }) => {
                const delta = Number(target) - variant.stock
                return <li key={variant.id}><b>{variant.sizeName} · {variant.colorName}</b>: {variant.stock} → {target} ({delta > 0 ? `+${delta}` : delta}){delta < 0 ? ' · corrección de ingreso' : ' · ajuste'}</li>
              })}
            </ul>
            <label className="adm-field">
              <span>Motivo del cambio de existencia</span>
              <input value={stockReason} maxLength={500} onChange={(event) => setStockReason(event.target.value)} />
              <small>Queda en el Kardex. Bajar la existencia descuenta de la última entrada (no cuenta como pérdida).</small>
            </label>
          </div>
        )}

        <h3 className="adm-step"><span>3</span>Agregar tallas o colores</h3>
        {!showAdd
          ? <button type="button" className="secondary-button" style={{ width: 'fit-content' }} onClick={() => setShowAdd(true)}>+ Agregar tallas o colores nuevos</button>
          : (
            <VariantBuilder
              catalogs={catalogs} state={builder} onChange={setBuilder} canCost={canCost} canPartners={canPartnersRead} existing={existing}
              onColorCreated={canCreateCatalogs ? addColor : undefined}
              onSizesCreated={canCreateCatalogs ? (group, sizes) => { if (group) addCatalog('sizeGroups', group); sizes.forEach((size) => addCatalog('sizes', size)) } : undefined}
            />
          )}

        {canPartnersManage && (
          <>
            <h3 className="adm-step"><span>4</span>Socio de la mercadería</h3>
            {lots === null && <p className="adm-help">Cargando entradas…</p>}
            {lots !== null && lots.length === 0 && <p className="adm-help">Todavía no tiene entradas de mercadería: el socio se elige al cargar existencia.</p>}
            {lots !== null && lots.length > 0 && (
              <div className="adm-grid-2">
                <label className="adm-field">
                  <span>Socio</span>
                  <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
                    <option value="">No cambiar</option>
                    {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
                  </select>
                  <small>{unassignedLots.length > 0 ? `${unassignedLots.length} de ${lots.length} entrada(s) sin socio.` : 'Todas las entradas ya tienen socio.'}</small>
                </label>
                <fieldset className="adm-scan-modes">
                  <legend>¿A qué entradas?</legend>
                  <label><input type="radio" name="full-partner-scope" checked={partnerScope === 'unassigned'} disabled={unassignedLots.length === 0} onChange={() => setPartnerScope('unassigned')} /> Solo las que no tienen socio ({unassignedLots.length})</label>
                  <label><input type="radio" name="full-partner-scope" checked={partnerScope === 'all'} onChange={() => setPartnerScope('all')} /> Todas ({lots.length})</label>
                </fieldset>
              </div>
            )}
          </>
        )}

        {pending > 0 && !error && <p className="adm-help">Cambios por guardar: {[fieldsChanged && 'datos del producto', applyingCost && 'costo para todas las tallas', stockChanges.length > 0 && `existencia de ${stockChanges.length} talla(s)/color(es)`, changedVariants.length > 0 && `${changedVariants.length} talla(s)/color(es)`, built.inputs.length > 0 && `${built.inputs.length} variante(s) nueva(s)`, partnerTargets.length > 0 && `socio en ${partnerTargets.length} entrada(s)`].filter(Boolean).join(', ')}.</p>}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
