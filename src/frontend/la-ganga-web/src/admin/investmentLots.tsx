import { useId, useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import type { Lot, Partner } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { formatDate, formatInt, formatTime, messageFrom } from './format'
import { useDebounced, useFetch } from './hooks'
import {
  listLots, lotWithPartner, moneyToField, noPartner, parseMoneyField, sourceLabel, updateLot,
  type InvRange, type PartnerFilter,
} from './investmentApi'
import { MoneyOrDash } from './investmentUi'
import { Dialog, LoadError, Notice, Pagination, Spinner, Tag } from './ui'

const pageSize = 25

/** Opciones de socio para un selector: «Sin socio», los activos y, si hace falta, el socio actual aunque esté inactivo. */
function partnerOptions(partners: Partner[], currentId: string | null) {
  return partners
    .filter((partner) => partner.isActive || partner.id === currentId)
    .map((partner) => ({ id: partner.id, label: partner.isActive ? partner.name : `${partner.name} (inactivo)` }))
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const details = Object.values(error.fieldErrors).flat()
    return details.length > 0 ? `${error.message} ${details.join(' ')}` : error.message
  }
  return messageFrom(error)
}

/** Tabla de entradas de mercadería (lotes) con filtros, paginación y acciones de edición. */
export function LotsPanel({ partner, onPartnerChange, partners, range, rev, canManage, onChanged, ariaLabel }: {
  partner: PartnerFilter
  /** Si se pasa, se muestra el selector de socio (incluye «Sin socio»). */
  onPartnerChange?: (partner: PartnerFilter) => void
  partners: Partner[]
  range: InvRange
  rev: number
  canManage: boolean
  onChanged: () => void
  ariaLabel: string
}) {
  const [search, setSearch] = useState('')
  const [onlyWithStock, setOnlyWithStock] = useState(false)
  const debounced = useDebounced(search.trim(), 300)
  const filtersKey = `${partner}|${debounced}|${onlyWithStock}|${range.from}|${range.to}`
  const [pageState, setPageState] = useState({ key: filtersKey, page: 1 })
  const page = pageState.key === filtersKey ? pageState.page : 1
  const [editing, setEditing] = useState<Lot | null>(null)
  const [bulk, setBulk] = useState<Lot[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<string | null>(null)

  const { data, error, loading, reload } = useFetch(
    `lots|${filtersKey}|${page}|${rev}`,
    (signal) => listLots({ partner, search: debounced, onlyWithStock, range, page, pageSize }, signal),
  )

  const showPartnerColumn = partner === '' || onPartnerChange !== undefined
  const selectable = canManage && partner === noPartner
  const items = useMemo(() => data?.items ?? [], [data])
  const selectedLots = items.filter((lot) => selected.has(lot.id))
  const allSelected = items.length > 0 && selectedLots.length === items.length

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const columns = 12 + (showPartnerColumn ? 1 : 0) + (selectable ? 1 : 0) + (canManage ? 1 : 0)

  return (
    <div className="inv-lots">
      <div className="adm-toolbar">
        {onPartnerChange && (
          <label className="adm-field-inline">
            <span>Socio</span>
            <select value={partner} onChange={(event) => { onPartnerChange(event.target.value); setSelected(new Set()) }}>
              <option value="">Todos los socios</option>
              <option value={noPartner}>Sin socio</option>
              {partners.map((item) => <option key={item.id} value={item.id}>{item.isActive ? item.name : `${item.name} (inactivo)`}</option>)}
            </select>
          </label>
        )}
        <label className="adm-field-inline grow">
          <span>Buscar</span>
          <input type="search" value={search} placeholder="Producto o código de barras" maxLength={80} onChange={(event) => { setSearch(event.target.value); setSelected(new Set()) }} />
        </label>
        <label className="adm-check">
          <input type="checkbox" checked={onlyWithStock} onChange={(event) => { setOnlyWithStock(event.target.checked); setSelected(new Set()) }} />
          Solo con existencias
        </label>
        {selectable && (
          <button type="button" className="primary-button" disabled={selectedLots.length === 0} onClick={() => setBulk(selectedLots)}>
            Asignar socio a las seleccionadas ({selectedLots.length})
          </button>
        )}
      </div>

      {selectable && (
        <p className="adm-help">Marcá las entradas «Sin socio» que querés asignar (por ejemplo el saldo inicial) y elegí el socio una sola vez. Si querés cambiar también el costo o el precio, usá «Editar» en cada fila.</p>
      )}
      {flash && <Notice tone="ok"><span>{flash}</span></Notice>}
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Cargando entradas…" />}

      {data && (
        <>
          <div className="table-scroll" aria-busy={loading}>
            <table className="adm-table inv-table" aria-label={ariaLabel}>
              <thead>
                <tr>
                  {selectable && (
                    <th className="inv-check-col">
                      <input type="checkbox" aria-label="Seleccionar todas las entradas de esta página" checked={allSelected}
                        onChange={(event) => setSelected(event.target.checked ? new Set(items.map((lot) => lot.id)) : new Set())} />
                    </th>
                  )}
                  <th>Fecha</th>
                  <th>Ingresó</th>
                  <th>Origen</th>
                  {showPartnerColumn && <th>Socio</th>}
                  <th>Producto</th>
                  <th className="numeric">Ingresadas</th>
                  <th className="numeric">Quedan</th>
                  <th className="numeric">Vendidas</th>
                  <th className="numeric">Pérdidas</th>
                  <th className="numeric">Costo unit.</th>
                  <th className="numeric">Precio dado</th>
                  <th className="numeric">Precio actual</th>
                  <th className="numeric">Inversión</th>
                  {canManage && <th className="actions-col"><span className="visually-hidden">Acciones</span></th>}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={columns} className="adm-empty">
                    {debounced || onlyWithStock || partner !== '' ? 'Ninguna entrada coincide con los filtros.' : 'Todavía no hay entradas de mercadería registradas.'}
                  </td></tr>
                )}
                {items.map((lot) => {
                  const noCost = lot.unitCost === null
                  const priceChanged = lot.unitPrice !== null && lot.unitPrice !== lot.currentPrice
                  return (
                    <tr key={lot.id} className={noCost ? 'inv-nocost' : undefined}>
                      {selectable && (
                        <td className="inv-check-col">
                          <input type="checkbox" aria-label={`Seleccionar ${lot.productName} ${lot.sizeName} ${lot.colorName}`} checked={selected.has(lot.id)} onChange={() => toggle(lot.id)} />
                        </td>
                      )}
                      <td className="nowrap">{formatDate(lot.enteredAtUtc)}<small className="row-sub">{formatTime(lot.enteredAtUtc)}</small></td>
                      <td>{lot.enteredByName || '—'}</td>
                      <td>
                        {sourceLabel(lot.source)}
                        {lot.note && <small className="row-sub" title={lot.note}>{lot.note}</small>}
                      </td>
                      {showPartnerColumn && <td>{lot.partnerId === null ? <Tag tone="warn">{lot.partnerName}</Tag> : lot.partnerName}</td>}
                      <td>
                        <span className="row-title">{lot.productName}</span>
                        <small className="row-sub">{lot.sizeName} · {lot.colorName} · <span className="adm-mono">{lot.barcode}</span></small>
                      </td>
                      <td className="numeric">{formatInt(lot.quantityIn)}</td>
                      <td className="numeric"><strong>{formatInt(lot.quantityRemaining)}</strong></td>
                      <td className="numeric">{formatInt(lot.quantitySold)}</td>
                      <td className="numeric">{lot.quantityLost > 0 ? <span className="adm-neg">{formatInt(lot.quantityLost)}</span> : '0'}</td>
                      <td className="numeric">
                        <MoneyOrDash value={lot.unitCost} />
                        {noCost && <small className="row-sub inv-warn">Sin costo</small>}
                      </td>
                      <td className="numeric"><MoneyOrDash value={lot.unitPrice} /></td>
                      <td className="numeric">
                        {formatNio(lot.currentPrice)}
                        {priceChanged && <small className="row-sub" title="El precio de venta de hoy es distinto al que se dio al ingresar la mercadería.">cambió</small>}
                      </td>
                      <td className="numeric">{noCost ? <MoneyOrDash value={null} /> : formatNio(lot.investedNio)}</td>
                      {canManage && (
                        <td className="actions-col">
                          <button type="button" className="link-button" onClick={() => { setFlash(null); setEditing(lot) }} aria-label={`Editar entrada de ${lot.productName} ${lot.sizeName} ${lot.colorName}`}>Editar</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} noun={data.totalCount === 1 ? 'entrada' : 'entradas'}
            onPage={(next) => { setPageState({ key: filtersKey, page: next }); setSelected(new Set()) }} />
        </>
      )}

      {editing && (
        <LotDialog
          lot={editing}
          partners={partners}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setFlash('Guardamos los cambios de la entrada. Quedó registrado en la auditoría.'); onChanged() }}
        />
      )}
      {bulk && (
        <BulkAssignDialog
          lots={bulk}
          partners={partners}
          onClose={() => setBulk(null)}
          onDone={(count) => { setBulk(null); setSelected(new Set()); setFlash(`Asignamos el socio a ${count} entrada${count === 1 ? '' : 's'}.`); onChanged() }}
          onPartial={onChanged}
        />
      )}
    </div>
  )
}

/** Edita socio, costo, precio dado y nota de una entrada (el cambio corrige todo su historial). */
export function LotDialog({ lot, partners, onClose, onSaved }: { lot: Lot; partners: Partner[]; onClose: () => void; onSaved: () => void }) {
  const id = useId()
  const [partnerId, setPartnerId] = useState(lot.partnerId ?? '')
  const [cost, setCost] = useState(moneyToField(lot.unitCost))
  const [price, setPrice] = useState(moneyToField(lot.unitPrice))
  const [note, setNote] = useState(lot.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errors, setErrors] = useState<{ cost?: string; price?: string }>({})
  const options = partnerOptions(partners, lot.partnerId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const parsedCost = parseMoneyField(cost)
    const parsedPrice = parseMoneyField(price)
    const next: { cost?: string; price?: string } = {}
    if (parsedCost === 'invalid') next.cost = 'Escribí un monto válido, por ejemplo 380 o 380.50.'
    if (parsedPrice === 'invalid') next.price = 'Escribí un monto válido, por ejemplo 650 o 650.00.'
    setErrors(next)
    if (parsedCost === 'invalid' || parsedPrice === 'invalid') return
    setBusy(true)
    setError(null)
    try {
      await updateLot(lot.id, { partnerId: partnerId || null, unitCost: parsedCost, unitPrice: parsedPrice, note: note.trim() || null })
      onSaved()
    } catch (caught) {
      setError(describeError(caught))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title="Editar entrada de mercadería"
      subtitle={`${lot.productName} · ${lot.sizeName} · ${lot.colorName} · ${sourceLabel(lot.source)} del ${formatDate(lot.enteredAtUtc)}`}
      onClose={busy ? () => undefined : onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form={`${id}-form`} className="primary-button" disabled={busy} aria-busy={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </>
      )}
    >
      <form id={`${id}-form`} className="adm-form" onSubmit={(event) => void submit(event)} noValidate>
        <Notice tone="info">
          <span>El cambio corrige <b>todo el historial</b> de esta entrada: las ventas y pérdidas que ya salieron de ella se recalculan con el nuevo socio y costo. Queda registrado en la auditoría.</span>
        </Notice>
        <p className="adm-help inv-lot-facts">
          Ingresaron {formatInt(lot.quantityIn)} · vendidas {formatInt(lot.quantitySold)} · pérdidas {formatInt(lot.quantityLost)} · quedan {formatInt(lot.quantityRemaining)}. Precio de venta actual {formatNio(lot.currentPrice)}.
        </p>
        <label className="adm-field">
          <span>Socio</span>
          <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} data-autofocus>
            <option value="">Sin socio</option>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <small>Quién aportó o invirtió en esta mercadería.</small>
        </label>
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>Costo unitario (C$)</span>
            <input inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} aria-invalid={errors.cost ? true : undefined} aria-describedby={`${id}-cost`} placeholder="Sin costo" />
            <small id={`${id}-cost`} className={errors.cost ? 'err' : undefined}>{errors.cost ?? 'Vacío = sin costo: la ganancia de lo vendido quedará como parcial.'}</small>
          </label>
          <label className="adm-field">
            <span>Precio dado (C$)</span>
            <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} aria-invalid={errors.price ? true : undefined} aria-describedby={`${id}-price`} placeholder="Sin precio" />
            <small id={`${id}-price`} className={errors.price ? 'err' : undefined}>{errors.price ?? 'El precio que se le dio al ingresarla; el precio de venta actual no cambia.'}</small>
          </label>
        </div>
        <label className="adm-field">
          <span>Nota (opcional)</span>
          <textarea value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <Notice tone="error"><span>{error}</span></Notice>}
      </form>
    </Dialog>
  )
}

