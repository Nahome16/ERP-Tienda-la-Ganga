// Prueba E2E de socios en inventario, productos e importación (docs/30, sección 11) con la API simulada.
// Uso: node e2e/inventory-partners.mjs            (levanta `vite preview` sobre dist/; hace falta `npm run build`)
//      BASE_URL=http://127.0.0.1:5199 node e2e/inventory-partners.mjs   (usa un servidor ya levantado)
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminUser, createMock } from './admin-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'la-ganga-partners-shots')
mkdirSync(shots, { recursive: true })

let failures = 0
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`)
  else { failures += 1; console.log(`  FAIL ${message}`) }
}
async function visible(locator, timeout = 4000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true } catch { return false }
}

// ---- Servidor de vista previa
let preview = null
let base = process.env.BASE_URL
if (!base) {
  const port = 4179
  preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' })
  base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 50; i += 1) {
    try { if ((await fetch(base)).ok) break } catch { /* aún no */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

const partners = [
  { id: 'pA', name: 'Socio A', phone: null, notes: null, isActive: true, version: 1 },
  { id: 'pB', name: 'Socio B', phone: null, notes: null, isActive: true, version: 1 },
  { id: 'pC', name: 'Socio C', phone: null, notes: null, isActive: false, version: 1 },
]
const partnerUser = { ...adminUser, permissions: [...adminUser.permissions, 'investment.read', 'investment.manage'] }

/** Agrega al mock lo de socios: lista, inventario con `partners`/`partnerStock`, importación con socios. */
async function installPartners(page, mock, options = {}) {
  const calls = { inventory: [], partners: [], imports: [] }
  const allowed = mock.user.permissions.includes('investment.read')
  await page.route('**/api/v1/investment/partners*', async (route) => {
    const url = new URL(route.request().url())
    calls.partners.push(url.searchParams.get('status'))
    if (!allowed) return route.fulfill({ status: 403, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Sin permiso', code: 'forbidden' }) })
    if (options.partnersFail) return route.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Error del servidor', code: 'server_error' }) })
    const list = options.noPartners ? [] : partners
    const status = url.searchParams.get('status') ?? 'active'
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status === 'all' ? list : list.filter((p) => p.isActive)) })
  })
  if (allowed) {
    // Distribución de existencias por socio de las variantes del mock + 25 filas de relleno (para paginar).
    const dist = [[['pA', 3], [null, 2]], [['pA', 1]], [], [], [[null, 8]]]
    const nameOf = (id) => (id === null ? 'Sin socio' : partners.find((p) => p.id === id).name)
    await page.route('**/api/v1/inventory?*', async (route) => {
      const url = new URL(route.request().url())
      if (route.request().method() !== 'GET') return route.fallback()
      calls.inventory.push(Object.fromEntries(url.searchParams))
      const s = mock.state
      const rows = s.variants.map((v, i) => {
        const p = s.products.find((x) => x.id === v.productId)
        const groups = (dist[i] ?? []).map(([id, units]) => ({ partnerId: id, name: nameOf(id), units }))
        return {
          variantId: v.id, productId: p.id, productName: p.name, categoryName: s.categories.find((c) => c.id === p.categoryId)?.name,
          sizeName: s.sizes.find((x) => x.id === v.sizeId)?.name, colorName: s.colors.find((x) => x.id === v.colorId)?.name,
          barcode: v.barcode, price: v.priceOverride ?? p.basePrice, stock: v.stock, cost: v.cost, stockValue: (v.cost ?? 0) * v.stock, partners: groups,
        }
      })
      for (let i = 0; i < 25; i += 1) {
        rows.push({ variantId: `fill${i}`, productId: 'pf', productName: `Relleno ${i}`, categoryName: 'Camisas', sizeName: 'S', colorName: 'Negro', barcode: `99000${i}`, price: 100, stock: 1, cost: 50, stockValue: 50, partners: [{ partnerId: 'pA', name: 'Socio A', units: 1 }] })
      }
      let out = rows
      const pid = url.searchParams.get('partnerId')
      if (pid) {
        out = rows.map((row) => ({ ...row, partnerStock: (row.partners.find((g) => (g.partnerId ?? 'none') === pid)?.units ?? 0) })).filter((row) => row.partnerStock > 0)
      }
      const size = Number(url.searchParams.get('pageSize') ?? 25)
      const pageNo = Number(url.searchParams.get('page') ?? 1)
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ items: out.slice((pageNo - 1) * size, pageNo * size), page: pageNo, pageSize: size, totalCount: out.length, totalPages: Math.max(1, Math.ceil(out.length / size)) }),
      })
    })
  }
  // Importación: socios que no existen se crean si `createMissingPartners`; si no, error de fila.
  await page.route('**/api/v1/products/import', async (route) => {
    const body = route.request().postDataJSON()
    calls.imports.push(body)
    if (!allowed && body.rows.some((r) => r.partner !== undefined)) {
      return route.fulfill({ status: 403, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Sin permiso para socios', code: 'partner_not_allowed' }) })
    }
    const errors = []
    const created = new Set()
    body.rows.forEach((row, i) => {
      if (row.partner && !partners.some((p) => p.name.toLowerCase() === row.partner.toLowerCase())) {
        if (body.createMissingPartners) created.add(`Socio: ${row.partner}`)
        else errors.push({ row: i + 1, message: `El socio «${row.partner}» no existe.` })
      }
    })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ dryRun: body.dryRun, productsCreated: errors.length ? 0 : 1, variantsCreated: errors.length ? 0 : body.rows.length, unitsLoaded: errors.length ? 0 : body.rows.reduce((a, r) => a + r.quantity, 0), catalogsCreated: [...created], errors }),
    })
  })
  return calls
}

const browser = await chromium.launch()
const consoleProblems = []

async function open(hash, { user = partnerUser, viewport = { width: 1366, height: 900 }, ...options } = {}) {
  const mock = createMock({ user })
  mock.user = user
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => consoleProblems.push(`pageerror ${hash}: ${error.message}`))
  await mock.install(page)
  const calls = await installPartners(page, mock, options)
  await page.goto(`${base}/#${hash}`)
  return { mock, page, context, calls }
}
const adjustments = (mock) => mock.log.filter((entry) => entry.method === 'POST' && entry.path === '/api/v1/inventory/adjustments')

