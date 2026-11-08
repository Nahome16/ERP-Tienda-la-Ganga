// Llamadas de imágenes de productos. Contrato: docs/30-mvp-contrato-api.md, sección 9.
import { ApiError, apiRequest, readCookie } from '../lib/api'
import type { ProductImage } from '../lib/apiTypes'
import { resizeImage } from './imageUtils'

const base = '/api/v1/products'

export const reorderImages = (productId: string, imageIds: string[]) =>
  apiRequest<ProductImage[]>(`${base}/${productId}/images/order`, { method: 'PUT', body: { imageIds } })

export const deleteImage = (productId: string, imageId: string) =>
  apiRequest<null>(`${base}/${productId}/images/${imageId}`, { method: 'DELETE' })

function problemFrom(status: number, text: string): ApiError {
  let problem: Record<string, unknown> = {}
  try {
    const parsed: unknown = text ? JSON.parse(text) : null
    if (typeof parsed === 'object' && parsed !== null) problem = parsed as Record<string, unknown>
  } catch { /* respuesta que no es JSON */ }
  const fallback = status === 401 ? 'Tu sesión terminó. Volvé a iniciar sesión.'
    : status === 403 ? 'Tu cuenta no tiene permiso para esta acción.'
      : status === 413 ? 'La imagen es demasiado pesada.'
        : 'No fue posible subir la imagen.'
  const message = typeof problem.title === 'string' ? problem.title : fallback
  const code = typeof problem.code === 'string' ? problem.code : null
  return new ApiError(status, message, code, {})
}

/**
 * Sube una imagen (`file` + `thumb`, multipart). Usa XMLHttpRequest para informar el
 * avance real de la subida. No se fija Content-Type: el navegador agrega el boundary.
 */
export function uploadImage(
  productId: string,
  parts: { file: Blob; thumb: Blob },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<ProductImage> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', parts.file, 'imagen.jpg')
    form.append('thumb', parts.thumb, 'miniatura.jpg')
    const request = new XMLHttpRequest()
    request.open('POST', `${base}/${productId}/images`)
    request.withCredentials = true
    request.setRequestHeader('Accept', 'application/json')
    const csrf = readCookie('la_ganga_csrf')
    if (csrf) request.setRequestHeader('X-CSRF-Token', csrf)
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    request.onerror = () => reject(new ApiError(0, 'No hay conexión con el servidor. Comprobá la red e intentá de nuevo.', 'network_error', {}))
    request.onabort = () => reject(new DOMException('Cancelado', 'AbortError'))
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        try { resolve(JSON.parse(request.responseText) as ProductImage) } catch { reject(problemFrom(500, '')) }
      } else {
        reject(problemFrom(request.status, request.responseText))
      }
    }
    signal?.addEventListener('abort', () => request.abort())
    request.send(form)
  })
}

/** Texto para el usuario según el error de subida (409 image_limit, 422 invalid_image, red…). */
export function uploadErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code === 'image_limit') return 'Este producto ya tiene 4 imágenes. Eliminá alguna para subir otra.'
    if (error.status === 422 || error.code === 'invalid_image') return 'El servidor no aceptó la imagen. Usá una foto JPEG, PNG o WebP válida.'
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'No fue posible subir la imagen.'
}

export type UploadStage = 'preparing' | 'uploading'

/** Reduce y sube una foto. Informa la etapa y el avance. */
export async function processImageFile(
  productId: string, file: File, onStage: (stage: UploadStage, progress: number) => void,
): Promise<ProductImage> {
  onStage('preparing', 0)
  const resized = await resizeImage(file)
  onStage('uploading', 0)
  return uploadImage(productId, resized, (fraction) => onStage('uploading', fraction))
}

export type UploadReport = { total: number; failed: { name: string; reason: string }[] }

/** Sube en fila las fotos elegidas al crear. Si alguna falla sigue con las demás. */
export async function uploadPendingImages(
  productId: string, files: File[], onProgress?: (done: number, total: number) => void,
): Promise<UploadReport> {
  const failed: UploadReport['failed'] = []
  let done = 0
  for (const file of files) {
    onProgress?.(done, files.length)
    try {
      await processImageFile(productId, file, () => undefined)
    } catch (caught) {
      failed.push({ name: file.name, reason: uploadErrorMessage(caught) })
    }
    done += 1
  }
  onProgress?.(done, files.length)
  return { total: files.length, failed }
}
