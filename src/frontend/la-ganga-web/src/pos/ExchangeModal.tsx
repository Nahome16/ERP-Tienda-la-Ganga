import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, CircleAlert, Printer, Repeat, Search } from 'lucide-react'
import type { CashSession, Exchange, ExchangeLookup, ExchangeResult } from '../lib/apiTypes'
import { formatNio } from '../lib/money'
import {
  buildExchangeRequest, choiceError, exchangeOptions, normalizeReceiptNumber, optionLabel, windowText, type ExchangeChoices,
} from './exchange'
import { Modal } from './Modal'
import { errorMessage, posRequest } from './net'
import { newClientSaleId } from './sale'

type Props = {
  session: CashSession
  online: boolean
  onPrint: (exchange: Exchange) => void
  onDone: (exchange: Exchange) => void
  onClose: () => void
}

/**
 * Cambio de talla o color con el recibo: la prenda regresa al inventario y
 * sale otra talla/color del mismo producto. No mueve dinero ni cambia la venta.
 */
export function ExchangeModal({ session, online, onPrint, onDone, onClose }: Props) {
  const [number, setNumber] = useState('')
  const [lookup, setLookup] = useState<ExchangeLookup | null>(null)
  const [choices, setChoices] = useState<ExchangeChoices>({})
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Exchange | null>(null)
  // Un mismo identificador mientras no cambie lo elegido: si la red falla y se reintenta, el servidor no lo duplica.
  const clientId = useRef(newClientSaleId())

  async function search(event: FormEvent) {
    event.preventDefault()
    const digits = normalizeReceiptNumber(number)
    if (!digits) {
      setError('Escribí el número del recibo (por ejemplo V-000123).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await posRequest<ExchangeLookup>(`/api/v1/exchanges/lookup?number=${encodeURIComponent(digits)}`)
      setLookup(result)
      setChoices({})
      setErrors({})
      clientId.current = newClientSaleId()
    } catch (caught) {
      setLookup(null)
      setError(errorMessage(caught, 'No fue posible buscar el recibo.'))
    } finally {
      setBusy(false)
    }
  }

  function choose(saleLineId: string, patch: Partial<{ quantity: number; newVariantId: string | null }>) {
    setChoices((current) => {
      const previous = current[saleLineId] ?? { quantity: 0, newVariantId: null }
      return { ...current, [saleLineId]: { ...previous, ...patch } }
    })
    setErrors((current) => {
      const next = { ...current }
      delete next[saleLineId]
      delete next.form
      return next
    })
    clientId.current = newClientSaleId()
  }

  async function confirm() {
    if (!lookup) return
    const built = buildExchangeRequest(lookup, choices, { clientExchangeId: clientId.current, cashSessionId: session.id, note })
    if (!built.request) {
      setErrors(built.errors)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await posRequest<ExchangeResult>('/api/v1/exchanges', { method: 'POST', body: built.request })
      setDone(result.exchange)
      onDone(result.exchange)
      onPrint(result.exchange)
    } catch (caught) {
      setError(errorMessage(caught, 'No fue posible registrar el cambio.'))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    const units = done.lines.reduce((sum, line) => sum + line.quantity, 0)
    return (
      <Modal
        title="Cambio registrado"
        size="md"
        onClose={onClose}
        footer={(
          <>
            <button type="button" className="pv-btn pv-btn-secondary" onClick={() => onPrint(done)}><Printer size={18} strokeWidth={1.75} aria-hidden="true" />Imprimir comprobante</button>
            <button type="button" className="pv-btn pv-btn-primary" data-autofocus onClick={onClose}>Listo</button>
          </>
        )}
      >
        <p className="pv-confirm-big"><strong>{done.number}</strong> · {units} {units === 1 ? 'prenda cambiada' : 'prendas cambiadas'} del recibo {done.saleNumber}.</p>
        <ul className="pv-xch-done">
          {done.lines.map((line, index) => (
            <li key={`${line.returnedBarcode}-${line.newBarcode}-${index}`}>
              <b>{line.quantity} × {line.productName}</b>
              <span>{line.returnedSizeName} · {line.returnedColorName} <ArrowRight size={14} strokeWidth={2} aria-label="por" /> {line.newSizeName} · {line.newColorName}</span>
            </li>
          ))}
        </ul>
        <p className="pv-note">El inventario ya se actualizó: la prenda devuelta volvió a existencia y la nueva salió. Entregá el comprobante junto con el recibo original.</p>
      </Modal>
    )
  }

  const selectedCount = lookup ? lookup.lines.filter((line) => (choices[line.saleLineId]?.quantity ?? 0) > 0).length : 0

  return (
    <Modal
      title="Cambio de talla"
      size="lg"
      onClose={onClose}
      locked={busy}
      footer={(
        <>
          <button type="button" className="pv-btn pv-btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
          {lookup?.canExchange && (
            <button type="button" className="pv-btn pv-btn-primary" onClick={() => { void confirm() }} disabled={busy || !online || selectedCount === 0}>
              <Repeat size={18} strokeWidth={1.75} aria-hidden="true" />{busy ? 'Registrando…' : 'Registrar cambio'}
            </button>
          )}
        </>
      )}
    >
      {!online && <p className="pv-banner pv-banner-warn"><CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" /><span>Sin conexión: los cambios necesitan conexión con el servidor para revisar el recibo y la existencia.</span></p>}

      <form className="pv-xch-search" onSubmit={(event) => { void search(event) }}>
        <label className="pv-field">
          <span>Número del recibo</span>
          <input
            data-autofocus inputMode="text" autoComplete="off" placeholder="V-000123" value={number}
            onChange={(event) => setNumber(event.target.value)} disabled={busy || !online}
          />
        </label>
        <button type="submit" className="pv-btn pv-btn-secondary" disabled={busy || !online}><Search size={18} strokeWidth={1.75} aria-hidden="true" />Buscar</button>
      </form>

      {error && <p className="pv-error" role="alert">{error}</p>}

      {lookup && (
        <div className="pv-xch">
          <div className="pv-xch-head">
            <div>
              <strong>{lookup.saleNumber}</strong> · {formatNio(lookup.totalNio)}
              <div className="pv-hint">{windowText(lookup)}</div>
            </div>
            {lookup.exchanges.length > 0 && <span className="pv-pill pv-pill-review">{lookup.exchanges.length} {lookup.exchanges.length === 1 ? 'cambio previo' : 'cambios previos'}</span>}
          </div>

          {lookup.blockedReason && <p className={lookup.canExchange ? 'pv-note' : 'pv-error'} role={lookup.canExchange ? undefined : 'alert'}>{lookup.blockedReason}</p>}

          {lookup.canExchange && (
            <>
              <p className="pv-note">Marcá cuántas unidades regresan y qué talla o color se lleva. Se mantiene el precio pagado: no se cobra ni se devuelve dinero.</p>
              <ul className="pv-xch-lines">
                {lookup.lines.map((line) => {
                  const choice = choices[line.saleLineId]
                  const options = exchangeOptions(line)
                  const quantity = choice?.quantity ?? 0
                  const lineError = errors[line.saleLineId] ?? (quantity > 0 ? choiceError(line, choice) : null)
                  const disabled = line.available === 0 || busy
                  return (
                    <li key={line.saleLineId} className={`pv-xch-line${quantity > 0 ? ' is-selected' : ''}`}>
                      <div className="pv-xch-info">
                        <b>{line.productName}</b>
                        <span>Talla {line.sizeName} · {line.colorName} · {formatNio(line.unitPrice)}</span>
                        <small>
                          Vendidas {line.quantity}
                          {line.alreadyExchanged > 0 ? ` · ya cambiadas ${line.alreadyExchanged}` : ''}
                          {' · '}disponibles para cambio {line.available}
                        </small>
                      </div>
                      <label className="pv-xch-qty">
                        <span>Regresan</span>
                        <select
                          value={quantity} disabled={disabled}
                          onChange={(event) => choose(line.saleLineId, { quantity: Number(event.target.value) })}
                        >
                          {Array.from({ length: line.available + 1 }, (_, value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                      <label className="pv-xch-new">
                        <span>Se lleva</span>
                        <select
                          value={choice?.newVariantId ?? ''} disabled={disabled || quantity === 0}
                          onChange={(event) => choose(line.saleLineId, { newVariantId: event.target.value || null })}
                        >
                          <option value="">{options.length === 0 ? 'Sin otras tallas' : 'Elegir talla o color…'}</option>
                          {options.map((option) => (
                            <option key={option.variantId} value={option.variantId} disabled={option.stock < Math.max(quantity, 1)}>
                              {optionLabel(option)} — {option.stock > 0 ? `${option.stock} en existencia` : 'agotada'}
                              {option.price !== line.unitPrice ? ` (precio actual ${formatNio(option.price)})` : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      {lineError && <p className="pv-hint pv-warn pv-xch-err">{lineError}</p>}
                    </li>
                  )
                })}
              </ul>
              <label className="pv-field">
                <span>Nota (opcional)</span>
                <input value={note} maxLength={500} placeholder="Ej.: le quedó pequeña" onChange={(event) => setNote(event.target.value)} disabled={busy} />
              </label>
              {errors.form && <p className="pv-error" role="alert">{errors.form}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
