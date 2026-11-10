/**
 * Humo end-to-end del POS con modo sin conexión (API simulada con page.route).
 *
 * Demuestra: abrir caja -> vender en línea -> cortar la red -> vender sin conexión
 * (incluido recargar la página sin red) -> recuperar la red -> la cola se envía UNA vez
 * -> cerrar caja con conciliación por método.
 *
 * Cobro por menús (Efectivo | Transferencia | Tarjeta, cada uno en C$ o US$) y cierre que concilia
 * efectivo, transferencias (banco) y tarjeta (cierre de lote) contra lo esperado por el sistema.
 *
 * Cómo correrlo (desde src/frontend/la-ganga-web):
 *   npm run build                      # el service worker solo existe en el build
 *   node e2e/pos-offline.mjs           # levanta `vite preview` solo (puerto 4173)
 *
 * Opciones por variable de entorno:
 *   BASE_URL=http://127.0.0.1:4173     usar un servidor ya levantado (no se inicia vite preview)
 *   HEADED=1                           ver el navegador
 *   SHOTS=/ruta/capturas               guardar capturas de pantalla en esa carpeta
 *
 * Requiere Playwright (`require('playwright')`, Chromium ya instalado).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

// ---------- API simulada ----------
const user = {
  id: 'user-1', username: 'vendedor.uno', displayName: 'Vendedor Uno', roles: ['Vendedor'], mustChangePassword: false,
  permissions: ['catalog.read', 'product.read', 'inventory.read', 'sale.create', 'cash.operate'],
}
const settings = {
  usdRate: 36.7, storeName: 'Tienda La Ganga', storeAddress: 'Managua', storePhone: '2222-0000',
  receiptFooter: 'Recibo interno — no es factura', banks: ['BAC', 'Banpro'],
  sellerDiscountLimitPercent: 10, lowStockThreshold: 2, exchangeWindowDays: 4,
}
const variants = [
  { variantId: 'v-1', productId: 'p-1', productName: 'Camisa Oxford', categoryName: 'Camisas', brandName: 'Ganga', sizeName: 'M', colorName: 'Azul', colorHex: '#2a5db0', barcode: '7000000000011', price: 350, stock: 5 },
  { variantId: 'v-2', productId: 'p-1', productName: 'Camisa Oxford', categoryName: 'Camisas', brandName: 'Ganga', sizeName: 'L', colorName: 'Azul', colorHex: '#2a5db0', barcode: '7000000000028', price: 350, stock: 1 },
  { variantId: 'v-3', productId: 'p-2', productName: 'Jean Slim', categoryName: 'Pantalones', brandName: 'Denim Co', sizeName: '32', colorName: 'Negro', colorHex: '#111', barcode: '7000000000035', price: 600, stock: 8 },
  { variantId: 'v-4', productId: 'p-2', productName: 'Jean Slim', categoryName: 'Pantalones', brandName: 'Denim Co', sizeName: '34', colorName: 'Negro', colorHex: '#111', barcode: '7000000000042', price: 600, stock: 0 },
]

const server = {
  down: false,
  session: null,
  sales: new Map(),
  postCounts: new Map(),
  counter: 0,
  summaryCalls: 0,
  closeBody: null,
  stock: Object.fromEntries(variants.map((v) => [v.variantId, v.stock])),
}

function json(route, status, body) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}
function problem(route, status, title, code) {
  return route.fulfill({ status, contentType: 'application/problem+json', body: JSON.stringify({ title, code, errors: {} }) })
}

function buildSale(request) {
  const subtotal = request.lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0)
  const discount = request.discount ? (request.discount.type === 'Percent' ? subtotal * request.discount.value / 100 : request.discount.value) : 0
  const total = subtotal - discount
  const paid = request.payments.reduce((sum, p) => sum + (p.currency === 'USD' ? p.amount * p.exchangeRate : p.amount), 0)
  server.counter += 1
  return {
    id: `sale-${server.counter}`, number: `V-${String(server.counter).padStart(6, '0')}`, clientSaleId: request.clientSaleId,
    status: 'Confirmed', channel: request.channel, cashSessionId: request.cashSessionId, registerName: 'Caja 1',
    sellerName: user.displayName, createdAtUtc: request.createdAtUtc, receivedAtUtc: new Date().toISOString(),
    isOffline: request.isOffline, subtotalNio: subtotal, discountType: request.discount?.type ?? null,
    discountValue: request.discount?.value ?? null, discountNio: discount, totalNio: total,
    changeNio: Math.max(0, paid - total), requiresReview: false, reviewNote: null, note: null,
    voidedAtUtc: null, voidedByName: null, voidReason: null,
    lines: request.lines.map((l) => {
      const v = variants.find((x) => x.variantId === l.variantId)
      return { variantId: l.variantId, productName: v.productName, sizeName: v.sizeName, colorName: v.colorName, barcode: v.barcode, quantity: l.quantity, unitPrice: l.unitPrice, lineTotalNio: l.quantity * l.unitPrice }
    }),
    payments: request.payments.map((p) => ({ ...p, amountNio: p.currency === 'USD' ? p.amount * p.exchangeRate : p.amount })),
  }
}

const r2 = (value) => Math.round(value * 100 + Number.EPSILON) / 100

/** Resumen de caja con la forma del contrato (secciones 3 y 4 de docs/30-mvp-contrato-api.md). */
function buildSummary(session) {
  const sales = [...server.sales.values()]
  const t = {
    salesCount: sales.length, voidedCount: 0, voidedTotalNio: 0, reviewCount: 0, grossTotalNio: 0, discountTotalNio: 0, netTotalNio: 0,
    cashNioTendered: 0, cashUsdTendered: 0, cashUsdEquivalentNio: 0, changeGivenNio: 0, cashTotalNio: 0,
    transferTotalNio: 0, cardTotalNio: 0, transferNioTendered: 0, transferUsdTendered: 0, transferUsdEquivalentNio: 0,
    cardNioTendered: 0, cardUsdTendered: 0, cardUsdEquivalentNio: 0, transfersByBank: [],
    byChannel: [{ channel: 'Store', salesCount: sales.length, totalNio: 0 }],
  }
  const banks = new Map()
  for (const sale of sales) {
    t.grossTotalNio += sale.subtotalNio
    t.discountTotalNio += sale.discountNio
    t.netTotalNio += sale.totalNio
    t.changeGivenNio += sale.changeNio
    for (const p of sale.payments) {
      const usd = p.currency === 'USD'
      if (p.method === 'Cash') {
        if (usd) { t.cashUsdTendered += p.amount; t.cashUsdEquivalentNio += p.amountNio } else t.cashNioTendered += p.amount
      } else if (p.method === 'Transfer') {
        if (usd) { t.transferUsdTendered += p.amount; t.transferUsdEquivalentNio += p.amountNio } else t.transferNioTendered += p.amount
        const bank = banks.get(p.bank) ?? { bank: p.bank, totalNio: 0, totalUsd: 0 }
        bank.totalNio += p.amountNio
        if (usd) bank.totalUsd += p.amount
        banks.set(p.bank, bank)
      } else if (usd) { t.cardUsdTendered += p.amount; t.cardUsdEquivalentNio += p.amountNio } else t.cardNioTendered += p.amount
    }
  }
  t.byChannel[0].totalNio = t.netTotalNio
  t.cashTotalNio = r2(t.cashNioTendered + t.cashUsdEquivalentNio - t.changeGivenNio)
  t.transferTotalNio = r2(t.transferNioTendered + t.transferUsdEquivalentNio)
  t.cardTotalNio = r2(t.cardNioTendered + t.cardUsdEquivalentNio)
  t.transfersByBank = [...banks.values()].map((b) => ({ ...b, totalNio: r2(b.totalNio) }))
  for (const key of ['grossTotalNio', 'discountTotalNio', 'netTotalNio', 'cashUsdEquivalentNio', 'transferUsdEquivalentNio', 'cardUsdEquivalentNio']) t[key] = r2(t[key])
  const expected = {
    expectedCashNio: r2(session.openingFloatNio + t.cashNioTendered - t.changeGivenNio), expectedCashUsd: r2(session.openingFloatUsd + t.cashUsdTendered),
    expectedTransferNio: t.transferNioTendered, expectedTransferUsd: t.transferUsdTendered,
    expectedCardNio: t.cardNioTendered, expectedCardUsd: t.cardUsdTendered,
  }
  const closed = session.closedAtUtc !== null
  const diff = (counted, exp) => (counted === null || counted === undefined ? null : r2(counted - exp))
  return {
    session, totals: t, ...expected,
    differenceCashNio: closed ? diff(session.countedCashNio, expected.expectedCashNio) : null,
    differenceCashUsd: closed ? diff(session.countedCashUsd, expected.expectedCashUsd) : null,
    differenceTransferNio: diff(session.countedTransferNio, expected.expectedTransferNio),
    differenceTransferUsd: diff(session.countedTransferUsd, expected.expectedTransferUsd),
    differenceCardNio: diff(session.countedCardNio, expected.expectedCardNio),
    differenceCardUsd: diff(session.countedCardUsd, expected.expectedCardUsd),
  }
}

