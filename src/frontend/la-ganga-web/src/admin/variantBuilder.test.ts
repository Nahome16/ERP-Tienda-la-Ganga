import { describe, expect, it } from 'vitest'
import type { CatalogItem } from '../lib/catalogApi'
import {
  assignScannedBarcodes, builderToInputs, cellUnits, withDefaultCost, combosOf, emptyBuilder, resolveVariantPartner, setDraft, totalInitialUnits, type BuilderState,
} from './variantBuilderLogic'

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

describe('assignScannedBarcodes', () => {
  const sizes = [item('s', 'S'), item('m', 'M')]
  const colors = [item('azul', 'Azul')]

  it('guarda el código mientras no hay talla ni color elegidos', () => {
    const result = assignScannedBarcodes(emptyBuilder, combosOf(emptyBuilder, sizes, colors), ['750100'])
    expect(result.leftover).toEqual(['750100'])
  })

  it('llena en orden las variantes sin código y no repite códigos', () => {
    let state: BuilderState = { ...emptyBuilder, sizeIds: ['s', 'm'], colorIds: ['azul'] }
    state = setDraft(state, 's|azul', { barcode: '111' })
    const result = assignScannedBarcodes(state, combosOf(state, sizes, colors), ['111', '222', '333'])
    expect(result.state.drafts['s|azul']?.barcode).toBe('111')
    expect(result.state.drafts['m|azul']?.barcode).toBe('222')
    expect(result.leftover).toEqual(['333'])
  })

  it('no toca variantes que el producto ya tiene', () => {
    const state: BuilderState = { ...emptyBuilder, sizeIds: ['s', 'm'], colorIds: ['azul'] }
    const result = assignScannedBarcodes(state, combosOf(state, sizes, colors), ['999'], new Set(['s|azul']))
    expect(result.state.drafts['m|azul']?.barcode).toBe('999')
    expect(result.state.drafts['s|azul']).toBeUndefined()
  })
})

describe('withDefaultCost y cellUnits', () => {
  it('aplica el costo general solo donde no hay costo propio', () => {
    let next: BuilderState = { ...emptyBuilder, sizeIds: ['s1', 's2'], colorIds: ['c1'] }
    next = setDraft(next, 's1|c1', { cost: '90' })
    const result = withDefaultCost(next, combosOf(next, sizes, colors), '120')
    expect(result.drafts['s1|c1']?.cost).toBe('90')
    expect(result.drafts['s2|c1']?.cost).toBe('120')
    expect(withDefaultCost(next, combosOf(next, sizes, colors), '  ')).toBe(next)
  })

  it('cuenta solo enteros positivos', () => {
    let next = setDraft(emptyBuilder, 'a', { qty: '3' })
    next = setDraft(next, 'b', { qty: '1.5' })
    expect(cellUnits(next, 'a')).toBe(3)
    expect(cellUnits(next, 'b')).toBe(0)
    expect(cellUnits(next, 'zz')).toBe(0)
  })
})
