import { useMemo, useState } from 'react'
import type { Catalogs } from './useCatalogs'
import { Swatch } from './ui'
import {
  combosOf, comboKey, draftOf, setDraft, toggleId, type BuilderState,
} from './variantBuilder'

type Props = {
  catalogs: Catalogs
  state: BuilderState
  onChange: (state: BuilderState) => void
  canCost: boolean
  /** Combinaciones talla|color que el producto ya tiene (no se pueden repetir). */
  existing?: Set<string>
}

/** Elige tallas y colores y arma la matriz talla × color con cantidades iniciales. */
export function VariantBuilder({ catalogs, state, onChange, canCost, existing }: Props) {
  const [groupId, setGroupId] = useState('')
  const [colorFilter, setColorFilter] = useState('')
  const [bulkQty, setBulkQty] = useState('')
  const [bulkCost, setBulkCost] = useState('')
  const taken = existing ?? new Set<string>()

  const visibleSizes = useMemo(
    () => catalogs.sizes.filter((size) => !groupId || size.sizeGroupId === groupId),
    [catalogs.sizes, groupId],
  )
  const visibleColors = useMemo(() => {
    const term = colorFilter.trim().toLocaleLowerCase('es')
    return catalogs.colors.filter((color) => !term || color.name.toLocaleLowerCase('es').includes(term) || state.colorIds.includes(color.id))
  }, [catalogs.colors, colorFilter, state.colorIds])

  const chosenSizes = catalogs.sizes.filter((size) => state.sizeIds.includes(size.id))
  const chosenColors = catalogs.colors.filter((color) => state.colorIds.includes(color.id))
  const combos = combosOf(state, catalogs.sizes, catalogs.colors)
  const newCombos = combos.filter((combo) => !taken.has(combo.key))
  const allVisibleSizesOn = visibleSizes.length > 0 && visibleSizes.every((size) => state.sizeIds.includes(size.id))

  function applyBulk(field: 'qty' | 'cost', value: string) {
    let next = state
    for (const combo of newCombos) next = setDraft(next, combo.key, { [field]: value })
    onChange(next)
  }

  return (
    <div className="adm-form">
      <fieldset className="adm-section">
        <legend>Tallas</legend>
        <div className="adm-toolbar" style={{ marginBottom: 8 }}>
          <label className="adm-field-inline">
            <span>Grupo de tallas</span>
            <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">Todos los grupos</option>
              {catalogs.sizeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </label>
          <button
            type="button" className="link-button"
            onClick={() => {
              const ids = visibleSizes.map((size) => size.id)
              onChange({ ...state, sizeIds: allVisibleSizesOn ? state.sizeIds.filter((id) => !ids.includes(id)) : Array.from(new Set([...state.sizeIds, ...ids])) })
            }}
          >{allVisibleSizesOn ? 'Quitar las del grupo' : 'Elegir todas las del grupo'}</button>
        </div>
        {visibleSizes.length === 0 && <p className="adm-muted">No hay tallas activas en este grupo.</p>}
        <div className="adm-chips">
          {visibleSizes.map((size) => (
            <label key={size.id} className={state.sizeIds.includes(size.id) ? 'adm-chip on' : 'adm-chip'}>
              <input type="checkbox" checked={state.sizeIds.includes(size.id)} onChange={(event) => onChange({ ...state, sizeIds: toggleId(state.sizeIds, size.id, event.target.checked) })} />
              {size.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="adm-section">
        <legend>Colores</legend>
        <div className="adm-toolbar" style={{ marginBottom: 8 }}>
          <input type="search" className="grow" placeholder="Buscar color" aria-label="Buscar color" value={colorFilter} onChange={(event) => setColorFilter(event.target.value)} />
        </div>
        {catalogs.colors.length === 0 && <p className="adm-muted">No hay colores activos. Creá colores en Catálogos.</p>}
        <div className="adm-chips">
          {visibleColors.map((color) => (
            <label key={color.id} className={state.colorIds.includes(color.id) ? 'adm-chip on' : 'adm-chip'}>
              <input type="checkbox" checked={state.colorIds.includes(color.id)} onChange={(event) => onChange({ ...state, colorIds: toggleId(state.colorIds, color.id, event.target.checked) })} />
              {color.swatchHex && <Swatch hex={color.swatchHex} />}
              {color.name}
            </label>
          ))}
        </div>
      </fieldset>

      {chosenSizes.length > 0 && chosenColors.length > 0 ? (
        <fieldset className="adm-section">
          <legend>Cantidad inicial por talla y color ({newCombos.length} variante{newCombos.length === 1 ? '' : 's'})</legend>
          <div className="adm-toolbar" style={{ marginBottom: 8 }}>
            <label className="adm-field-inline">
              <span>Cantidad a todas</span>
              <input type="number" min={0} step={1} value={bulkQty} onChange={(event) => setBulkQty(event.target.value)} style={{ width: 110 }} />
            </label>
            <button type="button" className="secondary-button" onClick={() => applyBulk('qty', bulkQty)}>Aplicar</button>
            {canCost && (
              <>
                <label className="adm-field-inline">
                  <span>Costo a todas</span>
                  <input type="number" min={0} step="0.01" value={bulkCost} onChange={(event) => setBulkCost(event.target.value)} style={{ width: 110 }} />
                </label>
                <button type="button" className="secondary-button" onClick={() => applyBulk('cost', bulkCost)}>Aplicar</button>
              </>
            )}
          </div>
          <div className="adm-matrix">
            <table aria-label="Matriz de tallas y colores">
              <thead>
                <tr>
                  <th className="row-head" scope="col"><span className="visually-hidden">Talla</span></th>
                  {chosenColors.map((color) => <th key={color.id} scope="col">{color.swatchHex && <Swatch hex={color.swatchHex} />} {color.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {chosenSizes.map((size) => (
                  <tr key={size.id}>
                    <th scope="row" className="row-head">{size.name}</th>
                    {chosenColors.map((color) => {
                      const key = comboKey(size.id, color.id)
                      const draft = draftOf(state, key)
                      const exists = taken.has(key)
                      return (
                        <td key={color.id}>
                          <input
                            type="number" min={0} step={1}
                            className={draft.qty && Number(draft.qty) > 0 ? 'filled' : undefined}
                            value={exists ? '' : draft.qty}
                            disabled={exists}
                            placeholder={exists ? 'ya existe' : '0'}
                            aria-label={`Cantidad talla ${size.name} color ${color.name}`}
                            onChange={(event) => onChange(setDraft(state, key, { qty: event.target.value }))}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: '.82rem', fontWeight: 800 }}>Precio especial{canCost ? ', costo' : ''} y código de barras por variante (opcional)</summary>
            <p className="adm-help">Dejá el precio especial vacío para usar el precio base. Si dejás el código vacío, el sistema genera uno (EAN-13 interno que empieza en 20).</p>
            <div className="table-scroll">
              <table className="adm-table">
                <thead><tr><th>Talla</th><th>Color</th><th>Precio especial</th>{canCost && <th>Costo</th>}<th>Código de barras</th></tr></thead>
                <tbody>
                  {newCombos.map((combo) => {
                    const draft = draftOf(state, combo.key)
                    const label = `${combo.size.name} ${combo.color.name}`
                    return (
                      <tr key={combo.key}>
                        <td>{combo.size.name}</td>
                        <td>{combo.color.name}</td>
                        <td><input type="number" min={0} step="0.01" value={draft.price} aria-label={`Precio especial ${label}`} onChange={(event) => onChange(setDraft(state, combo.key, { price: event.target.value }))} /></td>
                        {canCost && <td><input type="number" min={0} step="0.01" value={draft.cost} aria-label={`Costo ${label}`} onChange={(event) => onChange(setDraft(state, combo.key, { cost: event.target.value }))} /></td>}
                        <td><input type="text" value={draft.barcode} aria-label={`Código de barras ${label}`} onChange={(event) => onChange(setDraft(state, combo.key, { barcode: event.target.value }))} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </fieldset>
      ) : (
        <p className="adm-muted">Elegí al menos una talla y un color para armar la matriz de variantes.</p>
      )}
    </div>
  )
}
