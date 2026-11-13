import { describe, expect, it } from 'vitest'
import { pickNeighbor, type Box } from './arrowNav'

// Tabla de 3 filas × 3 columnas (cantidad, costo, código), celdas de 100 × 30.
const cell = (row: number, col: number): Box => ({ left: col * 120, top: row * 40, width: 100, height: 30 })
const grid = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => cell(row, col)))
const at = (row: number, col: number) => row * 3 + col

describe('pickNeighbor', () => {
  it('abajo y arriba se quedan en la misma columna', () => {
    expect(pickNeighbor(cell(0, 1), grid, 'down')).toBe(at(1, 1))
    expect(pickNeighbor(cell(2, 2), grid, 'up')).toBe(at(1, 2))
  })

  it('izquierda y derecha se quedan en la misma fila', () => {
    expect(pickNeighbor(cell(1, 0), grid, 'right')).toBe(at(1, 1))
    expect(pickNeighbor(cell(1, 2), grid, 'left')).toBe(at(1, 1))
  })

  it('en el borde no hay vecina', () => {
    expect(pickNeighbor(cell(0, 0), grid, 'up')).toBe(-1)
    expect(pickNeighbor(cell(2, 1), grid, 'down')).toBe(-1)
    expect(pickNeighbor(cell(1, 2), grid, 'right')).toBe(-1)
  })

  it('en un formulario baja al campo de debajo aunque tenga otro ancho', () => {
    const wide: Box = { left: 0, top: 0, width: 400, height: 36 }
    const halves: Box[] = [
      { left: 0, top: 60, width: 190, height: 36 },
      { left: 210, top: 60, width: 190, height: 36 },
      { left: 0, top: 120, width: 400, height: 36 },
    ]
    expect(pickNeighbor(halves[1], [wide, halves[0], halves[2]], 'down')).toBe(2)
    expect(pickNeighbor(halves[1], [wide, halves[0], halves[2]], 'up')).toBe(0)
    expect(pickNeighbor(wide, halves, 'down')).toBe(0)
  })

  it('baja a la fila siguiente aunque más abajo haya un campo mejor centrado', () => {
    const name: Box = { left: 0, top: 0, width: 1000, height: 40 }
    const nextRow: Box[] = [{ left: 0, top: 75, width: 490, height: 40 }, { left: 510, top: 75, width: 490, height: 40 }]
    const farCentered: Box = { left: 20, top: 450, width: 850, height: 40 }
    expect(pickNeighbor(name, [farCentered, ...nextRow], 'down')).toBe(1)
  })
})