/** Asigna un mismo socio a varias entradas, una por una, conservando costo, precio y nota. */
function BulkAssignDialog({ lots, partners, onClose, onDone, onPartial }: {
  lots: Lot[]; partners: Partner[]; onClose: () => void; onDone: (count: number) => void; onPartial: () => void
}) {
  const id = useId()
  const [partnerId, setPartnerId] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [failures, setFailures] = useState<string[]>([])
  const active = partners.filter((partner) => partner.isActive)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!partnerId) return
    setBusy(true)
    setFailures([])
    setProgress(0)
    const problems: string[] = []
    let done = 0
    for (const lot of lots) {
      try {
        await updateLot(lot.id, lotWithPartner(lot, partnerId))
        done += 1
      } catch (caught) {
        problems.push(`${lot.productName} ${lot.sizeName} ${lot.colorName}: ${describeError(caught)}`)
      }
      setProgress(done + problems.length)
    }
    if (problems.length === 0) { onDone(done); return }
    setFailures(problems)
    setBusy(false)
    onPartial()
  }

  return (
    <Dialog
      title="Asignar socio a las entradas"
      subtitle={`${lots.length} entrada${lots.length === 1 ? '' : 's'} sin socio seleccionada${lots.length === 1 ? '' : 's'}`}
      onClose={busy ? () => undefined : onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>{failures.length > 0 ? 'Cerrar' : 'Cancelar'}</button>
          <button type="submit" form={`${id}-form`} className="primary-button" disabled={busy || !partnerId || failures.length > 0} aria-busy={busy}>
            {busy ? `Asignando ${progress} de ${lots.length}…` : 'Asignar socio'}
          </button>
        </>
      )}
    >
      <form id={`${id}-form`} className="adm-form" onSubmit={(event) => void submit(event)}>
        <Notice tone="info"><span>Se corrige todo el historial de estas entradas (ventas y pérdidas incluidas) y queda en la auditoría. El costo, el precio y la nota de cada una no cambian.</span></Notice>
        <label className="adm-field">
          <span>Socio</span>
          <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required data-autofocus>
            <option value="">Elegí un socio</option>
            {active.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
          </select>
          {active.length === 0 && <small className="err">No hay socios activos. Creá uno en «Gestionar socios».</small>}
        </label>
        {failures.length > 0 && (
          <Notice tone="error">
            <div>
              <b>No pudimos asignar {failures.length} entrada{failures.length === 1 ? '' : 's'}:</b>
              <ul className="inv-failures">{failures.map((text) => <li key={text}>{text}</li>)}</ul>
            </div>
          </Notice>
        )}
      </form>
    </Dialog>
  )
}
