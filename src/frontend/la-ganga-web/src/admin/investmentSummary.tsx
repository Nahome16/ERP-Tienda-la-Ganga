import type { InvestmentSummary, Partner, PartnerSummary } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { formatInt } from './format'
import { filterOf, type PartnerFilter } from './investmentApi'
import { InvestedCell, Money, PartnerTag, ProfitCell, Section } from './investmentUi'
import { Kpi, LoadError, Notice, Spinner } from './ui'

/** Tarjetas de totales (las existencias son siempre las de hoy). */
export function TotalsCards({ row, title }: { row: PartnerSummary; title?: string }) {
  return (
    <div className="adm-kpis inv-kpis" role="group" aria-label={title ?? 'Totales'}>
      <Kpi label="Inversión total" value={formatNio(row.investedNio)} hint={row.unitsWithoutCost > 0 ? `Incompleta: faltan costos en ${formatInt(row.unitsWithoutCost)} unid.` : `${formatInt(row.unitsEntered)} unid. ingresadas`} tone={row.unitsWithoutCost > 0 ? 'warn' : undefined} />
      <Kpi label="Existencias al costo" value={formatNio(row.stockAtCostNio)} hint={`${formatInt(row.unitsInStock)} unid. hoy`} />
      <Kpi label="Existencias a precio de venta" value={formatNio(row.stockAtPriceNio)} hint="Al precio actual, hoy" />
      <Kpi label="Vendido" value={formatNio(row.revenueNio)} hint={`${formatInt(row.unitsSold)} unid. vendidas`} />
      <Kpi label="Ganancia" value={formatNio(row.profitNio)} tone={row.profitNio < 0 ? 'danger' : row.soldUnitsWithoutCost > 0 ? 'warn' : undefined}
        hint={row.soldUnitsWithoutCost > 0 ? `Parcial: ${formatInt(row.soldUnitsWithoutCost)} unid. vendidas sin costo` : `Costo de lo vendido ${formatNio(row.costOfSoldNio)}`} />
    </div>
  )
}

export function SummaryPanel({ summary, loading, error, onRetry, onOpen, onAssign, canManage, rangeText, partners }: {
  summary: InvestmentSummary | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpen: (filter: PartnerFilter) => void
  onAssign: () => void
  canManage: boolean
  rangeText: string
  partners: Partner[]
}) {
  const inactive = new Set(partners.filter((partner) => !partner.isActive).map((partner) => partner.id))
  return (
    <>
      <Notice tone="info">
        <span>Las <b>existencias son siempre las de hoy</b> (no dependen de las fechas). Las <b>entradas</b> (unidades ingresadas e inversión) y las <b>ventas</b> (vendido y ganancia) corresponden al período elegido: <b>{rangeText}</b>.</span>
      </Notice>
      {error && <LoadError message={error} onRetry={onRetry} />}
      {loading && !summary && <Spinner label="Calculando el resumen por socio…" />}
      {summary && (
        <>
          <TotalsCards row={summary.totals} title="Totales de todos los socios" />
          <Section title="Resumen por socio" hint="Hacé clic en un socio para ver sus productos y sus entradas de mercadería.">
            <div className="table-scroll" aria-busy={loading}>
              <table className="adm-table inv-table" aria-label="Resumen por socio">
                <thead>
                  <tr>
                    <th>Socio</th>
                    <th className="numeric">Unid. ingresadas</th>
                    <th className="numeric">Inversión</th>
                    <th className="numeric">Existencias (unid.)</th>
                    <th className="numeric">Exist. al costo</th>
                    <th className="numeric">Exist. a precio</th>
                    <th className="numeric">Unid. vendidas</th>
                    <th className="numeric">Vendido</th>
                    <th className="numeric">Costo de lo vendido</th>
                    <th className="numeric">Ganancia</th>
                    <th className="numeric">Pérdidas</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.partners.length === 0 && <tr><td colSpan={11} className="adm-empty">Todavía no hay movimientos de inversión en este período.</td></tr>}
                  {summary.partners.map((row) => (
                    <tr key={row.partnerId ?? 'none'} className="clickable" onClick={() => onOpen(filterOf(row.partnerId))}>
                      <td>
                        <button type="button" className="link-button inv-partner-link" onClick={(event) => { event.stopPropagation(); onOpen(filterOf(row.partnerId)) }} aria-label={`Ver detalle de ${row.partnerName}`}>
                          <PartnerTag name={row.partnerName} partnerId={row.partnerId} />
                        </button>
                        {row.partnerId !== null && inactive.has(row.partnerId) && <small className="row-sub">Inactivo</small>}
                        {row.partnerId === null && canManage && (
                          <button type="button" className="link-button inv-assign" onClick={(event) => { event.stopPropagation(); onAssign() }}>Asignar socio a estas entradas</button>
                        )}
                      </td>
                      <td className="numeric">{formatInt(row.unitsEntered)}</td>
                      <td className="numeric"><InvestedCell row={row} /></td>
                      <td className="numeric">{formatInt(row.unitsInStock)}</td>
                      <td className="numeric">{formatNio(row.stockAtCostNio)}</td>
                      <td className="numeric">{formatNio(row.stockAtPriceNio)}</td>
                      <td className="numeric">{formatInt(row.unitsSold)}</td>
                      <td className="numeric">{formatNio(row.revenueNio)}</td>
                      <td className="numeric">{formatNio(row.costOfSoldNio)}</td>
                      <td className="numeric"><strong><ProfitCell row={row} /></strong></td>
                      <td className="numeric">
                        {row.lossUnits > 0 ? <><span className="adm-neg">{formatNio(row.lossCostNio)}</span><small className="row-sub">{formatInt(row.lossUnits)} unid.</small></> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {summary.partners.length > 0 && (
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="numeric">{formatInt(summary.totals.unitsEntered)}</td>
                      <td className="numeric"><InvestedCell row={summary.totals} /></td>
                      <td className="numeric">{formatInt(summary.totals.unitsInStock)}</td>
                      <td className="numeric">{formatNio(summary.totals.stockAtCostNio)}</td>
                      <td className="numeric">{formatNio(summary.totals.stockAtPriceNio)}</td>
                      <td className="numeric">{formatInt(summary.totals.unitsSold)}</td>
                      <td className="numeric">{formatNio(summary.totals.revenueNio)}</td>
                      <td className="numeric">{formatNio(summary.totals.costOfSoldNio)}</td>
                      <td className="numeric"><ProfitCell row={summary.totals} /></td>
                      <td className="numeric">{summary.totals.lossUnits > 0 ? <Money value={summary.totals.lossCostNio} /> : '—'}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Section>
        </>
      )}
    </>
  )
}
