import { describe, expect, it } from 'vitest'
import { computePayments, computeTotals, discountExceedsLimit, round2 } from '../lib/money'
import { buildPayments, emptyPaymentForm, evaluatePayments, parseAmount } from './payments'

describe('computeTotals', () => {
  const lines = [{ quantity: 2, unitPrice: 350 }, { quantity: 1, unitPrice: 199.99 }]

  it('suma líneas sin descuento', () => {
    expect(computeTotals({ lines, discount: null })).toEqual({
      subtotalNio: 899.99, discountNio: 0, totalNio: 899.99, discountPercent: 0,
    })
  })

  it('aplica descuento por porcentaje y redondea mitad hacia arriba', () => {
    const totals = computeTotals({ lines, discount: { type: 'Percent', value: 10 } })
    // 899.99 * 10% = 89.999 → 90.00
    expect(totals.discountNio).toBe(90)
    expect(totals.totalNio).toBe(809.99)
    expect(totals.discountPercent).toBe(10)
  })

  it('aplica descuento por monto fijo y lo limita al subtotal', () => {
    expect(computeTotals({ lines, discount: { type: 'Amount', value: 100 } }).totalNio).toBe(799.99)
    const capped = computeTotals({ lines, discount: { type: 'Amount', value: 5000 } })
    expect(capped.discountNio).toBe(899.99)
    expect(capped.totalNio).toBe(0)
  })

  it('el porcentaje equivalente de un monto fijo se compara con el límite del vendedor', () => {
    const totals = computeTotals({ lines: [{ quantity: 1, unitPrice: 1000 }], discount: { type: 'Amount', value: 120 } })
    expect(totals.discountPercent).toBe(12)
    expect(discountExceedsLimit(totals, { sellerDiscountLimitPercent: 10 })).toBe(true)
    expect(discountExceedsLimit({ ...totals, discountPercent: 10 }, { sellerDiscountLimitPercent: 10 })).toBe(false)
  })

  it('ignora porcentajes fuera de rango', () => {
    expect(computeTotals({ lines, discount: { type: 'Percent', value: 150 } }).totalNio).toBe(0)
    expect(computeTotals({ lines, discount: { type: 'Percent', value: -5 } }).discountNio).toBe(0)
  })

  it('round2 no tiene errores de coma flotante', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(2.675)).toBe(2.68)
    expect(round2(0.1 + 0.2)).toBe(0.3)
  })
})

describe('pagos mixtos', () => {
  const rate = 36.7

  it('parseAmount acepta coma decimal y descarta lo inválido', () => {
    expect(parseAmount('12,5')).toBe(12.5)
    expect(parseAmount(' 1 000.456 ')).toBe(1000.46)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount('-4')).toBe(0)
  })

  it('arma pagos en efectivo C$, US$ (con tasa), transferencia y tarjeta', () => {
    const payments = buildPayments({
      cashNio: '100', cashUsd: '20', transfer: '300', bank: 'BAC', reference: ' 555 ', card: '50',
    }, rate)
    expect(payments).toEqual([
      { method: 'Cash', currency: 'NIO', amount: 100, exchangeRate: null, bank: null, reference: null },
      { method: 'Cash', currency: 'USD', amount: 20, exchangeRate: rate, bank: null, reference: null },
      { method: 'Transfer', currency: 'NIO', amount: 300, exchangeRate: null, bank: 'BAC', reference: '555' },
      { method: 'Card', currency: 'NIO', amount: 50, exchangeRate: null, bank: null, reference: null },
    ])
  })

  it('convierte dólares a córdobas y calcula el cambio en C$', () => {
    const payments = buildPayments({ ...emptyPaymentForm('BAC'), cashUsd: '30' }, rate)
    // 30 × 36.7 = 1101 → total 1000 → cambio 101
    const evaluation = evaluatePayments(1000, payments)
    expect(evaluation.paidNio).toBe(1101)
    expect(evaluation.changeNio).toBe(101)
    expect(evaluation.pendingNio).toBe(0)
    expect(evaluation.valid).toBe(true)
  })

  it('efectivo C$ + US$ + transferencia', () => {
    const payments = buildPayments({ ...emptyPaymentForm('BAC'), cashNio: '200', cashUsd: '10', transfer: '433' }, rate)
    const evaluation = evaluatePayments(1000, payments)
    expect(evaluation.paidNio).toBe(1000)
    expect(evaluation.changeNio).toBe(0)
    expect(evaluation.valid).toBe(true)
  })

  it('muestra lo pendiente y no deja confirmar si falta dinero', () => {
    const payments = buildPayments({ ...emptyPaymentForm(), cashNio: '400' }, rate)
    const evaluation = evaluatePayments(1000, payments)
    expect(evaluation.pendingNio).toBe(600)
    expect(evaluation.valid).toBe(false)
  })

  it('no permite que la transferencia o la tarjeta superen el total (el cambio solo sale del efectivo)', () => {
    const transfer = evaluatePayments(500, buildPayments({ ...emptyPaymentForm('BAC'), transfer: '600' }, rate))
    expect(transfer.valid).toBe(false)
    expect(transfer.error).toMatch(/cambio/)
    const card = evaluatePayments(500, buildPayments({ ...emptyPaymentForm(), card: '500.01' }, rate))
    expect(card.valid).toBe(false)
    // Mixto con exceso de efectivo sí es válido y da cambio
    const mixed = evaluatePayments(500, buildPayments({ ...emptyPaymentForm('BAC'), transfer: '200', cashNio: '400' }, rate))
    expect(mixed.valid).toBe(true)
    expect(mixed.changeNio).toBe(100)
  })

  it('exige banco en la transferencia cuando hay bancos configurados', () => {
    const payments = buildPayments({ ...emptyPaymentForm(''), transfer: '500' }, rate)
    expect(evaluatePayments(500, payments, true).valid).toBe(false)
    expect(evaluatePayments(500, payments, false).valid).toBe(true)
  })

  it('computePayments redondea cada pago en córdobas', () => {
    const result = computePayments(100, [{ method: 'Cash', currency: 'USD', amount: 2.73, exchangeRate: 36.7, bank: null, reference: null }])
    expect(result.paidNio).toBe(100.19)
    expect(result.changeNio).toBe(0.19)
  })
})