async function handleApi(route) {
  const request = route.request()
  const url = new URL(request.url())
  const path = url.pathname
  const method = request.method()
  if (server.down) return route.abort('internetdisconnected')

  if (path === '/api/health') return json(route, 200, { service: 'mock', status: 'healthy', timeZone: 'America/Managua', checkedAtUtc: new Date().toISOString() })
  if (path === '/api/v1/auth/me') return json(route, 200, user)
  if (path === '/api/v1/pos/snapshot') {
    return json(route, 200, {
      generatedAtUtc: new Date().toISOString(), settings,
      variants: variants.map((v) => ({ ...v, stock: server.stock[v.variantId] })),
    })
  }
  if (path === '/api/v1/cash/sessions/current') return server.session ? json(route, 200, server.session) : problem(route, 404, 'No tenés una caja abierta.', 'no_open_session')
  if (path === '/api/v1/cash/registers') {
    return json(route, 200, [
      { id: 'reg-1', name: 'Caja 1', openSession: server.session ? { id: server.session.id, openedAtUtc: server.session.openedAtUtc, openedByName: user.displayName } : null },
      { id: 'reg-2', name: 'Caja 2', openSession: { id: 'other', openedAtUtc: new Date().toISOString(), openedByName: 'María López' } },
    ])
  }
  if (path === '/api/v1/cash/sessions' && method === 'POST') {
    const body = request.postDataJSON()
    server.session = {
      id: 'cs-1', registerId: body.registerId, registerName: 'Caja 1', openedAtUtc: new Date().toISOString(),
      openedByUserId: user.id, openedByName: user.displayName, openingFloatNio: body.openingFloatNio, openingFloatUsd: body.openingFloatUsd,
      closedAtUtc: null, closedByName: null, countedCashNio: null, countedCashUsd: null, closingNotes: null,
      countedTransferNio: null, countedTransferUsd: null, countedCardNio: null, countedCardUsd: null,
    }
    return json(route, 201, server.session)
  }
  if (path === '/api/v1/pos/sales' && method === 'POST') {
    const body = request.postDataJSON()
    server.postCounts.set(body.clientSaleId, (server.postCounts.get(body.clientSaleId) ?? 0) + 1)
    const existing = server.sales.get(body.clientSaleId)
    if (existing) return json(route, 200, { alreadyProcessed: true, sale: existing })
    const sale = buildSale(body)
    body.lines.forEach((l) => { server.stock[l.variantId] -= l.quantity })
    server.sales.set(body.clientSaleId, sale)
    return json(route, 201, { alreadyProcessed: false, sale })
  }
  if (/^\/api\/v1\/cash\/sessions\/[^/]+\/sales$/.test(path)) return json(route, 200, [...server.sales.values()])
  if (/^\/api\/v1\/cash\/sessions\/[^/]+\/summary$/.test(path)) {
    server.summaryCalls += 1
    return json(route, 200, buildSummary(server.session))
  }
  if (/^\/api\/v1\/cash\/sessions\/[^/]+\/close$/.test(path)) {
    const body = request.postDataJSON()
    server.closeBody = body
    const optional = (value) => (value === undefined || value === null ? null : value)
    server.session = {
      ...server.session, closedAtUtc: new Date().toISOString(), closedByName: user.displayName,
      countedCashNio: body.countedCashNio, countedCashUsd: body.countedCashUsd, closingNotes: body.notes,
      countedTransferNio: optional(body.countedTransferNio), countedTransferUsd: optional(body.countedTransferUsd),
      countedCardNio: optional(body.countedCardNio), countedCardUsd: optional(body.countedCardUsd),
    }
    const closed = buildSummary(server.session)
    server.session = null
    return json(route, 200, closed)
  }
  return problem(route, 404, `Ruta no simulada: ${method} ${path}`, 'not_mocked')
}