// ---------------------------------------------------------------- Administrador: inventario
console.log('Inventario: filtro por socio y columnas (con investment.read)')
{
  const { page, context, calls } = await open('inventario')
  check(await visible(page.getByText('Camisa Oxford').first()), 'carga el inventario')
  const select = page.getByLabel('Filtrar por socio')
  check(await visible(select), 'muestra el selector «Socio»')
  const options = await select.locator('option').allTextContents()
  check(options.join('|') === 'Todos|Socio A|Socio B|Socio C (inactivo)|Sin socio', `opciones del filtro: ${options.join(' | ')}`)
  check(calls.partners.includes('all'), 'pide los socios con status=all para el filtro')
  check(await visible(page.getByRole('columnheader', { name: 'Socios' })), 'columna «Socios» en la tabla')
  check(!(await page.getByRole('columnheader', { name: 'Unidades del socio' }).count()), 'sin filtro no hay «Unidades del socio»')
  const firstRow = (await page.locator('tbody tr').first().innerText()).replace(/\s+/g, ' ')
  check(/Socio A: 3/.test(firstRow) && /Sin socio: 2/.test(firstRow), `la fila muestra quién tiene unidades (${firstRow.slice(-60)})`)
  check(calls.inventory[0].partnerId === undefined, 'sin filtro no se envía partnerId')

  await select.selectOption({ label: 'Socio A' })
  check(await visible(page.getByRole('columnheader', { name: 'Unidades del socio' })), 'con filtro aparece «Unidades del socio»')
  check(calls.inventory.at(-1).partnerId === 'pA', 'envía partnerId=<id>')
  const headers = await page.locator('thead th').allTextContents()
  const colIndex = headers.indexOf('Unidades del socio')
  const cells = await page.locator('tbody tr').first().locator('td').allTextContents()
  check(cells[colIndex].trim() === '3', `partnerStock de Socio A en la primera fila = ${cells[colIndex]}`)
  await page.screenshot({ path: join(shots, 'inventario-filtro-socio.png') })

  await page.getByRole('button', { name: 'Siguiente' }).click()
  await page.waitForTimeout(300)
  const pageTwo = calls.inventory.at(-1)
  check(pageTwo.page === '2' && pageTwo.partnerId === 'pA', 'el filtro persiste al paginar (page=2&partnerId=pA)')
  await page.getByRole('button', { name: 'Bajo stock', exact: true }).click()
  await page.waitForTimeout(300)
  check(calls.inventory.at(-1).partnerId === 'pA' && calls.inventory.at(-1).filter === 'low' && calls.inventory.at(-1).page === '1', 'combina con los filtros de existencias y vuelve a la página 1')
  await page.getByRole('button', { name: 'Todos', exact: true }).click()

  await select.selectOption({ label: 'Sin socio' })
  await page.waitForTimeout(300)
  check(calls.inventory.at(-1).partnerId === 'none', 'Sin socio envía partnerId=none')
  await select.selectOption({ label: 'Todos' })
  await page.waitForTimeout(300)
  check(calls.inventory.at(-1).partnerId === undefined && !(await page.getByRole('columnheader', { name: 'Unidades del socio' }).count()), 'Todos quita el filtro y la columna')
  await context.close()
}

