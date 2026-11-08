import { useId, useState, type FormEvent } from 'react'
import type { CashSummary, CloseSessionRequest } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import { closeSession, getSessionSummary } from './adminApi'
import { BreakdownTables, Difference, ReconciliationBlock, TenderedBreakdown, TotalsList } from './CashReconciliation'
import { PrintableCashSlip } from './CashSlip'
import { printCashSlip, slipFromSummary } from './cashSlipData'
import { parseDecimal } from './csv'
import { formatDateTime, messageFrom } from './format'
import { useFetch } from './hooks'
import { methodsFromSummary } from './reconciliation'
import { Dialog, LoadError, Notice, Row, Spinner, Tag } from './ui'

/** Resumen completo de una caja, con impresión del cierre y opción de cerrarla. */
export function SessionDialog({ sessionId, storeName, canClose, onClose, onChanged }: {
  sessionId: string; storeName: string; canClose: boolean; onClose: () => void; onChanged: () => void
}) {
  const { data: summary, error, loading, reload } = useFetch<CashSummary>(`session|${sessionId}`, (signal) => getSessionSummary(sessionId, signal))
  const [closing, setClosing] = useState(false)
  const [justClosed, setJustClosed] = useState(false)

  const session = summary?.session
  const isOpen = session ? session.closedAtUtc === null : false
  return (
    <>
      <Dialog
        wide
        title={session ? `${session.registerName} · ${session.openedByName}` : 'Detalle de caja'}
        subtitle={session ? `Abierta ${formatDateTime(session.openedAtUtc)}${session.closedAtUtc ? ` · Cerrada ${formatDateTime(session.closedAtUtc)}${session.closedByName ? ` por ${session.closedByName}` : ''}` : ''}` : undefined}
        onClose={onClose}
        footer={summary && (
          <>
            {canClose && !session?.closedAtUtc && <button type="button" className="secondary-button" onClick={() => setClosing(true)}>Cerrar caja</button>}
            <button type="button" className="primary-button" onClick={printCashSlip}>Imprimir cierre</button>
          </>
        )}
      >
        {loading && !summary && <Spinner />}
        {error && <LoadError message={error} onRetry={reload} />}
        {justClosed && <Notice tone="ok">La caja quedó cerrada. Revisá las diferencias de cada método.</Notice>}
        {summary && session && (
          <>
            <div className="adm-actions" style={{ marginBottom: 12 }}>
              <Tag tone={session.closedAtUtc ? 'neutral' : 'ok'}>{session.closedAtUtc ? 'Cerrada' : 'Abierta'}</Tag>
              {summary.totals.reviewCount > 0 && <Tag tone="warn">{summary.totals.reviewCount} venta{summary.totals.reviewCount === 1 ? '' : 's'} por revisar</Tag>}
              {summary.totals.voidedCount > 0 && <Tag tone="danger">{summary.totals.voidedCount} anulada{summary.totals.voidedCount === 1 ? '' : 's'} · {formatNio(summary.totals.voidedTotalNio)}</Tag>}
            </div>

            <h3 className="adm-card-title">Esperado vs verificado</h3>
            <ReconciliationBlock methods={methodsFromSummary(summary)} open={isOpen} scope="session" />
            <p className="adm-help" style={{ marginTop: 8 }}>
              Efectivo contra el conteo físico (fondo inicial {formatNio(session.openingFloatNio)} y {formatUsd(session.openingFloatUsd)}), transferencias contra lo que se ve en el banco y tarjeta contra el cierre de lote de la terminal.
              {isOpen ? ' La conciliación aparece al cerrar la caja.' : ''}
            </p>
            {session.closingNotes && <p className="adm-help">Notas del cierre: {session.closingNotes}</p>}

            <div className="adm-columns" style={{ marginTop: 14 }}>
              <section>
                <h3 className="adm-card-title">Ventas y descuentos</h3>
                <TotalsList totals={summary.totals} />
              </section>
              <section>
                <h3 className="adm-card-title">Recibido por método y moneda</h3>
                <TenderedBreakdown totals={summary.totals} />
              </section>
            </div>
            <div style={{ marginTop: 14 }}><BreakdownTables totals={summary.totals} /></div>
          </>
        )}
      </Dialog>
      {summary && <PrintableCashSlip data={slipFromSummary(storeName, summary)} />}
      {summary && closing && (
        <CloseCashDialog
          summary={summary}
          onClose={() => setClosing(false)}
          onClosed={() => { setClosing(false); setJustClosed(true); reload(); onChanged() }}
        />
      )}
    </>
  )
}

type OptionalField = 'transferNio' | 'transferUsd' | 'cardNio' | 'cardUsd'
type OptionalValues = Record<OptionalField, string>

const optionalKeys: Record<OptionalField, 'countedTransferNio' | 'countedTransferUsd' | 'countedCardNio' | 'countedCardUsd'> = {
  transferNio: 'countedTransferNio', transferUsd: 'countedTransferUsd', cardNio: 'countedCardNio', cardUsd: 'countedCardUsd',
}

