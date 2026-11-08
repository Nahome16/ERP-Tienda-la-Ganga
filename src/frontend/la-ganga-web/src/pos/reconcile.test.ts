import { describe, expect, it } from 'vitest'
import { formatNio, formatUsd } from '../lib/money'
import {
  buildCloseRequest, diffText, diffTone, liveRows, parseOptionalAmount, visibleRows, type CloseInputs, type Expected,
} from './reconcile'

const base: CloseInputs = { countedCashNio: 1500, countedCashUsd: 20, notes: '  todo bien ', transferNio: '', transferUsd: '', cardNio: '', cardUsd: '' }

describe('parseOptionalAmount', () => {
  it('vacío = no verificado; cualquier número (incluido 0) = verificado', () => {
    expect(parseOptionalAmount('')).toBeNull()
    expect(parseOptionalAmount('   ')).toBeNull()
    expect(parseOptionalAmount('0')).toBe(0)
    expect(parseOptionalAmount('1250,5')).toBe(1250.5)
  })
})

describe('buildCloseRequest', () => {
  it('omite transferencia y tarjeta cuando no se escribió nada', () => {
    expect(buildCloseRequest(base)).toEqual({ countedCashNio: 1500, countedCashUsd: 20, notes: 'todo bien' })
  })

  it('incluye solo lo que la persona escribió', () => {
    const request = buildCloseRequest({ ...base, transferNio: '800', cardUsd: '0' })
    expect(request).toEqual({ countedCashNio: 1500, countedCashUsd: 20, notes: 'todo bien', countedTransferNio: 800, countedCardUsd: 0 })
    expect('countedTransferUsd' in request).toBe(false)
    expect('countedCardNio' in request).toBe(false)
  })
})

describe('diferencias', () => {
  it('clasifica y redacta', () => {
    expect(diffTone(0)).toBe('ok')
    expect(diffTone(-5)).toBe('short')
    expect(diffTone(5)).toBe('over')
    expect(diffTone(null)).toBe('none')
    expect(diffText(0, formatNio)).toBe('Cuadra')
    expect(diffText(-10, formatNio)).toBe('Falta C$ 10.00')
    expect(diffText(2.5, formatUsd)).toBe('Sobra US$ 2.50')
    expect(diffText(null, formatNio)).toBe('No verificado')
  })
})

describe('liveRows y visibleRows', () => {
  const expected: Expected = {
    expectedCashNio: 1000, expectedCashUsd: 0, expectedTransferNio: 734, expectedTransferUsd: 20,
    expectedCardNio: 0, expectedCardUsd: 0,
  }

  it('calcula verificado − esperado por método y moneda', () => {
    const rows = liveRows(expected, { cashNio: 990, cashUsd: 0, transferNio: 734, transferUsd: null, cardNio: null, cardUsd: null })
    expect(rows.map((row) => row.difference)).toEqual([-10, 0, 0, null, null, null])
  })

  it('muestra compacto lo que no tuvo movimientos ni verificación', () => {
    const rows = liveRows(expected, { cashNio: 1000, cashUsd: 0, transferNio: null, transferUsd: null, cardNio: null, cardUsd: null })
    const visible = visibleRows(rows).map((row) => `${row.method}-${row.currency}`)
    expect(visible).toEqual(['Cash-NIO', 'Transfer-NIO', 'Transfer-USD'])
    // Si se verificó una moneda sin movimiento (≠ 0), aparece para mostrar la diferencia
    const withCard = liveRows(expected, { cashNio: 1000, cashUsd: 0, transferNio: null, transferUsd: null, cardNio: 50, cardUsd: null })
    expect(visibleRows(withCard).some((row) => row.method === 'Card' && row.difference === 50)).toBe(true)
  })
})
