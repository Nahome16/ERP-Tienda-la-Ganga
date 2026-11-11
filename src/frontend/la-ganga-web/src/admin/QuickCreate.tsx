import { useState } from 'react'
import { createCatalogItem, type CatalogItem, type CatalogKind } from '../lib/catalogApi'
import { messageFrom } from './format'

/**
 * Crea al momento una marca, un corte o una categoría sin salir del formulario del producto.
 * Se muestra como un enlace «+ Nueva» que abre un campo pequeño debajo del selector.
 */
export function QuickCreate({ kind, label, onCreated, parents }: {
  kind: Extract<CatalogKind, 'brands' | 'cuts' | 'categories'>
  /** «marca», «corte», «categoría» (para los textos). */
  label: string
  onCreated: (item: CatalogItem) => void
  /** Solo categorías: posibles categorías padre (por ejemplo «Caballero»). */
  parents?: { id: string; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    const clean = name.trim()
    if (!clean) { setError(`Escribí el nombre de la ${label}.`); return }
    setBusy(true)
    setError(null)
    try {
      const item = await createCatalogItem(kind, { name: clean, ...(kind === 'categories' ? { parentId: parentId || null } : {}) })
      onCreated(item)
      setOpen(false)
      setName('')
      setParentId('')
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return <button type="button" className="link-button quick-create-link" onClick={() => setOpen(true)}>+ Nueva {label}</button>
  }

  return (
    <div className="quick-create" role="group" aria-label={`Nueva ${label}`}>
      {parents && (
        <select value={parentId} onChange={(event) => setParentId(event.target.value)} aria-label="Dentro de">
          <option value="">Principal (sin categoría padre)</option>
          {parents.map((parent) => <option key={parent.id} value={parent.id}>Dentro de {parent.label}</option>)}
        </select>
      )}
      <input
        autoFocus value={name} maxLength={100} placeholder={`Nombre de la ${label}`} aria-label={`Nombre de la ${label}`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void create() } }}
      />
      <button type="button" className="secondary-button" onClick={() => { void create() }} disabled={busy}>{busy ? 'Creando…' : 'Crear'}</button>
      <button type="button" className="link-button" onClick={() => { setOpen(false); setError(null) }} disabled={busy}>Cancelar</button>
      {error && <small className="err" role="alert">{error}</small>}
    </div>
  )
}

/**
 * Crea tallas nuevas (y su grupo si hace falta) sin salir del alta: por ejemplo el grupo
 * «Infantil» con las tallas 2, 4, 6, 8. Las tallas se escriben separadas por coma.
 */
export function NewSizesPanel({ groups, sizes, onCreated, onCancel }: {
  groups: CatalogItem[]
  sizes: CatalogItem[]
  onCreated: (created: { group: CatalogItem | null; sizes: CatalogItem[] }) => void
  onCancel: () => void
}) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? '__new')
  const [groupName, setGroupName] = useState('')
  const [names, setNames] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const list = [...new Set(names.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))]

  async function create() {
    if (groupId === '__new' && !groupName.trim()) { setError('Escribí el nombre del grupo nuevo (por ejemplo «Infantil»).'); return }
    if (list.length === 0) { setError('Escribí al menos una talla.'); return }
    setBusy(true)
    setError(null)
    try {
      const group = groupId === '__new' ? await createCatalogItem('size-groups', { name: groupName.trim() }) : null
      const targetGroup = group?.id ?? groupId
      const existing = new Map(sizes.filter((size) => size.sizeGroupId === targetGroup).map((size) => [size.name.toLocaleLowerCase('es'), size]))
      const created: CatalogItem[] = []
      for (const name of list) {
        if (existing.has(name.toLocaleLowerCase('es'))) continue
        created.push(await createCatalogItem('sizes', { name, sizeGroupId: targetGroup }))
      }
      onCreated({ group, sizes: created })
    } catch (caught) {
      setError(messageFrom(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="new-color-panel">
      <div className="new-color-custom">
        <label className="adm-field">
          <span>Grupo de tallas</span>
          <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            <option value="__new">+ Grupo nuevo…</option>
          </select>
          {groupId === '__new' && (
            <input value={groupName} maxLength={100} placeholder="Ej.: Infantil, Juvenil, Numérica dama" aria-label="Nombre del grupo nuevo" onChange={(event) => setGroupName(event.target.value)} />
          )}
        </label>
        <label className="adm-field">
          <span>Tallas (separadas por coma)</span>
          <input
            value={names} placeholder="Ej.: 2, 4, 6, 8" aria-label="Tallas nuevas"
            onChange={(event) => setNames(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void create() } }}
          />
          <small>Se crean en este orden y quedan marcadas para este producto.</small>
        </label>
      </div>
      {error && <p className="adm-notice error" role="alert">{error}</p>}
      <div className="new-color-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cerrar</button>
        <button type="button" className="primary-button" onClick={() => { void create() }} disabled={busy || list.length === 0}>
          {busy ? 'Creando…' : `Crear ${list.length > 0 ? list.length : ''} talla${list.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </div>
  )
}
