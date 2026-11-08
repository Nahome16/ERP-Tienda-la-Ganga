import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGES, MAX_SOURCE_BYTES, effectiveType, fitWithin, makeFirst, moveItem, remainingSlots, selectFiles,
  validateImageFile, withOrder,
} from './imageUtils'

const photo = (name = 'a.jpg', type = 'image/jpeg', size = 1000) => ({ name, type, size })

describe('fitWithin', () => {
  it('reduce el lado mayor conservando la proporción', () => {
    expect(fitWithin(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 })
    expect(fitWithin(3000, 4000, 1200)).toEqual({ width: 900, height: 1200 })
    expect(fitWithin(4000, 3000, 320)).toEqual({ width: 320, height: 240 })
  })
  it('no amplía imágenes pequeñas', () => {
    expect(fitWithin(800, 600, 1200)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(1200, 1200, 1200)).toEqual({ width: 1200, height: 1200 })
  })
  it('nunca produce lados de cero píxeles', () => {
    expect(fitWithin(10000, 3, 1200).height).toBe(1)
    expect(fitWithin(0, 100, 1200)).toEqual({ width: 0, height: 0 })
  })
})

describe('validateImageFile', () => {
  it('acepta JPEG, PNG y WebP', () => {
    expect(validateImageFile(photo())).toBeNull()
    expect(validateImageFile(photo('a.png', 'image/png'))).toBeNull()
    expect(validateImageFile(photo('a.webp', 'image/webp'))).toBeNull()
  })
  it('rechaza otros tipos con un mensaje claro', () => {
    expect(validateImageFile(photo('a.gif', 'image/gif'))).toMatch(/JPEG, PNG o WebP/)
    expect(validateImageFile(photo('a.heic', 'image/heic'))).toMatch(/no es una imagen válida/)
    expect(validateImageFile(photo('doc.pdf', 'application/pdf'))).not.toBeNull()
  })
  it('usa la extensión cuando el navegador no informa el tipo', () => {
    expect(effectiveType({ name: 'FOTO.JPG', type: '' })).toBe('image/jpeg')
    expect(validateImageFile(photo('foto.jpeg', ''))).toBeNull()
    expect(validateImageFile(photo('foto.bmp', ''))).not.toBeNull()
  })
  it('rechaza archivos de más de 15 MB o vacíos', () => {
    expect(validateImageFile(photo('a.jpg', 'image/jpeg', MAX_SOURCE_BYTES))).toBeNull()
    expect(validateImageFile(photo('a.jpg', 'image/jpeg', MAX_SOURCE_BYTES + 1))).toMatch(/El máximo es 15 MB/)
    expect(validateImageFile(photo('a.jpg', 'image/jpeg', 0))).toMatch(/vacío/)
  })
})

describe('selectFiles / remainingSlots', () => {
  it('calcula cupos sin bajar de cero', () => {
    expect(remainingSlots(1)).toBe(MAX_IMAGES - 1)
    expect(remainingSlots(4)).toBe(0)
    expect(remainingSlots(7)).toBe(0)
  })
  it('respeta el límite y avisa de lo que sobra y de lo inválido', () => {
    const files = [photo('1.jpg'), photo('2.jpg'), photo('3.jpg'), photo('x.gif', 'image/gif')]
    const result = selectFiles(files, 2)
    expect(result.accepted.map((file) => file.name)).toEqual(['1.jpg', '2.jpg'])
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[1]).toMatch(/Solo caben 2 imágenes más/)
  })
  it('sin cupo explica que hay que eliminar alguna', () => {
    const result = selectFiles([photo()], 0)
    expect(result.accepted).toEqual([])
    expect(result.rejected[0]).toMatch(/eliminá alguna/)
  })
})

describe('orden', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('mueve elementos sin mutar', () => {
    expect(moveItem(items, 0, 2).map((i) => i.id)).toEqual(['b', 'c', 'a'])
    expect(moveItem(items, 2, 1).map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(moveItem(items, 1, 9)).toEqual(items)
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
  it('marca como principal dejando el resto en orden', () => {
    expect(makeFirst(items, 'c').map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(makeFirst(items, 'zzz')).toEqual(items)
  })
  it('renumera y deja solo la primera como principal', () => {
    const list = withOrder([{ id: 'x', isPrimary: false, sortOrder: 5 }, { id: 'y', isPrimary: true, sortOrder: 0 }])
    expect(list.map((i) => [i.id, i.isPrimary, i.sortOrder])).toEqual([['x', true, 0], ['y', false, 1]])
  })
})
