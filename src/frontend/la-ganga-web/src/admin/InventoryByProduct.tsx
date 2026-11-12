import type { InventoryProductRow } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { Thumb } from './ImageManager'
import { Spinner, Tag } from './ui'

const range = (min: number | null | undefined, max: number | null | undefined) =>
  min == null || max == null ? '—' : min === max ? formatNio(min) : `${formatNio(min)} – ${formatNio(max)}`

/**
 * Existencias por producto madre: una fila por producto con sus códigos (fábrica y cód. ref.),
 * la existencia sumada de todas sus tallas y colores, el precio de venta, el costo, el valor al
 * costo y lo vendido. Al tocar la fila se abre la ficha con el detalle por talla y color.
 */
export function InventoryByProduct({ rows, loading, failed, canCost, lowThreshold, onOpen }: {
  rows: InventoryProductRow[]
  loading: boolean
  failed: boolean
  canCost: boolean
  lowThreshold: number
  onOpen: (productId: string) => void
}) {
  const columns = 7 + (canCost ? 2 : 0)
  return (
    <div className="table-scroll">
      <table className="adm-table inv-by-product">
        <thead>
          <tr>
            <th>Producto madre</th><th>Código de barras</th><th>Cód. ref.</th>
            <th className="numeric">Existencia</th><th className="numeric">Precio de venta</th>
            {canCost && <th className="numeric">Costo</th>}
            {canCost && <th className="numeric">Valor al costo</th>}
            <th className="numeric">Vendido</th><th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && <tr><td colSpan={columns}><Spinner label="Cargando inventario…" /></td></tr>}
          {!loading && !failed && rows.length === 0 && <tr><td colSpan={columns} className="adm-empty">No hay productos con estos filtros.</td></tr>}
          {rows.map((row) => (
            <tr
              key={row.productId} className={row.stock < 0 ? 'clickable neg-row' : 'clickable'} tabIndex={0}
              onClick={() => onOpen(row.productId)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(row.productId) } }}
              aria-label={`${row.productName}, existencia ${row.stock}`}
            >
              <td>
                <div className="inv-product-cell">
                  <Thumb src={row.imageUrl} name={row.productName} size={40} />
                  <div>
                    <strong className="row-title">{row.productName}</strong>
                    <small className="row-sub">{row.brandName} · {row.categoryName} · {row.variants} talla{row.variants === 1 ? '' : 's'}/color{row.variants === 1 ? '' : 'es'}</small>
                  </div>
                </div>
              </td>
              <td className="adm-mono">{row.barcode ?? <span className="adm-muted">—</span>}</td>
              <td className="adm-mono">{row.referenceCode ?? <span className="adm-muted">—</span>}</td>
              <td className={row.stock < 0 ? 'numeric adm-neg' : 'numeric'}><strong>{row.stock}</strong></td>
              <td className="numeric">{row.missingPrice && row.maxPrice <= 0 ? <span className="adm-warn-text">Pendiente</span> : range(row.minPrice, row.maxPrice)}</td>
              {canCost && <td className="numeric">{range(row.minCost, row.maxCost)}</td>}
              {canCost && <td className="numeric">{row.stockValue == null ? '—' : formatNio(row.stockValue)}</td>}
              <td className="numeric">
                <strong>{row.soldUnits}</strong>
                {row.soldUnits > 0 && <small className="row-sub">{formatNio(row.soldRevenue)}</small>}
              </td>
              <td>
                <span className="adm-tags">
                  {row.stock < 0 ? <Tag tone="danger">Requiere revisión</Tag>
                    : row.stock === 0 ? <Tag tone="danger">Agotado</Tag>
                      : row.stock <= lowThreshold ? <Tag tone="warn">Bajo stock</Tag> : <Tag tone="ok">Disponible</Tag>}
                  {row.missingPrice && <Tag tone="warn">Sin precio</Tag>}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
