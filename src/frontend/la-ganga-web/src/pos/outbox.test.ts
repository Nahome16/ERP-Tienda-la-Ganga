import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../lib/api'
import type { Sale, SaleRequest, SaleResult } from '../lib/apiTypes'
import { resetDbForTests } from './db'
import {
  backoffMs, countByStatus, drainOutbox, enqueueSale, getOutboxEntry, listOutbox, pruneSent,
  recoverInterrupted, retryEntry,
} from './outbox'
import { buildLocalSale, newClientSaleId, shortRef } from './sale'
import { pendingUnits } from './stock'
import type { CartLine } from './types'

const cartLine: CartLine = {
  variantId: 'v1', productId: 'p1', productName: 'Camisa', sizeName: 'M', colorName: 'Azul',
  colorHex: null, barcode: '123', unitPrice: 100, quantity: 2,
}

function makeRequest(id: string, quantity = 2): SaleRequest {
  return {
    clientSaleId: id,
    cashSessionId: 'cs1',
    channel: 'Store',
    createdAtUtc: '2026-11-10T15:00:00.000Z',
    isOffline: true,
    lines: [{ variantId: 'v1', quantity, unitPrice: 100 }],
    discount: null,
    discountApprovalId: null,
    payments: [{ method: 'Cash', currency: 'NIO', amount: 500, exchangeRate: null, bank: null, reference: null }],
    note: null,
  }
}

async function queue(id: string, userId = 'u1', quantity = 2) {
  const request = makeRequest(id, quantity)
  const localSale = buildLocalSale(request, [{ ...cartLine, quantity }], {
    session: { registerName: 'Caja 1' }, sellerName: 'Ana', settings: { usdRate: 36.7 },
  })
  return enqueueSale({ clientSaleId: id, userId, userName: userId, request, localSale })
}

function okSend() {
  let counter = 0
  return vi.fn(async (request: SaleRequest): Promise<SaleResult> => {
    counter += 1
    const sale = { id: `s${counter}`, number: `V-00000${counter}`, clientSaleId: request.clientSaleId, receivedAtUtc: '2026-11-10T16:00:00Z' } as Sale
    return { alreadyProcessed: false, sale }
  })
}

beforeEach(async () => {
  await resetDbForTests()
})

