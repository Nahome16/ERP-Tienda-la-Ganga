// Pruebas de extremo a extremo de la pantalla «Socios e inversión» con la API simulada (page.route).
// Uso: node e2e/investment.mjs            (compila con `npm run build` y levanta `vite preview` en 4199)
//      BASE_URL=http://127.0.0.1:5199 node e2e/investment.mjs   (contra un servidor que ya esté en marcha)
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminUser, createMock } from './admin-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'la-ganga-investment-shots')
mkdirSync(shots, { recursive: true })

let base = process.env.BASE_URL
let server = null
if (!base) {
  base = 'http://127.0.0.1:4199'
  server = spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(base)).ok) break } catch { /* aún no responde */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const fakeXlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2500, 7)])
const managuaToday = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const today = managuaToday()
const monthStart = `${today.slice(0, 7)}-01`

let failures = 0
const consoleProblems = []
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`)
  else { failures += 1; console.log(`  FAIL ${message}`) }
}
async function visible(locator, timeout = 4000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true } catch { return false }
}
const hasHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

const investUser = {
  ...adminUser,
  permissions: [...adminUser.permissions, 'investment.read', 'investment.manage'],
}

// ---------------------------------------------------------------- Datos de ejemplo (contrato, sección 11)
const summaryRow = (partnerId, partnerName, extra = {}) => ({
  partnerId, partnerName, unitsEntered: 0, investedNio: 0, unitsWithoutCost: 0, unitsInStock: 0, stockAtCostNio: 0, stockAtPriceNio: 0,
  unitsSold: 0, revenueNio: 0, costOfSoldNio: 0, profitNio: 0, soldUnitsWithoutCost: 0, lossUnits: 0, lossCostNio: 0, ...extra,
})

function makeState() {
  const lot = (id, partnerId, partnerName, product, size, color, barcode, source, qty, remaining, sold, lost, cost, price, current, extra = {}) => ({
    id, partnerId, partnerName, variantId: `v-${id}`, productId: `pr-${product}`, productName: product, sizeName: size, colorName: color, barcode,
    enteredAtUtc: '2026-10-05T15:30:00Z', enteredByName: 'Administrador', source, note: null,
    quantityIn: qty, quantityRemaining: remaining, quantitySold: sold, quantityLost: lost, unitCost: cost, unitPrice: price, currentPrice: current,
    investedNio: cost === null ? 0 : qty * cost, stockAtCostNio: cost === null ? 0 : remaining * cost, ...extra,
  })
  return {
    partners: [
      { id: 'p1', name: 'Rosa Pérez', phone: '8888-1111', notes: 'Socia fundadora', isActive: true, version: 1 },
      { id: 'p2', name: 'Carlos Mena', phone: null, notes: null, isActive: true, version: 1 },
      { id: 'p3', name: 'Luis Vega', phone: null, notes: 'Ya no invierte', isActive: false, version: 2 },
    ],
    lots: [
      lot('l1', 'p1', 'Rosa Pérez', 'Camisa Oxford', 'M', 'Azul', '7501000000011', 'Import', 20, 12, 7, 1, 380, 650, 650),
      lot('l2', 'p1', 'Rosa Pérez', 'Jean Slim', '32', 'Negro', '7501000000028', 'Entry', 10, 0, 10, 0, 500, 900, 950, { enteredAtUtc: '2026-09-20T14:00:00Z' }),
      lot('l3', 'p1', 'Rosa Pérez', 'Polo Básico', 'L', 'Blanco', '7501000000035', 'Adjustment', 5, 5, 0, 0, null, 300, 300),
      lot('l4', 'p2', 'Carlos Mena', 'Blusa Floral', 'S', 'Azul', '7501000000042', 'InitialStock', 8, 6, 2, 0, 250, 450, 450),
      lot('l5', null, 'Sin socio', 'Camisa Oxford', 'L', 'Negro', '7501000000059', 'Opening', 15, 15, 0, 0, null, null, 650, { enteredAtUtc: '2026-08-01T12:00:00Z' }),
      lot('l6', null, 'Sin socio', 'Jean Slim', '32', 'Azul', '7501000000066', 'Opening', 6, 4, 2, 0, 480, null, 950, { enteredAtUtc: '2026-08-01T12:00:00Z' }),
      lot('l7', null, 'Sin socio', 'Polo Básico', 'M', 'Negro', '7501000000073', 'Restock', 3, 3, 0, 0, null, null, 300, { note: 'Unidades sin entrada registrada' }),
    ],
    calls: [],
  }
}

const baseSummary = {
  from: null, to: null,
  partners: [
    summaryRow('p1', 'Rosa Pérez', { unitsEntered: 35, investedNio: 12600, unitsWithoutCost: 5, unitsInStock: 17, stockAtCostNio: 4560, stockAtPriceNio: 7550, unitsSold: 17, revenueNio: 14100, costOfSoldNio: 7660, profitNio: 6440, soldUnitsWithoutCost: 0, lossUnits: 1, lossCostNio: 380 }),
    summaryRow('p2', 'Carlos Mena', { unitsEntered: 8, investedNio: 2000, unitsInStock: 6, stockAtCostNio: 1500, stockAtPriceNio: 2700, unitsSold: 2, revenueNio: 900, costOfSoldNio: 500, profitNio: 400 }),
    summaryRow('p3', 'Luis Vega', { unitsEntered: 4, investedNio: 800, unitsInStock: 0, unitsSold: 4, revenueNio: 600, costOfSoldNio: 800, profitNio: -200 }),
    summaryRow(null, 'Sin socio', { unitsEntered: 24, investedNio: 2880, unitsWithoutCost: 18, unitsInStock: 22, stockAtCostNio: 1920, stockAtPriceNio: 18000, unitsSold: 2, revenueNio: 1900, costOfSoldNio: 960, profitNio: 940, soldUnitsWithoutCost: 3 }),
  ],
  totals: summaryRow(null, 'Total', { unitsEntered: 71, investedNio: 18280, unitsWithoutCost: 23, unitsInStock: 45, stockAtCostNio: 7980, stockAtPriceNio: 28250, unitsSold: 25, revenueNio: 17500, costOfSoldNio: 9920, profitNio: 7580, soldUnitsWithoutCost: 3, lossUnits: 1, lossCostNio: 380 }),
}

const breakdownFor = (partnerId) => [
  { partnerId, partnerName: partnerId === 'p1' ? 'Rosa Pérez' : 'x', productId: 'pr-a', productName: 'Camisa Oxford', unitsEntered: 20, investedNio: 7600, unitsInStock: 12, stockAtCostNio: 4560, unitsSold: 7, revenueNio: 4550, profitNio: 1890 },
  { partnerId, partnerName: 'x', productId: 'pr-b', productName: 'Jean Slim', unitsEntered: 10, investedNio: 5000, unitsInStock: 0, unitsSold: 10, stockAtCostNio: 0, revenueNio: 8600, profitNio: -400 },
]

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/** Instala las rutas de /investment y /reports/investment (ganan sobre la simulación general). */
async function installInvestment(page, state, options = {}) {
  await page.route('**/api/v1/investment/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname.replace('/api/v1/investment', '')
    const q = url.searchParams
    const body = request.postData() ? JSON.parse(request.postData()) : null
    state.calls.push({ method, path, query: Object.fromEntries(q), body })

    if (path === '/summary') {
      if (options.summaryError?.()) return json(route, 500, { title: 'No fue posible calcular el resumen.' })
      const scaled = q.get('from') || q.get('to')
      const summary = scaled
        ? { ...baseSummary, from: q.get('from'), to: q.get('to'), partners: baseSummary.partners.map((row) => ({ ...row, unitsSold: 1, revenueNio: 111 })) }
        : baseSummary
      return json(route, 200, summary)
    }
    if (path === '/partners' && method === 'GET') return json(route, 200, q.get('status') === 'all' ? state.partners : state.partners.filter((p) => p.isActive))
    if (path === '/partners' && method === 'POST') {
      if (state.partners.some((p) => p.name.toLowerCase() === body.name.toLowerCase())) return json(route, 409, { title: 'Ya existe un socio con ese nombre.', code: 'duplicate_name' })
      const created = { id: `p${state.partners.length + 1}`, name: body.name, phone: body.phone, notes: body.notes, isActive: true, version: 1 }
      state.partners.push(created)
      return json(route, 201, created)
    }
    let m = path.match(/^\/partners\/([^/]+)$/)
    if (m && method === 'PUT') {
      const partner = state.partners.find((p) => p.id === m[1])
      Object.assign(partner, { name: body.name, phone: body.phone, notes: body.notes, isActive: body.isActive, version: partner.version + 1 })
      return json(route, 200, partner)
    }
    if (path === '/breakdown') return json(route, 200, breakdownFor(q.get('partnerId')))
    if (path === '/lots' && method === 'GET') {
      let items = [...state.lots]
      const pid = q.get('partnerId')
      if (pid === 'none') items = items.filter((l) => l.partnerId === null)
      else if (pid) items = items.filter((l) => l.partnerId === pid)
      if (q.get('onlyWithStock') === 'true') items = items.filter((l) => l.quantityRemaining > 0)
      const search = q.get('search')?.toLowerCase()
      if (search) items = items.filter((l) => l.productName.toLowerCase().includes(search) || l.barcode.includes(search))
      const pageSize = Number(q.get('pageSize') ?? 25)
      const page = Number(q.get('page') ?? 1)
      return json(route, 200, { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, totalCount: items.length, totalPages: Math.max(1, Math.ceil(items.length / pageSize)) })
    }
    m = path.match(/^\/lots\/([^/]+)$/)
    if (m && method === 'PUT') {
      if (options.lotError?.(m[1])) return json(route, 422, { title: 'No se pudo guardar la entrada.', code: 'validation_failed', errors: { unitCost: ['El costo no puede ser negativo.'] } })
      const lot = state.lots.find((l) => l.id === m[1])
      const partner = state.partners.find((p) => p.id === body.partnerId)
      Object.assign(lot, {
        partnerId: body.partnerId, partnerName: partner ? partner.name : 'Sin socio', unitCost: body.unitCost, unitPrice: body.unitPrice, note: body.note,
        investedNio: body.unitCost === null ? 0 : lot.quantityIn * body.unitCost, stockAtCostNio: body.unitCost === null ? 0 : lot.quantityRemaining * body.unitCost,
      })
      return json(route, 200, lot)
    }
    return json(route, 404, { title: `Sin simulación para ${method} ${path}`, code: 'not_mocked' })
  })
}

const browser = await chromium.launch()

async function open(hash = 'socios', { user = investUser, viewport = { width: 1366, height: 900 }, options = {}, reportHandler } = {}) {
  const mock = createMock({ user })
  const state = makeState()
  const reportCalls = []
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => consoleProblems.push(`pageerror ${hash}: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !/not_mocked|404|409|422|500|Failed to load resource|net::ERR/.test(message.text())) consoleProblems.push(`console ${hash}: ${message.text()}`) })
  await mock.install(page)
  await installInvestment(page, state, options)
  await page.route('**/api/v1/reports/investment**', async (route) => {
    const url = new URL(route.request().url())
    reportCalls.push({ from: url.searchParams.get('from'), to: url.searchParams.get('to') })
    if (reportHandler) return reportHandler(route)
    const name = `socios-inversion_${url.searchParams.get('from')}_${url.searchParams.get('to')}.xlsx`
    return route.fulfill({ status: 200, body: fakeXlsx, headers: { 'Content-Type': xlsxMime, 'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}` } })
  })
  await page.goto(`${base}/#${hash}`)
  return { page, context, state, reportCalls }
}

const lastCall = (state, predicate) => [...state.calls].reverse().find(predicate)
const tab = (page, name) => page.getByRole('tab', { name })

// ---------------------------------------------------------------- Resumen
console.log('Resumen por socio')
{
  const { page, context, state } = await open()
  check(await visible(page.getByRole('heading', { name: 'Socios e inversión', level: 1 })), 'muestra el título')
  check(await visible(page.getByRole('group', { name: 'Totales de todos los socios' })), 'muestra las tarjetas de totales')
  const cards = page.getByRole('group', { name: 'Totales de todos los socios' })
  for (const label of ['Inversión total', 'Existencias al costo', 'Existencias a precio de venta', 'Vendido', 'Ganancia']) {
    check(await visible(cards.getByText(label, { exact: true })), `tarjeta «${label}»`)
  }
  check(await visible(cards.getByText('C$ 18,280.00')), 'inversión total formateada en córdobas')
  check(await visible(page.getByText(/existencias son siempre las de hoy/)), 'aclara que las existencias son las de hoy')
  const table = page.getByRole('table', { name: 'Resumen por socio' })
  check(await visible(table.getByRole('row', { name: /Rosa Pérez/ })), 'fila de Rosa Pérez')
  check(await visible(table.getByRole('row', { name: /Sin socio/ })), 'fila «Sin socio»')
  check(await visible(table.getByText(/parcial · 3 unid\. sin costo/)), 'ganancia «parcial» en Sin socio')
  check(await visible(table.getByText(/Inversión incompleta, faltan costos \(18 unid\.\)/)), 'marca de inversión incompleta en Sin socio')
  const loss = await table.getByRole('row', { name: /Luis Vega/ }).locator('td').nth(9).locator('.adm-neg').count()
  check(loss === 1, 'la ganancia negativa de Luis Vega va en rojo (adm-neg)')
  check(await visible(table.getByRole('row', { name: /Luis Vega/ }).getByText('Inactivo')), 'marca al socio inactivo')
  check(lastCall(state, (c) => c.path === '/summary').query.from === undefined, 'por defecto pide todo el historial (sin from/to)')
  await page.screenshot({ path: join(shots, 'resumen-escritorio.png'), fullPage: true })
  await context.close()
}

// ---------------------------------------------------------------- Filtro de fechas
console.log('Filtro de fechas')
{
  const { page, context, state } = await open()
  await visible(page.getByRole('table', { name: 'Resumen por socio' }))
  await page.getByRole('button', { name: 'Este mes', exact: true }).click()
  await page.waitForResponse((r) => r.url().includes('/investment/summary') && r.url().includes('from='))
  let call = lastCall(state, (c) => c.path === '/summary')
  check(call.query.from === monthStart && call.query.to === today, `Este mes pide ${monthStart} a ${today}`)
  check(await page.getByLabel('Desde').inputValue() === monthStart, 'llena el campo Desde')
  check(await page.getByRole('button', { name: 'Este mes', exact: true }).getAttribute('aria-pressed') === 'true', 'marca el atajo activo')
  check(await visible(page.getByText(/corresponden al período elegido/)), 'explica el período')

  await page.getByRole('button', { name: 'Mes pasado', exact: true }).click()
  await page.waitForResponse((r) => r.url().includes('/investment/summary') && r.url().includes(`to=${addDays(monthStart, -1)}`))
  call = lastCall(state, (c) => c.path === '/summary')
  check(call.query.to === addDays(monthStart, -1) && call.query.from === `${addDays(monthStart, -1).slice(0, 7)}-01`, 'Mes pasado pide el mes anterior completo')

  await page.getByRole('button', { name: 'Hoy', exact: true }).click()
  await page.waitForResponse((r) => r.url().includes('/investment/summary') && r.url().includes(`from=${today}`))
  call = lastCall(state, (c) => c.path === '/summary')
  check(call.query.from === today && call.query.to === today, 'Hoy pide solo hoy')

  await page.getByRole('button', { name: 'Todo', exact: true }).click()
  await page.waitForResponse((r) => r.url().includes('/investment/summary') && !r.url().includes('from='))
  call = lastCall(state, (c) => c.path === '/summary')
  check(call.query.from === undefined && call.query.to === undefined, 'Todo quita las fechas')

  const before = state.calls.length
  await page.getByLabel('Desde').fill(addDays(today, -1))
  await page.getByLabel('Hasta').fill(addDays(today, -5))
  check(await visible(page.getByRole('alert').filter({ hasText: 'no puede ser posterior' })), 'avisa si Desde es posterior a Hasta')
  check(await page.getByRole('button', { name: 'Descargar Excel' }).isDisabled(), 'deshabilita Excel con fechas inválidas')
  const invalidCalls = state.calls.slice(before).filter((c) => c.path === '/summary' && c.query.from === addDays(today, -1) && c.query.to === addDays(today, -5))
  check(invalidCalls.length === 0, 'no consulta la API con un rango inválido')
  await context.close()
}

// ---------------------------------------------------------------- Detalle de un socio
console.log('Detalle de socio')
{
  const { page, context, state } = await open()
  await page.getByRole('table', { name: 'Resumen por socio' }).getByRole('button', { name: 'Ver detalle de Rosa Pérez' }).click()
  check(await visible(page.getByRole('heading', { name: 'Rosa Pérez', level: 2 })), 'abre el detalle del socio')
  check(await visible(page.getByText('Tel. 8888-1111')), 'muestra el teléfono y las notas')
  check(await visible(page.getByRole('group', { name: 'Totales de Rosa Pérez' })), 'KPIs propios del socio')
  const byProduct = page.getByRole('table', { name: 'Productos de Rosa Pérez' })
  check(await visible(byProduct.getByRole('row', { name: /Camisa Oxford/ })), 'tabla por producto')
  check(await byProduct.getByRole('row', { name: /Jean Slim/ }).locator('.adm-neg').count() >= 1, 'ganancia negativa por producto en rojo')
  check(lastCall(state, (c) => c.path === '/breakdown').query.partnerId === 'p1', 'pidió el desglose con partnerId=p1')

  const lots = page.getByRole('table', { name: 'Entradas de Rosa Pérez' })
  check(await visible(lots.getByRole('row', { name: /Camisa Oxford/ })), 'tabla de entradas')
  check(lastCall(state, (c) => c.path === '/lots').query.partnerId === 'p1', 'pidió las entradas con partnerId=p1')
  check(await visible(lots.getByText('Importación')) && await visible(lots.getByText('Entrada', { exact: true })) && await visible(lots.getByText('Ajuste', { exact: true })), 'origen traducido (Importación/Entrada/Ajuste)')
  const noCostRow = lots.getByRole('row', { name: /Polo Básico/ })
  check(await noCostRow.getAttribute('class') === 'inv-nocost', 'resalta la entrada sin costo')
  check((await noCostRow.locator('td').nth(8).innerText()).includes('—'), 'costo nulo se muestra como «—»')
  check(await visible(lots.getByText('cambió')), 'avisa que el precio actual cambió respecto al dado (950 vs 900)')

  await page.getByLabel('Solo con existencias').check()
  await page.waitForResponse((r) => r.url().includes('onlyWithStock=true'))
  check(await lots.getByRole('row', { name: /Jean Slim/ }).count() === 0, '«solo con existencias» oculta lo agotado')
  await page.getByLabel('Buscar').fill('polo')
  await page.waitForResponse((r) => r.url().includes('search=polo'))
  check(await lots.getByRole('row', { name: /Camisa Oxford/ }).count() === 0 && await lots.getByRole('row', { name: /Polo Básico/ }).count() === 1, 'la búsqueda filtra por producto')
  await page.screenshot({ path: join(shots, 'detalle-escritorio.png'), fullPage: true })

  await page.getByRole('button', { name: '← Volver al resumen' }).click()
  check(await visible(page.getByRole('table', { name: 'Resumen por socio' })), 'vuelve al resumen')
  await page.getByRole('table', { name: 'Resumen por socio' }).getByRole('row', { name: /Sin socio/ }).click()
  check(await visible(page.getByRole('heading', { name: 'Sin socio', level: 2 })), 'abre el detalle de «Sin socio» con clic en la fila')
  check(lastCall(state, (c) => c.path === '/breakdown').query.partnerId === 'none', 'Sin socio viaja como partnerId=none')
  await context.close()
}

// ---------------------------------------------------------------- Editar una entrada
console.log('Editar una entrada')
{
  let failOnce = true
  const { page, context, state } = await open('socios', { options: { lotError: () => { if (failOnce) { failOnce = false; return true } return false } } })
  await page.getByRole('table', { name: 'Resumen por socio' }).getByRole('button', { name: 'Ver detalle de Rosa Pérez' }).click()
  const lots = page.getByRole('table', { name: 'Entradas de Rosa Pérez' })
  await lots.getByRole('button', { name: /Editar entrada de Polo Básico/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Editar entrada de mercadería' })
  check(await visible(dialog), 'abre el diálogo de edición')
  check(await visible(dialog.getByText(/corrige todo el historial/)) && await visible(dialog.getByText(/auditoría/)), 'explica que corrige el historial y queda en auditoría')
  await dialog.getByLabel('Socio').selectOption('p2')
  await dialog.getByLabel('Costo unitario (C$)').fill('abc')
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
  check(await visible(dialog.getByText(/Escribí un monto válido/)), 'valida el costo en el cliente')
  await dialog.getByLabel('Costo unitario (C$)').fill('150,50')
  await dialog.getByLabel('Precio dado (C$)').fill('300')
  await dialog.getByLabel('Nota (opcional)').fill('Corregido por Rosa')
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
  check(await visible(dialog.getByRole('alert').filter({ hasText: 'No se pudo guardar la entrada.' })), 'muestra el error del servidor (422) dentro del diálogo')
  check(await dialog.isVisible(), 'el diálogo sigue abierto tras el error')
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
  await dialog.waitFor({ state: 'detached' })
  const put = lastCall(state, (c) => c.method === 'PUT' && c.path === '/lots/l3')
  check(put && put.body.partnerId === 'p2' && put.body.unitCost === 150.5 && put.body.unitPrice === 300 && put.body.note === 'Corregido por Rosa', 'PUT /lots/l3 con socio, costo, precio y nota')
  check(await visible(page.getByText(/Guardamos los cambios de la entrada/)), 'confirma el guardado')
  check(await lots.getByRole('row', { name: /Polo Básico/ }).count() === 0, 'la entrada ya no aparece en el socio anterior (recarga)')

  // Vaciar costo y precio los manda como null.
  await lots.getByRole('button', { name: /Editar entrada de Camisa Oxford/ }).click()
  await dialog.getByLabel('Costo unitario (C$)').fill('')
  await dialog.getByLabel('Precio dado (C$)').fill('')
  await dialog.getByRole('button', { name: 'Guardar cambios' }).click()
  await dialog.waitFor({ state: 'detached' })
  const cleared = lastCall(state, (c) => c.method === 'PUT' && c.path === '/lots/l1')
  check(cleared && cleared.body.unitCost === null && cleared.body.unitPrice === null && cleared.body.partnerId === 'p1', 'costo y precio vacíos se envían como null')
  await context.close()
}

// ---------------------------------------------------------------- Todas las entradas y asignación rápida
console.log('Todas las entradas y asignación de socio')
{
  const { page, context, state } = await open()
  await tab(page, 'Todas las entradas').click()
  const lots = page.getByRole('table', { name: 'Todas las entradas de mercadería' })
  check(await visible(lots.getByRole('row', { name: /Blusa Floral/ })), 'lista las entradas de todos los socios')
  check(await visible(lots.getByRole('columnheader', { name: 'Socio' })), 'muestra la columna Socio')
  check(await visible(lots.getByText('Saldo inicial').first()) && await visible(lots.getByText('Sin entrada registrada').first()) && await visible(lots.getByText('Existencia inicial')), 'traduce Saldo inicial / Sin entrada registrada / Existencia inicial')
  check(lastCall(state, (c) => c.path === '/lots').query.partnerId === undefined, 'sin filtro de socio no manda partnerId')
  await page.getByLabel('Socio', { exact: true }).selectOption('none')
  await page.waitForResponse((r) => r.url().includes('partnerId=none'))
  check(await lots.getByRole('row', { name: /Blusa Floral/ }).count() === 0, 'el selector filtra por «Sin socio»')
  await page.screenshot({ path: join(shots, 'entradas-sin-socio.png'), fullPage: true })

  const assignButton = page.getByRole('button', { name: /Asignar socio a las seleccionadas/ })
  check(await assignButton.isDisabled(), 'sin selección el botón de asignar está deshabilitado')
  await page.getByRole('checkbox', { name: 'Seleccionar todas las entradas de esta página' }).check()
  check(await visible(page.getByRole('button', { name: 'Asignar socio a las seleccionadas (3)' })), 'cuenta las entradas seleccionadas')
  await page.getByRole('button', { name: 'Asignar socio a las seleccionadas (3)' }).click()
  const dialog = page.getByRole('dialog', { name: 'Asignar socio a las entradas' })
  check(await visible(dialog), 'abre el diálogo de asignación rápida')
  check(await dialog.getByRole('option', { name: 'Luis Vega' }).count() === 0, 'solo ofrece socios activos')
  await dialog.getByLabel('Socio').selectOption('p2')
  await dialog.getByRole('button', { name: 'Asignar socio' }).click()
  await dialog.waitFor({ state: 'detached' })
  const puts = state.calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/lots/'))
  check(puts.length === 3 && puts.every((c) => c.body.partnerId === 'p2'), 'hizo un PUT por entrada con el socio elegido')
  const l5 = puts.find((c) => c.path === '/lots/l5')
  const l6 = puts.find((c) => c.path === '/lots/l6')
  check(l5.body.unitCost === null && l5.body.unitPrice === null && l6.body.unitCost === 480, 'conserva el costo y el precio de cada entrada')
  check(await visible(page.getByText('Asignamos el socio a 3 entradas.')), 'confirma cuántas se asignaron')
  check(await visible(lots.getByText('Ninguna entrada coincide con los filtros.')), 'ya no quedan entradas sin socio')
  await context.close()
}

// ---------------------------------------------------------------- Ir a «Sin socio» desde el resumen
console.log('Acción rápida desde el resumen')
{
  const { page, context } = await open()
  await page.getByRole('button', { name: 'Asignar socio a estas entradas' }).click()
  check(await visible(page.getByRole('table', { name: 'Todas las entradas de mercadería' })), 'lleva a «Todas las entradas»')
  check(await page.getByLabel('Socio', { exact: true }).inputValue() === 'none', 'con el filtro «Sin socio» ya elegido')
  await context.close()
}

// ---------------------------------------------------------------- Gestionar socios
console.log('Gestionar socios')
{
  const { page, context, state } = await open()
  await tab(page, 'Gestionar socios').click()
  const list = page.getByRole('table', { name: 'Lista de socios' })
  check(await visible(list.getByRole('row', { name: /Rosa Pérez/ })) && await visible(list.getByRole('row', { name: /Luis Vega.*Inactivo/ })), 'lista socios activos e inactivos')
  check(lastCall(state, (c) => c.path === '/partners').query.status === 'all', 'pide status=all')
  await page.getByLabel('Mostrar inactivos', { exact: false }).uncheck()
  check(await list.getByRole('row', { name: /Luis Vega/ }).count() === 0, 'se pueden ocultar los inactivos')
  await page.getByLabel('Mostrar inactivos', { exact: false }).check()

  await page.getByRole('button', { name: 'Nuevo socio' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo socio' })
  await dialog.getByRole('button', { name: 'Crear socio' }).click()
  check(await visible(dialog.getByText('Escribí el nombre del socio.')), 'exige el nombre')
  await dialog.getByLabel('Nombre').fill('  carlos   mena ')
  await dialog.getByRole('button', { name: 'Crear socio' }).click()
  check(await visible(dialog.getByText(/Ya existe un socio con ese nombre/)), 'maneja el 409 duplicate_name junto al campo')
  check(await dialog.getByLabel('Nombre').getAttribute('aria-invalid') === 'true', 'marca el campo como inválido')
  await dialog.getByLabel('Nombre').fill('Marta Ruiz')
  await dialog.getByLabel('Teléfono (opcional)').fill('7777-2222')
  await dialog.getByLabel('Notas (opcional)').fill('Aporta ropa de niños')
  await dialog.getByRole('button', { name: 'Crear socio' }).click()
  await dialog.waitFor({ state: 'detached' })
  const post = lastCall(state, (c) => c.method === 'POST')
  check(post.body.name === 'Marta Ruiz' && post.body.phone === '7777-2222' && post.body.notes === 'Aporta ropa de niños', 'POST con nombre, teléfono y notas')
  check(await visible(list.getByRole('row', { name: /Marta Ruiz/ })), 'el socio nuevo aparece en la lista')

  await list.getByRole('button', { name: 'Editar a Marta Ruiz' }).click()
  const edit = page.getByRole('dialog', { name: 'Editar socio' })
  await edit.getByLabel('Teléfono (opcional)').fill('')
  await edit.getByLabel('Nombre').fill('Marta R. Ruiz')
  await edit.getByRole('button', { name: 'Guardar cambios' }).click()
  await edit.waitFor({ state: 'detached' })
  const put = lastCall(state, (c) => c.method === 'PUT' && c.path === '/partners/p4')
  check(put.body.name === 'Marta R. Ruiz' && put.body.phone === null && put.body.isActive === true, 'PUT edita nombre y teléfono')

  await list.getByRole('button', { name: 'Inactivar a Marta R. Ruiz' }).click()
  check(await visible(list.getByRole('row', { name: /Marta R\. Ruiz.*Inactivo/ })), 'inactiva al socio')
  check(lastCall(state, (c) => c.method === 'PUT' && c.path === '/partners/p4').body.isActive === false, 'PUT con isActive=false')
  await list.getByRole('button', { name: 'Activar a Marta R. Ruiz' }).click()
  check(await visible(list.getByRole('row', { name: /Marta R\. Ruiz.*Activo/ })), 'vuelve a activarlo')
  check(await list.getByRole('button', { name: /Borrar|Eliminar/ }).count() === 0, 'no hay opción de borrar socios')
  await page.screenshot({ path: join(shots, 'socios-escritorio.png'), fullPage: true })
  await context.close()
}

// ---------------------------------------------------------------- Excel
console.log('Descarga de Excel')
{
  const { page, context, reportCalls } = await open()
  await page.getByRole('button', { name: 'Este mes', exact: true }).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar Excel' }).click()])
  const expected = `socios-inversion_${monthStart}_${today}.xlsx`
  check(download.suggestedFilename() === expected, `descarga con el nombre del servidor (${download.suggestedFilename()})`)
  const path = await download.path()
  check(path !== null && readFileSync(path).equals(fakeXlsx), 'contenido igual al del servidor')
  check(reportCalls.length === 1 && reportCalls[0].from === monthStart && reportCalls[0].to === today, 'llamó a /reports/investment con el rango elegido')
  check(await visible(page.getByText(expected)), 'muestra nombre y tamaño del archivo')

  await page.getByRole('button', { name: 'Todo', exact: true }).click()
  check(await visible(page.getByText(/últimos 366 días/)), 'con «Todo» avisa que el Excel se limita a 366 días')
  const [all] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar Excel' }).click()])
  check(all.suggestedFilename() === `socios-inversion_${addDays(today, -365)}_${today}.xlsx`, 'con «Todo» pide los últimos 366 días')
  await context.close()

  const failing = await open('socios', { reportHandler: (route) => json(route, 400, { title: 'El rango no puede pasar de 366 días.' }) })
  await failing.page.getByRole('button', { name: 'Descargar Excel' }).click()
  check(await visible(failing.page.getByRole('alert').filter({ hasText: 'El rango no puede pasar de 366 días.' })), 'muestra el error si el servidor rechaza el reporte')
  await failing.context.close()
}

// ---------------------------------------------------------------- Errores, carga y permisos
console.log('Errores, carga y permisos')
{
  let broken = true
  const { page, context } = await open('socios', { options: { summaryError: () => broken } })
  check(await visible(page.getByRole('alert').filter({ hasText: 'No fue posible calcular el resumen.' })), 'muestra el error del resumen')
  broken = false
  await page.getByRole('button', { name: 'Reintentar' }).click()
  check(await visible(page.getByRole('table', { name: 'Resumen por socio' })), 'Reintentar recupera el resumen')
  await context.close()

  let release
  const gate = new Promise((resolve) => { release = resolve })
  const mock = createMock({ user: investUser })
  const slowContext = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  const slow = await slowContext.newPage()
  await mock.install(slow)
  await installInvestment(slow, makeState())
  await slow.route('**/api/v1/investment/summary**', async (route) => { await gate; await json(route, 200, baseSummary) })
  await slow.goto(`${base}/#socios`)
  check(await visible(slow.getByText('Calculando el resumen por socio…')), 'muestra el estado de carga')
  release()
  check(await visible(slow.getByRole('table', { name: 'Resumen por socio' })), 'sale del estado de carga')
  await slowContext.close()

  const empty = await open('socios', { options: {} })
  await empty.page.route('**/api/v1/investment/summary**', (route) => json(route, 200, { from: null, to: null, partners: [], totals: summaryRow(null, 'Total') }))
  await empty.page.reload()
  check(await visible(empty.page.getByText('Todavía no hay movimientos de inversión en este período.')), 'estado vacío del resumen')
  await empty.context.close()

  const readOnly = await open('socios', { user: { ...adminUser, permissions: [...adminUser.permissions, 'investment.read'] } })
  await readOnly.page.getByRole('table', { name: 'Resumen por socio' }).getByRole('button', { name: 'Ver detalle de Rosa Pérez' }).click()
  await visible(readOnly.page.getByRole('table', { name: 'Entradas de Rosa Pérez' }))
  check(await readOnly.page.getByRole('button', { name: /Editar entrada/ }).count() === 0, 'sin investment.manage no hay botones de edición de entradas')
  await readOnly.page.getByRole('button', { name: '← Volver al resumen' }).click()
  check(await readOnly.page.getByRole('button', { name: 'Asignar socio a estas entradas' }).count() === 0, 'sin investment.manage no hay acción rápida')
  await tab(readOnly.page, 'Gestionar socios').click()
  check(await visible(readOnly.page.getByRole('table', { name: 'Lista de socios' })) && await readOnly.page.getByRole('button', { name: 'Nuevo socio' }).count() === 0, 'sin investment.manage la lista es de solo lectura')
  await readOnly.context.close()
}

// ---------------------------------------------------------------- Responsive (390 px)
console.log('Responsive a 390 px')
{
  const { page, context } = await open('socios', { viewport: { width: 390, height: 800 } })
  await visible(page.getByRole('table', { name: 'Resumen por socio' }))
  check(!(await hasHorizontalScroll(page)), 'resumen sin scroll horizontal de la página')
  await page.screenshot({ path: join(shots, 'resumen-390.png'), fullPage: true })
  await page.getByRole('table', { name: 'Resumen por socio' }).getByRole('button', { name: 'Ver detalle de Rosa Pérez' }).click()
  await visible(page.getByRole('table', { name: 'Entradas de Rosa Pérez' }))
  check(!(await hasHorizontalScroll(page)), 'detalle sin scroll horizontal')
  await page.screenshot({ path: join(shots, 'detalle-390.png'), fullPage: true })
  await page.getByRole('button', { name: '← Volver al resumen' }).click()
  await tab(page, 'Todas las entradas').click()
  await visible(page.getByRole('table', { name: 'Todas las entradas de mercadería' }))
  check(!(await hasHorizontalScroll(page)), 'todas las entradas sin scroll horizontal')
  await tab(page, 'Gestionar socios').click()
  await visible(page.getByRole('table', { name: 'Lista de socios' }))
  check(!(await hasHorizontalScroll(page)), 'gestión de socios sin scroll horizontal')
  await page.getByRole('button', { name: 'Nuevo socio' }).click()
  check(!(await hasHorizontalScroll(page)), 'diálogo de socio sin scroll horizontal')
  await page.screenshot({ path: join(shots, 'socio-dialogo-390.png') })
  await context.close()
}

await browser.close()
server?.kill()
if (consoleProblems.length > 0) {
  failures += 1
  console.log('Problemas de consola:')
  for (const problem of consoleProblems) console.log(`  ${problem}`)
}
console.log(failures === 0 ? '\nTodo bien.' : `\n${failures} comprobación(es) fallaron.`)
console.log(`Capturas en ${shots}`)
process.exit(failures === 0 ? 0 : 1)
