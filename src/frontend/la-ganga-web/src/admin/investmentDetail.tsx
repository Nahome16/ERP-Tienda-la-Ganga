import { formatNio } from '../lib/money'
import type { InvestmentSummary, Partner } from '../lib/apiTypes'
import { formatInt } from './format'
import { useFetch } from './hooks'
import { getBreakdown, noPartner, type InvRange, type PartnerFilter } from './investmentApi'
import { LotsPanel } from './investmentLots'
import { Money, Section } from './investmentUi'
import { TotalsCards } from './investmentSummary'
import { LoadError, Spinner, Tag } from './ui'

/** Detalle de un socio: sus datos, totales, tabla por producto y sus entradas de mercadería. */
export function PartnerDetail({ filter, partners, summary, range, rev, canManage, onBack, onChanged }: {
  filter: PartnerFilter
  partners: Partner[]
  summary: InvestmentSummary | null
  range: InvRange
  rev: number
  canManage: boolean
  onBack: () => void
  onChanged: () => void
}) {
  const partner = partners.find((item) => item.id === filter) ?? null
  const row = summary?.partners.find((item) => (item.partnerId ?? noPartner) === filter) ?? null
  const name = filter === noPartner ? 'Sin socio' : partner?.name ?? row?.partnerName ?? 'Socio'
  const breakdown = useFetch(`breakdown|${filter}|${range.from}|${range.to}|${rev}`, (signal) => getBreakdown(filter, range, signal))

  return (
    <>
      <div className="inv-detail-head">
        <button type="button" className="secondary-button" onClick={onBack}>← Volver al resumen</button>
        <div>
          <h2 className="inv-detail-title">{name}</h2>
          <p className="adm-help inv-detail-sub">
            {filter === noPartner
              ? 'Mercadería cuyo socio todavía no se registró (por ejemplo, el saldo inicial). Asignale el socio desde «Editar» en cada entrada.'
              : partner
                ? <>{partner.phone ? `Tel. ${partner.phone}` : 'Sin teléfono'}{partner.notes ? ` · ${partner.notes}` : ''} </>
                : null}
          </p>
        </div>
        {partner && <Tag tone={partner.isActive ? 'ok' : 'neutral'}>{partner.isActive ? 'Activo' : 'Inactivo'}</Tag>}
      </div>

      {!row && !summary && <Spinner label="Cargando totales…" />}
      {row && <TotalsCards row={row} title={`Totales de ${name}`} />}
      {summary && !row && <p className="adm-help">Este socio no tiene movimientos en el período elegido; las entradas de abajo muestran todo lo que se filtra por las fechas.</p>}
      {row && row.lossUnits > 0 && <p className="adm-help">Pérdidas y ajustes negativos en el período: <b><Money value={row.lossCostNio} /></b> ({formatInt(row.lossUnits)} unid.).</p>}

      <Section title="Por producto" hint="Lo ingresado, lo que queda, lo vendido y la ganancia de cada producto de este socio.">
        {breakdown.error && <LoadError message={breakdown.error} onRetry={breakdown.reload} />}
        {breakdown.loading && !breakdown.data && <Spinner label="Cargando productos…" />}
        {breakdown.data && (
          <div className="table-scroll" aria-busy={breakdown.loading}>
            <table className="adm-table inv-table" aria-label={`Productos de ${name}`}>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="numeric">Unid. ingresadas</th>
                  <th className="numeric">Inversión</th>
                  <th className="numeric">Existencias</th>
                  <th className="numeric">Exist. al costo</th>
                  <th className="numeric">Unid. vendidas</th>
                  <th className="numeric">Vendido</th>
                  <th className="numeric">Ganancia</th>
                </tr>
              </thead>
              <tbody>
                {breakdown.data.length === 0 && <tr><td colSpan={8} className="adm-empty">Este socio no tiene productos con movimientos en el período.</td></tr>}
                {breakdown.data.map((item) => (
                  <tr key={`${item.partnerId ?? 'none'}|${item.productId}`}>
                    <td><strong>{item.productName}</strong></td>
                    <td className="numeric">{formatInt(item.unitsEntered)}</td>
                    <td className="numeric">{formatNio(item.investedNio)}</td>
                    <td className="numeric">{formatInt(item.unitsInStock)}</td>
                    <td className="numeric">{formatNio(item.stockAtCostNio)}</td>
                    <td className="numeric">{formatInt(item.unitsSold)}</td>
                    <td className="numeric">{formatNio(item.revenueNio)}</td>
                    <td className="numeric"><strong><Money value={item.profitNio} /></strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Entradas de mercadería" hint="Cada ingreso de mercadería de este socio, con el costo y el precio que se dieron al ingresarla. Las ventas descuentan de la entrada más antigua primero.">
        <LotsPanel partner={filter} partners={partners} range={range} rev={rev} canManage={canManage} onChanged={onChanged} ariaLabel={`Entradas de ${name}`} />
      </Section>
    </>
  )
}