// ---------------------------------------------------------------- Administrador: entrada con socio
console.log('Inventario: registrar entrada con socio, costo y precio')
{
  const { mock, page, context } = await open('inventario')
  await page.locator('tbody tr', { hasText: 'Camisa Oxford' }).first().locator('td').nth(1).click()  // el nombre abre la ficha del producto; el resto de la fila, el movimiento
  const dialog = page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(dialog), 'abre la ficha de la variante')
  const partner = dialog.getByLabel('Socio que ingresó la mercadería')
  check(await visible(partner), 'muestra «Socio que ingresó la mercadería» en Entrada')
  const options = await partner.locator('option').allTextContents()
  check(options.join('|') === 'Sin socio|Socio A|Socio B', `solo socios activos y «Sin socio»: ${options.join(' | ')}`)
  check((await dialog.getByLabel('Costo unitario (C$)').inputValue()) === '380', 'costo por defecto = costo actual de la variante')
  check((await dialog.getByLabel('Precio de venta dado (C$)').inputValue()) === '650', 'precio por defecto = precio actual')
  await page.screenshot({ path: join(shots, 'entrada-socio.png') })

  await dialog.getByLabel('Tipo').selectOption('Loss')
  check(!(await partner.isVisible().catch(() => false)) && !(await dialog.getByLabel('Costo unitario (C$)').count()), 'Pérdida no muestra socio/costo/precio')
  await dialog.getByLabel('Tipo').selectOption('Adjustment')
  check(await visible(partner), 'Ajuste (sin cantidad) muestra los campos')
  await dialog.getByLabel(/^Cantidad/).fill('-1')
  check(!(await dialog.getByLabel('Costo unitario (C$)').count()), 'Ajuste negativo no muestra los campos')
  await dialog.getByLabel(/^Cantidad/).fill('2')
  check(await visible(dialog.getByLabel('Costo unitario (C$)')), 'Ajuste positivo sí los muestra')

  await dialog.getByLabel('Tipo').selectOption('Entry')
  await partner.selectOption({ label: 'Socio A' })
  await dialog.getByLabel('Costo unitario (C$)').fill('400.5')
  await dialog.getByLabel('Precio de venta dado (C$)').fill('700')
  await dialog.getByLabel(/^Cantidad/).fill('3')
  await dialog.getByLabel('Motivo (obligatorio)').fill('Llegó pedido del socio A')
  check((await dialog.textContent()).includes('5 → 8'), 'vista previa del saldo (5 → 8)')
  await dialog.getByRole('button', { name: 'Registrar movimiento' }).click()
  check(await visible(dialog.getByText(/Movimiento registrado/)), 'registra el movimiento')
  const body = adjustments(mock).at(-1)?.body
  check(JSON.stringify(body) === JSON.stringify({ variantId: body?.variantId, kind: 'Entry', delta: 3, reason: 'Llegó pedido del socio A', partnerId: 'pA', unitCost: 400.5, unitPrice: 700 }), `cuerpo: ${JSON.stringify(body)}`)

  // Sin socio: solo costo y precio por defecto.
  await partner.selectOption({ label: 'Sin socio' })
  await dialog.getByLabel(/^Cantidad/).fill('1')
  await dialog.getByLabel('Motivo (obligatorio)').fill('Entrada sin socio')
  await dialog.getByRole('button', { name: 'Registrar movimiento' }).click()
  await page.waitForTimeout(400)
  const second = adjustments(mock).at(-1)?.body
  check(second?.partnerId === undefined && second?.unitCost === 400.5 && second?.delta === 1, `Sin socio no envía partnerId (${JSON.stringify(second)})`)

  // Validación del costo
  await dialog.getByLabel('Costo unitario (C$)').fill('-3')
  await dialog.getByLabel(/^Cantidad/).fill('1')
  await dialog.getByLabel('Motivo (obligatorio)').fill('Prueba costo')
  const before = adjustments(mock).length
  await dialog.getByRole('button', { name: 'Registrar movimiento' }).click()
  await page.waitForTimeout(300)
  check(adjustments(mock).length === before, 'un costo negativo no se envía (lo frena la validación del campo)')
  await context.close()
}

