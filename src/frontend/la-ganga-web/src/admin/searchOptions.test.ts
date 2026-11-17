import { describe, expect, it } from 'vitest'
import { exactOption, filterOptions } from './searchOptions'

const brands = [
  { id: '1', label: 'Bossini' }, { id: '2', label: 'Levis' }, { id: '3', label: 'Zolo' },
  { id: '4', label: 'Penguin' }, { id: '5', label: 'Jingo Original' }, { id: '6', label: 'Original Penguin' },
]
const categories = [
  { id: 'a', label: 'Caballero › Camisas' }, { id: 'b', label: 'Dama › Blusas' }, { id: 'c', label: 'Caballero › Pantalones' },
]

describe('filterOptions', () => {
  it('sin texto devuelve todo', () => {
    expect(filterOptions(brands, '  ')).toHaveLength(brands.length)
  })

  it('filtra por letras sin importar mayúsculas y pone primero lo que empieza así', () => {
    expect(filterOptions(brands, 'PEN').map((item) => item.label)).toEqual(['Penguin', 'Original Penguin'])
    expect(filterOptions(brands, 'orig').map((item) => item.label)).toEqual(['Original Penguin', 'Jingo Original'])
  })

  it('busca en cualquier parte del nombre', () => {
    expect(filterOptions(brands, 'vi').map((item) => item.label)).toEqual(['Levis'])
  })

  it('ignora tildes y acepta varias palabras', () => {
    expect(filterOptions([{ id: 'x', label: 'Niña › Vestidos' }], 'nina').map((item) => item.id)).toEqual(['x'])
    expect(filterOptions(categories, 'cab pan').map((item) => item.id)).toEqual(['c'])
    expect(filterOptions(categories, 'camisas').map((item) => item.id)).toEqual(['a'])
  })
})

describe('exactOption', () => {
  it('encuentra el nombre exacto sin importar mayúsculas ni tildes', () => {
    expect(exactOption(brands, ' levis ')?.id).toBe('2')
    expect(exactOption(brands, 'lev')).toBeUndefined()
  })
})
