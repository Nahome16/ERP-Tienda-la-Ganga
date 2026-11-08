import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CashSession, CashSummary } from '../lib/apiTypes'
import { formatNio, formatUsd, round2 } from '../lib/money'
import { channelLabel, formatDateTime } from './format'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import { parseAmount } from './payments'
import {
  buildCloseRequest, difference, diffText, diffTone, liveRows, parseOptionalAmount, reconciliationRows, reconMethodTitle,
  visibleRows, type ReconCurrency, type ReconMethod, type ReconRow,
} from './reconcile'

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
const money: Record<ReconCurrency, (value: number) => string> = { NIO: formatNio, USD: formatUsd }
const currencyName: Record<ReconCurrency, string> = { NIO: 'Córdobas', USD: 'Dólares' }

function Diff({ value, format }: { value: number | null; format: (amount: number) => string }) {
  return <span className={`pv-diff pv-diff-${diffTone(value)}`}>{diffText(value, format)}</span>
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return <div className={`pv-sum-row${strong ? ' is-strong' : ''}`}><span>{label}</span><b>{children}</b></div>
}

/** Tabla Esperado / Verificado / Diferencia, agrupada por método; lo que no tuvo movimientos se muestra en una línea. */
function ReconTable({ rows, className = '' }: { rows: ReconRow[]; className?: string }) {
  const shown = visibleRows(rows)
  const methods: ReconMethod[] = ['Cash', 'Transfer', 'Card']
  return (
    <div className={`pv-recon ${className}`} role="table" aria-label="Conciliación por método y moneda">
      <div className="pv-recon-head" role="row">
        <span role="columnheader">Método</span><b role="columnheader">Esperado</b><b role="columnheader">Verificado</b><b role="columnheader">Diferencia</b>
      </div>
      {methods.map((method) => {
        const group = shown.filter((row) => row.method === method)
        return (
          <div className="pv-recon-group" role="rowgroup" key={method}>
            <h4>{reconMethodTitle[method]}</h4>
            {group.length === 0 && <p className="pv-recon-empty">Sin movimientos en este turno.</p>}
            {group.map((row) => (
              <div className="pv-recon-row" role="row" key={row.currency}>
                <span role="cell">{currencyName[row.currency]}</span>
                <span role="cell">{money[row.currency](row.expected)}</span>
                <span role="cell">{row.counted === null ? <em>—</em> : money[row.currency](row.counted)}</span>
                <span role="cell"><Diff value={row.difference} format={money[row.currency]} /></span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

type VerifySectionProps = {
  step: number
  title: string
  verifyLabel: string
  expectedNio: number
  expectedUsd: number
  valueNio: string
  valueUsd: string
  onNio: (value: string) => void
  onUsd: (value: string) => void
  byBank?: { bank: string; totalNio: number; totalUsd: number }[]
}

/** Transferencias y tarjeta: esperado por el sistema, desglose y verificación opcional. */
function VerifySection({ step, title, verifyLabel, expectedNio, expectedUsd, valueNio, valueUsd, onNio, onUsd, byBank = [] }: VerifySectionProps) {
  if (expectedNio === 0 && expectedUsd === 0) {
    return (
      <section className="pv-close-sec is-compact" aria-label={title}>
        <h3><i className="pv-step">{step}</i> {title}</h3>
        <span className="pv-recon-empty">Sin movimientos en este turno.</span>
      </section>
    )
  }
  const verifiedNio = parseOptionalAmount(valueNio)
  const verifiedUsd = parseOptionalAmount(valueUsd)
  return (
    <section className="pv-close-sec" aria-label={title}>
      <h3><i className="pv-step">{step}</i> {title}</h3>
      <div className="pv-expect">
        <span>Esperado por el sistema</span>
        <b>{formatNio(expectedNio)}</b>
        <b>{formatUsd(expectedUsd)}</b>
      </div>
      {byBank.length > 0 && (
        <ul className="pv-banks" aria-label="Desglose por banco">
          {byBank.map((item) => (
            <li key={item.bank}>
              <span>{item.bank}</span>
              <span>{formatNio(item.totalNio)}{item.totalUsd > 0 ? ` (incluye ${formatUsd(item.totalUsd)} en dólares)` : ''}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="pv-hint">{verifyLabel} Dejalo vacío si no lo vas a verificar.</p>
      <div className="pv-row-2">
        <label className="pv-field">C$
          <input inputMode="decimal" autoComplete="off" placeholder="Sin verificar" value={valueNio} onChange={(event) => onNio(event.target.value)} />
          <small className="pv-live"><Diff value={difference(expectedNio, verifiedNio)} format={formatNio} /></small>
        </label>
        <label className="pv-field">US$
          <input inputMode="decimal" autoComplete="off" placeholder="Sin verificar" value={valueUsd} onChange={(event) => onUsd(event.target.value)} />
          <small className="pv-live"><Diff value={difference(expectedUsd, verifiedUsd)} format={formatUsd} /></small>
        </label>
      </div>
    </section>
  )
}

export function CloseCashModal({
  session, pendingCount, attentionCount, online, syncing, onSyncNow, onClosed, onPrintSummary, onFinish, onCancel,
}: CloseCashModalProps) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [coins, setCoins] = useState('')
  const [usd, setUsd] = useState('')
  const [transferNio, setTransferNio] = useState('')
  const [transferUsd, setTransferUsd] = useState('')
  const [cardNio, setCardNio] = useState('')
  const [cardUsd, setCardUsd] = useState('')
  const [notes, setNotes] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CashSummary | null>(null)

  // Lo esperado viene del servidor. Se vuelve a pedir cuando cambia la cola (al sincronizar entran ventas nuevas).
  const [expected, setExpected] = useState<{ pendingCount: number; value: CashSummary } | null>(null)
  const [expectedError, setExpectedError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!online) return
    let cancelled = false
    posRequest<CashSummary>(`/api/v1/cash/sessions/${session.id}/summary`)
      .then((value) => {
        if (cancelled) return
        setExpected({ pendingCount, value })
        setExpectedError(null)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setExpectedError(errorMessage(caught, 'No fue posible consultar lo esperado.'))
      })
    return () => { cancelled = true }
  }, [online, pendingCount, session.id, reloadKey])

  const ready = expected !== null && expected.pendingCount === pendingCount
  const exp = ready ? expected.value : null

  const countedNio = useMemo(() => {
    const bills = denominations.reduce((sum, value) => sum + value * Math.floor(parseAmount(counts[value] ?? '')), 0)
    return round2(bills + parseAmount(coins))
  }, [counts, coins])
  const countedUsd = parseAmount(usd)

  const rows = useMemo(() => (exp
    ? liveRows(exp, {
      cashNio: countedNio, cashUsd: countedUsd,
      transferNio: parseOptionalAmount(transferNio), transferUsd: parseOptionalAmount(transferUsd),
      cardNio: parseOptionalAmount(cardNio), cardUsd: parseOptionalAmount(cardUsd),
    })
    : []), [exp, countedNio, countedUsd, transferNio, transferUsd, cardNio, cardUsd])
  const hasDifferences = rows.some((row) => row.difference !== null && row.difference !== 0)

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
        body: buildCloseRequest({ countedCashNio: countedNio, countedCashUsd: countedUsd, notes, transferNio, transferUsd, cardNio, cardUsd }),
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
    const cashLines: [string, string][] = [
      ['Recibido en C$', formatNio(totals.cashNioTendered)],
      ...(totals.cashUsdTendered > 0 ? [[`Recibido en US$ (${formatNio(totals.cashUsdEquivalentNio)})`, formatUsd(totals.cashUsdTendered)] as [string, string]] : []),
      ...(totals.changeGivenNio > 0 ? [['Cambio entregado', `−${formatNio(totals.changeGivenNio)}`] as [string, string]] : []),
    ]
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
          <ReconTable rows={reconciliationRows(summary)} />
          {summary.session.closingNotes && <p className="pv-note">Notas: {summary.session.closingNotes}</p>}
          <div className="pv-summary-grid">
            <section>
              <h3>Ventas</h3>
              <Row label="Ventas realizadas">{totals.salesCount}</Row>
              <Row label="Anuladas">{totals.voidedCount} · {formatNio(totals.voidedTotalNio)}</Row>
              <Row label="Venta bruta">{formatNio(totals.grossTotalNio)}</Row>
              <Row label="Descuentos">−{formatNio(totals.discountTotalNio)}</Row>
              <Row label="Total vendido" strong>{formatNio(totals.netTotalNio)}</Row>
              {totals.reviewCount > 0 && <p className="pv-banner pv-banner-warn">{totals.reviewCount} venta(s) con revisión pendiente.</p>}
              {totals.byChannel.length > 0 && <h3 className="pv-sub">Por canal</h3>}
              {totals.byChannel.map((item) => <Row key={item.channel} label={`${channelLabel[item.channel]} (${item.salesCount})`}>{formatNio(item.totalNio)}</Row>)}
            </section>
            <section>
              <h3>Vendido por método de pago</h3>
              <Row label="Efectivo (neto)" strong>{formatNio(totals.cashTotalNio)}</Row>
              {cashLines.map(([label, value]) => <Row key={label} label={`· ${label}`}>{value}</Row>)}
              <Row label="Transferencias" strong>{formatNio(totals.transferTotalNio)}</Row>
              {totals.transferNioTendered > 0 && <Row label="· Recibido en C$">{formatNio(totals.transferNioTendered)}</Row>}
              {totals.transferUsdTendered > 0 && <Row label={`· Recibido en US$ (${formatNio(totals.transferUsdEquivalentNio)})`}>{formatUsd(totals.transferUsdTendered)}</Row>}
              {totals.transfersByBank.map((item) => (
                <Row key={item.bank} label={`· ${item.bank}`}>{formatNio(item.totalNio)}{item.totalUsd > 0 ? ` (${formatUsd(item.totalUsd)})` : ''}</Row>
              ))}
              <Row label="Tarjeta (terminal)" strong>{formatNio(totals.cardTotalNio)}</Row>
              {totals.cardNioTendered > 0 && <Row label="· Cobrado en C$">{formatNio(totals.cardNioTendered)}</Row>}
              {totals.cardUsdTendered > 0 && <Row label={`· Cobrado en US$ (${formatNio(totals.cardUsdEquivalentNio)})`}>{formatUsd(totals.cardUsdTendered)}</Row>}
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
          <span className="pv-confirm-text">¿Cerrar la caja con estos montos?</span>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>Revisar</button>
          <button type="button" className="pv-btn pv-btn-primary" onClick={() => { void closeCash() }} disabled={busy} data-autofocus>
            {busy ? 'Cerrando…' : 'Sí, cerrar caja'}
          </button>
        </>
      ) : (
        <>
          <button type="button" className="pv-btn pv-btn-ghost" onClick={onCancel}>Cancelar</button>
          <button type="button" className="pv-btn pv-btn-primary" disabled={blockedReason !== null || !ready} onClick={() => setConfirming(true)}>Cerrar caja</button>
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
        {online && !blockedReason && !ready && (
          expectedError
            ? (
              <div className="pv-banner pv-banner-warn" role="alert">
                {expectedError}{' '}
                <button type="button" className="pv-link" onClick={() => { setExpectedError(null); setReloadKey((key) => key + 1) }}>Reintentar</button>
              </div>
            )
            : <div className="pv-banner" role="status">Consultando lo esperado por el sistema…</div>
        )}
        {attentionCount > 0 && (
          <div className="pv-banner pv-banner-warn" role="alert">
            {attentionCount} {attentionCount === 1 ? 'venta fue rechazada' : 'ventas fueron rechazadas'} por el servidor y no entra{attentionCount === 1 ? '' : 'n'} en el cierre. Revisalas en «Ventas de esta caja».
          </div>
        )}

        {confirming ? (
          <div className="pv-summary">
            <p className="pv-note">Revisá el resumen. Lo esperado lo calcula el sistema; lo verificado es lo que escribiste.</p>
            <ReconTable rows={rows} />
            {hasDifferences && <p className="pv-banner pv-banner-warn">Hay diferencias. Podés revisar los montos o cerrar igual y dejar una nota.</p>}
            {notes.trim() && <p className="pv-note">Notas: {notes.trim()}</p>}
          </div>
        ) : (
          <>
            <p className="pv-note">Contá y verificá cada método contra su fuente. El sistema muestra lo esperado; vos escribís lo que encontrás.</p>

            <section className="pv-close-sec" aria-label="Efectivo">
              <h3><i className="pv-step">1</i> Efectivo</h3>
              <div className="pv-expect">
                <span>Esperado en la gaveta (con el fondo inicial)</span>
                <b>{exp ? formatNio(exp.expectedCashNio) : '…'}</b>
                <b>{exp ? formatUsd(exp.expectedCashUsd) : '…'}</b>
              </div>
              <div className="pv-close-grid">
                <div>
                  <h4>Córdobas (C$)</h4>
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
                  {exp && <Row label="Diferencia C$"><Diff value={difference(exp.expectedCashNio, countedNio)} format={formatNio} /></Row>}
                </div>
                <div>
                  <h4>Dólares (US$)</h4>
                  <label className="pv-field">Total en dólares
                    <input inputMode="decimal" value={usd} placeholder="0.00" onChange={(event) => setUsd(event.target.value)} />
                  </label>
                  <Row label="Total contado US$" strong>{formatUsd(countedUsd)}</Row>
                  {exp && <Row label="Diferencia US$"><Diff value={difference(exp.expectedCashUsd, countedUsd)} format={formatUsd} /></Row>}
                </div>
              </div>
            </section>

            {exp ? (
              <>
                <VerifySection
                  step={2} title="Transferencias" verifyLabel="Total verificado en el banco (lo que ves en el banco por este turno)."
                  expectedNio={exp.expectedTransferNio} expectedUsd={exp.expectedTransferUsd}
                  valueNio={transferNio} valueUsd={transferUsd} onNio={setTransferNio} onUsd={setTransferUsd}
                  byBank={exp.totals.transfersByBank}
                />
                <VerifySection
                  step={3} title="Tarjeta (POS)" verifyLabel="Total según el cierre de lote de la terminal."
                  expectedNio={exp.expectedCardNio} expectedUsd={exp.expectedCardUsd}
                  valueNio={cardNio} valueUsd={cardUsd} onNio={setCardNio} onUsd={setCardUsd}
                />
              </>
            ) : (
              <p className="pv-hint">Las transferencias y la tarjeta se muestran cuando el sistema entrega lo esperado.</p>
            )}

            <section className="pv-close-sec" aria-label="Notas">
              <h3><i className="pv-step">4</i> Notas</h3>
              <label className="pv-field">Notas del cierre (opcional)
                <textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ej.: faltaron C$ 10 por cambio" />
              </label>
            </section>
          </>
        )}
        {error && <p className="pv-error" role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
