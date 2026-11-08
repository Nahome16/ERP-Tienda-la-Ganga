// Imágenes de productos: validación y reducción en el navegador antes de subirlas.
// Contrato: docs/30-mvp-contrato-api.md, sección 9. Las funciones puras se prueban con vitest.

export const MAX_IMAGES = 4
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024
export const FILE_MAX_SIDE = 1200
export const FILE_QUALITY = 0.82
export const THUMB_MAX_SIDE = 320
export const THUMB_QUALITY = 0.8
/** Topes del servidor: si la foto reducida se pasa, se baja la calidad. */
export const FILE_MAX_BYTES = 2 * 1024 * 1024
export const THUMB_MAX_BYTES = 300 * 1024

export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const ACCEPT_ATTRIBUTE = ACCEPTED_TYPES.join(',')

const extensionTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

export type Dimensions = { width: number; height: number }
export type ImageLike = { name: string; type: string; size: number }

/** Tamaño destino con el lado mayor en `maxSide` como máximo; nunca amplía. */
export function fitWithin(width: number, height: number, maxSide: number): Dimensions {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 }
  const longest = Math.max(width, height)
  if (longest <= maxSide) return { width: Math.round(width), height: Math.round(height) }
  const scale = maxSide / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Tipo MIME efectivo: el del archivo o, si el navegador no lo informa, el que indica la extensión. */
export function effectiveType(file: Pick<ImageLike, 'name' | 'type'>): string {
  if (file.type) return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return extensionTypes[extension] ?? ''
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
}

/** Mensaje de error en español si el archivo no sirve, o null si es válido. */
export function validateImageFile(file: ImageLike): string | null {
  const type = effectiveType(file)
  if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
    return `«${file.name}» no es una imagen válida. Usá fotos JPEG, PNG o WebP.`
  }
  if (file.size <= 0) return `«${file.name}» está vacío.`
  if (file.size > MAX_SOURCE_BYTES) {
    return `«${file.name}» pesa ${megabytes(file.size)}. El máximo es ${megabytes(MAX_SOURCE_BYTES)}.`
  }
  return null
}

/** Cuántas imágenes más caben (nunca negativo). */
export function remainingSlots(currentCount: number, max = MAX_IMAGES): number {
  return Math.max(0, max - currentCount)
}

export type Selection<T> = { accepted: T[]; rejected: string[] }

/**
 * Separa los archivos elegidos en los que se van a subir y los avisos de los que no:
 * inválidos, o que sobran por el límite de imágenes.
 */
export function selectFiles<T extends ImageLike>(files: T[], slots: number): Selection<T> {
  const accepted: T[] = []
  const rejected: string[] = []
  let skipped = 0
  for (const file of files) {
    const problem = validateImageFile(file)
    if (problem) rejected.push(problem)
    else if (accepted.length < slots) accepted.push(file)
    else skipped += 1
  }
  if (skipped > 0) {
    rejected.push(
      slots === 0
        ? `Ya hay ${MAX_IMAGES} imágenes: eliminá alguna para subir otras.`
        : `Solo caben ${slots} ${slots === 1 ? 'imagen' : 'imágenes'} más (máximo ${MAX_IMAGES}). Se omitieron ${skipped}.`,
    )
  }
  return { accepted, rejected }
}

/** Mueve el elemento de `from` a `to` sin mutar la lista. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items]
  const copy = [...items]
  const [moved] = copy.splice(from, 1)
  copy.splice(to, 0, moved)
  return copy
}

/** Deja `id` de primero conservando el orden relativo de las demás. */
export function makeFirst<T extends { id: string }>(items: readonly T[], id: string): T[] {
  const found = items.find((item) => item.id === id)
  if (!found) return [...items]
  return [found, ...items.filter((item) => item.id !== id)]
}

/** Aplica el orden y marca solo la primera como principal. */
export function withOrder<T extends { isPrimary: boolean; sortOrder: number }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ ...item, isPrimary: index === 0, sortOrder: index }))
}

export type ResizedImage = { file: Blob; thumb: Blob; width: number; height: number }

type Source = { bitmap: CanvasImageSource; width: number; height: number; release: () => void }

async function loadSource(file: File): Promise<Source> {
  if (typeof createImageBitmap === 'function') {
    try {
      // 'from-image' respeta la orientación EXIF (fotos tomadas con el celular).
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch {
      // Sigue con <img>, que en los navegadores modernos también aplica EXIF.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { bitmap: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch {
    URL.revokeObjectURL(url)
    throw new Error(`No se pudo leer «${file.name}». Probá con otra foto.`)
  }
}

function canvasToJpeg(source: Source, maxSide: number, quality: number, maxBytes: number): Promise<{ blob: Blob } & Dimensions> {
  const target = fitWithin(source.width, source.height, maxSide)
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const context = canvas.getContext('2d')
  if (!context) return Promise.reject(new Error('Este navegador no puede reducir imágenes.'))
  // El JPEG no tiene transparencia: se pinta fondo blanco para PNG/WebP con alfa.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, target.width, target.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source.bitmap, 0, 0, target.width, target.height)

  const encode = (q: number) => new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo reducir la imagen.'))), 'image/jpeg', q)
  })
  return (async () => {
    let q = quality
    let blob = await encode(q)
    while (blob.size > maxBytes && q > 0.4) {
      q = Math.round((q - 0.1) * 100) / 100
      blob = await encode(q)
    }
    return { blob, ...target }
  })()
}

/** Reduce la foto: `file` (lado mayor 1200 px) y `thumb` (320 px), ambos JPEG. */
export async function resizeImage(file: File): Promise<ResizedImage> {
  const problem = validateImageFile(file)
  if (problem) throw new Error(problem)
  const source = await loadSource(file)
  try {
    const main = await canvasToJpeg(source, FILE_MAX_SIDE, FILE_QUALITY, FILE_MAX_BYTES)
    const thumb = await canvasToJpeg(source, THUMB_MAX_SIDE, THUMB_QUALITY, THUMB_MAX_BYTES)
    return { file: main.blob, thumb: thumb.blob, width: main.width, height: main.height }
  } finally {
    source.release()
  }
}
