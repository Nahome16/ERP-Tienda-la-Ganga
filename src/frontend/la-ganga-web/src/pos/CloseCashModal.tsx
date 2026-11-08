import { useMemo, useState, type ReactNode } from 'react'
import type { CashSession, CashSummary } from '../lib/apiTypes'
import { formatNio, formatUsd, round2 } from '../lib/money'
import { channelLabel, formatDateTime } from './format'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import { parseAmount } from './payments'

type CloseCashModalProps = {
  session: CashSession
  /** Ventas pendientes o en envío: bloquean el cierre. */
  pendingCount: number
  /** Ventas rechazadas por el servidor que siguen sin resolverse. */
  attentionCount: number
  online: boolean
  syncing: boolean
  onSyncNow: () => void
  onClosed: (summary: CashSummary) => void
  onPrintSummary: (summary: CashSummary) => void
  onFinish: () => void
  onCancel: () => void
}

const denominations = [1000, 500, 200, 100, 50, 20, 10, 5, 1] as const

function Difference({ value, format }: { value: number | null; format: (amount: number) => string }) {
  if (value === null) return <span>—</span>
  const tone = value === 0 ? 'pv-diff-ok' : value > 0 ? 'pv-diff-over' : 'pv-diff-short'
  const label = value === 0 ? 'Cuadra' : value > 0 ? 'Sobrante' : 'Faltante'
  return <span className={tone}>{value > 0 ? '+' : ''}{format(value)} · {label}</span>
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return <div className={`pv-sum-row${strong ? ' is-strong' : ''}`}><span>{label}</span><b>{children}</b></div>
}

