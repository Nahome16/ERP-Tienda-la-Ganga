import { describe, expect, it } from 'vitest'
import type { SaleRequestPayment } from '../lib/apiTypes'
import { computePayments } from '../lib/money'
import {
  amountForPending, checkDraft, draftToPayment, emptyDraft, evaluatePayments, parseAmount, usdToNio,
  type PaymentDraft,
} from './payments'

const rate = 36.7

const draft = (patch: Partial<PaymentDraft>): PaymentDraft => ({ ...emptyDraft('BAC'), ...patch })
const pay = (patch: Partial<PaymentDraft>) => {
  const payment = draftToPayment(draft(patch), rate)
  if (!payment) throw new Error('borrador sin monto')
  return payment
}

describe('parseAmount', () => {
  it('acepta coma decimal y descarta lo inválido', () => {
    expect(parseAmount('12,5')).toBe(12.5)
    expect(parseAmount(' 1 000.456 ')).toBe(1000.46)
    expect(parseAmount('abc')).toBe(0)
    expect(parseAmount('-4')).toBe(0)
    expect(parseAmount('')).toBe(0)
  })
})

describe('draftToPayment', () => {
  it('efectivo en córdobas: sin tasa ni banco', () => {
    expect(draftToPayment(draft({ amount: '100' }), rate)).toEqual(
      { method: 'Cash', currency: 'NIO', amount: 100, exchangeRate: null, bank: null, reference: null },
    )
  })

  it('dólares llevan la tasa en los tres métodos', () => {
    expect(pay({ method: 'Cash', currency: 'USD', amount: '20' })).toMatchObject({ currency: 'USD', amount: 20, exchangeRate: rate, bank: null })
    expect(pay({ method: 'Transfer', currency: 'USD', amount: '10', reference: ' 77 ' })).toEqual(
      { method: 'Transfer', currency: 'USD', amount: 10, exchangeRate: rate, bank: 'BAC', reference: '77' },
    )
    expect(pay({ method: 'Card', currency: 'USD', amount: '5' })).toEqual(
      { method: 'Card', currency: 'USD', amount: 5, exchangeRate: rate, bank: null, reference: null },
    )
  })

  it('banco y referencia solo existen en la transferencia', () => {
    const card = draftToPayment(draft({ method: 'Card', amount: '50', reference: 'x' }), rate)
    expect(card).toMatchObject({ bank: null, reference: null })
    expect(draftToPayment(draft({ amount: '' }), rate)).toBeNull()
    expect(draftToPayment(draft({ amount: '0' }), rate)).toBeNull()
  })
})

