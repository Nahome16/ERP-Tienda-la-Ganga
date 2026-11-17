import { useState, type FormEvent } from 'react'
import type { SaleShipping } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import { Modal } from './Modal'
import { parseAmount } from './payments'

type ShippingModalProps = {
  initial: SaleShipping | null
  onSave: (shipping: SaleShipping) => void
  onRemove: () => void
  onCancel: () => void
}

/** Datos del envío: el costo se suma a la cuenta y todo sale en el recibo. */
export function ShippingModal({ initial, onSave, onRemove, onCancel }: ShippingModalProps) {
  const [cost, setCost] = useState(initial ? String(initial.costNio) : '')
  const [destination, setDestination] = useState(initial?.destination ?? '')
  const [recipient, setRecipient] = useState(initial?.recipient ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [carrier, setCarrier] = useState(initial?.carrier ?? '')
  const [error, setError] = useState<string | null>(null)
  const costNio = cost.trim() === '' ? 0 : parseAmount(cost)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (cost.trim() !== '' && !(costNio >= 0)) {
      setError('Escribí un costo de envío válido (puede ser 0 si es gratis).')
      return
    }
    if (costNio > 100_000) {
      setError('El costo del envío no puede pasar de C$ 100,000.')
      return
    }
    if (!destination.trim()) {
      setError('Escribí el destino del envío.')
      return
    }
    onSave({
      costNio,
      destination: destination.trim(),
      recipient: recipient.trim() || null,
      phone: phone.trim() || null,
      carrier: carrier.trim() || null,
    })
  }

  return (
    <Modal
      title="Envío"
      size="sm"
      onClose={onCancel}
      footer={(
        <>
          {initial
            ? <button type="button" className="pv-btn pv-btn-secondary" onClick={onRemove}>Quitar envío</button>
            : <button type="button" className="pv-btn pv-btn-secondary" onClick={onCancel}>Cancelar</button>}
          <button type="submit" form="pv-shipping-form" className="pv-btn pv-btn-primary">
            {costNio > 0 ? `Agregar ${formatNio(costNio)} a la cuenta` : 'Guardar envío'}
          </button>
        </>
      )}
    >
      <form id="pv-shipping-form" className="pv-form pv-shipping-form" onSubmit={submit}>
        <label>Costo del envío (C$)
          <input
            data-autofocus inputMode="decimal" autoComplete="off" placeholder="0" value={cost}
            onChange={(event) => { setCost(event.target.value); setError(null) }}
          />
        </label>
        <label>Destino
          <textarea
            rows={2} maxLength={300} autoComplete="off" placeholder="Ciudad, barrio, dirección o punto de entrega" value={destination}
            onChange={(event) => { setDestination(event.target.value); setError(null) }}
          />
        </label>
        <div className="pv-row-2">
          <label>Recibe
            <input maxLength={120} autoComplete="off" placeholder="Nombre" value={recipient} onChange={(event) => setRecipient(event.target.value)} />
          </label>
          <label>Teléfono
            <input type="tel" maxLength={30} autoComplete="off" placeholder="8888-8888" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </label>
        </div>
        <label>Lo lleva
          <input maxLength={120} autoComplete="off" placeholder="Repartidor o empresa (opcional)" value={carrier} onChange={(event) => setCarrier(event.target.value)} />
        </label>
        <p className="pv-note">El costo se suma al total de la venta y todo sale impreso en el recibo. El descuento no se aplica al envío.</p>
        {error && <p className="pv-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
