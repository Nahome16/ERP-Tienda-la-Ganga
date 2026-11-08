import { describe, expect, it } from 'vitest'
import {
  describeRange, excelRange, filterOf, invPresetRange, isAllRange, lotWithPartner, moneyToField, parseMoneyField,
  partnerParam, profitInfo, sourceLabel, validateInvRange,
} from './investmentApi'

describe('invPresetRange', () => {
  const today = '2026-11-08'
  it('calcula los atajos en hora de Managua', () => {
    expect(invPresetRange('today', today)).toEqual({ from: '2026-11-08', to: '2026-11-08' })
    expect(invPresetRange('thisMonth', today)).toEqual({ from: '2026-11-01', to: '2026-11-08' })
    expect(invPresetRange('lastMonth', today)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(invPresetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
  })
  it('«Todo» no pone límites', () => {
    const all = invPresetRange('all', today)
    expect(all).toEqual({ from: '', to: '' })
    expect(isAllRange(all)).toBe(true)
  })
})

describe('validateInvRange', () => {
  const today = '2026-11-08'
  it('acepta rangos abiertos y completos', () => {
    expect(validateInvRange({ from: '', to: '' }, today)).toBeNull()
    expect(validateInvRange({ from: '2026-11-01', to: '' }, today)).toBeNull()
    expect(validateInvRange({ from: '', to: '2026-11-08' }, today)).toBeNull()
    expect(validateInvRange({ from: '2026-11-01', to: '2026-11-08' }, today)).toBeNull()
  })
  it('rechaza desde > hasta y fechas futuras', () => {
    expect(validateInvRange({ from: '2026-11-09', to: '2026-11-01' }, today)).toMatch(/posterior/)
    expect(validateInvRange({ from: '2026-11-01', to: '2026-11-09' }, today)).toMatch(/futuras/)
  })
})

describe('describeRange', () => {
  const format = (iso: string) => `<${iso}>`
  it('describe cada forma de rango', () => {
    expect(describeRange({ from: '', to: '' }, format)).toBe('Todo el historial')
    expect(describeRange({ from: '2026-11-01', to: '2026-11-01' }, format)).toBe('<2026-11-01>')
    expect(describeRange({ from: '2026-11-01', to: '2026-11-08' }, format)).toBe('<2026-11-01> al <2026-11-08>')
    expect(describeRange({ from: '2026-11-01', to: '' }, format)).toBe('Desde <2026-11-01>')
    expect(describeRange({ from: '', to: '2026-11-08' }, format)).toBe('Hasta <2026-11-08>')
  })
})

describe('excelRange', () => {
  const today = '2026-11-08'
  it('con «Todo» descarga los últimos 366 días y avisa', () => {
    const result = excelRange({ from: '', to: '' }, today)
    expect(result).toEqual({ ok: true, range: { from: '2025-11-08', to: '2026-11-08' }, clamped: true })
  })
  it('respeta un rango normal', () => {
    expect(excelRange({ from: '2026-10-01', to: '2026-10-31' }, today)).toEqual({ ok: true, range: { from: '2026-10-01', to: '2026-10-31' }, clamped: false })
  })
  it('completa «Hasta» con hoy', () => {
    expect(excelRange({ from: '2026-11-01', to: '' }, today)).toEqual({ ok: true, range: { from: '2026-11-01', to: '2026-11-08' }, clamped: false })
  })
  it('rechaza un rango explícito de más de 366 días', () => {
    const result = excelRange({ from: '2025-01-01', to: '2026-11-08' }, today)
    expect(result.ok).toBe(false)
  })
  it('recorta si solo hay «Desde» y es muy antiguo', () => {
    expect(excelRange({ from: '2024-01-01', to: '' }, today)).toEqual({ ok: true, range: { from: '2025-11-08', to: '2026-11-08' }, clamped: true })
  })
  it('propaga fechas inválidas', () => {
    expect(excelRange({ from: '2026-11-09', to: '2026-11-01' }, today).ok).toBe(false)
  })
})

describe('sourceLabel', () => {
  it('traduce cada origen', () => {
    expect(sourceLabel('InitialStock')).toBe('Existencia inicial')
    expect(sourceLabel('Entry')).toBe('Entrada')
    expect(sourceLabel('Adjustment')).toBe('Ajuste')
    expect(sourceLabel('Import')).toBe('Importación')
    expect(sourceLabel('Opening')).toBe('Saldo inicial')
    expect(sourceLabel('Restock')).toBe('Sin entrada registrada')
  })
  it('deja pasar un origen desconocido', () => {
    expect(sourceLabel('Otro')).toBe('Otro')
  })
})

describe('filtros de socio', () => {
  it('«Sin socio» viaja como none', () => {
    expect(filterOf(null)).toBe('none')
    expect(filterOf('abc')).toBe('abc')
    expect(partnerParam('')).toBeNull()
    expect(partnerParam('none')).toBe('none')
  })
})

describe('parseMoneyField', () => {
  it('vacío es null (sin dato)', () => {
    expect(parseMoneyField('')).toBeNull()
    expect(parseMoneyField('   ')).toBeNull()
  })
  it('acepta punto o coma decimal', () => {
    expect(parseMoneyField('380')).toBe(380)
    expect(parseMoneyField('380.5')).toBe(380.5)
    expect(parseMoneyField('380,50')).toBe(380.5)
    expect(parseMoneyField('C$ 12')).toBe(12)
  })
  it('rechaza negativos y texto', () => {
    expect(parseMoneyField('-5')).toBe('invalid')
    expect(parseMoneyField('abc')).toBe('invalid')
    expect(parseMoneyField('1.2.3')).toBe('invalid')
  })
  it('moneyToField es el inverso', () => {
    expect(moneyToField(null)).toBe('')
    expect(moneyToField(380.5)).toBe('380.5')
  })
})

describe('profitInfo y lotWithPartner', () => {
  it('marca ganancia parcial, negativa e inversión incompleta', () => {
    expect(profitInfo({ profitNio: -10, soldUnitsWithoutCost: 0, unitsWithoutCost: 0 })).toEqual({ negative: true, partial: false, incompleteInvestment: false })
    expect(profitInfo({ profitNio: 50, soldUnitsWithoutCost: 3, unitsWithoutCost: 2 })).toEqual({ negative: false, partial: true, incompleteInvestment: true })
  })
  it('asignar socio conserva costo, precio y nota', () => {
    expect(lotWithPartner({ unitCost: null, unitPrice: 650, note: 'x' }, 'p1')).toEqual({ partnerId: 'p1', unitCost: null, unitPrice: 650, note: 'x' })
  })
})