describe('cola de ventas (outbox)', () => {
  it('guarda en orden y no duplica el mismo clientSaleId', async () => {
    const a = await queue('aaaaaaaa-1')
    const b = await queue('bbbbbbbb-2')
    const again = await queue('aaaaaaaa-1')
    expect(again.seq).toBe(a.seq)
    const entries = await listOutbox('u1')
    expect(entries.map((entry) => entry.clientSaleId)).toEqual(['aaaaaaaa-1', 'bbbbbbbb-2'])
    expect(b.seq).toBeGreaterThan(a.seq)
    expect(entries.every((entry) => entry.status === 'pending')).toBe(true)
    expect(entries[0]?.localSale.number).toBe('#AAAAAA')
  })

  it('envía una a una en orden y guarda la venta oficial', async () => {
    await queue('id-1'); await queue('id-2'); await queue('id-3')
    const send = okSend()
    const result = await drainOutbox({ userId: 'u1', send })
    expect(result.sent).toBe(3)
    expect(send.mock.calls.map(([request]) => request.clientSaleId)).toEqual(['id-1', 'id-2', 'id-3'])
    const entries = await listOutbox('u1')
    expect(entries.map((entry) => entry.status)).toEqual(['sent', 'sent', 'sent'])
    expect(entries[0]?.serverSale?.number).toBe('V-000001')
    expect(entries[0]?.sentAt).not.toBeNull()
  })

  it('idempotencia: alreadyProcessed también cuenta como enviada', async () => {
    await queue('id-1')
    const send = vi.fn(async (request: SaleRequest): Promise<SaleResult> => ({
      alreadyProcessed: true, sale: { id: 's', number: 'V-000009', clientSaleId: request.clientSaleId } as Sale,
    }))
    await drainOutbox({ userId: 'u1', send })
    const entry = await getOutboxEntry('id-1')
    expect(entry?.status).toBe('sent')
    expect(entry?.alreadyProcessed).toBe(true)
    // Un segundo ciclo no vuelve a enviar lo que ya está enviado.
    await drainOutbox({ userId: 'u1', send })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('solo envía las ventas del usuario en sesión', async () => {
    await queue('mine-1', 'u1')
    await queue('other-1', 'u2')
    await queue('mine-2', 'u1')
    const send = okSend()
    await drainOutbox({ userId: 'u1', send })
    expect(send.mock.calls.map(([request]) => request.clientSaleId)).toEqual(['mine-1', 'mine-2'])
    expect((await getOutboxEntry('other-1'))?.status).toBe('pending')
    expect(await listOutbox('u2')).toHaveLength(1)
    expect(await listOutbox()).toHaveLength(3)
  })

  it('error de red: conserva la venta, retrocede y detiene el ciclo', async () => {
    await queue('id-1'); await queue('id-2')
    const send = vi.fn(async (): Promise<SaleResult> => { throw new ApiError(0, 'sin red', 'network_error', {}) })
    const now = Date.parse('2026-11-10T16:00:00Z')
    const result = await drainOutbox({ userId: 'u1', send, now: () => now })
    expect(result.stoppedBy).toBe('network')
    expect(send).toHaveBeenCalledTimes(1)
    const first = await getOutboxEntry('id-1')
    expect(first?.status).toBe('pending')
    expect(first?.attempts).toBe(1)
    expect(first?.nextAttemptAt).toBe(now + backoffMs(1))
    expect((await getOutboxEntry('id-2'))?.status).toBe('pending')

    // Antes de la espera no se reintenta la que falló (la otra, que nunca se intentó, sí).
    const early = okSend()
    await drainOutbox({ userId: 'u1', send: early, now: () => now + 1000 })
    expect(early.mock.calls.map(([request]) => request.clientSaleId)).toEqual(['id-2'])
    // Pasada la espera (o con force) se reintenta.
    const late = okSend()
    const done = await drainOutbox({ userId: 'u1', send: late, now: () => now + backoffMs(1) + 1 })
    expect(done.sent).toBe(1)
    expect(countByStatus(await listOutbox('u1'), 'sent')).toBe(2)
    expect((await getOutboxEntry('id-1'))?.status).toBe('sent')
  })

  it('retroceso exponencial con tope de 5 minutos', () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2000, 4000, 8000, 16000])
    expect(backoffMs(30)).toBe(5 * 60 * 1000)
    expect(backoffMs(0)).toBe(0)
  })

  it('5xx: reintenta después pero sigue con las demás ventas', async () => {
    await queue('bad'); await queue('good')
    const send = vi.fn(async (request: SaleRequest): Promise<SaleResult> => {
      if (request.clientSaleId === 'bad') throw new ApiError(500, 'Error interno', null, {})
      return { alreadyProcessed: false, sale: { id: 's', number: 'V-1', clientSaleId: request.clientSaleId } as Sale }
    })
    const result = await drainOutbox({ userId: 'u1', send })
    expect(result.retryLater).toBe(1)
    expect(result.sent).toBe(1)
    expect((await getOutboxEntry('bad'))?.status).toBe('pending')
    expect((await getOutboxEntry('bad'))?.nextAttemptAt).not.toBeNull()
    expect((await getOutboxEntry('good'))?.status).toBe('sent')
  })

  it('401: conserva la cola y se detiene sin contar intento', async () => {
    await queue('id-1'); await queue('id-2')
    const send = vi.fn(async (): Promise<SaleResult> => { throw new ApiError(401, 'No autorizado', null, {}) })
    const result = await drainOutbox({ userId: 'u1', send })
    expect(result.stoppedBy).toBe('unauthorized')
    expect(send).toHaveBeenCalledTimes(1)
    const entries = await listOutbox('u1')
    expect(entries.map((entry) => entry.status)).toEqual(['pending', 'pending'])
    expect(entries[0]?.attempts).toBe(0)
    expect(entries[0]?.lastError).toMatch(/sesión venció/)
    // Tras iniciar sesión, continúa.
    const send2 = okSend()
    expect((await drainOutbox({ userId: 'u1', send: send2 })).sent).toBe(2)
  })

  it('422/409: marca «attention» con el mensaje y NO bloquea a las siguientes', async () => {
    await queue('rejected'); await queue('after')
    const send = vi.fn(async (request: SaleRequest): Promise<SaleResult> => {
      if (request.clientSaleId === 'rejected') throw new ApiError(422, 'El descuento no está autorizado.', 'discount_not_authorized', {})
      return { alreadyProcessed: false, sale: { id: 's', number: 'V-2', clientSaleId: request.clientSaleId } as Sale }
    })
    const result = await drainOutbox({ userId: 'u1', send })
    expect(result.needsAttention).toBe(1)
    expect(result.sent).toBe(1)
    const rejected = await getOutboxEntry('rejected')
    expect(rejected?.status).toBe('attention')
    expect(rejected?.lastError).toBe('El descuento no está autorizado.')
    expect(rejected?.errorCode).toBe('discount_not_authorized')
    expect((await getOutboxEntry('after'))?.status).toBe('sent')

    // No se reintenta sola, pero se puede reintentar a mano.
    await drainOutbox({ userId: 'u1', send })
    expect(send).toHaveBeenCalledTimes(2)
    await retryEntry('rejected')
    expect((await getOutboxEntry('rejected'))?.status).toBe('pending')
  })

  it('si el navegador se cerró enviando, la venta vuelve a la cola al abrir', async () => {
    await queue('id-1')
    // Simula el cierre a mitad: el envío nunca respondió.
    const hanging = new Promise<SaleResult>(() => undefined)
    void drainOutbox({ userId: 'u1', send: () => hanging })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await getOutboxEntry('id-1'))?.status).toBe('sending')
    expect(await recoverInterrupted()).toBe(1)
    expect((await getOutboxEntry('id-1'))?.status).toBe('pending')
    const send = okSend()
    expect((await drainOutbox({ userId: 'u1', send })).sent).toBe(1)
  })

  it('pruneSent solo borra enviadas antiguas', async () => {
    const now = Date.now()
    await queue('old'); await queue('pending')
    await drainOutbox({
      userId: 'u1', now: () => now - 10 * 24 * 3600 * 1000,
      send: async (request) => {
        if (request.clientSaleId === 'pending') throw new ApiError(500, 'x', null, {})
        return { alreadyProcessed: false, sale: { id: 's', number: 'V', clientSaleId: request.clientSaleId } as Sale }
      },
    })
    await queue('fresh')
    await drainOutbox({ userId: 'u1', send: okSend(), now: () => now })
    expect(await pruneSent(7 * 24 * 3600 * 1000, now)).toBe(1)
    expect((await listOutbox()).map((entry) => entry.clientSaleId).sort()).toEqual(['fresh', 'pending'])
  })
})

