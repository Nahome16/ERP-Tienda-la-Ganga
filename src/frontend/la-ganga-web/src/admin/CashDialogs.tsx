import { useState, type FormEvent } from 'react'
import type { CashSummary, CashTotals } from '../lib/apiTypes'
import { formatNio, formatUsd } from '../lib/money'
import { closeSession, getSessionSummary } from './adminApi'
import { PrintableCashSlip } from './CashSlip'
import { printCashSlip, slipFromSummary } from './cashSlipData'
import { parseDecimal } from './csv'
import { channelLabels, formatDateTime, messageFrom } from './format'
import { useFetch } from './hooks'
import { Dialog, LoadError, Notice, Row, Spinner, Tag } from './ui'

/** Diferencia de arqueo: cuadra, sobra o falta. */
export function Difference({ value, format }: { value: number | null; format: (value: number) => string }) {
  if (value === null) return <span className="adm-muted">Pendiente</span>
  const rounded = Math.round(value * 100) / 100
  if (rounded === 0) return <span className="adm-diff-ok">Cuadra</span>
  return <span className="adm-diff-bad">{rounded > 0 ? 'Sobra' : 'Falta'} {format(Math.abs(rounded))}</span>
}

export function TotalsList({ totals }: { totals: CashTotals }) {
  return (
    <div>
      <Row label="Ventas">{totals.salesCount}</Row>
      <Row label="Anuladas">{totals.voidedCount} · {formatNio(totals.voidedTotalNio)}</Row>
      <Row label="Total bruto">{formatNio(totals.grossTotalNio)}</Row>
      <Row label="Descuentos">−{formatNio(totals.discountTotalNio)}</Row>
      <Row label="Total vendido" strong>{formatNio(totals.netTotalNio)}</Row>
      <Row label="Efectivo C$ recibido">{formatNio(totals.cashNioTendered)}</Row>
      <Row label="Efectivo US$ recibido">{formatUsd(totals.cashUsdTendered)} ≈ {formatNio(totals.cashUsdEquivalentNio)}</Row>
      <Row label="Cambio entregado">{formatNio(totals.changeGivenNio)}</Row>
      <Row label="Efectivo (neto)">{formatNio(totals.cashTotalNio)}</Row>
      <Row label="Transferencia">{formatNio(totals.transferTotalNio)}</Row>
      <Row label="POS / Tarjeta">{formatNio(totals.cardTotalNio)}</Row>
    </div>
  )
}

