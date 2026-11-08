import { useId } from 'react'
import { Notice } from './ui'
import {
  formatBytes, managuaDate, presetRange, rangePresets, useReportDownload, validateRange,
  type DateRange, type DownloadState, type ReportKind,
} from './reportsApi'

/** Dos fechas con atajos (Hoy, Ayer…) calculados en hora de Managua. */
export function DateRangePicker({ value, onChange, today, allowFuture, error, errorId }: {
  value: DateRange
  onChange: (range: DateRange) => void
  today: string
  allowFuture: boolean
  error: string | null
  errorId: string
}) {
  const id = useId()
  const max = allowFuture ? undefined : today
  return (
    <div className="rep-range">
      <div className="rep-presets" role="group" aria-label="Atajos de fechas">
        {rangePresets.map((preset) => {
          const range = presetRange(preset.id, today)
          const active = range.from === value.from && range.to === value.to
          return (
            <button key={preset.id} type="button" className={active ? 'rep-chip on' : 'rep-chip'} aria-pressed={active} onClick={() => onChange(range)}>
              {preset.label}
            </button>
          )
        })}
      </div>
      <div className="rep-dates">
        <label className="rep-date" htmlFor={`${id}-from`}>
          <span>Desde</span>
          <input
            id={`${id}-from`} type="date" value={value.from} max={max} required
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange({ ...value, from: event.target.value })}
          />
        </label>
        <label className="rep-date" htmlFor={`${id}-to`}>
          <span>Hasta</span>
          <input
            id={`${id}-to`} type="date" value={value.to} max={max} required
            aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })}
          />
        </label>
      </div>
    </div>
  )
}

/** Resultado de la descarga: éxito con nombre y tamaño, o el error. */
export function DownloadResult({ state }: { state: DownloadState }) {
  if (state.status === 'done') {
    return <Notice tone="ok"><span>Listo: se descargó <b className="rep-file">{state.filename}</b> ({formatBytes(state.size)}).</span></Notice>
  }
  if (state.status === 'error') return <Notice tone="error"><span>{state.message}</span></Notice>
  return null
}

/** Botón «Descargar Excel» con su estado de carga. */
export function DownloadButton({ busy, disabled, onClick, className = 'primary-button', label = 'Descargar Excel' }: {
  busy: boolean; disabled?: boolean; onClick: () => void; className?: string; label?: string
}) {
  return (
    <button type="button" className={className} onClick={onClick} disabled={busy || disabled} aria-busy={busy}>
      {busy ? 'Preparando archivo…' : label}
    </button>
  )
}

/**
 * Atajo para las pantallas de Ventas, Inventario y Caja: descarga el reporte con
 * el rango que la pantalla ya tiene seleccionado. Sin `range`, el reporte no usa fechas.
 */
export function ExcelShortcut({ kind, range, allowFuture = false }: { kind: ReportKind; range?: DateRange; allowFuture?: boolean }) {
  const { state, start, fail } = useReportDownload()
  const errorId = useId()

  function handleClick() {
    if (range) {
      const problem = validateRange(range, managuaDate(), { allowFuture })
      if (problem) { fail(problem); return }
    }
    void start(kind, range)
  }

  const busy = state.status === 'busy'
  return (
    <div className="rep-shortcut">
      <DownloadButton busy={busy} onClick={handleClick} className="secondary-button" />
      <div className="rep-shortcut-status" id={errorId} aria-live="polite">
        {state.status === 'done' && <span className="rep-ok">Descargado: {state.filename} ({formatBytes(state.size)})</span>}
        {state.status === 'error' && <span className="rep-err">{state.message}</span>}
      </div>
    </div>
  )
}
