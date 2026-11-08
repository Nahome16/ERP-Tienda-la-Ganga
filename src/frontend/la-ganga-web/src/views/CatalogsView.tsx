import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import {
  catalogLabels,
  createCatalogItem,
  listAllCatalog,
  listCatalog,
  setCatalogItemActive,
  updateCatalogItem,
  type CatalogInput,
  type CatalogItem,
  type CatalogKind,
  type CatalogPage,
  type CatalogStatus,
} from '../lib/catalogApi'
import type { CurrentUser } from '../types'

const kinds: CatalogKind[] = ['categories', 'brands', 'cuts', 'size-groups', 'sizes', 'colors']
const pageSize = 25
const nameLimits: Record<CatalogKind, number> = {
  categories: 100, brands: 100, cuts: 100, 'size-groups': 100, sizes: 30, colors: 60,
}

type ListState =
  | { key: string; kind: 'ready'; page: CatalogPage }
  | { key: string; kind: 'error'; message: string }

type ReferenceState = { key: string; categories: CatalogItem[]; sizeGroups: CatalogItem[] }

type EditorState = { mode: 'create' } | { mode: 'edit'; item: CatalogItem } | null

function messageFrom(error: unknown) {
  if (error instanceof ApiError) return error.message
  return 'Ocurrió un error inesperado. Intentá de nuevo.'
}

/** Ruta legible de una categoría: «Dama › Pantalones». */
function categoryPath(item: CatalogItem, byId: Map<string, CatalogItem>) {
  const names = [item.name]
  const seen = new Set([item.id])
  let parentId = item.parentId
  while (parentId && !seen.has(parentId)) {
    const parent = byId.get(parentId)
    if (!parent) break
    names.unshift(parent.name)
    seen.add(parent.id)
    parentId = parent.parentId
  }
  return names
}

/** Ordena las categorías como árbol: cada superior seguida de sus subcategorías. */
function categoryTree(items: CatalogItem[]) {
  const children = new Map<string | null, CatalogItem[]>()
  for (const item of items) {
    const key = item.parentId && items.some((candidate) => candidate.id === item.parentId) ? item.parentId : null
    children.set(key, [...(children.get(key) ?? []), item])
  }
  const ordered: { item: CatalogItem; depth: number }[] = []
  const visit = (parentId: string | null, depth: number) => {
    const level = [...(children.get(parentId) ?? [])]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'))
    for (const item of level) {
      ordered.push({ item, depth })
      visit(item.id, depth + 1)
    }
  }
  visit(null, 0)
  return ordered
}

function descendantsOf(id: string, items: CatalogItem[]) {
  const result = new Set<string>()
  const pending = [id]
  while (pending.length > 0) {
    const current = pending.pop()!
    for (const item of items) {
      if (item.parentId === current && !result.has(item.id)) {
        result.add(item.id)
        pending.push(item.id)
      }
    }
  }
  return result
}

