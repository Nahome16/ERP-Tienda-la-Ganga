import { useState } from 'react'
import { Printer, Search } from 'lucide-react'
import { apiRequest } from '../lib/api'
import { formatDateTime } from '../admin/format'
import { useDebounced, useFetch } from '../admin/hooks'
import { Thumb } from '../admin/ImageManager'
import { LabelsDialog, type LabelVariant } from '../admin/LabelsDialog'
import { LoadError, Notice, Pagination, Spinner, Swatch, Tag } from '../admin/ui'
import type { PageResult } from '../lib/apiTypes'

/** Una etiqueta de código generado: de una talla y color, o del producto entero (variantId nulo). */
export type LabelRow = {
  productId: string
  variantId: string | null
  productName: string
  sizeName: string | null
  colorName: string | null
  colorHex: string | null
  barcode: string
  price: number
  stock: number
  imageUrl: string | null
  lastPrintedAtUtc: string | null
  lastCopies: number
  pending: boolean
}

type Status = 'pending' | 'printed' | 'all'

const pageSize = 25
const keyOf = (row: LabelRow) => row.variantId ?? `p:${row.productId}`

const listLabels = (search: string, status: Status, page: number, signal?: AbortSignal) =>
  apiRequest<PageResult<LabelRow>>(`/api/v1/labels?status=${status}&page=${page}&pageSize=${pageSize}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''}`, { signal })

const markPrinted = (items: { productId: string; variantId: string | null; copies: number }[]) =>
  apiRequest<number>('/api/v1/labels/printed', { method: 'POST', body: { items } })

/**
 * Etiquetas de las prendas que llegaron sin código de barras: el sistema les generó uno (por talla
 * y color, o uno para todo el producto). Aquí se ve cuáles faltan imprimir y se imprimen.
 */