describe('evaluatePayments', () => {
  it('convierte dólares en efectivo y da el cambio en C$', () => {
    // 30 × 36.7 = 1101 → total 1000 → cambio 101
    const evaluation = evaluatePayments(1000, [pay({ currency: 'USD', amount: '30' })])
    expect(evaluation.paidNio).toBe(1101)
    expect(evaluation.changeNio).toBe(101)
    expect(evaluation.pendingNio).toBe(0)
    expect(evaluation.valid).toBe(true)
  })

  it('mezcla: US$ 10 en efectivo + transferencia C$ + tarjeta US$', () => {
    const payments = [
      pay({ currency: 'USD', amount: '10' }), // 367
      pay({ method: 'Transfer', amount: '500' }),
      pay({ method: 'Card', currency: 'USD', amount: '3' }), // 110.1
    ]
    const evaluation = evaluatePayments(977.1, payments)
    expect(evaluation.paidNio).toBe(977.1)
    expect(evaluation.pendingNio).toBe(0)
    expect(evaluation.changeNio).toBe(0)
    expect(evaluation.valid).toBe(true)
  })

  it('se pueden agregar varias líneas del mismo método', () => {
    const payments = [pay({ amount: '100' }), pay({ amount: '200' }), pay({ method: 'Transfer', amount: '100' }), pay({ method: 'Transfer', amount: '100' })]
    const evaluation = evaluatePayments(500, payments)
    expect(evaluation.valid).toBe(true)
    expect(evaluation.cashNio).toBe(300)
    expect(evaluation.nonCashNio).toBe(200)
  })

  it('muestra lo pendiente y no deja confirmar si falta dinero', () => {
    const evaluation = evaluatePayments(1000, [pay({ amount: '400' })])
    expect(evaluation.pendingNio).toBe(600)
    expect(evaluation.valid).toBe(false)
    expect(evaluation.error).toBeNull()
  })

  it('sin pagos no es válido', () => {
    expect(evaluatePayments(100, []).valid).toBe(false)
    expect(evaluatePayments(0, []).valid).toBe(false)
  })

  it('transferencia o tarjeta (C$ o US$) no pueden dejar pagado de más', () => {
    const transfer = evaluatePayments(500, [pay({ method: 'Transfer', amount: '600' })])
    expect(transfer.valid).toBe(false)
    expect(transfer.error).toMatch(/cambio/)
    expect(evaluatePayments(500, [pay({ method: 'Card', amount: '500.01' })]).valid).toBe(false)
    // US$ 14 = 513.80 > 500
    expect(evaluatePayments(500, [pay({ method: 'Transfer', currency: 'USD', amount: '14' })]).valid).toBe(false)
    expect(evaluatePayments(500, [pay({ method: 'Card', currency: 'USD', amount: '14' })]).valid).toBe(false)
  })

  it('solo el efectivo da cambio y no puede superar el efectivo recibido', () => {
    // transf 200 + efectivo 400 = 600 → cambio 100 ≤ efectivo 400
    const mixed = evaluatePayments(500, [pay({ method: 'Transfer', amount: '200' }), pay({ amount: '400' })])
    expect(mixed.valid).toBe(true)
    expect(mixed.changeNio).toBe(100)
    // transf 450 + efectivo 100 = 550 → cambio 50 ≤ 100: válido (el cambio sale del efectivo)
    expect(evaluatePayments(500, [pay({ method: 'Transfer', amount: '450' }), pay({ amount: '100' })]).valid).toBe(true)
    // transf 500 + tarjeta 100: cambio 100 sin efectivo → inválido
    expect(evaluatePayments(500, [pay({ method: 'Transfer', amount: '500' }), pay({ method: 'Card', amount: '100' })]).valid).toBe(false)
  })

  it('exige banco en la transferencia cuando hay bancos configurados', () => {
    const payments = [pay({ method: 'Transfer', amount: '500', bank: '' })]
    expect(evaluatePayments(500, payments, true).valid).toBe(false)
    expect(evaluatePayments(500, payments, true).error).toMatch(/banco/)
    expect(evaluatePayments(500, payments, false).valid).toBe(true)
  })

  it('un pago en dólares sin tasa no es válido', () => {
    const payment: SaleRequestPayment = { method: 'Cash', currency: 'USD', amount: 10, exchangeRate: null, bank: null, reference: null }
    expect(evaluatePayments(100, [payment]).valid).toBe(false)
  })

  it('computePayments redondea cada pago en córdobas', () => {
    const result = computePayments(100, [{ method: 'Cash', currency: 'USD', amount: 2.73, exchangeRate: 36.7, bank: null, reference: null }])
    expect(result.paidNio).toBe(100.19)
    expect(result.changeNio).toBe(0.19)
  })
})

describe('checkDraft', () => {
  it('sin monto no hay pago ni error', () => {
    expect(checkDraft(500, [], draft({}), rate, true)).toEqual({ payment: null, error: null, changeNio: 0 })
  })

  it('rechaza una transferencia que pasaría el total y acepta la exacta', () => {
    const over = checkDraft(500, [], draft({ method: 'Transfer', amount: '501' }), rate, true)
    expect(over.payment).toBeNull()
    expect(over.error).toMatch(/cambio/)
    expect(checkDraft(500, [], draft({ method: 'Transfer', amount: '500' }), rate, true).payment).not.toBeNull()
  })

  it('tiene en cuenta lo ya agregado y calcula el cambio del efectivo', () => {
    const existing = [pay({ method: 'Transfer', amount: '300' })]
    expect(checkDraft(500, existing, draft({ method: 'Card', amount: '250' }), rate, true).payment).toBeNull()
    const cash = checkDraft(500, existing, draft({ amount: '500' }), rate, true)
    expect(cash.payment).not.toBeNull()
    expect(cash.changeNio).toBe(300)
  })

  it('transferencia sin banco no se puede agregar', () => {
    const result = checkDraft(500, [], draft({ method: 'Transfer', amount: '100', bank: '' }), rate, true)
    expect(result.payment).toBeNull()
    expect(result.error).toMatch(/banco/)
  })
})

describe('amountForPending', () => {
  it('córdobas: el pendiente exacto', () => {
    expect(amountForPending(123.45, 'NIO', 'Transfer', rate)).toBe(123.45)
    expect(amountForPending(0, 'NIO', 'Cash', rate)).toBe(0)
  })

  it('dólares: efectivo redondea hacia arriba, el resto hacia abajo (sin pasarse)', () => {
    // 100 / 36.7 = 2.7248 → 2.73 (efectivo) / 2.72 (transferencia)
    expect(amountForPending(100, 'USD', 'Cash', rate)).toBe(2.73)
    expect(amountForPending(100, 'USD', 'Transfer', rate)).toBe(2.72)
    expect(usdToNio(amountForPending(100, 'USD', 'Card', rate), rate)).toBeLessThanOrEqual(100)
    // 367 = US$ 10 exactos
    expect(amountForPending(367, 'USD', 'Cash', rate)).toBe(10)
    expect(amountForPending(367, 'USD', 'Card', rate)).toBe(10)
  })
})
