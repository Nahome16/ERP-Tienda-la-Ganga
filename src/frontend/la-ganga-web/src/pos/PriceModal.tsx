import { useState, type FormEvent } from 'react'
import type { ProductDetail } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import { parseAmount } from './payments'

type PriceModalProps = {
  productId: string
  productName: string
  onSaved: (price: number) => void
  onCancel: () => void
}

/** Pone el precio de venta del producto (todas sus tallas y colores) sin salir de la caja. */
async function saveProductPrice(productId: string, price: number): Promise<void> {
  const product = await posRequest<ProductDetail>(`/api/v1/products/${productId}`)
  await posRequest(`/api/v1/products/${productId}`, {
    method: 'PUT',
    ifMatch: product.version,
    body: {
      name: product.name,
      categoryId: product.categoryId,
      brandId: product.brandId,
      cutId: product.cutId ?? null,
      basePrice: price,
      barcode: product.barcode ?? '',
      referenceCode: product.referenceCode ?? '',
      isActive: product.isActive,
    },
  })
}

export function PriceModal({ productId, productName, onSaved, onCancel }: PriceModalProps) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const price = parseAmount(text)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (price <= 0) {
      setError('Escribí un precio mayor que cero.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveProductPrice(productId, price)
      onSaved(price)
    } catch (caught) {
      setError(errorMessage(caught, 'No fue posible guardar el precio.'))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Poner precio de venta"
      size="sm"
      onClose={onCancel}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
          <button type="submit" form="pv-price-form" className="pv-btn pv-btn-primary" disabled={busy || price <= 0}>
            {busy ? 'Guardando…' : price > 0 ? `Guardar ${formatNio(price)} y agregar` : 'Guardar y agregar'}
          </button>
        </>
      )}
    >
      <form id="pv-price-form" className="pv-form" onSubmit={(event) => { void submit(event) }}>
        <p className="pv-note"><strong>{productName}</strong> todavía no tiene precio de venta, por eso no se podía vender.</p>
        <label>Precio de venta (C$)
          <input
            data-autofocus inputMode="decimal" autoComplete="off" value={text}
            onChange={(event) => { setText(event.target.value); setError(null) }}
            aria-invalid={error ? true : undefined}
          />
        </label>
        <p className="pv-note">Se guarda en el producto para todas sus tallas y colores, igual que en «Editar producto».</p>
        {error && <p className="pv-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
