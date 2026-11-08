import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../lib/catalogApi'
import {
  builderToInputs, combosOf, emptyBuilder, resolveVariantPartner, setDraft, totalInitialUnits, type BuilderState,
} from './variantBuilder'

const item = (id: string, name: string): CatalogItem => ({ id, name, isActive: true, sortOrder: 1, version: 1, parentId: null, sizeGroupId: null, swatchHex: null, updatedAtUtc: '' })
const sizes = [item('s1', 'S'), item('s2', 'M')]
const colors = [item('c1', 'Negro')]

function state(): BuilderState {
  let next: BuilderState = { ...emptyBuilder, sizeIds: ['s1', 's2'], colorIds: ['c1'], partnerId: 'pA' }
  next = setDraft(next, 's1|c1', { qty: '4' })
  next = setDraft(next, 's2|c1', { qty: '2', partnerId: 'pB' })
  return next
}

describe('resolveVariantPartner', () => {
  it('sigue el general, permite «Sin socio» y permite otro socio', () => {
    expect(resolveVariantPartner('pA', '')).toBe('pA')
    expect(resolveVariantPartner('', '')).toBeNull()
    expect(resolveVariantPartner('pA', 'none')).toBeNull()
    expect(resolveVariantPartner('pA', 'pB')).toBe('pB')
  })
})

describe('builderToInputs con socios', () => {
  it('manda partnerId por variante solo con permiso y cantidad mayor que cero', () => {
    const built = builderToInputs(state(), sizes, colors, new Set(), true, true)
    expect(built.errors).toEqual([])
    expect(built.inputs.map((input) => input.partnerId)).toEqual(['pA', 'pB'])
    expect(built.totalUnits).toBe(6)
  })
  it('sin permiso de socios no manda partnerId', () => {
    const built = builderToInputs(state(), sizes, colors, new Set(), true)
    for (const input of built.inputs) expect(input).not.toHaveProperty('partnerId')
  })
  it('sin cantidad inicial no manda socio', () => {
    const base: BuilderState = { ...emptyBuilder, sizeIds: ['s1'], colorIds: ['c1'], partnerId: 'pA' }
    const built = builderToInputs(base, sizes, colors, new Set(), true, true)
    expect(built.inputs[0]).not.toHaveProperty('partnerId')
  })
  it('«Sin socio» por fila gana sobre el general', () => {
    const next = setDraft(state(), 's1|c1', { partnerId: 'none' })
    const built = builderToInputs(next, sizes, colors, new Set(), true, true)
    expect(built.inputs[0]).not.toHaveProperty('partnerId')
    expect(built.inputs[1].partnerId).toBe('pB')
  })
})

describe('totalInitialUnits', () => {
  it('suma las cantidades válidas de las variantes nuevas', () => {
    const next = setDraft(state(), 's1|c1', { qty: 'x' })
    expect(totalInitialUnits(next, combosOf(next, sizes, colors))).toBe(2)
    expect(totalInitialUnits(state(), combosOf(state(), sizes, colors), new Set(['s2|c1']))).toBe(4)
  })
})
