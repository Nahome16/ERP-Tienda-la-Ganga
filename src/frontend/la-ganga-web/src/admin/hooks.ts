import { useCallback, useEffect, useState } from 'react'
import { isAbort, messageFrom } from './format'

type FetchState<T> = { key: string; data: T | null; error: string | null }

/**
 * Carga datos al cambiar `deps` (texto que resume los parámetros). Mientras se
 * recarga conserva los datos anteriores para que la tabla no parpadee.
 */
export function useFetch<T>(deps: string, load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [reloadCount, setReloadCount] = useState(0)
  const [state, setState] = useState<FetchState<T> | null>(null)
  const key = `${deps}|${reloadCount}`

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    load(controller.signal)
      .then((data) => setState({ key, data, error: null }))
      .catch((error: unknown) => {
        if (isAbort(error)) return
        setState({ key, data: null, error: messageFrom(error) })
      })
    return () => controller.abort()
    // `deps` resume todos los parámetros de `load`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled])

  const reload = useCallback(() => setReloadCount((count) => count + 1), [])
  const current = state?.key === key ? state : null
  return {
    data: current ? current.data : (state?.data ?? null),
    error: current?.error ?? null,
    loading: enabled && current === null,
    reload,
  }
}

/** Devuelve `value` con retraso, para búsquedas mientras se escribe. */
export function useDebounced<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

