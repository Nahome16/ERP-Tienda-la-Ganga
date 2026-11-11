import { useEffect, useState, type FormEvent } from 'react'
import type { Lot, Partner, ProductDetail } from '../lib/apiTypes'
import { formatDateTime, messageFrom } from './format'
import { listLots, listPartners, lotWithPartner, updateLot } from './investmentApi'
import { Dialog, Notice } from './ui'

/**
 * Socio de la mercadería de un producto. El socio se guarda en cada entrada (cuándo entró,
 * cuántas, a qué costo), no en el producto: así un mismo producto puede tener mercadería de
 * varios socios. Aquí se asigna o cambia el socio de todas sus entradas de una vez.
 */
export function ProductPartnerDialog({ product, onClose, onDone }: {
  product: ProductDetail
  onClose: () => void
  onDone: (text: string) => void
}) {
  const [lots, setLots] = useState<Lot[] | null>(null)
  const [partners, setPartners] = useState<Partner[]>([])
  const [partnerId, setPartnerId] = useState('')
  const [scope, setScope] = useState<'unassigned' | 'all'>('unassigned')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      listLots({ partner: '', search: product.name, onlyWithStock: false, range: { from: '', to: '' }, page: 1, pageSize: 100 }, controller.signal),
      listPartners('active', controller.signal),
    ])
      .then(([page, activePartners]) => {
        const own = page.items.filter((lot) => lot.productId === product.id)
        setLots(own)
        setPartners(activePartners)
        if (!own.some((lot) => !lot.partnerId)) setScope('all')
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(messageFrom(caught))
      })
    return () => controller.abort()
  }, [product.id, product.name])

  const unassigned = lots?.filter((lot) => !lot.partnerId) ?? []
  const targets = scope === 'unassigned' ? unassigned : lots ?? []

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!partnerId || targets.length === 0) return
    setBusy(true)
    setError(null)
    const problems: string[] = []
    for (const lot of targets) {
      try {
        await updateLot(lot.id, lotWithPartner(lot, partnerId))
      } catch (caught) {
        problems.push(`${lot.sizeName} · ${lot.colorName}: ${messageFrom(caught)}`)
      }
    }
    setBusy(false)
    if (problems.length > 0) {
      setError(`No se pudieron cambiar ${problems.length} entrada(s): ${problems.join('; ')}`)
      return
    }
    const name = partners.find((partner) => partner.id === partnerId)?.name ?? 'el socio'
    onDone(`${targets.length} entrada${targets.length === 1 ? '' : 's'} de ${product.name} asignada${targets.length === 1 ? '' : 's'} a ${name}.`)
  }

  return (
    <Dialog
      title="Socio de la mercadería"
      subtitle={product.name}
      onClose={busy ? () => undefined : onClose}
      wide
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form="product-partner-form" className="primary-button" disabled={busy || !partnerId || targets.length === 0}>
            {busy ? 'Guardando…' : 'Guardar socio'}
          </button>
        </>
      )}
    >
      <form id="product-partner-form" className="adm-form" onSubmit={(event) => { void submit(event) }}>
        {lots === null && !error && <p>Cargando entradas…</p>}
        {lots !== null && lots.length === 0 && (
          <Notice tone="warn">Este producto no tiene entradas de mercadería todavía. El socio se elige al cargar existencia (alta del producto o «Ingresar mercadería»).</Notice>
        )}
        {lots !== null && lots.length > 0 && (
          <>
            <label className="adm-field">
              <span>Socio</span>
              <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} required>
                <option value="">Elegí un socio…</option>
                {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
              </select>
            </label>
            {partners.length === 0 && <Notice tone="warn">No hay socios activos. Crealos en Inversión → Socios.</Notice>}
            <fieldset className="adm-scan-modes">
              <legend>¿A qué entradas?</legend>
              <label>
                <input type="radio" name="partner-scope" checked={scope === 'unassigned'} disabled={unassigned.length === 0} onChange={() => setScope('unassigned')} />
                {' '}Solo las que no tienen socio ({unassigned.length})
              </label>
              <label>
                <input type="radio" name="partner-scope" checked={scope === 'all'} onChange={() => setScope('all')} />
                {' '}Todas, también cambiar las que ya tienen ({lots.length})
              </label>
            </fieldset>
            <div className="table-scroll">
              <table className="adm-table">
                <thead>
                  <tr><th>Talla</th><th>Color</th><th>Entró</th><th className="numeric">Entraron</th><th className="numeric">Quedan</th><th>Socio actual</th></tr>
                </thead>
                <tbody>
                  {lots.map((lot) => (
                    <tr key={lot.id} className={targets.includes(lot) ? undefined : 'muted'}>
                      <td>{lot.sizeName}</td>
                      <td>{lot.colorName}</td>
                      <td>{formatDateTime(lot.enteredAtUtc)}</td>
                      <td className="numeric">{lot.quantityIn}</td>
                      <td className="numeric">{lot.quantityRemaining}</td>
                      <td>{lot.partnerId ? lot.partnerName : <em>Sin socio</em>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="adm-help">Se cambia solo el socio: el costo, el precio y las cantidades de cada entrada se conservan.</p>
          </>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Dialog>
  )
}
