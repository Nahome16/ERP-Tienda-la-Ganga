import { ApiError, apiRequest } from '../lib/api'

// Las peticiones reales también cuentan como prueba de conexión: si una falla
// por red, el POS pasa a «Sin conexión» sin esperar al próximo ping.

type NetworkListener = (reachable: boolean) => void
const listeners = new Set<NetworkListener>()

export function onNetworkResult(listener: NetworkListener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function reportNetworkResult(reachable: boolean) {
  listeners.forEach((listener) => listener(reachable))
}

export type ErrorKind = 'network' | 'unauthorized' | 'server' | 'rejected'

/** Clasifica un error de envío para decidir si se reintenta o se marca para atención. */
export function classifyError(error: unknown): ErrorKind {
  if (error instanceof ApiError) {
    if (error.status === 0 || [502, 503, 504].includes(error.status)) return 'network'
    if (error.status === 401) return 'unauthorized'
    if (error.status >= 500 || error.status === 408 || error.status === 429) return 'server'
    return 'rejected'
  }
  // JSON inválido (p. ej. una página de error de un proxy) o fallo inesperado de fetch.
  if (error instanceof SyntaxError) return 'server'
  return 'network'
}

/** Igual que apiRequest, pero informa del resultado de red y normaliza errores raros. */
export async function posRequest<T>(path: string, options: Parameters<typeof apiRequest>[1] = {}): Promise<T> {
  try {
    const result = await apiRequest<T>(path, options)
    reportNetworkResult(true)
    return result
  } catch (error) {
    if (error instanceof ApiError) {
      reportNetworkResult(error.status !== 0 && ![502, 503, 504].includes(error.status))
      throw error
    }
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    if (error instanceof SyntaxError) {
      throw new ApiError(502, 'El servidor respondió algo inesperado. Intentá de nuevo.', 'bad_response', {})
    }
    reportNetworkResult(false)
    throw new ApiError(0, 'No hay conexión con el servidor. Comprobá la red e intentá de nuevo.', 'network_error', {})
  }
}

export function errorMessage(error: unknown, fallback = 'No fue posible completar la solicitud.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export function isNetworkError(error: unknown): boolean {
  return classifyError(error) === 'network'
}