export function CloseCashModal({
  session, pendingCount, attentionCount, online, syncing, onSyncNow, onClosed, onPrintSummary, onFinish, onCancel,
}: CloseCashModalProps) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [coins, setCoins] = useState('')
  const [usd, setUsd] = useState('')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CashSummary | null>(null)

  const countedNio = useMemo(() => {
    const bills = denominations.reduce((sum, value) => sum + value * Math.floor(parseAmount(counts[value] ?? '')), 0)
    return round2(bills + parseAmount(coins))
  }, [counts, coins])
  const countedUsd = parseAmount(usd)

  const blockedReason = !online
    ? 'Sin conexión: para cerrar la caja necesitás conexión con el servidor.'
    : pendingCount > 0
      ? `Hay ${pendingCount} ${pendingCount === 1 ? 'venta pendiente' : 'ventas pendientes'} de enviar. Sincronizá primero.`
      : null

  async function closeCash() {
    setBusy(true)
    setError(null)
    try {
      const result = await posRequest<CashSummary>(`/api/v1/cash/sessions/${session.id}/close`, {
        method: 'POST',
        body: { countedCashNio: countedNio, countedCashUsd: countedUsd, notes: notes.trim() },
      })
      setSummary(result)
      onClosed(result)
    } catch (caught) {
      setError(errorMessage(caught, 'No fue posible cerrar la caja.'))
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  if (summary) {
    const { totals } = summary
    return (
      <Modal
        title="Caja cerrada"
        size="lg"
        onClose={onFinish}
        footer={(
          <>
            <button type="button" className="pv-btn pv-btn-ghost" onClick={() => onPrintSummary(summary)}>Imprimir resumen</button>
            <button type="button" className="pv-btn pv-btn-primary" data-autofocus onClick={onFinish}>Listo</button>
          </>
        )}
      >
        <div className="pv-summary">
          <p className="pv-note">{summary.session.registerName} · {formatDateTime(summary.session.openedAtUtc)} → {summary.session.closedAtUtc ? formatDateTime(summary.session.closedAtUtc) : ''}</p>
          <div className="pv-summary-grid">
            <section>
              <h3>Ventas</h3>
              <Row label="Ventas realizadas">{totals.salesCount}</Row>
              <Row label="Anuladas">{totals.voidedCount} · {formatNio(totals.voidedTotalNio)}</Row>
              <Row label="Venta bruta">{formatNio(totals.grossTotalNio)}</Row>
              <Row label="Descuentos">−{formatNio(totals.discountTotalNio)}</Row>
              <Row label="Total vendido" strong>{formatNio(totals.netTotalNio)}</Row>
              {totals.reviewCount > 0 && <p className="pv-banner pv-banner-warn">{totals.reviewCount} venta(s) con revisión pendiente.</p>}
            </section>
            <section>
              <h3>Por método de pago</h3>
              <Row label="Efectivo (neto)">{formatNio(totals.cashTotalNio)}</Row>
              <Row label="Transferencias">{formatNio(totals.transferTotalNio)}</Row>
              {totals.transfersByBank.map((item) => <Row key={item.bank} label={`· ${item.bank}`}>{formatNio(item.totalNio)}</Row>)}
              <Row label="Tarjeta (terminal)">{formatNio(totals.cardTotalNio)}</Row>
              {totals.byChannel.length > 0 && <h3 className="pv-sub">Por canal</h3>}
              {totals.byChannel.map((item) => <Row key={item.channel} label={`${channelLabel[item.channel]} (${item.salesCount})`}>{formatNio(item.totalNio)}</Row>)}
            </section>
            <section className="pv-span-2">
              <h3>Arqueo de efectivo</h3>
              <div className="pv-arqueo">
                <div />
                <b>Esperado</b><b>Contado</b><b>Diferencia</b>
                <span>Córdobas</span>
                <span>{formatNio(summary.expectedCashNio)}</span>
                <span>{summary.session.countedCashNio === null ? '—' : formatNio(summary.session.countedCashNio)}</span>
                <Difference value={summary.differenceCashNio} format={formatNio} />
                <span>Dólares</span>
                <span>{formatUsd(summary.expectedCashUsd)}</span>
                <span>{summary.session.countedCashUsd === null ? '—' : formatUsd(summary.session.countedCashUsd)}</span>
                <Difference value={summary.differenceCashUsd} format={formatUsd} />
              </div>
              {summary.session.closingNotes && <p className="pv-note">Notas: {summary.session.closingNotes}</p>}
            </section>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      title="Cerrar caja"
      size="lg"
      onClose={onCancel}
      locked={busy}
      footer={confirming ? (
        <>
          <span className="pv-confirm-text">¿Cerrar la caja con {formatNio(countedNio)} y {formatUsd(countedUsd)} contados?</span>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Revisar</button>
          <button type="button" className="pv-btn pv-btn-primary" onClick={() => { void closeCash() }} disabled={busy} data-autofocus>
            {busy ? 'Cerrando…' : 'Sí, cerrar caja'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="pv-btn pv-btn-primary" disabled={blockedReason !== null} onClick={() => setConfirming(true)}>Cerrar caja</button>
        </>
      )}
    >
      <div className="pv-close">
        {blockedReason && (
          <div className="pv-banner pv-banner-warn" role="alert">
            {blockedReason}{' '}
            {online && pendingCount > 0 && (
              <button type="button" className="pv-link" onClick={onSyncNow} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
            )}
          </div>
        )}
        {attentionCount > 0 && (
          <div className="pv-banner pv-banner-warn" role="alert">
            {attentionCount} {attentionCount === 1 ? 'venta fue rechazada' : 'ventas fueron rechazadas'} por el servidor y no entra{attentionCount === 1 ? '' : 'n'} en el cierre. Revisalas en «Ventas de esta caja».
          </div>
        )}
        <p className="pv-note">Contá el efectivo que hay en la gaveta. Los córdobas y los dólares se cuentan por separado.</p>
        <div className="pv-close-grid">
          <section>
            <h3>Córdobas (C$)</h3>
            <div className="pv-denoms">
              {denominations.map((value) => (
                <label key={value}>
                  <span>C$ {value}</span>
                  <input
                    inputMode="numeric" aria-label={`Cantidad de billetes o monedas de ${value} córdobas`}
                    value={counts[value] ?? ''} placeholder="0"
                    onChange={(event) => setCounts((current) => ({ ...current, [value]: event.target.value.replace(/\D/g, '') }))}
                  />
                  <em>{formatNio(value * Math.floor(parseAmount(counts[value] ?? '')))}</em>
                </label>
              ))}
              <label>
                <span>Otras monedas</span>
                <input inputMode="decimal" aria-label="Otras monedas y centavos en córdobas" value={coins} placeholder="0.00" onChange={(event) => setCoins(event.target.value)} />
                <em>{formatNio(parseAmount(coins))}</em>
              </label>
            </div>
            <Row label="Total contado C$" strong>{formatNio(countedNio)}</Row>
          </section>
          <section>
            <h3>Dólares (US$)</h3>
            <label className="pv-field">Total en dólares
              <input inputMode="decimal" value={usd} placeholder="0.00" onChange={(event) => setUsd(event.target.value)} />
            </label>
            <Row label="Total contado US$" strong>{formatUsd(countedUsd)}</Row>
            <label className="pv-field">Notas del cierre (opcional)
              <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej.: faltaron C$ 10 por cambio" />
            </label>
          </section>
        </div>
        {error && <p className="pv-error" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