describe('referencias y stock', () => {
  it('referencia corta y GUID', () => {
    expect(shortRef('abcdef12-3456-4789-8abc-def012345678')).toBe('#ABCDEF')
    expect(newClientSaleId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('el stock descuenta pendientes y enviadas posteriores a la instantánea', async () => {
    await queue('p1', 'u1', 2)
    await queue('p2', 'u1', 3)
    await queue('p3', 'u1', 4)
    // p3 ya enviada ANTES de la instantánea (ya está descontada); p2 enviada DESPUÉS.
    const send = vi.fn(async (request: SaleRequest): Promise<SaleResult> => {
      const received = request.clientSaleId === 'p2' ? '2026-11-10T18:00:00Z' : '2026-11-10T12:00:00Z'
      return { alreadyProcessed: false, sale: { id: 's', number: 'V', clientSaleId: request.clientSaleId, receivedAtUtc: received } as Sale }
    })
    await retryEntry('p1')
    // Solo p2 y p3 se envían: p1 se deja pendiente forzando un fallo de red en la primera.
    const guarded = vi.fn(async (request: SaleRequest) => {
      if (request.clientSaleId === 'p1') throw new ApiError(500, 'x', null, {})
      return send(request)
    })
    await drainOutbox({ userId: 'u1', send: guarded })
    const units = pendingUnits(await listOutbox('u1'), { generatedAtUtc: '2026-11-10T15:00:00Z' })
    // p1 pendiente (2) + p2 enviada tras la instantánea (3); p3 no cuenta.
    expect(units.get('v1')).toBe(5)
  })
})
