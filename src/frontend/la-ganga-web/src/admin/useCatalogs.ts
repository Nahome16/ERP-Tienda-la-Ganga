import { listAllCatalog, type CatalogItem } from '../lib/catalogApi'
import { useFetch } from './hooks'

export type Catalogs = {
  categories: CatalogItem[]
  brands: CatalogItem[]
  cuts: CatalogItem[]
  sizeGroups: CatalogItem[]
  sizes: CatalogItem[]
  colors: CatalogItem[]
}

const byOrder = (a: CatalogItem, b: CatalogItem) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es')

/** Catálogos activos que usan los formularios de productos. */
export function useCatalogs(enabled = true) {
  const result = useFetch<Catalogs>('catalogs', async (signal) => {
    const [categories, brands, cuts, sizeGroups, sizes, colors] = await Promise.all([
      listAllCatalog('categories', 'active', signal),
      listAllCatalog('brands', 'active', signal),
      listAllCatalog('cuts', 'active', signal),
      listAllCatalog('size-groups', 'active', signal),
      listAllCatalog('sizes', 'active', signal),
      listAllCatalog('colors', 'active', signal),
    ])
    return {
      categories: [...categories].sort(byOrder), brands: [...brands].sort(byOrder), cuts: [...cuts].sort(byOrder),
      sizeGroups: [...sizeGroups].sort(byOrder), sizes: [...sizes].sort(byOrder), colors: [...colors].sort(byOrder),
    }
  }, enabled)
  return result
}

/** Nombre de categoría con su ruta («Dama › Pantalones»). */
export function categoryOptions(categories: CatalogItem[]) {
  const byId = new Map(categories.map((item) => [item.id, item]))
  return categories
    .map((item) => {
      const names = [item.name]
      const seen = new Set([item.id])
      let parent = item.parentId ? byId.get(item.parentId) : undefined
      while (parent && !seen.has(parent.id)) { names.unshift(parent.name); seen.add(parent.id); parent = parent.parentId ? byId.get(parent.parentId) : undefined }
      return { id: item.id, label: names.join(' › ') }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'es'))
}