console.log('Inventario: lista de socios con error o vacía no bloquea')
{
  const failing = await open('inventario', { partnersFail: true })
  await failing.page.locator('tbody tr', { hasText: 'Camisa Oxford' }).first().locator('td').nth(1).click()
  const dialog = failing.page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(dialog.getByText(/No se pudo cargar la lista de socios/)), 'si falla la carga avisa «Podés continuar Sin socio»')
  await dialog.getByLabel(/^Cantidad/).fill('2')
  await dialog.getByLabel('Motivo (obligatorio)').fill('Entrada con la lista caída')
  await dialog.getByRole('button', { name: 'Registrar movimiento' }).click()
  check(await visible(dialog.getByText(/Movimiento registrado/)), 'permite registrar la entrada sin socio')
  const body = adjustments(failing.mock).at(-1)?.body
  check(body?.partnerId === undefined && body?.unitCost === 380 && body?.unitPrice === 650, 'se envían costo y precio actuales y ningún socio')
  await failing.context.close()

  const empty = await open('inventario', { noPartners: true })
  await empty.page.locator('tbody tr', { hasText: 'Camisa Oxford' }).first().locator('td').nth(1).click()
  const dialog2 = empty.page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(dialog2.getByText(/Todavía no hay socios activos/)), 'sin socios explica cómo crearlos')
  check((await dialog2.getByRole('link', { name: 'Socios e inversión' }).getAttribute('href')) === '#socios', 'enlaza a Socios e inversión')
  check(!(await dialog2.getByLabel('Socio que ingresó la mercadería').count()), 'no muestra el selector vacío')
  await empty.context.close()
}

