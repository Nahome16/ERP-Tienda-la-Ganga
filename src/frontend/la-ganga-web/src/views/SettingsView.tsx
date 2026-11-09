import { useState, type FormEvent } from 'react'
import { hasPermission } from '../lib/access'
import type { StoreSettings } from '../lib/apiTypes'
import type { CurrentUser } from '../types'
import { getSettings, putSettings } from '../admin/adminApi'
import { parseDecimal } from '../admin/csv'
import { messageFrom } from '../admin/format'
import { useFetch } from '../admin/hooks'
import { LoadError, Notice, Spinner } from '../admin/ui'

type Form = {
  usdRate: string; storeName: string; storeAddress: string; storePhone: string; receiptFooter: string
  banks: string[]; sellerDiscountLimitPercent: string; lowStockThreshold: string
}

function toForm(settings: StoreSettings): Form {
  return {
    usdRate: String(settings.usdRate), storeName: settings.storeName, storeAddress: settings.storeAddress,
    storePhone: settings.storePhone, receiptFooter: settings.receiptFooter, banks: [...settings.banks],
    sellerDiscountLimitPercent: String(settings.sellerDiscountLimitPercent), lowStockThreshold: String(settings.lowStockThreshold),
  }
}

function validate(form: Form): { value: StoreSettings | null; errors: Record<string, string> } {
  const errors: Record<string, string> = {}
  const usdRate = parseDecimal(form.usdRate)
  if (usdRate === null || usdRate <= 0) errors.usdRate = 'La tasa debe ser un número mayor que cero.'
  if (!form.storeName.trim()) errors.storeName = 'Escribí el nombre de la tienda.'
  const discount = parseDecimal(form.sellerDiscountLimitPercent)
  if (discount === null || discount < 0 || discount > 100) errors.sellerDiscountLimitPercent = 'Debe estar entre 0 y 100.'
  const low = parseDecimal(form.lowStockThreshold)
  if (low === null || !Number.isInteger(low) || low < 0) errors.lowStockThreshold = 'Debe ser un número entero, cero o mayor.'
  if (Object.keys(errors).length > 0) return { value: null, errors }
  return {
    errors,
    value: {
      usdRate: usdRate as number, storeName: form.storeName.trim(), storeAddress: form.storeAddress.trim(), storePhone: form.storePhone.trim(),
      receiptFooter: form.receiptFooter.trim(), banks: form.banks,
      sellerDiscountLimitPercent: discount as number, lowStockThreshold: low as number,
    },
  }
}

