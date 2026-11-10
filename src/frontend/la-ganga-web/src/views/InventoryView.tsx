import { useState, type FormEvent } from 'react'
import { PackagePlus, Plus, ScanBarcode, Search } from 'lucide-react'
import { ApiError } from '../lib/api'
import { hasPermission } from '../lib/access'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { getInventorySummary, getProductByBarcode, getSettings, getVariantByBarcode, listInventory } from '../admin/adminApi'
import { formatInt, messageFrom } from '../admin/format'
import { useDebounced, useFetch } from '../admin/hooks'
import { noPartnerFilter, partnerFilterParam, partnerUnitsLabel } from '../admin/partners'
import { ExcelShortcut } from '../admin/reportsUi'
import { LoadError, Kpi, Notice, Pagination, Spinner, Tag } from '../admin/ui'
import { usePartners } from '../admin/usePartners'
import { Thumb } from '../admin/ImageManager'
import { ProductDetailDialog } from '../admin/ProductDetailDialog'
import { ProductPickerDialog } from '../admin/ProductPickerDialog'
import { CreateProductDialog } from '../admin/ProductDialogs'
import { ReceiveStockDialog } from '../admin/ReceiveStockDialog'
import { useCatalogs } from '../admin/useCatalogs'
import { VariantPanel, type PanelVariant } from '../admin/VariantPanel'

const pageSize = 25
const filters = [
  { value: 'all', label: 'Todos' },
  { value: 'low', label: 'Bajo stock' },
  { value: 'out', label: 'Agotados' },
  { value: 'negative', label: 'Negativos' },
] as const
type FilterValue = typeof filters[number]['value']