// ---------------------------------------------------------------- Administrador: producto
console.log('Nuevo producto con socio por variante')
{
  const { mock, page, context } = await open('productos')
  await visible(page.getByText('Camisa Oxford'))
  await page.getByRole('button', { name: 'Nuevo producto' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' })
  await dialog.getByLabel('Nombre del producto').fill('Polo Socios')
  await dialog.getByLabel('Categoría').selectOption({ label: 'Camisas' })
  await dialog.getByLabel('Marca').selectOption({ label: 'Bossini' })
  await dialog.getByLabel('Precio base (C$)').fill('450')
  await dialog.getByRole('checkbox', { name: 'S', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'M', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'Negro' }).check()
  check(!(await dialog.getByLabel('Socio que ingresó (todas las variantes)').count()), 'sin cantidades iniciales el selector no aparece')
  await dialog.getByLabel('Cantidad talla S color Negro').fill('3')
  await dialog.getByLabel('Cantidad talla M color Negro').fill('2')
  const general = dialog.getByLabel('Socio que ingresó (todas las variantes)')
  check(await visible(general), 'con cantidad inicial aparece el selector general de socio')
  await general.selectOption({ label: 'Socio B' })
  await dialog.locator('summary').click()
  await dialog.getByLabel('Socio M Negro').selectOption({ label: 'Sin socio' })
  await page.screenshot({ path: join(shots, 'producto-socio.png') })
  await dialog.getByRole('button', { name: /Crear producto/ }).click()
  check(await visible(page.getByRole('dialog', { name: 'Polo Socios' })), 'crea el producto')
  const post = mock.log.find((entry) => entry.method === 'POST' && entry.path === '/api/v1/products')
  const byKey = Object.fromEntries(post.body.variants.map((v) => [`${v.sizeId}|${v.colorId}`, v]))
  check(byKey['s1|o1'].partnerId === 'pB' && byKey['s1|o1'].initialQuantity === 3, 'S Negro: partnerId=pB (general)')
  check(!('partnerId' in byKey['s2|o1']) && byKey['s2|o1'].initialQuantity === 2, 'M Negro: «Sin socio» por fila, sin partnerId')
  await context.close()
}

// ---------------------------------------------------------------- Administrador: importación
console.log('Importación CSV con columna Socio')
{
  const { page, context, calls } = await open('productos')
  await page.getByRole('button', { name: 'Importar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar productos' })
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Descargar plantilla CSV' }).click()])
  const text = (await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')).replace(/^﻿/, '')
  const header = text.split(/\r?\n/)[0].split(';')
  check(header.at(-1) === 'Socio' && header.at(-2) === 'Cantidad', `la plantilla trae «Socio» después de «Cantidad» (${header.join(';')})`)

  const csv = ['PRODUCTO;Categoría;Marca;Corte;Talla;Color;Código de barras;Precio;Costo;Cantidad;SÓCIO',
    'Blusa Lino;Camisas;Bossini;;S;Negro;;350;200;4;Socio A',
    'Blusa Lino;Camisas;Bossini;;M;Negro;;350;200;2;Socio Nuevo',
    'Blusa Lino;Camisas;Bossini;;L;Negro;;350;200;1;'].join('\n')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'socios.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') })
  check(await visible(dialog.getByText('El socio «Socio Nuevo» no existe.')), 'sin la casilla, el servidor rechaza al socio que no existe')
  check(await visible(dialog.getByRole('columnheader', { name: 'Socio' })), 'la vista previa muestra la columna Socio')
  const previewRows = (await dialog.getByRole('table', { name: 'Vista previa del archivo' }).locator('tbody tr').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  check(previewRows[0].includes('Socio A') && previewRows[2].includes('Sin socio'), 'filas con su socio y «Sin socio»')
  check(calls.imports[0].createMissingPartners === false && calls.imports[0].rows[0].partner === 'Socio A' && calls.imports[0].rows[2].partner === null, 'dry-run con partner por fila y createMissingPartners:false')
  await dialog.getByLabel('Crear los socios que falten').check()
  check(await visible(dialog.getByText(/Socios nuevos: Socio Nuevo/)), 'el resumen muestra «Socios nuevos: Socio Nuevo»')
  check(calls.imports.at(-1).createMissingPartners === true, 'reenvía el dry-run con createMissingPartners:true')
  await page.screenshot({ path: join(shots, 'import-socios.png') })
  await dialog.getByRole('button', { name: 'Confirmar importación' }).click()
  check(await visible(dialog.getByText(/Importación terminada/)) && calls.imports.at(-1).dryRun === false && calls.imports.at(-1).createMissingPartners === true, 'confirma con createMissingPartners:true')
  check((await dialog.textContent()).includes('Socios creados: Socio Nuevo'), 'informa los socios creados')

  // Archivo sin la columna Socio: sin columna ni casilla.
  await context.close()
  const plain = await open('productos')
  await plain.page.getByRole('button', { name: 'Importar' }).click()
  const d2 = plain.page.getByRole('dialog', { name: 'Importar productos' })
  const noCol = 'Producto;Categoría;Marca;Talla;Color;Precio;Cantidad\nBlusa Lino;Camisas;Bossini;S;Negro;350;4'
  await d2.locator('input[type=file]').setInputFiles({ name: 'sin-socio.csv', mimeType: 'text/csv', buffer: Buffer.from(noCol, 'utf-8') })
  check(await visible(d2.getByText(/Se crearían/)), 'un archivo sin columna Socio se importa normal')
  check(!(await d2.getByRole('columnheader', { name: 'Socio' }).count()) && !(await d2.getByLabel('Crear los socios que falten').count()), 'sin columna: ni «Socio» en la vista previa ni casilla')
  check(!('partner' in plain.calls.imports[0].rows[0]), 'las filas no llevan partner')
  await plain.context.close()
}

// ---------------------------------------------------------------- Sin investment.read: todo como antes
console.log('Sin investment.read (Encargado de inventario): pantallas sin cambios')
{
  const { mock, page, context, calls } = await open('inventario', { user: adminUser })
  check(await visible(page.getByText('Camisa Oxford').first()), 'carga el inventario')
  check(!(await page.getByLabel('Filtrar por socio').count()) && !(await page.getByRole('columnheader', { name: 'Socios' }).count()), 'sin selector de socio ni columna «Socios»')
  check(calls.inventory.length === 0 && mock.log.filter((e) => e.path === '/api/v1/inventory' && e.query.partnerId).length === 0, 'nunca envía partnerId')
  await page.locator('tbody tr', { hasText: 'Camisa Oxford' }).first().locator('td').nth(1).click()
  const dialog = page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(dialog.getByLabel('Tipo')), 'abre la ficha')
  check(!(await dialog.getByLabel('Socio que ingresó la mercadería').count()) && !(await dialog.getByLabel('Costo unitario (C$)').count()) && !(await dialog.getByLabel('Precio de venta dado (C$)').count()), 'no hay campos de socio, costo ni precio de entrada')
  await dialog.getByLabel(/^Cantidad/).fill('2')
  await dialog.getByLabel('Motivo (obligatorio)').fill('Llegó pedido')
  await dialog.getByRole('button', { name: 'Registrar movimiento' }).click()
  check(await visible(dialog.getByText(/Movimiento registrado/)), 'registra la entrada')
  const body = adjustments(mock).at(-1)?.body
  check(Object.keys(body).sort().join() === 'delta,kind,reason,variantId', `cuerpo sin campos nuevos: ${Object.keys(body).join(',')}`)
  check(calls.partners.length === 0, 'nunca consulta /investment/partners')
  await context.close()

  const products = await open('productos', { user: adminUser })
  await visible(products.page.getByText('Camisa Oxford'))
  await products.page.getByRole('button', { name: 'Nuevo producto' }).click()
  const d3 = products.page.getByRole('dialog', { name: 'Nuevo producto' })
  await d3.getByLabel('Nombre del producto').fill('Polo Normal')
  await d3.getByLabel('Categoría').selectOption({ label: 'Camisas' })
  await d3.getByLabel('Marca').selectOption({ label: 'Bossini' })
  await d3.getByLabel('Precio base (C$)').fill('450')
  await d3.getByRole('checkbox', { name: 'S', exact: true }).check()
  await d3.getByRole('checkbox', { name: 'Negro' }).check()
  await d3.getByLabel('Cantidad talla S color Negro').fill('3')
  check(!(await d3.getByLabel('Socio que ingresó', { exact: false }).count()), 'el producto nuevo no ofrece socio')
  await d3.getByRole('button', { name: /Crear producto/ }).click()
  check(await visible(products.page.getByRole('dialog', { name: 'Polo Normal' })), 'crea el producto')
  const post = products.mock.log.find((entry) => entry.method === 'POST' && entry.path === '/api/v1/products')
  check(post.body.variants.every((v) => !('partnerId' in v)), 'las variantes no llevan partnerId')
  await products.context.close()

  const imp = await open('productos', { user: adminUser })
  await imp.page.getByRole('button', { name: 'Importar' }).click()
  const d4 = imp.page.getByRole('dialog', { name: 'Importar productos' })
  const [download] = await Promise.all([imp.page.waitForEvent('download'), d4.getByRole('button', { name: 'Descargar plantilla CSV' }).click()])
  const text = (await (await import('node:fs/promises')).readFile(await download.path(), 'utf8')).replace(/^﻿/, '')
  check(text.split(/\r?\n/)[0].split(';').at(-1) === 'Cantidad', 'la plantilla no trae «Socio»')
  const csv = 'Producto;Categoría;Marca;Talla;Color;Precio;Cantidad;Socio\nBlusa Lino;Camisas;Bossini;S;Negro;350;4;Socio A'
  await d4.locator('input[type=file]').setInputFiles({ name: 'con-socio.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf-8') })
  check(await visible(d4.getByText(/Tu cuenta no puede asignar socios/)), 'avisa que la columna Socio se ignora')
  check(await visible(d4.getByText(/Se crearían/)), 'el dry-run pasa (sin partner)')
  check(!(await d4.getByRole('columnheader', { name: 'Socio' }).count()) && !(await d4.getByLabel('Crear los socios que falten').count()), 'sin columna Socio ni casilla')
  const sent = imp.calls.imports[0]
  check(!('createMissingPartners' in sent) && sent.rows.every((r) => !('partner' in r)), 'el cuerpo no lleva partner ni createMissingPartners')
  await imp.context.close()
}

