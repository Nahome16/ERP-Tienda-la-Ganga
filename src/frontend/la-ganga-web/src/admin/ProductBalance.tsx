import { useEffect, useState } from 'react'
import type { ProductDetail } from '../lib/apiTypes'
import { apiRequest } from '../lib/api'
import { formatNio } from '../lib/money'
import { productBalance, type BalanceGroup, type VariantSales } from './productBalance'

const money = (value: number | null) => (value === null ? '—' : formatNio(value))
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)} %`)

/**
 * Balance del producto en la ficha: por cada grupo de precio (por ejemplo las tallas con precio
 * especial), cuántas unidades hay, cuánto costaron, cuánto valen a precio de venta y la ganancia
 * esperada; y de lo ya vendido, los ingresos y la ganancia real.
 */
export function ProductBalance({ product, canSeeCosts }: { product: ProductDetail; canSeeCosts: boolean }) {
  const [sales, setSales] = useState<VariantSales[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest<VariantSales[]>(`/api/v1/products/${product.id}/sales-summary`, { signal: controller.signal })
      .then(setSales)
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [product.id, product.version])

  const { groups, total } = productBalance(product.variants, sales ?? [])
  if (product.variants.length === 0) return null
  const rows: BalanceGroup[] = groups.length > 1 ? [...groups, total] : [total]

  return (
    <section className="adm-balance" aria-label="Balance del producto">
      <h3>Balance <small>{groups.some((group) => group.special) ? 'Las tallas con precio especial van por separado.' : 'Todas las tallas tienen el mismo precio.'}</small></h3>
      <div className="table-scroll">
        <table className="adm-table adm-balance-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th className="numeric">Precio</th>
              {canSeeCosts && <th className="numeric">Costo c/u</th>}
              <th className="numeric">En existencia</th>
              {canSeeCosts && <th className="numeric">Costo total</th>}
              <th className="numeric">Valor de venta</th>
              {canSeeCosts && <th className="numeric">Ganancia esperada</th>}
              {canSeeCosts && <th className="numeric">Margen</th>}
              <th className="numeric">Vendidas</th>
              <th className="numeric">Ingresos</th>
              {canSeeCosts && <th className="numeric">Ganancia real</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((group) => (
              <tr key={group.key} className={group.key === 'total' ? 'is-total' : undefined}>
                <td>
                  {group.label}
                  {group.special && <span className="adm-pill adm-pill-special">Precio especial</span>}
                </td>
                <td className="numeric">{group.key === 'total' ? '' : formatNio(group.price)}</td>
                {canSeeCosts && <td className="numeric">{group.key === 'total' ? '' : money(group.cost)}</td>}
                <td className="numeric">{group.units}</td>
                {canSeeCosts && <td className="numeric">{money(group.costTotal)}</td>}
                <td className="numeric">{formatNio(group.saleValue)}</td>
                {canSeeCosts && <td className="numeric">{money(group.expectedProfit)}</td>}
                {canSeeCosts && <td className="numeric">{percent(group.margin)}</td>}
                <td className="numeric">{sales === null && !failed ? '…' : group.soldUnits}</td>
                <td className="numeric">{sales === null && !failed ? '…' : formatNio(group.soldRevenue)}</td>
                {canSeeCosts && <td className="numeric">{sales === null && !failed ? '…' : money(group.soldProfit)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failed && <p className="adm-help">No se pudo cargar lo vendido; el resto del balance es correcto.</p>}
      {canSeeCosts && total.costTotal === null && <p className="adm-help">Algunas tallas no tienen costo: la ganancia esperada se calcula cuando todas lo tengan.</p>}
    </section>
  )
}