function SettingsForm({ initial, canManage }: { initial: StoreSettings; canManage: boolean }) {
  const [form, setForm] = useState<Form>(() => toForm(initial))
  const [original, setOriginal] = useState<string>(() => JSON.stringify(toForm(initial)))
  const [newBank, setNewBank] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const dirty = JSON.stringify(form) !== original

  function update(patch: Partial<Form>) {
    setForm((current) => ({ ...current, ...patch }))
    setNotice(null)
  }

  function addBank() {
    const name = newBank.trim()
    if (!name) return
    if (form.banks.some((bank) => bank.toLocaleLowerCase('es') === name.toLocaleLowerCase('es'))) {
      setNotice({ tone: 'error', text: `«${name}» ya está en la lista.` })
      return
    }
    update({ banks: [...form.banks, name] })
    setNewBank('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const { value, errors: found } = validate(form)
    setErrors(found)
    if (!value) { setNotice({ tone: 'error', text: 'Revisá los campos marcados.' }); return }
    setSaving(true)
    try {
      const saved = await putSettings(value)
      setForm(toForm(saved)); setOriginal(JSON.stringify(toForm(saved)))
      setNotice({ tone: 'ok', text: 'Configuración guardada. El punto de venta la toma al actualizar sus datos.' })
    } catch (caught) {
      setNotice({ tone: 'error', text: messageFrom(caught) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    <form className="adm-form" onSubmit={(event) => { void submit(event) }} noValidate>
      <div className="adm-columns">
        <section className="panel-card adm-card adm-form">
          <h2 className="adm-card-title">Moneda y reglas de venta</h2>
          <label className="adm-field">
            <span>Tasa del dólar (C$ por US$)</span>
            <input type="number" step="0.01" min={0} value={form.usdRate} disabled={!canManage} onChange={(event) => update({ usdRate: event.target.value })} aria-invalid={Boolean(errors.usdRate)} />
            {errors.usdRate ? <small className="err">{errors.usdRate}</small> : <small>Se usa en el POS para pagos en dólares. Las ventas con otra tasa quedan por revisar.</small>}
          </label>
          <label className="adm-field">
            <span>Límite de descuento del vendedor (%)</span>
            <input type="number" step="0.01" min={0} max={100} value={form.sellerDiscountLimitPercent} disabled={!canManage} onChange={(event) => update({ sellerDiscountLimitPercent: event.target.value })} aria-invalid={Boolean(errors.sellerDiscountLimitPercent)} />
            {errors.sellerDiscountLimitPercent ? <small className="err">{errors.sellerDiscountLimitPercent}</small> : <small>Descuentos mayores piden la autorización de un administrador.</small>}
          </label>
          <label className="adm-field">
            <span>Umbral de stock bajo (unidades)</span>
            <input type="number" step={1} min={0} value={form.lowStockThreshold} disabled={!canManage} onChange={(event) => update({ lowStockThreshold: event.target.value })} aria-invalid={Boolean(errors.lowStockThreshold)} />
            {errors.lowStockThreshold ? <small className="err">{errors.lowStockThreshold}</small> : <small>Una variante con esta cantidad o menos se marca como bajo stock.</small>}
          </label>
        </section>

        <section className="panel-card adm-card adm-form">
          <h2 className="adm-card-title">Datos del recibo</h2>
          <label className="adm-field">
            <span>Nombre de la tienda</span>
            <input value={form.storeName} maxLength={120} disabled={!canManage} onChange={(event) => update({ storeName: event.target.value })} aria-invalid={Boolean(errors.storeName)} />
            {errors.storeName && <small className="err">{errors.storeName}</small>}
          </label>
          <label className="adm-field">
            <span>Dirección</span>
            <input value={form.storeAddress} maxLength={200} disabled={!canManage} onChange={(event) => update({ storeAddress: event.target.value })} />
          </label>
          <label className="adm-field">
            <span>Teléfono</span>
            <input value={form.storePhone} maxLength={40} disabled={!canManage} onChange={(event) => update({ storePhone: event.target.value })} />
          </label>
          <label className="adm-field">
            <span>Pie del recibo</span>
            <input value={form.receiptFooter} maxLength={200} disabled={!canManage} placeholder="Ej.: Cambios en 7 días con recibo y etiqueta" onChange={(event) => update({ receiptFooter: event.target.value })} />
          </label>
        </section>
      </div>

      <section className="panel-card adm-card">
        <h2 className="adm-card-title">Bancos para transferencias</h2>
        <div className="adm-chips" style={{ marginBottom: 10 }}>
          {form.banks.length === 0 && <span className="adm-muted">Todavía no hay bancos.</span>}
          {form.banks.map((bank) => (
            <span key={bank} className="adm-chip removable on">
              {bank}
              {canManage && <button type="button" onClick={() => update({ banks: form.banks.filter((item) => item !== bank) })} aria-label={`Quitar ${bank}`}>×</button>}
            </span>
          ))}
        </div>
        {canManage && (
          <div className="adm-toolbar">
            <input
              type="text" className="grow" placeholder="Nombre del banco (ej. BAC, Lafise, Banpro)" aria-label="Nuevo banco"
              value={newBank} onChange={(event) => setNewBank(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addBank() } }}
            />
            <button type="button" className="secondary-button" onClick={addBank} disabled={!newBank.trim()}>Agregar banco</button>
          </div>
        )}
      </section>

      {canManage && (
        <div className="adm-actions">
          <button type="submit" className="primary-button" disabled={saving || !dirty}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
          {dirty && <button type="button" className="secondary-button" onClick={() => setForm(JSON.parse(original) as Form)} disabled={saving}>Descartar</button>}
          {dirty && <span className="adm-muted">Hay cambios sin guardar.</span>}
        </div>
      )}
    </form>
    </>
  )
}

export function SettingsView({ user, onOpenCatalogs }: { user: CurrentUser; onOpenCatalogs: () => void }) {
  const canManage = hasPermission(user, 'settings.manage')
  const { data, error, loading, reload } = useFetch<StoreSettings>('settings', (signal) => getSettings(signal))
  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Administración · <b className="live-data">Datos reales</b></p>
          <h1>Configuración</h1>
          <p className="page-summary">Tasa de cambio, datos del recibo, bancos y reglas del punto de venta.</p>
        </div>
        <div className="page-actions">
          <button className="secondary-button" type="button" onClick={onOpenCatalogs}>Catálogos</button>
          {hasPermission(user, 'user.manage') && <a className="secondary-button" href="#equipo" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Equipo</a>}
        </div>
      </header>

      {loading && !data && <Spinner label="Cargando configuración…" />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && <SettingsForm initial={data} canManage={canManage} />}
    </main>
  )
}
