const csrfCookieName = 'la_ganga_csrf'

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null
  readonly fieldErrors: Record<string, string[]>

  constructor(status: number, message: string, code: string | null, fieldErrors: Record<string, string[]>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

export function readCookie(name: string) {
  const prefix = `${encodeURIComponent(name)}=`
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix))
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT'
  body?: unknown
  ifMatch?: number
  signal?: AbortSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFieldErrors(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const result: Record<string, string[]> = {}
  for (const [field, messages] of Object.entries(value)) {
    if (Array.isArray(messages)) result[field] = messages.filter((item): item is string => typeof item === 'string')
  }
  return result
}

/**
 * Llama a la API con la cookie de sesión. En operaciones de escritura agrega
 * el token CSRF y, si corresponde, la versión esperada (If-Match).
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') {
    const csrf = readCookie(csrfCookieName)
    if (csrf) headers['X-CSRF-Token'] = csrf
  }
  if (options.ifMatch !== undefined) headers['If-Match'] = `"${options.ifMatch}"`

  let response: Response
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'No hay conexión con el servidor. Comprobá la red e intentá de nuevo.', 'network_error', {})
  }

  const text = await response.text()
  const payload: unknown = text ? JSON.parse(text) : null

  if (!response.ok) {
    const problem = isRecord(payload) ? payload : {}
    const message = typeof problem.title === 'string'
      ? problem.title
      : response.status === 401
        ? 'Tu sesión terminó. Volvé a iniciar sesión.'
        : response.status === 403
          ? 'Tu cuenta no tiene permiso para esta acción.'
          : 'No fue posible completar la solicitud.'
    const code = typeof problem.code === 'string' ? problem.code : null
    throw new ApiError(response.status, message, code, readFieldErrors(problem.errors))
  }

  return payload as T
}
