import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import type { CashRegisterInfo, CashSession } from '../lib/apiTypes'
import { formatDateTime } from './format'
import { errorMessage, posRequest } from './net'
import { parseAmount } from './payments'

type OpenCashScreenProps = {
  userName: string
  online: boolean
  onOpened: (session: CashSession) => void
}

export function OpenCashScreen({ userName, online, onOpened }: OpenCashScreenProps) {
  const [registers, setRegisters] = useState<CashRegisterInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [floatNio, setFloatNio] = useState('')
  const [floatUsd, setFloatUsd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const list = await posRequest<CashRegisterInfo[]>('/api/v1/cash/registers')
      setRegisters(list)
      setSelected((current) => {
        if (current && list.some((item) => item.id === current && !item.openSession)) return current
        return list.find((item) => !item.openSession)?.id ?? null
      })
    } catch (caught) {
      setLoadError(errorMessage(caught, 'No pudimos cargar las cajas.'))
    }
  }, [])

  useEffect(() => {
    // La carga es asíncrona: el estado se actualiza cuando llega la respuesta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (online) void load()
  }, [load, online])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected || busy) return
    setBusy(true)
    setError(null)
    try {
      const session = await posRequest<CashSession>('/api/v1/cash/sessions', {
        method: 'POST',
        body: { registerId: selected, openingFloatNio: parseAmount(floatNio), openingFloatUsd: parseAmount(floatUsd) },
      })
      onOpened(session)
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'register_in_use') {
        setError('Esa caja ya está abierta por otra persona. Elegí la otra caja.')
        void load()
      } else if (caught instanceof ApiError && caught.code === 'user_has_open_session') {
        setError('Ya tenés una caja abierta. Recargá la pantalla para continuar con ella.')
      } else {
        setError(errorMessage(caught, 'No fue posible abrir la caja.'))
      }
      setBusy(false)
    }
  }

  return (
    <main className="pv-center-screen">
      <form className="pv-card pv-open-cash" onSubmit={(event) => { void submit(event) }}>
        <p className="pv-eyebrow">Hola, {userName}</p>
        <h1>Abrir caja</h1>
        <p className="pv-note">Elegí tu caja e indicá cuánto efectivo hay al empezar. Necesitás conexión para abrir la caja.</p>

        {!online && <p className="pv-banner pv-banner-warn" role="alert">Sin conexión. Cuando vuelva la red podrás abrir la caja.</p>}
        {loadError && (
          <p className="pv-banner pv-banner-error" role="alert">
            {loadError} <button type="button" className="pv-link" onClick={() => { void load() }}>Reintentar</button>
          </p>
        )}
        {online && !registers && !loadError && <p className="pv-note">Cargando cajas…</p>}

        {registers && (
          <fieldset className="pv-registers">
            <legend>Caja</legend>
            {registers.map((register) => {
              const busyBy = register.openSession
              return (
                <label key={register.id} className={`pv-register${selected === register.id ? ' is-selected' : ''}${busyBy ? ' is-busy' : ''}`}>
                  <input
                    type="radio" name="register" value={register.id} disabled={Boolean(busyBy)}
                    checked={selected === register.id} onChange={() => setSelected(register.id)}
                  />
                  <span>
                    <strong>{register.name}</strong>
                    <small>{busyBy ? `Ocupada por ${busyBy.openedByName} desde ${formatDateTime(busyBy.openedAtUtc)}` : 'Libre'}</small>
                  </span>
                </label>
              )
            })}
          </fieldset>
        )}

        <div className="pv-row-2">
          <label>Fondo inicial en córdobas (C$)
            <input inputMode="decimal" value={floatNio} onChange={(event) => setFloatNio(event.target.value)} placeholder="0.00" autoComplete="off" />
          </label>
          <label>Fondo inicial en dólares (US$)
            <input inputMode="decimal" value={floatUsd} onChange={(event) => setFloatUsd(event.target.value)} placeholder="0.00" autoComplete="off" />
          </label>
        </div>

        {error && <p className="pv-error" role="alert">{error}</p>}
        <button type="submit" className="pv-btn pv-btn-primary pv-btn-xl" disabled={!selected || busy || !online}>
          {busy ? 'Abriendo…' : 'Abrir caja'}
        </button>
      </form>
    </main>
  )
}