// ---------------------------------------------------------------- Móvil
console.log('Móvil 390 px')
{
  const { page, context } = await open('inventario', { viewport: { width: 390, height: 844 } })
  await visible(page.getByText('Camisa Oxford').first())
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check((await overflow()) <= 0, `inventario sin scroll horizontal de página (${await overflow()} px)`)
  await page.getByLabel('Filtrar por socio').selectOption({ label: 'Socio A' })
  await page.waitForTimeout(300)
  check((await overflow()) <= 0, 'con filtro de socio tampoco')
  await page.screenshot({ path: join(shots, 'movil-inventario.png') })
  await page.locator('tbody tr', { hasText: 'Camisa Oxford' }).first().locator('td').nth(1).click()
  const dialog = page.getByRole('dialog', { name: 'Camisa Oxford' })
  await visible(dialog.getByLabel('Socio que ingresó la mercadería'))
  check((await overflow()) <= 0, 'ficha con campos de socio sin scroll horizontal')
  await dialog.getByLabel('Socio que ingresó la mercadería').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(shots, 'movil-entrada.png') })
  await context.close()
}

await browser.close()
preview?.kill()
if (consoleProblems.length) { console.log('Errores de consola:'); consoleProblems.forEach((p) => console.log(`  ${p}`)); failures += 1 }
console.log(failures === 0 ? '\nTodo en orden.' : `\n${failures} comprobación(es) fallaron.`)
process.exit(failures === 0 ? 0 : 1)