/** Campo opcional: vacío = no verificado. */
function OptionalAmount({ label, value, expected, format, onChange }: {
  label: string; value: string; expected: number; format: (value: number) => string; onChange: (value: string) => void
}) {
  const id = useId()
  const parsed = value.trim() === '' ? null : parseDecimal(value)
  const invalid = value.trim() !== '' && (parsed === null || parsed < 0)
  return (
    <div className="adm-field adm-rec-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={0} step="0.01" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={invalid || undefined} aria-describedby={`${id}-hint`} placeholder="Sin verificar" />
      <small id={`${id}-hint`} className={invalid ? 'err' : undefined} aria-live="polite">
        {invalid ? 'Escribí un monto válido (cero o más).' : parsed === null ? 'Vacío = no verificado.' : <Difference value={parsed - expected} format={format} />}
      </small>
    </div>
  )
}

/** Arqueo y conciliación: efectivo contado (obligatorio) y transferencias/tarjeta verificadas (opcionales). */
export function CloseCashDialog({ summary, onClose, onClosed }: { summary: CashSummary; onClose: () => void; onClosed: () => void }) {
  const [nio, setNio] = useState('')
  const [usd, setUsd] = useState('0')
  const [optional, setOptional] = useState<OptionalValues>({ transferNio: '', transferUsd: '', cardNio: '', cardUsd: '' })
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const countedNio = parseDecimal(nio)
  const countedUsd = parseDecimal(usd || '0')
  const setField = (field: OptionalField) => (value: string) => setOptional((current) => ({ ...current, [field]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (countedNio === null || countedNio < 0) { setError('Escribí los córdobas contados (cero si no hay).'); return }
    if (countedUsd === null || countedUsd < 0) { setError('Escribí los dólares contados (cero si no hay).'); return }
    const request: CloseSessionRequest = { countedCashNio: countedNio, countedCashUsd: countedUsd, notes: notes.trim() }
    for (const field of Object.keys(optional) as OptionalField[]) {
      const raw = optional[field].trim()
      if (raw === '') continue
      const parsed = parseDecimal(raw)
      if (parsed === null || parsed < 0) { setError('Revisá los montos de transferencias y tarjeta: deben ser cero o más (o dejalos vacíos si no los verificaste).'); return }
      request[optionalKeys[field]] = parsed
    }
    setSaving(true)
    try {
      await closeSession(summary.session.id, request)
      onClosed()
    } catch (caught) {
      setError(messageFrom(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`Cerrar ${summary.session.registerName}`}
      subtitle="Contá el efectivo y, si podés, verificá transferencias y tarjeta. Esta acción no se puede deshacer."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="close-cash-form" className="adm-danger-button" disabled={saving}>{saving ? 'Cerrando…' : 'Cerrar caja'}</button>
        </>
      )}
    >
      <form id="close-cash-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <fieldset className="adm-section adm-rec-fieldset">
          <legend>Efectivo (conteo físico)</legend>
          <Row label="Esperado C$">{formatNio(summary.expectedCashNio)}</Row>
          <Row label="Esperado US$">{formatUsd(summary.expectedCashUsd)}</Row>
          <div className="adm-grid-2" style={{ marginTop: 8 }}>
            <label className="adm-field">
              <span>Córdobas contados (C$)</span>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={nio} onChange={(event) => setNio(event.target.value)} required data-autofocus />
            </label>
            <label className="adm-field">
              <span>Dólares contados (US$)</span>
              <input type="number" min={0} step="0.01" inputMode="decimal" value={usd} onChange={(event) => setUsd(event.target.value)} required />
            </label>
          </div>
          {countedNio !== null && countedUsd !== null && (
            <div style={{ marginTop: 6 }}>
              <Row label="Diferencia efectivo C$"><Difference value={countedNio - summary.expectedCashNio} format={formatNio} /></Row>
              <Row label="Diferencia efectivo US$"><Difference value={countedUsd - summary.expectedCashUsd} format={formatUsd} /></Row>
            </div>
          )}
        </fieldset>

        <fieldset className="adm-section adm-rec-fieldset">
          <legend>Transferencias (lo que se ve en el banco)</legend>
          <Row label="Esperado C$">{formatNio(summary.expectedTransferNio)}</Row>
          <Row label="Esperado US$">{formatUsd(summary.expectedTransferUsd)}</Row>
          <div className="adm-grid-2" style={{ marginTop: 8 }}>
            <OptionalAmount label="Transferencias verificadas C$ (opcional)" value={optional.transferNio} expected={summary.expectedTransferNio} format={formatNio} onChange={setField('transferNio')} />
            <OptionalAmount label="Transferencias verificadas US$ (opcional)" value={optional.transferUsd} expected={summary.expectedTransferUsd} format={formatUsd} onChange={setField('transferUsd')} />
          </div>
        </fieldset>

        <fieldset className="adm-section adm-rec-fieldset">
          <legend>Tarjeta POS (cierre de lote de la terminal)</legend>
          <Row label="Esperado C$">{formatNio(summary.expectedCardNio)}</Row>
          <Row label="Esperado US$">{formatUsd(summary.expectedCardUsd)}</Row>
          <div className="adm-grid-2" style={{ marginTop: 8 }}>
            <OptionalAmount label="Tarjeta según terminal C$ (opcional)" value={optional.cardNio} expected={summary.expectedCardNio} format={formatNio} onChange={setField('cardNio')} />
            <OptionalAmount label="Tarjeta según terminal US$ (opcional)" value={optional.cardUsd} expected={summary.expectedCardUsd} format={formatUsd} onChange={setField('cardUsd')} />
          </div>
        </fieldset>

        <label className="adm-field">
          <span>Notas (opcional)</span>
          <textarea value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. Faltante por cambio mal entregado" />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
