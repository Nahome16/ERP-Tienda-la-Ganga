import { useState } from 'react'

/** Iniciales para el marcador: «Camisa Polo» → «CP». */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  return words.slice(0, 2).map((word) => word.charAt(0).toLocaleUpperCase('es')).join('')
}

/**
 * Miniatura de tamaño fijo. Sin imagen, o si no carga (sin conexión y fuera de la caché),
 * muestra las iniciales del producto; el tamaño no cambia, así que no hay saltos.
 */
export function PosThumb({ src, name, size }: { src: string | null | undefined; name: string; size: 'card' | 'row' | 'line' }) {
  const [failed, setFailed] = useState<string | null>(null)
  const showImage = Boolean(src) && failed !== src
  return (
    <span className={`pv-thumb pv-thumb-${size}`} aria-hidden="true">
      {showImage
        ? <img src={src ?? undefined} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src ?? null)} />
        : <b>{initialsOf(name)}</b>}
    </span>
  )
}
