import { useState, type ChangeEvent } from 'react'
import { hasPermission } from '../lib/access'
import type { ImportResult, ImportRow } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { importProducts } from './adminApi'
import { buildTemplateCsv, parseImportCsv, prepareImportRows, templateHeaders, templateHeadersWithPartner, type ParsedImport } from './csv'
import { messageFrom } from './format'
import { splitCreated } from './partners'
import { Dialog, Notice } from './ui'

const previewLimit = 60
const errorLimit = 200

function downloadTemplate(withPartner: boolean) {
  const blob = new Blob([buildTemplateCsv(withPartner)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'plantilla-productos-la-ganga.csv'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Lee el archivo como UTF-8 y, si no es válido (CSV de Excel «ANSI»), como Windows-1252. */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

type Phase = 'choose' | 'preview' | 'done'

/** «Se crearían N productos…» más, aparte, los socios y catálogos nuevos. */
function CreatedLists({ created, verb }: { created: string[]; verb: 'Catálogos nuevos' | 'Catálogos creados' }) {
  const { partners, catalogs } = splitCreated(created)
  return (
    <>
      {catalogs.length > 0 && <> {verb}: {catalogs.join(', ')}.</>}
      {partners.length > 0 && <> {verb === 'Catálogos nuevos' ? 'Socios nuevos' : 'Socios creados'}: {partners.join(', ')}.</>}
    </>
  )
}

export function ImportDialog({ user, onClose, onImported }: { user: CurrentUser; onClose: () => void; onImported: () => void }) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canInitial = hasPermission(user, 'inventory.initial.confirm')
  const canPartners = hasPermission(user, 'investment.read')
  const [phase, setPhase] = useState<Phase>('choose')
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [createMissing, setCreateMissing] = useState(false)
  const [createMissingPartners, setCreateMissingPartners] = useState(false)
  const [dryRun, setDryRun] = useState<ImportResult | null>(null)
  const [final, setFinal] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const rows: ImportRow[] = prepareImportRows(parsed, { canCost, canPartners })
  const showPartner = canPartners && Boolean(parsed?.hasPartnerColumn)
  const hasLocalErrors = Boolean(parsed && (parsed.errors.length > 0 || parsed.fileErrors.length > 0))
  const needsInitialPermission = !canInitial && rows.some((row) => row.quantity > 0)

  const partnerOption = (value: boolean) => (canPartners ? { createMissingPartners: value } : {})

  async function validate(rowsToSend: ImportRow[], createMissingCatalogs: boolean, createPartners: boolean) {
    setBusy(true)
    setError(null)
    setDryRun(null)
    try {
      setDryRun(await importProducts({ dryRun: true, createMissingCatalogs, ...partnerOption(createPartners), rows: rowsToSend }))
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)
    setDryRun(null)
    try {
      const text = await readText(file)
      const result = parseImportCsv(text)
      setParsed(result)
      setFileName(file.name)
      setPhase('preview')
      if (result.errors.length === 0 && result.fileErrors.length === 0) {
        void validate(prepareImportRows(result, { canCost, canPartners }), createMissing, createMissingPartners)
      }
    } catch {
      setError('No se pudo leer el archivo. Guardalo como CSV desde Excel e intentá de nuevo.')
    }
  }

  function toggleCreateMissing(value: boolean) {
    setCreateMissing(value)
    if (parsed && !hasLocalErrors) void validate(rows, value, createMissingPartners)
  }

  function toggleCreateMissingPartners(value: boolean) {
    setCreateMissingPartners(value)
    if (parsed && !hasLocalErrors) void validate(rows, createMissing, value)
  }

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const result = await importProducts({ dryRun: false, createMissingCatalogs: createMissing, ...partnerOption(createMissingPartners), rows })
      setFinal(result)
      if (result.errors.length === 0) { setPhase('done'); onImported() }
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setPhase('choose'); setParsed(null); setDryRun(null); setFinal(null); setError(null); setFileName('')
  }

  // Errores por fila (archivo + servidor) para resaltar la vista previa.
  const serverErrors = (final?.errors.length ? final.errors : dryRun?.errors) ?? []
  const errorsByRow = new Map<number, string[]>()
  for (const item of [...(parsed?.errors ?? []), ...serverErrors]) errorsByRow.set(item.row, [...(errorsByRow.get(item.row) ?? []), item.message])
  const allErrors = [...(parsed?.errors ?? []), ...serverErrors]
  const canConfirm = phase === 'preview' && !hasLocalErrors && dryRun !== null && dryRun.errors.length === 0 && !busy && !needsInitialPermission

  return (
    <Dialog
      wide
      title="Importar productos"
      subtitle="Desde Excel o CSV. Todo o nada: si una fila tiene error, no se guarda nada."
      onClose={onClose}
      footer={(
        <>
          {phase === 'preview' && <button type="button" className="secondary-button" onClick={reset} disabled={busy}>Elegir otro archivo</button>}
          <button type="button" className="secondary-button" onClick={onClose}>{phase === 'done' ? 'Cerrar' : 'Cancelar'}</button>
          {phase === 'preview' && <button type="button" className="primary-button" disabled={!canConfirm} onClick={() => { void confirm() }}>{busy && dryRun ? 'Importando…' : 'Confirmar importación'}</button>}
        </>
      )}
    >
      {error && <Notice tone="error">{error}</Notice>}

      {phase === 'choose' && (
        <div className="adm-form">
          <div className="adm-help">
            <strong>Cómo hacerlo</strong>
            <ol>
              <li>Descargá la plantilla y abrila en Excel.</li>
              <li>Una fila por cada talla y color. Las filas con el mismo producto, categoría y marca forman un solo producto.</li>
              <li>Guardá como <b>CSV</b> (delimitado por comas o por punto y coma) y subilo acá.</li>
            </ol>
            <p style={{ marginTop: 8 }}>Columnas: {(canPartners ? templateHeadersWithPartner : templateHeaders).join(' · ')}. Código de barras vacío = el sistema genera uno. Si el código tiene muchos dígitos, formateá esa columna como Texto en Excel.</p>
            {canPartners && <p style={{ marginTop: 6 }}>La columna <b>Socio</b> es opcional: es el nombre del socio que ingresó esa mercadería (vacía = sin socio).</p>}
          </div>
          <div className="adm-actions">
            <button type="button" className="secondary-button" onClick={() => downloadTemplate(canPartners)}>Descargar plantilla CSV</button>
            <label className="primary-button" style={{ display: 'inline-grid', placeItems: 'center', cursor: 'pointer' }}>
              Subir archivo CSV
              <input type="file" accept=".csv,.txt,text/csv" className="visually-hidden" onChange={(event) => { void handleFile(event) }} />
            </label>
          </div>
        </div>
      )}

      {phase === 'preview' && parsed && (
        <div className="adm-form">
          <p className="adm-help" style={{ margin: 0 }}>
            Archivo <b>{fileName}</b> · {parsed.rows.length} fila{parsed.rows.length === 1 ? '' : 's'} de datos (el número de fila no cuenta el encabezado) · delimitador «{parsed.delimiter === '\t' ? 'tabulador' : parsed.delimiter}».
          </p>
          {parsed.fileErrors.map((message) => <Notice key={message} tone="error">{message}</Notice>)}
          {!canCost && <Notice tone="info">Tu cuenta no puede ver costos: la columna Costo se ignora.</Notice>}
          {!canPartners && parsed.hasPartnerColumn && <Notice tone="info">Tu cuenta no puede asignar socios: la columna Socio se ignora.</Notice>}
          {needsInitialPermission && <Notice tone="warn">Hay cantidades mayores que cero y tu cuenta no tiene permiso para registrar existencia inicial. Pedile a un administrador que importe el archivo.</Notice>}
          <label className="adm-chip" style={{ width: 'fit-content' }}>
            <input type="checkbox" checked={createMissing} disabled={busy} onChange={(event) => toggleCreateMissing(event.target.checked)} />
            Crear catálogos faltantes (categorías, marcas, cortes, tallas y colores nuevos)
          </label>
          {showPartner && (
            <label className="adm-chip" style={{ width: 'fit-content' }}>
              <input type="checkbox" checked={createMissingPartners} disabled={busy} onChange={(event) => toggleCreateMissingPartners(event.target.checked)} />
              Crear los socios que falten
            </label>
          )}

          {busy && !final && <p className="adm-loading">Validando con el servidor…</p>}
          {dryRun && dryRun.errors.length === 0 && !hasLocalErrors && (
            <Notice tone="ok">
              <span>
                Todo en orden. Se crearían <b>{dryRun.productsCreated}</b> producto{dryRun.productsCreated === 1 ? '' : 's'}, <b>{dryRun.variantsCreated}</b> variante{dryRun.variantsCreated === 1 ? '' : 's'} y se cargarían <b>{dryRun.unitsLoaded}</b> unidades.
                <CreatedLists created={dryRun.catalogsCreated} verb="Catálogos nuevos" />
              </span>
            </Notice>
          )}
          {allErrors.length > 0 && (
            <Notice tone="error">
              <span>Hay {allErrors.length} error{allErrors.length === 1 ? '' : 'es'}. Corregí el archivo y volvé a subirlo; mientras tanto no se guarda nada.</span>
            </Notice>
          )}

          {allErrors.length > 0 && (
            <div className="table-scroll" style={{ maxHeight: 190, overflowY: 'auto' }}>
              <table className="adm-table" aria-label="Errores de importación">
                <thead><tr><th className="numeric">Fila</th><th>Problema</th></tr></thead>
                <tbody>
                  {allErrors.slice(0, errorLimit).map((item, index) => (
                    <tr key={`${item.row}-${index}`} className="error-row"><td className="numeric">{item.row}</td><td>{item.message}</td></tr>
                  ))}
                  {allErrors.length > errorLimit && <tr><td colSpan={2} className="adm-empty">… y {allErrors.length - errorLimit} más.</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="table-scroll" style={{ maxHeight: 280, overflowY: 'auto' }}>
              <table className="adm-table" aria-label="Vista previa del archivo">
                <thead>
                  <tr>
                    <th className="numeric">Fila</th><th>Producto</th><th>Categoría</th><th>Marca</th><th>Corte</th><th>Talla</th><th>Color</th>
                    <th>Código</th><th className="numeric">Precio</th>{canCost && <th className="numeric">Costo</th>}<th className="numeric">Cant.</th>{showPartner && <th>Socio</th>}
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, previewLimit).map((item) => {
                    const problems = errorsByRow.get(item.row)
                    const data = item.data
                    return (
                      <tr key={item.row} className={problems ? 'error-row' : undefined} title={problems?.join(' ')}>
                        <td className="numeric">{item.row}</td>
                        {data ? (
                          <>
                            <td>{data.productName}</td><td>{data.category}</td><td>{data.brand}</td><td>{data.cut ?? ''}</td>
                            <td>{data.size}</td><td>{data.color}</td>
                            <td className="adm-mono">{data.barcode ?? 'auto'}</td>
                            <td className="numeric">{formatNio(data.price)}</td>
                            {canCost && <td className="numeric">{data.cost != null ? formatNio(data.cost) : ''}</td>}
                            <td className="numeric">{data.quantity}</td>
                            {showPartner && <td>{data.partner ?? <span className="adm-muted">Sin socio</span>}</td>}
                          </>
                        ) : (
                          <td colSpan={9 + (canCost ? 1 : 0) + (showPartner ? 1 : 0)} className="adm-mono">{item.cells.join(' ; ')}</td>
                        )}
                      </tr>
                    )
                  })}
                  {parsed.rows.length > previewLimit && <tr><td colSpan={11 + (showPartner ? 1 : 0)} className="adm-empty">Se muestran las primeras {previewLimit} filas de {parsed.rows.length}.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && final && (
        <Notice tone="ok">
          <span>
            Importación terminada: <b>{final.productsCreated}</b> producto{final.productsCreated === 1 ? '' : 's'}, <b>{final.variantsCreated}</b> variante{final.variantsCreated === 1 ? '' : 's'} y <b>{final.unitsLoaded}</b> unidades cargadas.
            <CreatedLists created={final.catalogsCreated} verb="Catálogos creados" />
          </span>
        </Notice>
      )}
    </Dialog>
  )
}
