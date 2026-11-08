import { useState } from 'react'

/** Iniciales para el marcador: «Camisa Polo» → «CP». */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '·'
  return words.slice(0, 2).map((word) => word.charAt(0).toLocaleUpperCase('es')).join('')
}

// Fotos que ya fallaron en esta sesión: no se vuelven a pedir en cada renderizado.
const failedUrls = new Set<string>()

/**
 * Miniatura de tamaño fijo. Las iniciales del producto siempre están debajo: si no hay imagen,
 * mientras carga o si falla (sin conexión y fuera de la caché) esas iniciales son lo que se ve,
 * y el tamaño no cambia, así que no hay saltos.
 */
export function PosThumb({ src, name, size }: { src: string | null | undefined; name: string; size: 'card' | 'row' | 'line' }) {
  const [, setFailures] = useState(0)
  const showImage = Boolean(src) && !failedUrls.has(src ?? '')
  return (
    <span className={`pv-thumb pv-thumb-${size}`} aria-hidden="true">
      <i>{initialsOf(name)}</i>
      {showImage && (
        <img
          src={src ?? undefined} alt="" loading="lazy" decoding="async" draggable={false}
          onError={() => { failedUrls.add(src ?? ''); setFailures((count) => count + 1) }}
        />
      )}
    </span>
  )
}
