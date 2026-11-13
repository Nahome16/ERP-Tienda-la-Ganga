import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

/**
 * Moverse entre casillas con las flechas del teclado, como en una hoja de
 * cálculo. Se busca la casilla más cercana en la dirección de la flecha según
 * su posición en pantalla, así sirve igual en tablas (tallas × colores) y en
 * formularios de dos columnas.
 */

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Box { left: number; top: number; width: number; height: number }

const KEYS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

const FIELD = [
  'input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=range]):not([type=color]):not([type=submit]):not([type=button]):not([disabled]):not([readonly])',
  'select:not([disabled])',
].join(', ')

/** Tipos de texto donde el cursor se puede mover dentro de lo escrito. */
const CARET_TYPES = new Set(['text', 'search', 'tel', 'url', 'password', ''])

const center = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })

/**
 * Elige la casilla vecina. Arriba/abajo: la de la fila siguiente más alineada
 * con la columna actual. Izquierda/derecha: solo casillas de la misma fila.
 * Devuelve -1 si no hay ninguna en esa dirección.
 */
export function pickNeighbor(current: Box, candidates: Box[], direction: Direction): number {
  const from = center(current)
  const vertical = direction === 'up' || direction === 'down'
  const sign = direction === 'down' || direction === 'right' ? 1 : -1
  const valid: { index: number; along: number; across: number }[] = []
  candidates.forEach((box, index) => {
    const to = center(box)
    const along = (vertical ? to.y - from.y : to.x - from.x) * sign
    const across = vertical ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y)
    const threshold = vertical ? Math.min(current.height, box.height) / 2 : Math.min(current.width, box.width) / 2
    if (along <= threshold) return
    if (!vertical) {
      // Misma fila: tienen que coincidir verticalmente.
      const overlap = Math.min(current.top + current.height, box.top + box.height) - Math.max(current.top, box.top)
      if (overlap <= Math.min(current.height, box.height) / 2) return
    }
    valid.push({ index, along, across })
  })
  if (valid.length === 0) return -1
  // Primero la fila (o columna) más cercana; dentro de ella, la mejor alineada.
  const nearest = Math.min(...valid.map((item) => item.along))
  const band = vertical ? Math.max(current.height, 16) / 2 : Math.max(current.width, 16) / 2
  const row = valid.filter((item) => item.along <= nearest + band)
  row.sort((a, b) => a.across - b.across || a.along - b.along)
  return row[0].index
}

/** ¿La flecha izquierda/derecha debe quedarse moviendo el cursor dentro del texto? */
function caretShouldMove(target: HTMLElement, direction: Direction) {
  if (!(target instanceof HTMLInputElement) || !CARET_TYPES.has(target.type)) return false
  const start = target.selectionStart
  const end = target.selectionEnd
  if (start === null || end === null) return false
  const length = target.value.length
  if (start === 0 && end === length) return false // todo seleccionado: se salta
  if (start !== end) return true
  return direction === 'left' ? start > 0 : end < length
}

function isVisible(element: HTMLElement) {
  return element.getClientRects().length > 0
}

function toBox(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

export function arrowNavigate(event: ReactKeyboardEvent<HTMLElement>) {
  const direction = KEYS[event.key]
  if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const target = event.target
  if (!(target instanceof HTMLElement) || !target.matches(FIELD)) return
  if (target.closest('[data-arrow-nav="off"]') || target.getAttribute('aria-expanded') === 'true') return
  if ((direction === 'left' || direction === 'right') && caretShouldMove(target, direction)) return

  const fields = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FIELD))
    .filter((field) => field !== target && isVisible(field) && !field.closest('[data-arrow-nav="off"]'))
  let index = pickNeighbor(toBox(target), fields.map(toBox), direction)
  if (index < 0 && (direction === 'left' || direction === 'right')) {
    // Al final de la fila se sigue con la siguiente casilla del formulario.
    const all = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FIELD)).filter((field) => field === target || fields.includes(field))
    const next = all[all.indexOf(target) + (direction === 'right' ? 1 : -1)]
    index = next ? fields.indexOf(next) : -1
  }
  if (index < 0) return

  event.preventDefault()
  const next = fields[index]
  next.focus()
  if (next instanceof HTMLInputElement && next.type !== 'checkbox') {
    try { next.select() } catch { /* algunos tipos no permiten seleccionar */ }
  }
}
