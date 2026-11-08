import { useId, type ReactNode } from 'react'
import type { PartnerSummary } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { formatInt } from './format'
import { invPresetRange, invPresets, profitInfo, validateInvRange, type InvRange } from './investmentApi'
import { Tag } from './ui'

/** Filtro de fechas con atajos (Hoy, Este mes, Mes pasado, Todo) en hora de Managua. */
export function InvRangeBar({ value, onChange, today }: { value: InvRange; onChange: (range: InvRange) => void; today: string }) {
  const id = useId()
  const error = validateInvRange(value, today)
  const errorId = `${id}-error`
  return (
    <div className="inv-range">
      <div className="rep-presets" role="group" aria-label="Atajos de fechas">
        {invPresets.map((preset) => {
          const range = invPresetRange(preset.id, today)
          const active = range.from === value.from && range.to === value.to
          return (
            <button key={preset.id} type="button" className={active ? 'rep-chip on' : 'rep-chip'} aria-pressed={active} onClick={() => onChange(range)}>
              {preset.label}
            </button>
          )
        })}
      </div>
      <div className="inv-dates">
        <label className="rep-date" htmlFor={`${id}-from`}>
          <span>Desde</span>
          <input id={`${id}-from`} type="date" value={value.from} max={today} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange({ ...value, from: event.target.value })} />
        </label>
        <label className="rep-date" htmlFor={`${id}-to`}>
          <span>Hasta</span>
          <input id={`${id}-to`} type="date" value={value.to} max={today} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(event) => onChange({ ...value, to: event.target.value })} />
        </label>
      </div>
      {error && <p className="rep-error" id={errorId} role="alert">{error}</p>}
    </div>
  )
}

/** Dinero con las pérdidas o ganancias negativas en rojo. */
export function Money({ value, signed }: { value: number; signed?: boolean }) {
  const text = formatNio(value)
  return <span className={value < 0 ? 'adm-neg' : undefined}>{signed && value > 0 ? `+${text}` : text}</span>
}

/** Dinero que puede faltar: «—» cuando no hay dato. */
export function MoneyOrDash({ value }: { value: number | null }) {
  return value === null ? <span className="inv-dash" aria-label="sin dato">—</span> : <>{formatNio(value)}</>
}

/** Ganancia con aviso «parcial» cuando hay ventas sin costo conocido. */
export function ProfitCell({ row }: { row: Pick<PartnerSummary, 'profitNio' | 'soldUnitsWithoutCost' | 'unitsWithoutCost'> }) {
  const info = profitInfo(row)
  return (
    <>
      <Money value={row.profitNio} />
      {info.partial && (
        <small className="row-sub inv-partial" title={`${formatInt(row.soldUnitsWithoutCost)} unidades vendidas no tienen costo registrado: su ganancia no está incluida.`}>
          parcial · {formatInt(row.soldUnitsWithoutCost)} unid. sin costo
        </small>
      )}
    </>
  )
}

/** Inversión con marca cuando faltan costos. */
export function InvestedCell({ row }: { row: Pick<PartnerSummary, 'investedNio' | 'unitsWithoutCost'> }) {
  return (
    <>
      {formatNio(row.investedNio)}
      {row.unitsWithoutCost > 0 && (
        <small className="row-sub inv-warn" title="Hay unidades ingresadas sin costo: la inversión real es mayor.">
          Inversión incompleta, faltan costos ({formatInt(row.unitsWithoutCost)} unid.)
        </small>
      )}
    </>
  )
}

export function PartnerTag({ name, partnerId }: { name: string; partnerId: string | null }) {
  return partnerId === null ? <Tag tone="warn">{name}</Tag> : <>{name}</>
}

export function Section({ title, hint, actions, children }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section className="panel-card adm-card" aria-labelledby={id}>
      <div className="inv-section-head">
        <h2 id={id} className="adm-card-title">{title}</h2>
        {actions && <div className="adm-actions">{actions}</div>}
      </div>
      {hint && <p className="adm-help">{hint}</p>}
      {children}
    </section>
  )
}
