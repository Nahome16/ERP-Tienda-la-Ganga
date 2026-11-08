import { useState } from 'react'
import { hasPermission } from '../lib/access'
import { formatNio } from '../lib/money'
import type { CurrentUser } from '../types'
import { listProducts } from '../admin/adminApi'
import { useDebounced, useFetch } from '../admin/hooks'
import { Thumb } from '../admin/ImageManager'
import { ImportDialog } from '../admin/ImportDialog'
import { ProductDetailDialog } from '../admin/ProductDetailDialog'
import { CreateProductDialog } from '../admin/ProductDialogs'
import { LoadError, Notice, Pagination, Spinner, Tag } from '../admin/ui'
import { categoryOptions, useCatalogs } from '../admin/useCatalogs'

const pageSize = 25

export function ProductsView({ user }: { user: CurrentUser }) {
  const canCreate = hasPermission(user, 'product.create')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebounced(searchInput)
  const [categoryId, setCategoryId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<{ id: string; labels: boolean } | null>(null)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null)

  const catalogs = useCatalogs()
  const filter = { search, categoryId, brandId, status, page, pageSize }
  const { data, error, loading, reload } = useFetch(
    `products|${search}|${categoryId}|${brandId}|${status}|${page}`,
    (signal) => listProducts(filter, signal),
  )

  const categories = catalogs.data ? categoryOptions(catalogs.data.categories) : []
  const items = data?.items ?? []

  return (
    <main className="admin-page adm-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Inventario · <b className="live-data">Datos reales</b></p>
          <h1>Productos</h1>
          <p className="page-summary">Productos con sus variantes de talla y color. Inactivar conserva el historial.</p>
        </div>
        {canCreate && (
          <div className="page-actions">
            <button type="button" className="secondary-button" onClick={() => setImporting(true)} disabled={!catalogs.data}>Importar</button>
            <button type="button" className="primary-button" onClick={() => setCreating(true)} disabled={!catalogs.data}>＋ Nuevo producto</button>
          </div>
        )}
      </header>

      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {catalogs.error && <LoadError message={`No se pudieron cargar los catálogos: ${catalogs.error}`} onRetry={catalogs.reload} />}

      <section className="panel-card adm-card">
        <div className="adm-toolbar">
          <label className="catalog-search grow">
            <span aria-hidden="true">⌕</span>
            <input
              type="search" placeholder="Buscar por nombre, marca o código de barras" aria-label="Buscar productos"
              value={searchInput} onChange={(event) => { setSearchInput(event.target.value); setPage(1) }}
            />
          </label>
          <select aria-label="Filtrar por categoría" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1) }}>
            <option value="">Todas las categorías</option>
            {categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select aria-label="Filtrar por marca" value={brandId} onChange={(event) => { setBrandId(event.target.value); setPage(1) }}>
            <option value="">Todas las marcas</option>
            {catalogs.data?.brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <select aria-label="Filtrar por estado" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1) }}>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        {error && <LoadError message={error} onRetry={reload} />}

        <div className="table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th className="thumb-col"><span className="visually-hidden">Imagen</span></th><th>Producto</th><th>Categoría</th><th>Marca</th><th className="numeric">Precio base</th>
                <th className="numeric">Variantes</th><th className="numeric">Existencia</th><th>Estado</th>
                <th className="actions-col"><span className="visually-hidden">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && <tr><td colSpan={9}><Spinner label="Cargando productos…" /></td></tr>}
              {!loading && !error && items.length === 0 && <tr><td colSpan={9} className="adm-empty">No hay productos con estos filtros.</td></tr>}
              {items.map((product) => (
                <tr key={product.id} className={product.isActive ? undefined : 'inactive-row'}>
                  <td className="thumb-col"><Thumb src={product.primaryImageUrl} name={product.name} size={44} /></td>
                  <td>
                    <button type="button" className="link-button" style={{ padding: 0, textAlign: 'left' }} onClick={() => setDetail({ id: product.id, labels: false })}>{product.name}</button>
                    {product.cutName && <small className="row-sub">Corte {product.cutName}</small>}
                  </td>
                  <td>{product.categoryName}</td>
                  <td>{product.brandName}</td>
                  <td className="numeric">{formatNio(product.basePrice)}</td>
                  <td className="numeric">{product.variantCount}</td>
                  <td className={product.totalStock < 0 ? 'numeric adm-neg' : 'numeric'}>{product.totalStock}</td>
                  <td><Tag tone={product.isActive ? 'ok' : 'neutral'}>{product.isActive ? 'Activo' : 'Inactivo'}</Tag></td>
                  <td className="actions-col">
                    <button type="button" className="link-button" onClick={() => setDetail({ id: product.id, labels: false })}>Ver</button>
                    <button type="button" className="link-button" onClick={() => setDetail({ id: product.id, labels: true })}>Etiquetas</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && <Pagination page={data.page} totalPages={data.totalPages} totalCount={data.totalCount} onPage={setPage} noun="productos" />}
      </section>

      {detail && catalogs.data && (
        <ProductDetailDialog
          key={`${detail.id}-${detail.labels}`}
          productId={detail.id} user={user} catalogs={catalogs.data} openLabels={detail.labels}
          onClose={() => setDetail(null)} onChanged={reload}
        />
      )}
      {creating && catalogs.data && (
        <CreateProductDialog
          user={user} catalogs={catalogs.data} onClose={() => setCreating(false)}
          onCreated={(product, images) => {
            setCreating(false)
            const base = `Producto «${product.name}» creado con ${product.variants.length} variante${product.variants.length === 1 ? '' : 's'}. Podés imprimir sus etiquetas desde la lista.`
            if (images && images.failed.length > 0) {
              const names = images.failed.map((item) => `«${item.name}»`).join(', ')
              setNotice({ tone: 'warn', text: `${base} El producto quedó creado, pero no se pudo subir: ${names}. Reintentá desde el detalle del producto. ${images.failed[0].reason}` })
            } else {
              setNotice({ tone: 'ok', text: images ? `${base} Se subieron ${images.total} ${images.total === 1 ? 'imagen' : 'imágenes'}.` : base })
            }
            reload()
            setDetail({ id: product.id, labels: false })
          }}
        />
      )}
      {importing && (
        <ImportDialog user={user} onClose={() => setImporting(false)} onImported={() => { setNotice({ tone: 'ok', text: 'Importación completada.' }); reload(); catalogs.reload() }} />
      )}
    </main>
  )
}