export function BreakdownTables({ totals }: { totals: CashTotals }) {
  return (
    <div className="adm-columns">
      <div>
        <h3 className="adm-card-title">Transferencias por banco</h3>
        <table className="adm-table">
          <thead><tr><th>Banco</th><th className="numeric">Total</th></tr></thead>
          <tbody>
            {totals.transfersByBank.length === 0 && <tr><td colSpan={2} className="adm-empty">Sin transferencias.</td></tr>}
            {totals.transfersByBank.map((bank) => <tr key={bank.bank}><td>{bank.bank}</td><td className="numeric">{formatNio(bank.totalNio)}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="adm-card-title">Ventas por canal</h3>
        <table className="adm-table">
          <thead><tr><th>Canal</th><th className="numeric">Ventas</th><th className="numeric">Total</th></tr></thead>
          <tbody>
            {totals.byChannel.length === 0 && <tr><td colSpan={3} className="adm-empty">Sin ventas.</td></tr>}
            {totals.byChannel.map((channel) => (
              <tr key={channel.channel}><td>{channelLabels[channel.channel] ?? channel.channel}</td><td className="numeric">{channel.salesCount}</td><td className="numeric">{formatNio(channel.totalNio)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Resumen completo de una caja, con impresión del cierre y opción de cerrarla. */
export function SessionDialog({ sessionId, storeName, canClose, onClose, onChanged }: {
  sessionId: string; storeName: string; canClose: boolean; onClose: () => void; onChanged: () => void
}) {
  const { data: summary, error, loading, reload } = useFetch<CashSummary>(`session|${sessionId}`, (signal) => getSessionSummary(sessionId, signal))
  const [closing, setClosing] = useState(false)
  const [justClosed, setJustClosed] = useState(false)

  const session = summary?.session
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
        {justClosed && <Notice tone="ok">La caja quedó cerrada. Revisá la diferencia del arqueo.</Notice>}
        {summary && session && (
          <>
            <div className="adm-actions" style={{ marginBottom: 12 }}>
              <Tag tone={session.closedAtUtc ? 'neutral' : 'ok'}>{session.closedAtUtc ? 'Cerrada' : 'Abierta'}</Tag>
              {summary.totals.reviewCount > 0 && <Tag tone="warn">{summary.totals.reviewCount} venta{summary.totals.reviewCount === 1 ? '' : 's'} por revisar</Tag>}
            </div>
            <div className="adm-columns">
              <section>
                <h3 className="adm-card-title">Ventas y métodos de pago</h3>
                <TotalsList totals={summary.totals} />
              </section>
              <section>
                <h3 className="adm-card-title">Arqueo de efectivo</h3>
                <Row label="Fondo inicial C$">{formatNio(session.openingFloatNio)}</Row>
                <Row label="Fondo inicial US$">{formatUsd(session.openingFloatUsd)}</Row>
                <Row label="Esperado C$">{formatNio(summary.expectedCashNio)}</Row>
                <Row label="Contado C$">{session.countedCashNio === null ? 'Pendiente' : formatNio(session.countedCashNio)}</Row>
                <Row label="Diferencia C$"><Difference value={summary.differenceCashNio} format={formatNio} /></Row>
                <Row label="Esperado US$">{formatUsd(summary.expectedCashUsd)}</Row>
                <Row label="Contado US$">{session.countedCashUsd === null ? 'Pendiente' : formatUsd(session.countedCashUsd)}</Row>
                <Row label="Diferencia US$"><Difference value={summary.differenceCashUsd} format={formatUsd} /></Row>
                {session.closingNotes && <p className="adm-help" style={{ marginTop: 8 }}>Notas del cierre: {session.closingNotes}</p>}
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

/** Arqueo: montos contados en C$ y US$ y cierre de la caja. */
export function CloseCashDialog({ summary, onClose, onClosed }: { summary: CashSummary; onClose: () => void; onClosed: () => void }) {
  const [nio, setNio] = useState('')
  const [usd, setUsd] = useState('0')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const countedNio = parseDecimal(nio)
  const countedUsd = parseDecimal(usd || '0')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (countedNio === null || countedNio < 0) { setError('Escribí los córdobas contados (cero si no hay).'); return }
    if (countedUsd === null || countedUsd < 0) { setError('Escribí los dólares contados (cero si no hay).'); return }
    setSaving(true)
    try {
      await closeSession(summary.session.id, { countedCashNio: countedNio, countedCashUsd: countedUsd, notes: notes.trim() })
      onClosed()
    } catch (caught) {
      setError(messageFrom(caught))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={`Cerrar ${summary.session.registerName}`}
      subtitle="Contá el efectivo de la caja e ingresá los montos. Esta acción no se puede deshacer."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="close-cash-form" className="adm-danger-button" disabled={saving}>{saving ? 'Cerrando…' : 'Cerrar caja'}</button>
        </>
      )}
    >
      <form id="close-cash-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        <div className="adm-section">
          <Row label="Efectivo esperado C$">{formatNio(summary.expectedCashNio)}</Row>
          <Row label="Efectivo esperado US$">{formatUsd(summary.expectedCashUsd)}</Row>
        </div>
        <div className="adm-grid-2">
          <label className="adm-field">
            <span>Córdobas contados (C$)</span>
            <input type="number" min={0} step="0.01" value={nio} onChange={(event) => setNio(event.target.value)} required data-autofocus />
          </label>
          <label className="adm-field">
            <span>Dólares contados (US$)</span>
            <input type="number" min={0} step="0.01" value={usd} onChange={(event) => setUsd(event.target.value)} required />
          </label>
        </div>
        {countedNio !== null && countedUsd !== null && (
          <div className="adm-section">
            <Row label="Diferencia C$"><Difference value={countedNio - summary.expectedCashNio} format={formatNio} /></Row>
            <Row label="Diferencia US$"><Difference value={countedUsd - summary.expectedCashUsd} format={formatUsd} /></Row>
          </div>
        )}
        <label className="adm-field">
          <span>Notas (opcional)</span>
          <textarea value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} placeholder="Ej. Faltante por cambio mal entregado" />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
