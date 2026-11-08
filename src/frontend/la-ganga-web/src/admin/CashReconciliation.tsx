import type { CashTotals } from '../lib/apiTypes'
import { formatNio, formatUsd, round2 } from '../lib/money'
import { channelLabels } from './format'
import { currencyNames, formatMoney, methodStatus, type RecMethod } from './reconciliation'
import { Row } from './ui'

/** Diferencia de arqueo: cuadra, sobra o falta. Sin valor muestra `emptyLabel`. */
export function Difference({ value, format, emptyLabel = 'Pendiente' }: {
  value: number | null; format: (value: number) => string; emptyLabel?: string
}) {
  if (value === null) return <span className="adm-muted">{emptyLabel}</span>
  const rounded = round2(value)
  if (rounded === 0) return <span className="adm-diff-ok">Cuadra</span>
  return <span className="adm-diff-bad">{rounded > 0 ? 'Sobra' : 'Falta'} {format(Math.abs(rounded))}</span>
}

/** Indicador compacto del estado de un método (tablas). Siempre lleva texto, no solo color. */
export function ReconBadge({ method, open }: { method: RecMethod; open: boolean }) {
  const status = methodStatus(method, open)
  return (
    <span className={`adm-rec-badge ${status.tone}`}>
      {status.details.length === 0 ? status.label : status.details.map((text) => <span key={text} className="adm-rec-line">{text}</span>)}
    </span>
  )
}

/**
 * «Esperado vs verificado»: una sección por método (efectivo, transferencias, tarjeta)
 * con filas por moneda. `scope` cambia el texto cuando todavía hay cajas abiertas.
 */
export function ReconciliationBlock({ methods, open, scope }: { methods: RecMethod[]; open: boolean; scope: 'day' | 'session' }) {
  const openText = scope === 'day' ? 'Hay cajas abiertas' : 'Pendiente'
  return (
    <div className="adm-rec-grid">
      {methods.map((item) => {
        const status = methodStatus(item, open)
        return (
          <section key={item.key} className="adm-rec-card" aria-label={`${item.title}: esperado vs verificado`} data-method={item.key}>
            <header className="adm-rec-head">
              <h3>{item.title}</h3>
              <span className={`adm-rec-pill ${status.tone}`}>{status.label}</span>
            </header>
            {item.lines.map((entry) => (
              <div key={entry.currency} className="adm-rec-currency" role="group" aria-label={`${item.title} en ${currencyNames[entry.currency]}`}>
                <h4>{currencyNames[entry.currency]}</h4>
                <Row label="Esperado">{formatMoney(entry.currency, entry.expected)}</Row>
                <Row label={item.countedLabel}>
                  {entry.counted === null ? <span className="adm-muted">{open ? openText : 'No verificado'}</span> : formatMoney(entry.currency, entry.counted)}
                </Row>
                <Row label="Diferencia">
                  <Difference value={entry.difference} format={(value) => formatMoney(entry.currency, value)} emptyLabel={open ? 'Pendiente' : 'No verificado'} />
                </Row>
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}

function UsdRow({ label, usd, equivalent }: { label: string; usd: number; equivalent: number }) {
  return <Row label={label}>{formatUsd(usd)}{usd > 0 && <> ≈ {formatNio(equivalent)}</>}</Row>
}

/** Lo recibido por método y moneda (los dólares entran por efectivo, transferencia y tarjeta). */
export function TenderedBreakdown({ totals }: { totals: CashTotals }) {
  return (
    <div>
      <Row label="Efectivo en C$">{formatNio(totals.cashNioTendered)}</Row>
      <UsdRow label="Efectivo en US$" usd={totals.cashUsdTendered} equivalent={totals.cashUsdEquivalentNio} />
      <Row label="Cambio entregado (C$)">{formatNio(totals.changeGivenNio)}</Row>
      <Row label="Efectivo neto">{formatNio(totals.cashTotalNio)}</Row>
      <Row label="Transferencia en C$">{formatNio(totals.transferNioTendered)}</Row>
      <UsdRow label="Transferencia en US$" usd={totals.transferUsdTendered} equivalent={totals.transferUsdEquivalentNio} />
      <Row label="Tarjeta (POS) en C$">{formatNio(totals.cardNioTendered)}</Row>
      <UsdRow label="Tarjeta (POS) en US$" usd={totals.cardUsdTendered} equivalent={totals.cardUsdEquivalentNio} />
    </div>
  )
}

export function TotalsList({ totals }: { totals: CashTotals }) {
  return (
    <div>
      <Row label="Ventas">{totals.salesCount}</Row>
      <Row label="Anuladas">{totals.voidedCount} · {formatNio(totals.voidedTotalNio)}</Row>
      <Row label="Por revisar">{totals.reviewCount > 0 ? <span className="adm-neg">{totals.reviewCount}</span> : 0}</Row>
      <Row label="Total bruto">{formatNio(totals.grossTotalNio)}</Row>
      <Row label="Descuentos">−{formatNio(totals.discountTotalNio)}</Row>
      <Row label="Total vendido" strong>{formatNio(totals.netTotalNio)}</Row>
      <Row label="Efectivo (neto, en C$)">{formatNio(totals.cashTotalNio)}</Row>
      <Row label="Transferencia (en C$)">{formatNio(totals.transferTotalNio)}</Row>
      <Row label="POS / Tarjeta (en C$)">{formatNio(totals.cardTotalNio)}</Row>
    </div>
  )
}

export function BreakdownTables({ totals }: { totals: CashTotals }) {
  return (
    <div className="adm-columns">
      <div>
        <h3 className="adm-card-title">Transferencias por banco</h3>
        <div className="table-scroll">
          <table className="adm-table">
            <thead><tr><th>Banco</th><th className="numeric">Total en C$</th><th className="numeric">Parte en US$</th></tr></thead>
            <tbody>
              {totals.transfersByBank.length === 0 && <tr><td colSpan={3} className="adm-empty">Sin transferencias.</td></tr>}
              {totals.transfersByBank.map((bank) => (
                <tr key={bank.bank}>
                  <td>{bank.bank}</td>
                  <td className="numeric">{formatNio(bank.totalNio)}</td>
                  <td className="numeric">{bank.totalUsd > 0 ? formatUsd(bank.totalUsd) : <span className="adm-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="adm-help" style={{ marginTop: 6 }}>«Total en C$» incluye lo recibido en dólares, convertido a córdobas.</p>
      </div>
      <div>
        <h3 className="adm-card-title">Ventas por canal</h3>
        <div className="table-scroll">
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
    </div>
  )
}
