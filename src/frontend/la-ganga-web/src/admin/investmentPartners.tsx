import { useId, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import type { Partner } from '../lib/apiTypes'
import { messageFrom } from './format'
import { createPartner, updatePartner } from './investmentApi'
import { Dialog, LoadError, Notice, Spinner, Tag } from './ui'

/** Lista de socios (activos e inactivos) con alta, edición y activar/inactivar. No se borran socios. */
export function PartnersPanel({ partners, loading, error, onRetry, canManage, onChanged }: {
  partners: Partner[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  canManage: boolean
  onChanged: () => void
}) {
  const [showInactive, setShowInactive] = useState(true)
  const [dialog, setDialog] = useState<{ partner: Partner | null } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const visible = (partners ?? []).filter((partner) => showInactive || partner.isActive)
  const inactiveCount = (partners ?? []).filter((partner) => !partner.isActive).length

  async function toggleActive(partner: Partner) {
    setBusyId(partner.id)
    setMessage(null)
    try {
      await updatePartner(partner, { name: partner.name, phone: partner.phone, notes: partner.notes, isActive: !partner.isActive })
      setMessage({ tone: 'ok', text: partner.isActive ? `«${partner.name}» quedó inactivo: ya no aparece al ingresar mercadería, pero su historial se conserva.` : `«${partner.name}» volvió a estar activo.` })
      onChanged()
    } catch (caught) {
      setMessage({ tone: 'error', text: messageFrom(caught) })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="panel-card adm-card" aria-label="Socios">
      <div className="inv-section-head">
        <h2 className="adm-card-title">Socios <small>{partners ? `${partners.length} en total` : ''}</small></h2>
        {canManage && <button type="button" className="primary-button" onClick={() => setDialog({ partner: null })}>Nuevo socio</button>}
      </div>
      <p className="adm-help">Los socios no se borran: si alguien deja de invertir, inactivalo. Su historial, sus entradas y sus ganancias se conservan, y solo deja de aparecer al ingresar mercadería nueva.</p>
      <div className="adm-toolbar">
        <label className="adm-check">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Mostrar inactivos{inactiveCount > 0 ? ` (${inactiveCount})` : ''}
        </label>
      </div>
      {message && <Notice tone={message.tone}><span>{message.text}</span></Notice>}
      {error && <LoadError message={error} onRetry={onRetry} />}
      {loading && !partners && <Spinner label="Cargando socios…" />}
      {partners && (
        <div className="table-scroll">
          <table className="adm-table" aria-label="Lista de socios">
            <thead>
              <tr>
                <th>Nombre</th><th>Teléfono</th><th>Notas</th><th>Estado</th>
                {canManage && <th className="actions-col"><span className="visually-hidden">Acciones</span></th>}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={canManage ? 5 : 4} className="adm-empty">{partners.length === 0 ? 'Todavía no hay socios. Creá el primero con «Nuevo socio».' : 'No hay socios activos.'}</td></tr>
              )}
              {visible.map((partner) => (
                <tr key={partner.id} className={partner.isActive ? undefined : 'inactive-row'}>
                  <td><strong>{partner.name}</strong></td>
                  <td>{partner.phone || '—'}</td>
                  <td className="inv-notes">{partner.notes || '—'}</td>
                  <td><Tag tone={partner.isActive ? 'ok' : 'neutral'}>{partner.isActive ? 'Activo' : 'Inactivo'}</Tag></td>
                  {canManage && (
                    <td className="actions-col">
                      <button type="button" className="link-button" onClick={() => setDialog({ partner })} aria-label={`Editar a ${partner.name}`}>Editar</button>
                      {' '}
                      <button type="button" className={partner.isActive ? 'link-button danger' : 'link-button'} disabled={busyId === partner.id} onClick={() => void toggleActive(partner)}
                        aria-label={`${partner.isActive ? 'Inactivar' : 'Activar'} a ${partner.name}`}>
                        {partner.isActive ? 'Inactivar' : 'Activar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && (
        <PartnerDialog
          partner={dialog.partner}
          onClose={() => setDialog(null)}
          onSaved={(saved, created) => {
            setDialog(null)
            setMessage({ tone: 'ok', text: created ? `Creamos al socio «${saved.name}».` : `Guardamos los datos de «${saved.name}».` })
            onChanged()
          }}
        />
      )}
    </section>
  )
}

/** Crear o editar un socio. Muestra el 409 `duplicate_name` junto al campo del nombre. */
export function PartnerDialog({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: (saved: Partner, created: boolean) => void }) {
  const id = useId()
  const [name, setName] = useState(partner?.name ?? '')
  const [phone, setPhone] = useState(partner?.phone ?? '')
  const [notes, setNotes] = useState(partner?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const cleanName = name.trim().replace(/\s+/g, ' ')
    if (!cleanName) { setNameError('Escribí el nombre del socio.'); return }
    setNameError(null)
    setError(null)
    setBusy(true)
    const input = { name: cleanName, phone: phone.trim() || null, notes: notes.trim() || null }
    try {
      const saved = partner ? await updatePartner(partner, { ...input, isActive: partner.isActive }) : await createPartner(input)
      onSaved(saved, partner === null)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409 && caught.code === 'duplicate_name') setNameError('Ya existe un socio con ese nombre. Usá otro nombre o editá el existente.')
      else if (caught instanceof ApiError && caught.status === 409) setError(`${caught.message} Cerrá este cuadro, actualizá la lista e intentá de nuevo.`)
      else if (caught instanceof ApiError && caught.fieldErrors.name) setNameError(caught.fieldErrors.name.join(' '))
      else setError(messageFrom(caught))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={partner ? 'Editar socio' : 'Nuevo socio'}
      subtitle={partner ? undefined : 'Podrás elegirlo al ingresar mercadería.'}
      onClose={busy ? () => undefined : onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" form={`${id}-form`} className="primary-button" disabled={busy} aria-busy={busy}>{busy ? 'Guardando…' : partner ? 'Guardar cambios' : 'Crear socio'}</button>
        </>
      )}
    >
      <form id={`${id}-form`} className="adm-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="adm-field">
          <span>Nombre</span>
          <input value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} data-autofocus aria-invalid={nameError ? true : undefined} aria-describedby={nameError ? `${id}-name` : undefined} />
          {nameError && <small id={`${id}-name`} className="err" role="alert">{nameError}</small>}
        </label>
        <label className="adm-field">
          <span>Teléfono (opcional)</span>
          <input type="tel" value={phone} maxLength={40} onChange={(event) => setPhone(event.target.value)} />
        </label>
        <label className="adm-field">
          <span>Notas (opcional)</span>
          <textarea value={notes} maxLength={500} onChange={(event) => setNotes(event.target.value)} />
        </label>
        {error && <Notice tone="error"><span>{error}</span></Notice>}
      </form>
    </Dialog>
  )
}
