import { useState } from 'react'
import { createCatalogItem, type CatalogItem } from '../lib/catalogApi'
import { clothingPalette, isLightHex, normalizeColorName, suggestColorHex } from '../lib/colorPalette'
import { messageFrom } from './format'

/** Cuadrícula de la paleta + selector libre + código #RRGGBB. */
export function ColorPicker({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const valid = /^#[0-9a-f]{6}$/i.test(value)
  return (
    <div className="color-picker">
      <div className="color-picker-grid" role="radiogroup" aria-label="Paleta de colores">
        {clothingPalette.map((color) => {
          const selected = valid && value.toUpperCase() === color.hex
          return (
            <button
              key={color.hex + color.name} type="button" role="radio" aria-checked={selected} title={`${color.name} ${color.hex}`}
              aria-label={color.name}
              className={`color-picker-dot${selected ? ' is-selected' : ''}${isLightHex(color.hex) ? ' is-light' : ''}`}
              style={{ background: color.hex }}
              onClick={() => onChange(color.hex)}
            />
          )
        })}
      </div>
      <div className="swatch-input">
        <input
          type="color" value={valid ? value : '#000000'} aria-label="Elegir otro tono"
          onChange={(event) => onChange(event.target.value.toUpperCase())}
        />
        <input value={value} placeholder="#RRGGBB" maxLength={7} aria-label="Código de color" onChange={(event) => onChange(event.target.value)} />
        {value && <button type="button" className="link-button" onClick={() => onChange('')}>Quitar</button>}
      </div>
    </div>
  )
}

/**
 * Crea un color del catálogo sin salir del alta del producto: un clic en un
 * color de la paleta que todavía no existe, o un nombre propio con su tono.
 */
export function NewColorPanel({ existing, onCreated, onCancel }: {
  existing: CatalogItem[]
  onCreated: (color: CatalogItem) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [hex, setHex] = useState('')
  const [touchedHex, setTouchedHex] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const taken = new Set(existing.map((color) => normalizeColorName(color.name)))
  const missing = clothingPalette.filter((color) => !taken.has(normalizeColorName(color.name)))

  async function create(colorName: string, swatchHex: string | null) {
    const clean = colorName.trim()
    if (!clean) { setError('Escribí el nombre del color.'); return }
    if (taken.has(normalizeColorName(clean))) { setError(`«${clean}» ya existe: marcalo en la lista de colores.`); return }
    if (swatchHex && !/^#[0-9a-f]{6}$/i.test(swatchHex)) { setError('El tono debe tener el formato #RRGGBB.'); return }
    setSaving(true)
    setError(null)
    try {
      onCreated(await createCatalogItem('colors', { name: clean, swatchHex: swatchHex ? swatchHex.toUpperCase() : null }))
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="new-color-panel">
      {missing.length > 0 && (
        <>
          <p className="adm-help" style={{ margin: 0 }}>Colores comunes que todavía no están en tu lista (un clic lo crea y lo marca):</p>
          <div className="new-color-quick">
            {missing.map((color) => (
              <button key={color.name} type="button" className="adm-chip" disabled={saving} onClick={() => { void create(color.name, color.hex) }}>
                <i className={`adm-swatch${isLightHex(color.hex) ? ' is-light' : ''}`} style={{ background: color.hex }} aria-hidden="true" />{color.name}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="new-color-custom">
        <label className="adm-field">
          <span>Otro color: nombre</span>
          <input
            value={name} maxLength={60} placeholder="Ej.: Verde jade"
            onChange={(event) => {
              setName(event.target.value)
              // Mientras no se elija un tono a mano, se sugiere el del nombre.
              if (!touchedHex) setHex(suggestColorHex(event.target.value) ?? '')
            }}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void create(name, hex || null) } }}
          />
        </label>
        <div className="adm-field">
          <span>Tono</span>
          <ColorPicker value={hex} onChange={(next) => { setTouchedHex(true); setHex(next) }} />
        </div>
      </div>
      {error && <p className="adm-notice error" role="alert">{error}</p>}
      <div className="new-color-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>Cerrar</button>
        <button type="button" className="primary-button" onClick={() => { void create(name, hex || null) }} disabled={saving || !name.trim()}>{saving ? 'Creando…' : 'Crear y marcar color'}</button>
      </div>
    </div>
  )
}