// ---------- Utilidades de prueba ----------
const results = []
function check(name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition) })
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) process.exitCode = 1
}

/** Repite una comprobación hasta que sea cierta (la pantalla se actualiza de forma asíncrona). */
async function eventually(fn, ms = 4000) {
  const limit = Date.now() + ms
  for (;;) {
    try { if (await fn()) return true } catch { /* aún no */ }
    if (Date.now() > limit) return false
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function waitForServer(url, ms = 20000) {
  const limit = Date.now() + ms
  while (Date.now() < limit) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* aún no */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`El servidor ${url} no respondió. ¿Corriste «npm run build»?`)
}

let preview = null
if (!process.env.BASE_URL) {
  preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' })
}

const browser = await chromium.launch({ headless: !process.env.HEADED })
try {
  await waitForServer(BASE_URL)
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } })
  await context.route('**/api/**', handleApi)
  const page = await context.newPage()
  page.on('pageerror', (error) => { console.log('PAGE ERROR', error.message); process.exitCode = 1 })
  page.on('dialog', (dialog) => dialog.dismiss())
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed ?? 0) + 1 } })
  const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

  const status = () => page.getByTestId('connection-status')
  const pendingText = () => page.getByTestId('pending-count').innerText()
  const scan = async (code) => { await page.locator('#pv-scan-input').fill(code); await page.locator('#pv-scan-input').press('Enter') }

  async function payExactAndFinish() {
    await page.locator('#pv-scan-input').fill('')
    await page.locator('#pv-scan-input').press('Enter') // Enter con el campo vacío = cobrar
    await page.getByRole('dialog', { name: 'Cobrar' }).waitFor()
    await page.getByRole('button', { name: 'Exacto' }).click()
    await page.getByRole('button', { name: /Agregar pago/ }).click()
    await shot('pay')
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await page.getByTestId('sale-done').waitFor()
  }

  // 1) Primera visita en línea: abrir caja
  await page.goto(`${BASE_URL}/#pos`)
  await page.getByRole('heading', { name: 'Abrir caja' }).waitFor()
  check('Pantalla Abrir caja (Caja 2 ocupada)', await page.getByText('Ocupada por María López').isVisible())
  await page.getByLabel(/Fondo inicial en córdobas/).fill('500')
  await page.getByRole('button', { name: 'Abrir caja' }).click()
  await page.locator('#pv-scan-input').waitFor()
  check('Caja abierta y POS listo', await page.getByText('Caja 1 · Vendedor Uno').isVisible())
  await shot('01-pos')

  // El service worker precachea el armazón para la próxima carga sin red
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForTimeout(800)

  // 2) Venta en línea
  await scan('7000000000011')
  check('Escanear agrega al carrito', await page.getByTestId('cart-total').innerText() === 'C$ 350.00')
  await payExactAndFinish()
  await page.waitForFunction(() => document.body.innerText.includes('Enviada al servidor'), null, { timeout: 15000 })
  check('Venta en línea enviada (con número oficial)', await page.getByTestId('sale-done').innerText().then((t) => /V-000001/.test(t)))
  await page.getByRole('button', { name: /Sin recibo/ }).click()
  check('Servidor recibió 1 venta', server.sales.size === 1)

  // 2b) Cobro por menús, pago mixto con dólares en los tres métodos (2 camisas = C$ 700)
  await scan('7000000000011')
  await scan('7000000000011')
  check('Total de las 2 camisas C$ 700', await page.getByTestId('cart-total').innerText() === 'C$ 700.00')
  await page.locator('#pv-scan-input').fill('')
  await page.locator('#pv-scan-input').press('Enter')
  const payDialog = page.getByRole('dialog', { name: 'Cobrar' })
  await payDialog.waitFor()
  check('Cobro: menú Efectivo | Transferencia | Tarjeta (Efectivo activo, C$)',
    await payDialog.getByRole('tab').count() === 3
    && await payDialog.getByRole('tab', { name: /Efectivo/ }).getAttribute('aria-selected') === 'true'
    && await payDialog.getByRole('radio', { name: /Córdobas/ }).getAttribute('aria-checked') === 'true')
  check('Cobro: el foco cae en el monto', await page.evaluate(() => document.activeElement?.id === 'pay-amount'))
  // Efectivo US$ 5 (tasa 36.7 = C$ 183.50)
  await payDialog.getByRole('radio', { name: /Dólares/ }).click()
  await page.locator('#pay-amount').fill('5')
  check('US$ muestra tasa y equivalente en vivo', await payDialog.locator('.pv-rate').innerText().then((t) => /36\.7/.test(t) && /C\$ 183\.50/.test(t)))
  await page.locator('#pay-amount').press('Enter')
  check('Pago agregado: Pendiente C$ 516.50', await page.getByTestId('pay-status').innerText() === 'C$ 516.50' && await payDialog.getByTestId('pay-line').count() === 1)
  // Transferencia en US$ con F2 (US$ 4 = C$ 146.80), banco y referencia
  await page.keyboard.press('F2')
  check('F2 abre Transferencia y conserva la moneda US$', await payDialog.getByRole('tab', { name: /Transferencia/ }).getAttribute('aria-selected') === 'true'
    && await payDialog.getByRole('radio', { name: /Dólares/ }).getAttribute('aria-checked') === 'true')
  await payDialog.getByLabel('Banco de la transferencia').selectOption('Banpro')
  await payDialog.getByLabel('Referencia de la transferencia').fill('TR-9981')
  await page.locator('#pay-amount').fill('4')
  await page.locator('#pay-amount').press('Enter')
  // Tarjeta (F3): una transferencia/tarjeta que se pasa del total no se deja agregar
  await page.keyboard.press('F3')
  await page.locator('#pay-amount').fill('20')
  check('Tarjeta US$ 20 (C$ 734 > pendiente) se rechaza: solo el efectivo da cambio',
    await payDialog.getByText(/Solo el efectivo puede dar cambio/).isVisible()
    && await payDialog.getByRole('button', { name: /Agregar pago/ }).isDisabled())
  await page.locator('#pay-amount').fill('3')
  await page.locator('#pay-amount').press('Enter')
  check('Tres pagos agregados y Confirmar sigue deshabilitado', await payDialog.getByTestId('pay-line').count() === 3
    && await payDialog.getByRole('button', { name: /Confirmar cobro/ }).isDisabled())
  // Resto en tarjeta C$ con «Todo lo pendiente»; se quita y se vuelve a agregar
  await payDialog.getByRole('radio', { name: /Córdobas/ }).click()
  await payDialog.getByRole('button', { name: 'Todo lo pendiente' }).click()
  await page.locator('#pay-amount').press('Enter')
  check('Pendiente C$ 0.00 con 4 líneas', await page.getByTestId('pay-status').innerText() === 'C$ 0.00' && await payDialog.getByTestId('pay-line').count() === 4)
  await payDialog.getByRole('button', { name: /Quitar pago: Tarjeta/ }).last().click()
  check('Quitar la última línea devuelve el pendiente (C$ 259.60)', await page.getByTestId('pay-status').innerText() === 'C$ 259.60')
  await payDialog.getByRole('button', { name: 'Todo lo pendiente' }).click()
  await shot('pay-mixto')
  await page.locator('#pay-amount').press('Enter') // agrega
  await page.locator('#pay-amount').press('Enter') // con el monto vacío y el cobro completo, confirma
  await page.getByTestId('sale-done').waitFor()
  await page.waitForFunction(() => document.body.innerText.includes('Enviada al servidor'), null, { timeout: 15000 })
  const mixed = [...server.sales.values()][1]
  check('El servidor recibió el pago mixto con tasa en cada US$',
    JSON.stringify(mixed.payments.map((p) => [p.method, p.currency, p.amount, p.exchangeRate, p.bank, p.reference]))
      === JSON.stringify([['Cash', 'USD', 5, 36.7, null, null], ['Transfer', 'USD', 4, 36.7, 'Banpro', 'TR-9981'], ['Card', 'USD', 3, 36.7, null, null], ['Card', 'NIO', 259.6, null, null, null]]),
    JSON.stringify(mixed.payments))
  await page.getByRole('button', { name: /Sin recibo/ }).click()

  // 3) Se corta la red
  server.down = true
  await context.setOffline(true)
  await page.waitForFunction(() => document.querySelector('[data-testid="connection-status"]')?.textContent?.includes('Sin conexión'), null, { timeout: 15000 })
  check('Indicador muestra «Sin conexión»', (await status().innerText()).includes('Sin conexión'))
  await shot('02-offline')

  // Escanear dos veces suma cantidad; vender sin conexión
  await scan('7000000000035')
  await scan('7000000000035')
  check('Escanear dos veces suma cantidad (C$ 1,200)', await page.getByTestId('cart-total').innerText() === 'C$ 1,200.00')
  // Código inexistente: aviso claro y no cambia el carrito
  await scan('9999999999999')
  check('Código no encontrado muestra aviso', await page.getByText(/Código no encontrado: 9999999999999/).isVisible())
  // Descuento sobre el límite sin conexión: bloqueado
  await page.getByLabel('Porcentaje de descuento').fill('30')
  check('Descuento > límite sin conexión se bloquea', await page.getByText(/Sin conexión: un descuento mayor a 10%/).isVisible()
    && await page.locator('.pv-charge').isDisabled())
  await page.getByLabel('Porcentaje de descuento').fill('5')
  await payExactAndFinish()
  check('Venta sin conexión guardada en el equipo', await page.getByTestId('sale-done').innerText().then((t) => /Guardada en este equipo/.test(t) && /#[0-9A-F]{6}/.test(t)))
  await page.getByRole('button', { name: /Sin recibo/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="pending-count"]')?.textContent?.startsWith('1 '))
  check('Cola: 1 pendiente', (await pendingText()).startsWith('1 pendiente'))
  check('Servidor sigue con 2 ventas', server.sales.size === 2)

  // Stock mostrado descuenta lo pendiente: Jean 32 tenía 8, se vendió 2 -> 6
  await page.locator('#pv-scan-input').fill('jean')
  await page.locator('.pv-product').first().click()
  const labels = await page.locator('.pv-size').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')))
  check('Stock = instantánea − pendientes (6)', labels.some((l) => /Jean Slim · Negro · 32, quedan 6/.test(l ?? '')), JSON.stringify(labels))
  await page.locator('#pv-scan-input').fill('')

  // 4) Recargar sin red: abre desde el service worker y entra con el usuario guardado
  await page.reload()
  await page.locator('#pv-scan-input').waitFor({ timeout: 15000 })
  check('Recarga sin red: abre el POS (modo sin conexión)', (await status().innerText()).includes('Sin conexión')
    && await page.getByText(/Modo sin conexión: entraste con el usuario guardado/).isVisible())
  check('La cola sobrevive a la recarga', (await pendingText()).startsWith('1 pendiente'))
  // Sin existencias no se vende: ni siquiera sin conexión (ya no existe «vender de todos modos»)
  await scan('7000000000042')
  check('Sin stock: aviso y la prenda no entra al carrito', await eventually(async () => await page.getByText(/Sin existencias de/).first().isVisible()
    && await page.getByTestId('cart-total').innerText() === 'C$ 0.00'),
  `total=${await page.getByTestId('cart-total').innerText()} aviso=${await page.locator('.pv-scan-feedback, [role=status], .pv-toast').allInnerTexts()}`)
  await scan('7000000000035')
  await payExactAndFinish()
  await page.getByRole('button', { name: /Sin recibo/ }).click()
  await page.waitForFunction(() => document.querySelector('[data-testid="pending-count"]')?.textContent?.startsWith('2 '))
  check('Cola: 2 pendientes', (await pendingText()).startsWith('2 pendientes'))
  await shot('03-offline-queue')

  // 5) Cerrar caja se bloquea sin conexión / con pendientes
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  check('Cerrar caja bloqueado sin conexión', await page.getByText(/Sin conexión: para cerrar la caja/).isVisible()
    && await page.getByRole('button', { name: 'Cerrar caja' }).last().isDisabled())
  await page.keyboard.press('Escape')

  // 6) Vuelve la red: la cola se envía una sola vez
  server.down = false
  await context.setOffline(false)
  await page.waitForFunction(() => document.querySelector('[data-testid="pending-count"]')?.textContent?.startsWith('0 '), null, { timeout: 30000 })
  check('Al recuperar la red la cola queda en 0', (await pendingText()).startsWith('0 pendientes'))
  check('Servidor tiene 4 ventas', server.sales.size === 4, `ventas=${server.sales.size}`)
  check('Cada venta se envió exactamente una vez', [...server.postCounts.values()].every((count) => count === 1), JSON.stringify([...server.postCounts.values()]))
  const offlineFlags = [...server.sales.values()].map((sale) => sale.isOffline)
  check('Ventas offline marcadas isOffline', offlineFlags.filter(Boolean).length === 2)
  await page.getByText(/Conexión recuperada/).first().waitFor({ timeout: 5000 })
  check('Toast de conexión recuperada', true)
  await shot('04-synced')

  // 7) Ventas de esta caja
  await page.getByRole('button', { name: 'Ventas de esta caja' }).click()
  const salesText = await page.getByRole('dialog').innerText()
  await shot('07-ventas-caja')
  check('Lista de ventas con números oficiales y estado Enviada', /V-000004/.test(salesText) && (salesText.match(/Enviada/g) ?? []).length >= 4)
  await page.getByRole('button', { name: 'Recibo' }).first().click()
  await page.waitForTimeout(300)
  check('Reimprimir recibo llama a imprimir', (await page.evaluate(() => window.__printed ?? 0)) >= 1)
  await page.keyboard.press('Escape')

  // 8) Cierre de caja: efectivo (conteo), transferencias (banco) y tarjeta (lote) contra lo esperado
  await shot('06-sales')
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  const closeDialog = page.getByRole('dialog', { name: 'Cerrar caja' })
  await closeDialog.getByText('Esperado por el sistema').first().waitFor()
  check('El cierre consulta lo esperado al servidor', server.summaryCalls >= 1)
  // Esperado: C$ 500 de fondo + 350 + 1140 + 600 = 2,590; US$ 5; transferencia US$ 4 (Banpro); tarjeta C$ 259.60 + US$ 3
  check('Muestra lo esperado en efectivo, transferencias y tarjeta', await eventually(async () => {
    const text = await closeDialog.innerText()
    return /C\$ 2,590\.00/.test(text) && /US\$ 5\.00/.test(text) && /C\$ 259\.60/.test(text) && /US\$ 3\.00/.test(text)
  }))
  check('Desglose por banco (Banpro con US$ 4 en dólares)', await closeDialog.getByRole('list', { name: 'Desglose por banco' }).innerText().then((t) => /Banpro/.test(t) && /US\$ 4\.00/.test(t)))
  await closeDialog.getByLabel('Cantidad de billetes o monedas de 1000 córdobas').fill('2')
  await closeDialog.getByLabel('Cantidad de billetes o monedas de 500 córdobas').fill('1')
  await closeDialog.getByLabel('Cantidad de billetes o monedas de 50 córdobas').fill('1')
  await closeDialog.getByLabel('Cantidad de billetes o monedas de 20 córdobas').fill('1')
  check('Diferencia de efectivo en vivo: falta C$ 20', await eventually(() => closeDialog.getByText('Falta C$ 20.00').first().isVisible()))
  await closeDialog.getByLabel('Cantidad de billetes o monedas de 20 córdobas').fill('2')
  await closeDialog.getByLabel('Total en dólares').fill('5')
  check('Efectivo cuadra', await eventually(async () => (await closeDialog.getByText('Cuadra').count()) >= 2))
  // Transferencias: verificado en el banco US$ 4 (cuadra); tarjeta: lote C$ 259.60 y US$ 2 (falta US$ 1)
  const section = (name) => closeDialog.locator(`section[aria-label="${name}"]`)
  await section('Transferencias').getByLabel(/US\$/).fill('4')
  await section('Tarjeta (POS)').getByLabel(/C\$/).fill('259.60')
  await section('Tarjeta (POS)').getByLabel(/US\$/).fill('2')
  check('Diferencia de tarjeta en vivo: falta US$ 1', await eventually(() => section('Tarjeta (POS)').getByText('Falta US$ 1.00').isVisible()))
  await shot('05a-cierre-form')
  await page.getByRole('button', { name: 'Cerrar caja' }).last().click()
  check('Resumen final antes de confirmar', await closeDialog.getByText('Transferencias (banco)').isVisible()
    && await closeDialog.getByText('Falta US$ 1.00').isVisible() && await closeDialog.getByText(/Hay diferencias/).isVisible())
  await shot('05b-cierre-resumen')
  await page.getByRole('button', { name: 'Sí, cerrar caja' }).click()
  await page.getByRole('heading', { name: 'Caja cerrada' }).waitFor()
  check('Se enviaron solo los campos verificados',
    JSON.stringify(server.closeBody) === JSON.stringify({ countedCashNio: 2590, countedCashUsd: 5, notes: '', countedTransferUsd: 4, countedCardNio: 259.6, countedCardUsd: 2 }),
    JSON.stringify(server.closeBody))
  const done = page.getByRole('dialog', { name: 'Caja cerrada' })
  check('Cierre muestra la tabla por método y moneda', await page.getByText('Arqueo de efectivo').isVisible()
    && await done.getByText('Tarjeta (cierre de lote)').isVisible())
  check('Cierre: Cuadra (efectivo, transferencia) y Falta US$ 1.00 (tarjeta)', (await done.getByText('Cuadra').count()) >= 3 && await done.getByText('Falta US$ 1.00').isVisible())
  check('Cierre: la moneda sin movimientos (transferencias en C$) no ocupa fila', await done.locator('.pv-recon-row').count() === 5)
  const doneText = await done.innerText()
  check('Totales vendidos por método y descuentos', /Total vendido/.test(doneText) && /Descuentos/.test(doneText) && /US\$ 4\.00/.test(doneText) && /Banpro/.test(doneText))
  await shot('05-cierre')
  await done.getByRole('button', { name: 'Imprimir resumen' }).click()
  await page.waitForTimeout(300)
  const printed = await page.locator('.receipt-print-root').textContent()
  check('Resumen imprimible con vendido por método y conciliación',
    /CIERRE DE CAJA/.test(printed ?? '') && /CONCILIACION/.test(printed ?? '') && /Falta US\$ 1\.00/.test(printed ?? '') && /TRANSFERENCIAS/.test(printed ?? ''), (printed ?? '').slice(0, 200))
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.getByRole('heading', { name: 'Abrir caja' }).waitFor()
  check('Después del cierre vuelve a Abrir caja', true)
} catch (error) {
  console.error('FALLO', error)
  process.exitCode = 1
} finally {
  await browser.close()
  preview?.kill()
  const failed = results.filter((item) => !item.ok)
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`)
}
