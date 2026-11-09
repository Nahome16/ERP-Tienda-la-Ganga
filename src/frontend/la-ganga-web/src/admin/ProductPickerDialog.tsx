import { useState } from 'react'
import { Search } from 'lucide-react'
import { formatNio } from '../lib/money'
import { listProducts } from './adminApi'
import { useDebounced, useFetch } from './hooks'
import { Thumb } from './ImageManager'
import { Dialog, LoadError, Spinner } from './ui'

/** Buscador de producto para empezar un ingreso de mercadería. */
export function ProductPickerDialog({ onPick, onClose, onCreate }: {
  onPick: (productId: string) => void
  onClose: () => void
  /** Si se pasa, ofrece crear un producto nuevo cuando no aparece en la búsqueda. */
  onCreate?: () => void
}) {
  const [input, setInput] = useState('')
  const search = useDebounced(input)
  const { data, error, loading, reload } = useFetch(
    `picker|${search}`,
    (signal) => listProducts({ search, categoryId: '', brandId: '', status: 'active', page: 1, pageSize: 8 }, signal),
  )
  const items = data?.items ?? []

  return (
    <Dialog
      title="Ingresar mercadería"
      subtitle="Buscá el producto al que le llegó mercadería."
      onClose={onClose}
      footer={onCreate && <button type="button" className="secondary-button" onClick={onCreate}>No está: crear producto nuevo</button>}
    >
      <label className="catalog-search">
        <Search size={18} strokeWidth={1.75} aria-hidden="true" />
        <input type="search" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Nombre, marca o categoría" aria-label="Buscar producto" data-autofocus />
      </label>
      {error && <LoadError message={error} onRetry={reload} />}
      {loading && !data && <Spinner />}
      <ul className="picker-list">
        {data && items.length === 0 && <li className="adm-empty">No hay productos activos con esa búsqueda.</li>}
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" className="picker-item" onClick={() => onPick(item.id)}>
              <Thumb src={item.primaryImageUrl} name={item.name} size={44} />
              <span className="picker-text">
                <strong>{item.name}</strong>
                <small>{item.categoryName} · {item.brandName} · {formatNio(item.basePrice)}</small>
              </span>
              <span className="picker-stock">{item.totalStock} u.</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  )
}
