import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatNio } from '../lib/money'
import { Barcode } from './Barcode'
import { normalizeBarcode } from './ean13'
import { Dialog, Notice } from './ui'

export type LabelVariant = {
  variantId: string
  productName: string
  sizeName: string
  colorName: string
  barcode: string
  price: number
  stock: number
}

type LabelItemProps = { variant: LabelVariant; widthMm: number; heightMm: number; screen?: boolean }

function LabelItem({ variant, widthMm, heightMm, screen }: LabelItemProps) {
  return (
    <div className={screen ? 'label-item screen' : 'label-item'} style={{ width: `${widthMm}mm`, height: `${heightMm}mm` }}>
      <div className="label-name">{variant.productName}</div>
      <div className="label-variant">Talla {variant.sizeName} · {variant.colorName}</div>
      <div className="label-barcode"><Barcode code={variant.barcode} /></div>
      <div className="label-price">{formatNio(variant.price)}</div>
    </div>
  )
}

const maxLabels = 1000
type Layout = 'roll' | 'sheet'

function readStored(key: string, fallback: number) {
  try {
    const value = Number(window.localStorage.getItem(key))
    return Number.isFinite(value) && value >= 15 && value <= 200 ? value : fallback
  } catch { return fallback }
}

function storeValue(key: string, value: number) {
  try { window.localStorage.setItem(key, String(value)) } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Imprime etiquetas de código de barras de las variantes elegidas con el cuadro de impresión del navegador. */
export function LabelsDialog({ title, variants, onClose }: { title: string; variants: LabelVariant[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(variants.map((variant) => [variant.variantId, true])))
  const [copies, setCopies] = useState<Record<string, string>>(() => Object.fromEntries(variants.map((variant) => [variant.variantId, '1'])))
  const [widthMm, setWidthMm] = useState(() => readStored('la-ganga-label-w', 50))
  const [heightMm, setHeightMm] = useState(() => readStored('la-ganga-label-h', 30))
  const [layout, setLayout] = useState<Layout>('roll')

  useEffect(() => () => document.body.classList.remove('printing-labels'), [])

  const queue = useMemo(() => {
    const items: LabelVariant[] = []
    for (const variant of variants) {
      if (!selected[variant.variantId]) continue
      const count = Math.max(0, Math.min(Math.floor(Number(copies[variant.variantId]) || 0), maxLabels))
      for (let index = 0; index < count; index += 1) items.push(variant)
    }
    return items
  }, [variants, selected, copies])

  const unreadable = variants.filter((variant) => selected[variant.variantId] && !normalizeBarcode(variant.barcode))
  const tooMany = queue.length > maxLabels
  const preview = variants.find((variant) => selected[variant.variantId])

  function print() {
    if (queue.length === 0 || tooMany) return
    storeValue('la-ganga-label-w', widthMm)
    storeValue('la-ganga-label-h', heightMm)
    const style = document.createElement('style')
    style.textContent = layout === 'roll'
      ? `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; } body.printing-labels .label-item { break-after: page; page-break-after: always; }`
      : '@page { size: A4; margin: 8mm; }'
    document.head.appendChild(style)
    document.body.classList.add('printing-labels')
    const cleanup = () => {
      document.body.classList.remove('printing-labels')
      style.remove()
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  function setAllCopies(mode: 'one' | 'stock') {
    setCopies(Object.fromEntries(variants.map((variant) => [variant.variantId, String(mode === 'one' ? 1 : Math.max(variant.stock, 1))])))
  }

  const allSelected = variants.every((variant) => selected[variant.variantId])

  return (
    <Dialog
      wide
      title="Imprimir etiquetas"
      subtitle={title}
      onClose={onClose}
      footer={(
        <>
          <span className="adm-muted" style={{ marginRight: 'auto', alignSelf: 'center', fontSize: '.8rem' }}>{queue.length} etiqueta{queue.length === 1 ? '' : 's'} para imprimir</span>
          <button type="button" className="secondary-button" onClick={onClose}>Cerrar</button>
          <button type="button" className="primary-button" onClick={print} disabled={queue.length === 0 || tooMany}>Imprimir etiquetas</button>
        </>
      )}
    >
      <div className="adm-columns">
        <section>
          <div className="adm-actions" style={{ marginBottom: 8 }}>
            <button type="button" className="link-button" onClick={() => setSelected(Object.fromEntries(variants.map((variant) => [variant.variantId, !allSelected])))}>
              {allSelected ? 'Quitar todas' : 'Elegir todas'}
            </button>
            <button type="button" className="link-button" onClick={() => setAllCopies('one')}>1 copia cada una</button>
            <button type="button" className="link-button" onClick={() => setAllCopies('stock')}>Copias = existencia</button>
          </div>
          <div className="table-scroll" style={{ maxHeight: 340, overflowY: 'auto' }}>
            <table className="adm-table">
              <thead><tr><th><span className="visually-hidden">Elegir</span></th><th>Variante</th><th>Código</th><th className="numeric">Exist.</th><th className="numeric">Copias</th></tr></thead>
              <tbody>
                {variants.map((variant) => (
                  <tr key={variant.variantId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[variant.variantId])}
                        onChange={(event) => setSelected({ ...selected, [variant.variantId]: event.target.checked })}
                        aria-label={`Elegir ${variant.productName} ${variant.sizeName} ${variant.colorName}`}
                      />
                    </td>
                    <td>{variant.sizeName} · {variant.colorName}</td>
                    <td className="adm-mono">{variant.barcode}</td>
                    <td className="numeric">{variant.stock}</td>
                    <td className="numeric">
                      <input
                        type="number" min={0} max={maxLabels} step={1}
                        value={copies[variant.variantId] ?? '1'}
                        onChange={(event) => setCopies({ ...copies, [variant.variantId]: event.target.value })}
                        aria-label={`Copias de ${variant.sizeName} ${variant.colorName}`}
                        style={{ width: 76 }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="adm-form">
          <div className="adm-grid-3">
            <label className="adm-field">
              <span>Ancho (mm)</span>
              <input type="number" min={20} max={200} value={widthMm} onChange={(event) => setWidthMm(Number(event.target.value) || 50)} />
            </label>
            <label className="adm-field">
              <span>Alto (mm)</span>
              <input type="number" min={15} max={200} value={heightMm} onChange={(event) => setHeightMm(Number(event.target.value) || 30)} />
            </label>
            <label className="adm-field">
              <span>Papel</span>
              <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
                <option value="roll">Rollo (1 por página)</option>
                <option value="sheet">Hoja A4</option>
              </select>
            </label>
          </div>
          <p className="adm-help">Medida de cada etiqueta: {widthMm} × {heightMm} mm. En el cuadro de impresión desactivá «Encabezados y pies de página» y elegí la impresora de etiquetas.</p>
          {unreadable.length > 0 && (
            <Notice tone="warn">
              {unreadable.length} variante{unreadable.length === 1 ? '' : 's'} tiene{unreadable.length === 1 ? '' : 'n'} un código que no es EAN-13/EAN-8 válido; la etiqueta sale sin barras. Editá el código de la variante o dejalo vacío para que el sistema genere uno.
            </Notice>
          )}
          {tooMany && <Notice tone="error">Máximo {maxLabels} etiquetas por impresión.</Notice>}
          <div>
            <strong style={{ fontSize: '.78rem' }}>Vista previa</strong>
            <div className="adm-preview-label">
              {preview ? <LabelItem variant={preview} widthMm={widthMm} heightMm={heightMm} screen /> : <p className="adm-muted">Elegí al menos una variante.</p>}
            </div>
          </div>
        </section>
      </div>
      {createPortal(
        <div className="labels-print-root">
          <div className="label-sheet">
            {queue.map((variant, index) => <LabelItem key={`${variant.variantId}-${index}`} variant={variant} widthMm={widthMm} heightMm={heightMm} />)}
          </div>
        </div>,
        document.body,
      )}
    </Dialog>
  )
}
