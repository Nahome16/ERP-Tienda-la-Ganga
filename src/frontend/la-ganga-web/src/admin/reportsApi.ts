import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../lib/api'
import { addDays } from './format'

export type ReportKind = 'sales' | 'inventory' | 'movements' | 'cash'
export type DateRange = { from: string; to: string }
export type RangePresetId = 'today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth'

export const maxRangeDays = 366
export const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const offlineMessage = 'Los reportes necesitan conexión con el servidor. Comprobá la red e intentá de nuevo.'

const managuaOffsetMs = -6 * 60 * 60 * 1000

/** Fecha de hoy en Managua (UTC−6 fijo, sin horario de verano) como YYYY-MM-DD, sin depender de la zona del navegador. */
export function managuaDate(now: Date = new Date()): string {
  return new Date(now.getTime() + managuaOffsetMs).toISOString().slice(0, 10)
}

export const rangePresets: { id: RangePresetId; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'last7', label: 'Últimos 7 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'lastMonth', label: 'Mes pasado' },
]

/** Rango que corresponde a un atajo, calculado a partir de «hoy» en Managua (YYYY-MM-DD). */
export function presetRange(id: RangePresetId, today: string): DateRange {
  const monthStart = `${today.slice(0, 7)}-01`
  switch (id) {
    case 'today': return { from: today, to: today }
    case 'yesterday': { const day = addDays(today, -1); return { from: day, to: day } }
    case 'last7': return { from: addDays(today, -6), to: today }
    case 'thisMonth': return { from: monthStart, to: today }
    case 'lastMonth': {
      const lastDay = addDays(monthStart, -1)
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay }
    }
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Cantidad de días del rango, contando ambos extremos. */
export function rangeDays(range: DateRange): number {
  const [fy, fm, fd] = range.from.split('-').map(Number)
  const [ty, tm, td] = range.to.split('-').map(Number)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000) + 1
}

/** Devuelve un mensaje para la persona si el rango no sirve, o null si es válido. */
export function validateRange(range: DateRange, today: string, options: { allowFuture: boolean }): string | null {
  if (!range.from || !range.to) return 'Elegí la fecha «Desde» y la fecha «Hasta».'
  if (!isIsoDate(range.from) || !isIsoDate(range.to)) return 'Alguna de las fechas no es válida. Usá el formato día/mes/año.'
  if (range.from > range.to) return 'La fecha «Desde» no puede ser posterior a «Hasta».'
  if (!options.allowFuture && range.to > today) return 'Este reporte no admite fechas futuras: «Hasta» debe ser hoy o antes.'
  const days = rangeDays(range)
  if (days > maxRangeDays) return `El rango máximo es de ${maxRangeDays} días y elegiste ${days}. Acortalo e intentá de nuevo.`
  return null
}

/** Nombre de archivo de `Content-Disposition` (`filename*=UTF-8''…` tiene prioridad sobre `filename="…"`). */
export function parseContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null
  let name: string | null = null

  const extended = /(?:^|[;\s])filename\*\s*=\s*([^;]+)/i.exec(header)
  if (extended) {
    const parts = /^\s*([^']*)'[^']*'(.*?)\s*$/.exec(extended[1])
    if (parts) {
      const charset = parts[1].toLowerCase()
      try {
        name = charset === 'iso-8859-1' || charset === 'latin1'
          ? parts[2].replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16)))
          : decodeURIComponent(parts[2])
      } catch {
        name = null
      }
    }
  }

  if (name === null) {
    const quoted = /(?:^|[;\s])filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header)
    if (quoted) name = quoted[1].replace(/\\(.)/g, '$1')
    else {
      const bare = /(?:^|[;\s])filename\s*=\s*([^;\s]+)/i.exec(header)
      if (bare) name = bare[1]
    }
  }

  if (name === null) return null
  // Nunca confiar en rutas ni en caracteres de control que vengan del servidor.
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').split(/[\\/]/).pop()?.trim() ?? ''
  return clean || null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function reportPath(kind: ReportKind, range?: DateRange): string {
  const base = `/api/v1/reports/${kind}`
  if (kind === 'inventory' || !range) return base
  return `${base}?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
}

export type DownloadedReport = { filename: string; size: number }

async function problemMessage(response: Response): Promise<string> {
  let title: string | null = null
  try {
    const payload: unknown = JSON.parse(await response.text())
    if (typeof payload === 'object' && payload !== null && 'title' in payload && typeof payload.title === 'string') title = payload.title
  } catch {
    title = null
  }
  if (title) return title
  if (response.status === 401) return 'Tu sesión terminó. Volvé a iniciar sesión.'
  if (response.status === 403) return 'Tu cuenta no tiene permiso para descargar este reporte.'
  if (response.status === 400) return 'Las fechas elegidas no son válidas para este reporte.'
  return 'No fue posible generar el reporte. Intentá de nuevo en unos minutos.'
}

/** Guarda el archivo con un enlace temporal y libera la URL del blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.hidden = true
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Pide el reporte al servidor y lo descarga. Lanza ApiError con un mensaje listo para mostrar. */
export async function downloadReport(kind: ReportKind, range?: DateRange, signal?: AbortSignal): Promise<DownloadedReport> {
  let response: Response
  try {
    response = await fetch(reportPath(kind, range), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: `${xlsxMime}, application/json;q=0.5` },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, offlineMessage, 'network_error', {})
  }

  if (!response.ok) throw new ApiError(response.status, await problemMessage(response), null, {})

  let blob: Blob
  try {
    blob = await response.blob()
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, offlineMessage, 'network_error', {})
  }

  const filename = parseContentDisposition(response.headers.get('Content-Disposition'))
    ?? `reporte-${kind}${range ? `-${range.from}_${range.to}` : ''}.xlsx`
  saveBlob(new Blob([blob], { type: xlsxMime }), filename)
  return { filename, size: blob.size }
}

export type DownloadState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'done'; filename: string; size: number }
  | { status: 'error'; message: string }

/** Estado de una descarga de reporte (cancela la petición si la pantalla se cierra). */
export function useReportDownload() {
  const [state, setState] = useState<DownloadState>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const start = useCallback(async (kind: ReportKind, range?: DateRange) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setState({ status: 'busy' })
    try {
      const result = await downloadReport(kind, range, current.signal)
      if (!current.signal.aborted) setState({ status: 'done', ...result })
    } catch (error) {
      if (current.signal.aborted) return
      setState({ status: 'error', message: error instanceof ApiError ? error.message : 'No fue posible descargar el reporte.' })
    }
  }, [])

  const fail = useCallback((message: string) => setState({ status: 'error', message }), [])
  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, start, fail, reset }
}