export function CatalogsView({ user, isPreview }: { user: CurrentUser; isPreview: boolean }) {
  const canManage = user.permissions.includes('catalog.manage')
  const [kind, setKind] = useState<CatalogKind>('categories')
  const [status, setStatus] = useState<CatalogStatus>('active')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [sizeGroupFilter, setSizeGroupFilter] = useState('')
  const [refreshCount, setRefreshCount] = useState(0)
  const [list, setList] = useState<ListState | null>(null)
  const [references, setReferences] = useState<ReferenceState | null>(null)
  const [editor, setEditor] = useState<EditorState>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const listKey = `${kind}|${status}|${search}|${page}|${sizeGroupFilter}|${refreshCount}`
  const referenceKey = `${refreshCount}`

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    if (isPreview) return
    const controller = new AbortController()
    Promise.all([
      listAllCatalog('categories', 'all', controller.signal),
      listAllCatalog('size-groups', 'all', controller.signal),
    ])
      .then(([categories, sizeGroups]) => setReferences({ key: referenceKey, categories, sizeGroups }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setReferences({ key: referenceKey, categories: [], sizeGroups: [] })
      })
    return () => controller.abort()
  }, [isPreview, referenceKey])

  useEffect(() => {
    if (isPreview || kind === 'categories') return
    const controller = new AbortController()
    listCatalog(kind, { status, search, page, pageSize, sizeGroupId: kind === 'sizes' ? sizeGroupFilter || undefined : undefined }, controller.signal)
      .then((result) => setList({ key: listKey, kind: 'ready', page: result }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setList({ key: listKey, kind: 'error', message: messageFrom(error) })
      })
    return () => controller.abort()
  }, [isPreview, kind, status, search, page, sizeGroupFilter, listKey])

  const categories = useMemo(() => references?.categories ?? [], [references])
  const sizeGroups = useMemo(() => references?.sizeGroups ?? [], [references])
  const categoriesById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
  const groupNames = useMemo(() => new Map(sizeGroups.map((item) => [item.id, item.name])), [sizeGroups])

  const categoryRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('es')
    return categoryTree(categories).filter(({ item }) => {
      if (status === 'active' && !item.isActive) return false
      if (status === 'inactive' && item.isActive) return false
      if (!term) return true
      return categoryPath(item, categoriesById).join(' ').toLocaleLowerCase('es').includes(term)
    })
  }, [categories, categoriesById, search, status])

  const isCategoryTab = kind === 'categories'
  const referencesLoading = references?.key !== referenceKey
  const listLoading = isCategoryTab ? referencesLoading : list?.key !== listKey
  const listError = !isCategoryTab && list?.key === listKey && list.kind === 'error' ? list.message : null
  const currentPage = !isCategoryTab && list?.key === listKey && list.kind === 'ready' ? list.page : null
  const labels = catalogLabels[kind]

  function changeKind(next: CatalogKind) {
    setKind(next)
    setPage(1)
    setSearchInput('')
    setSearch('')
    setSizeGroupFilter('')
    setNotice(null)
  }

  function refresh() {
    setRefreshCount((count) => count + 1)
  }

  async function toggleActive(item: CatalogItem) {
    setBusyId(item.id)
    setNotice(null)
    try {
      const updated = await setCatalogItemActive(kind, item, !item.isActive)
      setNotice({ tone: 'ok', text: `«${updated.name}» quedó ${updated.isActive ? 'activo' : 'inactivo'}.` })
      refresh()
    } catch (error) {
      setNotice({ tone: 'error', text: messageFrom(error) })
      if (error instanceof ApiError && error.code === 'version_conflict') refresh()
    } finally {
      setBusyId(null)
    }
  }

  function handleSaved(item: CatalogItem, created: boolean) {
    setEditor(null)
    setNotice({ tone: 'ok', text: created ? `Se agregó «${item.name}».` : `Se guardaron los cambios de «${item.name}».` })
    refresh()
  }

  const rows: { item: CatalogItem; depth: number }[] = isCategoryTab
    ? categoryRows
    : (currentPage?.items ?? []).map((item) => ({ item, depth: 0 }))

  return (
    <main className="admin-page catalogs-page">
      <header className="page-header">
        <div>
          <p className="page-kicker">Configuración · <b className="live-data">Datos reales</b></p>
          <h1>Catálogos</h1>
          <p className="page-summary">Listas que alimentan productos, variantes e inventario. Inactivar conserva el historial.</p>
        </div>
        {canManage && !isPreview && (
          <div className="page-actions">
            <button className="primary-button" type="button" onClick={() => setEditor({ mode: 'create' })}>
              ＋ {labels.create}
            </button>
          </div>
        )}
      </header>

      <nav className="catalog-tabs" aria-label="Tipos de catálogo">
        {kinds.map((item) => (
          <button
            key={item}
            type="button"
            className={item === kind ? 'active' : undefined}
            aria-pressed={item === kind}
            onClick={() => changeKind(item)}
          >
            {catalogLabels[item].plural}
          </button>
        ))}
      </nav>

      {isPreview ? (
        <section className="panel-card catalog-empty">
          <h2>Necesitás una sesión real</h2>
          <p>La vista previa no se conecta a la base de datos. Iniciá sesión con tu cuenta para consultar y editar catálogos.</p>
        </section>
      ) : (
        <section className="panel-card catalog-card">
          <div className="catalog-toolbar">
            <label className="catalog-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder={`Buscar ${labels.plural.toLocaleLowerCase('es')}`}
                value={searchInput}
                onChange={(event) => { setSearchInput(event.target.value); setPage(1) }}
                aria-label={`Buscar ${labels.plural.toLocaleLowerCase('es')}`}
              />
            </label>
            {kind === 'sizes' && (
              <select
                value={sizeGroupFilter}
                onChange={(event) => { setSizeGroupFilter(event.target.value); setPage(1) }}
                aria-label="Filtrar por grupo de tallas"
              >
                <option value="">Todos los grupos</option>
                {sizeGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
              </select>
            )}
            <select
              value={status}
              onChange={(event) => { setStatus(event.target.value as CatalogStatus); setPage(1) }}
              aria-label="Filtrar por estado"
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </div>

          {notice && <p className={`catalog-notice ${notice.tone}`} role="status">{notice.text}</p>}
          {listError && (
            <div className="catalog-notice error" role="alert">
              {listError} <button type="button" onClick={refresh}>Reintentar</button>
            </div>
          )}

          <div className="table-scroll">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>{kind === 'categories' ? 'Categoría' : 'Nombre'}</th>
                  {kind === 'sizes' && <th>Grupo</th>}
                  {kind === 'colors' && <th>Muestra</th>}
                  <th className="numeric">Orden</th>
                  <th>Estado</th>
                  {canManage && <th className="actions-col"><span className="visually-hidden">Acciones</span></th>}
                </tr>
              </thead>
              <tbody>
                {listLoading && rows.length === 0 && (
                  <tr><td colSpan={6} className="catalog-placeholder">Cargando {labels.plural.toLocaleLowerCase('es')}…</td></tr>
                )}
                {!listLoading && !listError && rows.length === 0 && (
                  <tr><td colSpan={6} className="catalog-placeholder">No hay {labels.plural.toLocaleLowerCase('es')} con estos filtros.</td></tr>
                )}
                {rows.map(({ item, depth }) => (
                  <tr key={item.id} className={item.isActive ? undefined : 'inactive-row'}>
                    <td>
                      <span className="catalog-name" style={{ paddingLeft: `${depth * 22}px` }}>
                        {depth > 0 && <span className="tree-mark" aria-hidden="true">└</span>}
                        <strong>{item.name}</strong>
                        {depth > 0 && <span className="visually-hidden"> (dentro de {categoryPath(item, categoriesById).slice(0, -1).join(' › ')})</span>}
                      </span>
                    </td>
                    {kind === 'sizes' && <td>{item.sizeGroupId ? groupNames.get(item.sizeGroupId) ?? '—' : 'Sin grupo'}</td>}
                    {kind === 'colors' && (
                      <td>
                        {item.swatchHex
                          ? <span className="swatch-cell"><i style={{ background: item.swatchHex }} />{item.swatchHex}</span>
                          : <span className="muted-text">Sin muestra</span>}
                      </td>
                    )}
                    <td className="numeric">{item.sortOrder}</td>
                    <td><span className={item.isActive ? 'catalog-status active' : 'catalog-status'}>{item.isActive ? 'Activo' : 'Inactivo'}</span></td>
                    {canManage && (
                      <td className="actions-col">
                        <button type="button" className="link-button" onClick={() => setEditor({ mode: 'edit', item })}>Editar</button>
                        <button
                          type="button"
                          className="link-button"
                          disabled={busyId === item.id}
                          onClick={() => { void toggleActive(item) }}
                        >
                          {item.isActive ? 'Inactivar' : 'Activar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {currentPage && currentPage.totalPages > 1 && (
            <div className="catalog-pagination">
              <span>Página {currentPage.page} de {currentPage.totalPages} · {currentPage.totalCount} en total</span>
              <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button>
              <button type="button" className="secondary-button" disabled={page >= currentPage.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button>
            </div>
          )}
        </section>
      )}

      {editor && (
        <CatalogEditor
          kind={kind}
          item={editor.mode === 'edit' ? editor.item : null}
          categories={categories}
          categoriesById={categoriesById}
          sizeGroups={sizeGroups}
          defaultSizeGroupId={sizeGroupFilter}
          onClose={() => setEditor(null)}
          onSaved={handleSaved}
          onConflict={refresh}
        />
      )}
    </main>
  )
}

type EditorProps = {
  kind: CatalogKind
  item: CatalogItem | null
  categories: CatalogItem[]
  categoriesById: Map<string, CatalogItem>
  sizeGroups: CatalogItem[]
  defaultSizeGroupId: string
  onClose: () => void
  onSaved: (item: CatalogItem, created: boolean) => void
  onConflict: () => void
}

function CatalogEditor({ kind, item, categories, categoriesById, sizeGroups, defaultSizeGroupId, onClose, onSaved, onConflict }: EditorProps) {
  const labels = catalogLabels[kind]
  const [name, setName] = useState(item?.name ?? '')
  const [sortOrder, setSortOrder] = useState(item ? String(item.sortOrder) : '')
  const [parentId, setParentId] = useState(item?.parentId ?? '')
  const [sizeGroupId, setSizeGroupId] = useState(item?.sizeGroupId ?? defaultSizeGroupId)
  const [swatch, setSwatch] = useState(item?.swatchHex ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const parentOptions = useMemo(() => {
    if (kind !== 'categories') return []
    const blocked = item ? descendantsOf(item.id, categories) : new Set<string>()
    if (item) blocked.add(item.id)
    return categoryTree(categories)
      .filter(({ item: option }) => !blocked.has(option.id) && (option.isActive || option.id === item?.parentId))
      .map(({ item: option }) => ({ id: option.id, label: categoryPath(option, categoriesById).join(' › ') }))
  }, [kind, item, categories, categoriesById])

  const groupOptions = sizeGroups.filter((group) => group.isActive || group.id === item?.sizeGroupId)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setFieldErrors({})
    const trimmedOrder = sortOrder.trim()
    const parsedOrder = trimmedOrder === '' ? undefined : Number(trimmedOrder)
    if (parsedOrder !== undefined && (!Number.isInteger(parsedOrder) || parsedOrder < 0)) {
      setFieldErrors({ sortOrder: ['El orden debe ser un número entero, cero o mayor.'] })
      return
    }

    const input: CatalogInput = {
      name,
      sortOrder: parsedOrder ?? (item ? item.sortOrder : undefined),
      isActive: item ? item.isActive : undefined,
    }
    if (kind === 'categories') input.parentId = parentId || null
    if (kind === 'sizes') input.sizeGroupId = sizeGroupId || null
    if (kind === 'colors') input.swatchHex = swatch.trim() || null

    setSaving(true)
    try {
      const saved = item ? await updateCatalogItem(kind, item, input) : await createCatalogItem(kind, input)
      onSaved(saved, !item)
    } catch (caught) {
      if (caught instanceof ApiError) {
        const hasFieldErrors = Object.keys(caught.fieldErrors).length > 0
        setError(caught.code === 'version_conflict'
          ? 'Otra persona cambió este elemento mientras lo editabas. Cerrá el formulario para ver la versión actual.'
          : hasFieldErrors ? null : caught.message)
        setFieldErrors(caught.fieldErrors)
        if (caught.code === 'version_conflict') onConflict()
      } else {
        setError('Ocurrió un error inesperado. Intentá de nuevo.')
      }
    } finally {
      setSaving(false)
    }
  }

  const fieldError = (field: string) => fieldErrors[field]?.[0]

  return (
    <div className="catalog-dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="catalog-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-dialog-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => { void submit(event) }}
      >
        <header>
          <h2 id="catalog-dialog-title">{item ? `Editar ${labels.singular}` : labels.create}</h2>
          <button type="button" className="dialog-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <label className="catalog-field">
          <span>Nombre</span>
          <input
            value={name}
            maxLength={nameLimits[kind]}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
            aria-invalid={Boolean(fieldError('name'))}
          />
          {fieldError('name') && <small className="field-error">{fieldError('name')}</small>}
        </label>

        {kind === 'categories' && (
          <label className="catalog-field">
            <span>Categoría superior</span>
            <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">Ninguna (categoría principal)</option>
              {parentOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            {fieldError('parentId') && <small className="field-error">{fieldError('parentId')}</small>}
          </label>
        )}

        {kind === 'sizes' && (
          <label className="catalog-field">
            <span>Grupo de tallas</span>
            <select value={sizeGroupId} onChange={(event) => setSizeGroupId(event.target.value)}>
              <option value="">Sin grupo</option>
              {groupOptions.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
            {fieldError('sizeGroupId') && <small className="field-error">{fieldError('sizeGroupId')}</small>}
          </label>
        )}

        {kind === 'colors' && (
          <div className="catalog-field">
            <span>Muestra visual (opcional)</span>
            <div className="swatch-input">
              <input
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(swatch) ? swatch : '#000000'}
                onChange={(event) => setSwatch(event.target.value.toUpperCase())}
                aria-label="Elegir color de muestra"
              />
              <input
                value={swatch}
                placeholder="#RRGGBB"
                maxLength={7}
                onChange={(event) => setSwatch(event.target.value)}
                aria-label="Código de color"
                aria-invalid={Boolean(fieldError('swatchHex'))}
              />
              {swatch && <button type="button" className="link-button" onClick={() => setSwatch('')}>Quitar</button>}
            </div>
            <small className="field-hint">El nombre sigue siendo el dato principal; la muestra solo ayuda a reconocerlo.</small>
            {fieldError('swatchHex') && <small className="field-error">{fieldError('swatchHex')}</small>}
          </div>
        )}

        <label className="catalog-field">
          <span>Orden</span>
          <input
            inputMode="numeric"
            value={sortOrder}
            placeholder={item ? undefined : 'Al final de la lista'}
            onChange={(event) => setSortOrder(event.target.value)}
            aria-invalid={Boolean(fieldError('sortOrder'))}
          />
          {fieldError('sortOrder') && <small className="field-error">{fieldError('sortOrder')}</small>}
        </label>

        {error && <p className="catalog-notice error" role="alert">{error}</p>}

        <footer>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button>
        </footer>
      </form>
    </div>
  )
}