export function LabelsView() {
  const [status, setStatus] = useState<Status>('pending')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Record<string, LabelRow>>({})
  const [printing, setPrinting] = useState<LabelRow[] | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const list = useFetch(`labels|${search}|${status}|${page}`, (signal) => listLabels(search, status, page, signal))
  const rows = list.data?.items ?? []
  const selectedRows = Object.values(selected)
  const allOnPage = rows.length > 0 && rows.every((row) => selected[keyOf(row)])

  function toggle(row: LabelRow, on: boolean) {
    setSelected((current) => {
      const next = { ...current }
      if (on) next[keyOf(row)] = row
      else delete next[keyOf(row)]
      return next
    })
  }

  function togglePage(on: boolean) {
    setSelected((current) => {
      const next = { ...current }
      for (const row of rows) {
        if (on) next[keyOf(row)] = row
        else delete next[keyOf(row)]
      }
      return next
    })
  }

  function chooseStatus(next: Status) {
    setStatus(next)
    setPage(1)
    setSelected({})
  }

  const labelVariants: LabelVariant[] = (printing ?? []).map((row) => ({
    variantId: keyOf(row),
    productName: row.productName,
    sizeName: row.sizeName ?? '',
    colorName: row.variantId ? row.colorName ?? '' : 'Todas las tallas',
    barcode: row.barcode,
    price: row.price,
    stock: row.stock,
  }))

  async function printed(items: { variantId: string; copies: number }[]) {
    const byKey = new Map((printing ?? []).map((row) => [keyOf(row), row]))
    const body = items.map((item) => {
      const row = byKey.get(item.variantId)!
      return { productId: row.productId, variantId: row.variantId, copies: item.copies }
    })
    if (body.length === 0) return
    try {
      await markPrinted(body)
      const copies = body.reduce((sum, item) => sum + item.copies, 0)
      setNotice({ tone: 'ok', text: `Se marcaron como impresas ${body.length} etiqueta${body.length === 1 ? '' : 's'} (${copies} copia${copies === 1 ? '' : 's'}). Si la impresión falló, usá «Reimprimir».` })
      setSelected({})
      list.reload()
    } catch {
      setNotice({ tone: 'error', text: 'Se mandó a imprimir, pero no se pudo marcar como impresa. Recargá la lista.' })
    }
  }

  return (
    <main className="page admin-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Inventario · <b className="live-data">Datos reales</b></p>
          <h1>Etiquetas</h1>
          <p className="page-summary">Prendas que llegaron sin código de barras: el sistema les generó uno. Imprimí sus etiquetas y quedan marcadas; si entra más mercadería, vuelven a «Pendientes».</p>
        </div>
        <div className="page-actions">
          <button type="button" className="primary-button" disabled={selectedRows.length === 0} onClick={() => setPrinting(selectedRows)}>
            <Printer size={16} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
            Imprimir seleccionadas{selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
          </button>
        </div>
      </header>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      <section className="panel-card adm-card">
        <div className="adm-toolbar">
          <nav className="catalog-tabs" aria-label="Estado de las etiquetas">
            {([['pending', 'Pendientes'], ['printed', 'Impresas'], ['all', 'Todas']] as const).map(([value, label]) => (
              <button key={value} type="button" className={status === value ? 'active' : undefined} aria-pressed={status === value} onClick={() => chooseStatus(value)}>{label}</button>
            ))}
          </nav>
          <label className="catalog-search grow">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input type="search" placeholder="Buscar por producto, talla, color o código" aria-label="Buscar etiquetas" value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1) }} />
          </label>
        </div>

        {list.error && <LoadError message={list.error} onRetry={list.reload} />}
        <div className="table-scroll">
          <table className="adm-table labels-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allOnPage} onChange={(event) => togglePage(event.target.checked)} aria-label="Elegir todas las de esta página" disabled={rows.length === 0} /></th>
                <th>Producto</th><th>Código</th><th className="numeric">Existencia</th><th>Última impresión</th><th>Estado</th>
                <th className="actions-col"><span className="visually-hidden">Imprimir</span></th>
              </tr>
            </thead>
            <tbody>
              {list.loading && rows.length === 0 && <tr><td colSpan={7}><Spinner label="Cargando etiquetas…" /></td></tr>}
              {!list.loading && !list.error && rows.length === 0 && (
                <tr><td colSpan={7} className="adm-empty">{status === 'pending' ? 'No hay etiquetas pendientes: todo lo que tiene existencia ya está etiquetado.' : 'No hay etiquetas con estos filtros.'}</td></tr>
              )}
              {rows.map((row) => (
                <tr key={keyOf(row)} className={selected[keyOf(row)] ? 'is-selected' : undefined}>
                  <td><input type="checkbox" checked={Boolean(selected[keyOf(row)])} onChange={(event) => toggle(row, event.target.checked)} aria-label={`Elegir ${row.productName} ${row.sizeName ?? ''} ${row.colorName ?? ''}`} /></td>
                  <td>
                    <div className="inv-product-cell">
                      <Thumb src={row.imageUrl} name={row.productName} size={44} />
                      <div>
                        <strong className="row-title">{row.productName}</strong>
                        <small className="row-sub">
                          {row.variantId
                            ? <span className="adm-inline"><Swatch hex={row.colorHex} /> {row.colorName} · Talla {row.sizeName}</span>
                            : 'Código de todo el producto (en caja se elige la talla)'}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td className="adm-mono">{row.barcode}</td>
                  <td className="numeric"><strong>{row.stock}</strong></td>
                  <td>{row.lastPrintedAtUtc ? <>{formatDateTime(row.lastPrintedAtUtc)}<small className="row-sub">{row.lastCopies} copia{row.lastCopies === 1 ? '' : 's'}</small></> : <span className="adm-muted">Nunca</span>}</td>
                  <td>{row.pending ? <Tag tone="warn">Pendiente</Tag> : row.lastPrintedAtUtc ? <Tag tone="ok">Impresa</Tag> : <Tag tone="neutral">Sin existencia</Tag>}</td>
                  <td className="actions-col">
                    <button type="button" className={row.pending ? 'primary-button' : 'secondary-button'} onClick={() => setPrinting([row])}>
                      {row.lastPrintedAtUtc ? 'Reimprimir' : 'Imprimir'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} totalCount={list.data.totalCount} onPage={setPage} noun="etiquetas" />}
      </section>

      {printing && (
        <LabelsDialog
          title={printing.length === 1 ? printing[0]!.productName : `${printing.length} códigos`}
          variants={labelVariants} initialCopies="stock"
          onClose={() => setPrinting(null)}
          onPrinted={(items) => { void printed(items) }}
        />
      )}
    </main>
  )
}