export function InventoryView({ user }: { user: CurrentUser }) {
  const canCost = hasPermission(user, 'inventory.cost.read')
  const canPartners = hasPermission(user, 'investment.read')
  const canCreate = hasPermission(user, 'product.create')
  const canReceive = hasPermission(user, 'inventory.adjust')
  const catalogs = useCatalogs()
  const [detailId, setDetailId] = useState<string | null>(null)
  const [creating, setCreating] = useState<{ barcode?: string } | null>(null)
  const [picking, setPicking] = useState(false)
  const [receiveId, setReceiveId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const [filter, setFilter] = useState<FilterValue>('all')
  const [partnerId, setPartnerId] = useState('')
  const [page, setPage] = useState(1)
  const [scan, setScan] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<{ tone: 'error' | 'warn'; text: string } | null>(null)
  const [selected, setSelected] = useState<PanelVariant | null>(null)

  const summary = useFetch('inv-summary', (signal) => getInventorySummary(signal))
  const settings = useFetch('inv-settings', (signal) => getSettings(signal))
  // Se piden también los inactivos: pueden tener existencias y hay que poder filtrarlos.
  const partnerList = usePartners('all', canPartners)
  const partnerParam = canPartners ? partnerFilterParam(partnerId) : undefined
  const list = useFetch(`inv|${search}|${filter}|${partnerParam ?? ''}|${page}`, (signal) => listInventory({ search, filter, page, pageSize, partnerId: partnerParam }, signal))
  const lowThreshold = settings.data?.lowStockThreshold ?? 2

  function refreshAll() {
    summary.reload()
    list.reload()
  }

  function chooseFilter(value: FilterValue) {
    setFilter(value)
    setPage(1)
  }

  async function submitScan(event: FormEvent) {
    event.preventDefault()
    const code = scan.trim()
    if (!code) return
    setScanning(true)
    setScanNotice(null)
    try {
      const variant = await getVariantByBarcode(code)
      setSelected({
        variantId: variant.id, productId: variant.productId, productName: variant.productName, sizeName: variant.sizeName, colorName: variant.colorName,
        barcode: variant.barcode, price: variant.price, stock: variant.stock, cost: variant.cost,
      })
      setScan('')
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) {
        setScan('')
        // ¿Es el código de fábrica de un producto (igual en todas las tallas)? Se abre el producto.
        try {
          const product = await getProductByBarcode(code)
          setDetailId(product.id)
          return
        } catch (productError) {
          if (!(productError instanceof ApiError && productError.status === 404)) {
            setScanNotice({ tone: 'error', text: messageFrom(productError) })
            return
          }
        }
        if (canCreate && catalogs.data) {
          // Código nuevo: se abre el alta del producto con el código ya cargado.
          setCreating({ barcode: code })
        } else {
          setScanNotice({ tone: 'warn', text: `No existe ninguna variante con el código ${code}.` })
        }
      } else {
        setScanNotice({ tone: 'error', text: messageFrom(caught) })
      }
    } finally {
      setScanning(false)
    }
  }

  const showPartnerStock = canPartners && partnerParam !== undefined
  const columns = 7 + (canCost ? 2 : 0) + (showPartnerStock ? 1 : 0) + (canPartners ? 1 : 0)
  const rows = list.data?.items ?? []
  const stats = summary.data

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Inventario · <b className="live-data">Datos reales</b></p>
          <h1>Inventario</h1>
          <p className="page-summary">Existencias por variante. Escaneá un código para abrir su ficha, ver el Kardex o registrar un movimiento. Si el código es nuevo, se abre el alta del producto con ese código.</p>
        </div>
        <div className="page-actions">
          {hasPermission(user, 'inventory.read') && <ExcelShortcut kind="inventory" />}
          {canReceive && (
            <button type="button" className="primary-button" onClick={() => setPicking(true)} disabled={!catalogs.data}>
              <PackagePlus size={16} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Ingresar mercadería
            </button>
          )}
          {canCreate && (
            <button type="button" className="secondary-button" onClick={() => setCreating({})} disabled={!catalogs.data}>
              <Plus size={16} strokeWidth={2} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />Nuevo producto
            </button>
          )}
        </div>
      </header>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {summary.error && <LoadError message={summary.error} onRetry={summary.reload} />}
      <div className="adm-kpis">
        <Kpi label="Unidades" value={stats ? formatInt(stats.totalUnits) : '—'} hint={stats ? `${formatInt(stats.totalVariants)} variantes` : undefined} />
        <Kpi label="Bajo stock" value={stats ? formatInt(stats.lowStockCount) : '—'} hint={`Con ${lowThreshold} o menos`} tone={stats && stats.lowStockCount > 0 ? 'warn' : undefined} onClick={() => chooseFilter('low')} />
        <Kpi label="Agotados" value={stats ? formatInt(stats.outOfStockCount) : '—'} hint="Existencia en cero" tone={stats && stats.outOfStockCount > 0 ? 'warn' : undefined} onClick={() => chooseFilter('out')} />
        <Kpi label="Negativos" value={stats ? formatInt(stats.negativeCount) : '—'} hint="Requieren revisión" tone={stats && stats.negativeCount > 0 ? 'danger' : 'ok'} onClick={() => chooseFilter('negative')} />
      </div>

      <section className="panel-card adm-card">
        <div className="adm-toolbar">
          <form className="adm-scanner" onSubmit={(event) => { void submitScan(event) }} role="search">
            <ScanBarcode size={20} strokeWidth={1.75} aria-hidden="true" />
            <input
              value={scan} onChange={(event) => setScan(event.target.value)} autoFocus inputMode="numeric"
              placeholder="Escaneá o escribí el código de barras y presioná Enter" aria-label="Escáner de código de barras"
            />
            <button type="submit" className="secondary-button" disabled={scanning || !scan.trim()}>{scanning ? 'Buscando…' : 'Buscar'}</button>
          </form>
          <label className="catalog-search grow">
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input
              type="search" placeholder="Buscar por nombre, marca, talla, color o código" aria-label="Buscar en inventario"
              value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1) }}
            />
          </label>
        </div>
        {scanNotice && <Notice tone={scanNotice.tone}>{scanNotice.text}</Notice>}

        <div className="inv-filters">
          <nav className="catalog-tabs" aria-label="Filtro de existencias">
            {filters.map((item) => (
              <button key={item.value} type="button" className={filter === item.value ? 'active' : undefined} aria-pressed={filter === item.value} onClick={() => chooseFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </nav>
          {canPartners && (
            <label className="inv-partner-filter">
              <span>Socio</span>
              <select value={partnerId} onChange={(event) => { setPartnerId(event.target.value); setPage(1) }} aria-label="Filtrar por socio">
                <option value="">Todos</option>
                {partnerList.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}{partner.isActive ? '' : ' (inactivo)'}</option>)}
                <option value={noPartnerFilter}>Sin socio</option>
              </select>
            </label>
          )}
        </div>
        {canPartners && partnerList.error && <Notice tone="warn">No se pudo cargar la lista de socios: el filtro solo ofrece «Todos» y «Sin socio». <button type="button" className="link-button" onClick={partnerList.reload}>Reintentar</button></Notice>}

        {list.error && <LoadError message={list.error} onRetry={list.reload} />}

        <div className="table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Producto</th><th>Talla</th><th>Color</th><th>Código</th><th className="numeric">Precio</th>
                {canCost && <th className="numeric">Costo</th>}
                {showPartnerStock && <th className="numeric">Unidades del socio</th>}
                <th className="numeric">Existencia</th>
                {canPartners && <th>Socios</th>}
                {canCost && <th className="numeric">Valor al costo</th>}
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {list.loading && rows.length === 0 && <tr><td colSpan={columns}><Spinner label="Cargando inventario…" /></td></tr>}
              {!list.loading && !list.error && rows.length === 0 && <tr><td colSpan={columns} className="adm-empty">No hay variantes con estos filtros.</td></tr>}
              {rows.map((row) => (
                <tr
                  key={row.variantId}
                  className={row.stock < 0 ? 'clickable neg-row' : 'clickable'}
                  tabIndex={0}
                  onClick={() => setSelected({ ...row })}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected({ ...row }) } }}
                  aria-label={`${row.productName} talla ${row.sizeName} ${row.colorName}, existencia ${row.stock}`}
                >
                  <td>
                    <div className="inv-product-cell">
                      <Thumb src={row.imageUrl} name={row.productName} size={40} />
                      <div>
                        <button
                          type="button" className="link-button row-title" style={{ padding: 0, textAlign: 'left' }}
                          title="Ver producto: fotos, tallas y colores"
                          onClick={(event) => { event.stopPropagation(); setDetailId(row.productId) }}
                          onKeyDown={(event) => event.stopPropagation()}
                        >{row.productName}</button>
                        <small className="row-sub">{row.categoryName}</small>
                      </div>
                    </div>
                  </td>
                  <td>{row.sizeName}</td>
                  <td>{row.colorName}</td>
                  <td className="adm-mono">{row.barcode}</td>
                  <td className="numeric">{formatNio(row.price)}</td>
                  {canCost && <td className="numeric">{row.cost == null ? '—' : formatNio(row.cost)}</td>}
                  {showPartnerStock && <td className="numeric"><strong>{row.partnerStock ?? 0}</strong></td>}
                  <td className={row.stock < 0 ? 'numeric adm-neg' : 'numeric'}><strong>{row.stock}</strong></td>
                  {canPartners && (
                    <td className="inv-partners" title={partnerUnitsLabel(row.partners)}>
                      {(row.partners ?? []).filter((item) => item.units !== 0).map((item) => (
                        <span key={item.partnerId ?? 'none'} className={item.partnerId === null ? 'inv-chip none' : 'inv-chip'}>{item.name || 'Sin socio'}: <b>{item.units}</b></span>
                      ))}
                      {!partnerUnitsLabel(row.partners) && <span className="adm-muted">—</span>}
                    </td>
                  )}
                  {canCost && <td className="numeric">{row.stockValue == null ? '—' : formatNio(row.stockValue)}</td>}
                  <td>
                    {row.stock < 0 ? <Tag tone="danger">Requiere revisión</Tag>
                      : row.stock === 0 ? <Tag tone="danger">Agotado</Tag>
                        : row.stock <= lowThreshold ? <Tag tone="warn">Bajo stock</Tag> : <Tag tone="ok">Disponible</Tag>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.data && <Pagination page={list.data.page} totalPages={list.data.totalPages} totalCount={list.data.totalCount} onPage={setPage} noun="variantes" />}
      </section>

      {selected && (
        <VariantPanel
          key={selected.variantId} user={user} variant={selected} lowThreshold={lowThreshold}
          onClose={() => setSelected(null)} onChanged={refreshAll}
          onOpenProduct={selected.productId ? () => { setDetailId(selected.productId ?? null); setSelected(null) } : undefined}
          onReceive={selected.productId ? () => { setReceiveId(selected.productId ?? null); setSelected(null) } : undefined}
        />
      )}
      {detailId && catalogs.data && (
        <ProductDetailDialog
          key={detailId} productId={detailId} user={user} catalogs={catalogs.data} openLabels={false}
          onClose={() => setDetailId(null)} onChanged={refreshAll}
        />
      )}
      {picking && (
        <ProductPickerDialog
          onClose={() => setPicking(false)}
          onPick={(id) => { setPicking(false); setReceiveId(id) }}
          onCreate={canCreate ? () => { setPicking(false); setCreating({}) } : undefined}
        />
      )}
      {receiveId && catalogs.data && (
        <ReceiveStockDialog key={receiveId} productId={receiveId} user={user} catalogs={catalogs.data} onClose={() => setReceiveId(null)} onChanged={refreshAll} />
      )}
      {creating && catalogs.data && (
        <CreateProductDialog
          user={user} catalogs={catalogs.data} onClose={() => setCreating(null)}
          initialBarcode={creating.barcode}
          onOpenExisting={(productId) => { setCreating(null); setDetailId(productId) }}
          onCreated={(product, images) => {
            setCreating(null)
            const base = `Producto «${product.name}» creado con ${product.variants.length} variante${product.variants.length === 1 ? '' : 's'}.`
            setNotice(images && images.failed.length > 0
              ? { tone: 'warn', text: `${base} No se pudo subir: ${images.failed.map((item) => `«${item.name}»`).join(', ')}. Reintentá desde la ficha del producto.` }
              : { tone: 'ok', text: images ? `${base} Se subieron ${images.total} ${images.total === 1 ? 'foto' : 'fotos'}.` : base })
            refreshAll()
            setDetailId(product.id)
          }}
        />
      )}
    </main>
  )
}
