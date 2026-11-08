// Pruebas de extremo a extremo de las pantallas administrativas con la API simulada.
// Uso: BASE_URL=http://127.0.0.1:5199 node e2e/admin-e2e.mjs   (con `npm run dev -- --port 5199` en marcha)
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminUser, createMock } from './admin-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5199'
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'la-ganga-admin-shots')
mkdirSync(shots, { recursive: true })

let failures = 0
const consoleProblems = []
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`)
  else { failures += 1; console.log(`  FAIL ${message}`) }
}
async function visible(locator, timeout = 4000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true } catch { return false }
}

const browser = await chromium.launch()

async function open(hash, mockOptions = {}, viewport = { width: 1366, height: 900 }) {
  const mock = createMock(mockOptions)
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => consoleProblems.push(`pageerror ${hash}: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !/not_mocked|404/.test(message.text())) consoleProblems.push(`console ${hash}: ${message.text()}`) })
  await mock.install(page)
  await page.goto(`${base}/#${hash}`)
  return { mock, page, context }
}

// ---------------------------------------------------------------- Importación CSV
console.log('Importación de CSV')
{
  const { mock, page, context } = await open('productos')
  await page.getByRole('button', { name: 'Importar' }).click()
  const dialog = page.getByRole('dialog', { name: 'Importar productos' })
  check(await visible(dialog), 'abre el diálogo de importación')

  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Descargar plantilla CSV' }).click()])
  check(download.suggestedFilename() === 'plantilla-productos-la-ganga.csv', 'descarga la plantilla CSV')

  const header = 'Producto;Categoría;Marca;Corte;Talla;Color;Código de barras;Precio;Costo;Cantidad'
  const bad = [header,
    'Blusa Lino;Camisas;Bossini;;S;Negro;;350,50;200;4',
    'Blusa Lino;Camisas;Bossini;;M;Negro;;abc;200;4',
    'Blusa Lino;Camisas;Bossini;;L;Negro;1234567890123;350;200;-1',
    'Blusa Lino;Camisas;Bossini;;L;Azul;1234567890123;350;200;1'].join('\r\n')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'malo.csv', mimeType: 'text/csv', buffer: Buffer.from(`﻿${bad}`) })
  check(await visible(dialog.getByRole('table', { name: 'Errores de importación' })), 'muestra la tabla de errores locales')
  const errorRows = await dialog.getByRole('table', { name: 'Errores de importación' }).locator('tbody tr').allTextContents()
  check(errorRows.length === 3 && errorRows[0].startsWith('2') && errorRows[1].startsWith('3') && errorRows[2].startsWith('4'), `errores en las filas 2, 3 y 4 (${errorRows.length})`)
  check(await dialog.getByRole('button', { name: 'Confirmar importación' }).isDisabled(), 'no deja confirmar con errores')
  check(mock.log.filter((entry) => entry.path === '/api/v1/products/import').length === 0, 'no llama al servidor mientras haya errores locales')
  await page.screenshot({ path: join(shots, 'import-errores.png') })

  await dialog.getByRole('button', { name: 'Elegir otro archivo' }).click()
  const good = [header,
    'Falda Plisada;Faldas;Bossini;Regular;S;Negro;;1.250,50;700,5;3',
    'Falda Plisada;Faldas;Bossini;Regular;M;Negro;;1250,50;700,5;2'].join('\n')
  await dialog.locator('input[type=file]').setInputFiles({ name: 'bueno.csv', mimeType: 'text/csv', buffer: Buffer.from(good, 'utf-8') })
  check(await visible(dialog.getByText('La categoría «Faldas» no existe.')), 'muestra el error de la validación del servidor (dryRun)')
  const first = mock.log.find((entry) => entry.path === '/api/v1/products/import')
  check(first?.body?.dryRun === true && first.body.rows[0].price === 1250.5 && first.body.rows[0].quantity === 3 && first.body.rows[0].cost === 700.5, 'envía dryRun:true con decimales interpretados')
  await dialog.getByLabel('Crear catálogos faltantes', { exact: false }).check()
  check(await visible(dialog.getByText(/Se crearían/)), 'resumen tras crear catálogos faltantes')
  check((await dialog.textContent()).includes('Categoría: Faldas'), 'lista los catálogos que se crearían')
  await page.screenshot({ path: join(shots, 'import-resumen.png') })
  await dialog.getByRole('button', { name: 'Confirmar importación' }).click()
  check(await visible(dialog.getByText(/Importación terminada/)), 'confirma la importación')
  const calls = mock.state.importCalls
  check(calls.at(-1).dryRun === false && calls.at(-1).createMissingCatalogs === true && calls.length === 3, 'confirma con dryRun:false y createMissingCatalogs:true')
  await context.close()
}

// ---------------------------------------------------------------- Producto con matriz + etiquetas
console.log('Creación de producto y etiquetas')
{
  const { mock, page, context } = await open('productos')
  check(await visible(page.getByText('Camisa Oxford')), 'lista productos')
  await page.getByRole('button', { name: '＋ Nuevo producto' }).click()
  const dialog = page.getByRole('dialog', { name: 'Nuevo producto' })
  await dialog.getByLabel('Nombre del producto').fill('Polo Básico')
  await dialog.getByLabel('Categoría').selectOption({ label: 'Camisas' })
  await dialog.getByLabel('Marca').selectOption({ label: 'Bossini' })
  await dialog.getByLabel('Precio base (C$)').fill('450')
  await dialog.getByRole('checkbox', { name: 'S', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'M', exact: true }).check()
  await dialog.getByRole('checkbox', { name: 'Negro' }).check()
  await dialog.getByRole('checkbox', { name: 'Azul' }).check()
  await dialog.getByLabel('Cantidad talla S color Negro').fill('3')
  await dialog.getByLabel('Cantidad talla M color Negro').fill('2')
  await dialog.getByLabel('Cantidad talla S color Azul').fill('1')
  await dialog.locator('summary').click()
  await dialog.getByLabel('Precio especial M Azul').fill('500')
  await dialog.getByLabel('Costo S Negro').fill('210.5')
  await page.screenshot({ path: join(shots, 'producto-matriz.png') })
  await dialog.getByRole('button', { name: /Crear producto/ }).click()
  const created = page.getByRole('dialog', { name: 'Polo Básico' })
  check(await visible(created), 'abre el detalle del producto creado')
  const post = mock.log.find((entry) => entry.method === 'POST' && entry.path === '/api/v1/products')
  check(post?.body.variants.length === 4, 'envía las 4 variantes de la matriz')
  const byKey = Object.fromEntries(post.body.variants.map((v) => [`${v.sizeId}|${v.colorId}`, v]))
  check(byKey['s1|o1'].initialQuantity === 3 && byKey['s2|o1'].initialQuantity === 2 && byKey['s1|o2'].initialQuantity === 1 && byKey['s2|o2'].initialQuantity === 0, 'cantidades iniciales por celda')
  check(byKey['s2|o2'].priceOverride === 500 && byKey['s1|o1'].cost === 210.5 && byKey['s1|o1'].barcode === null, 'precio especial, costo y código vacío')
  check((await created.locator('tbody tr').count()) === 4, 'el detalle lista 4 variantes')

  await created.getByRole('button', { name: 'Etiquetas' }).click()
  const labels = page.getByRole('dialog', { name: 'Imprimir etiquetas' })
  check(await visible(labels.locator('svg[role=img]')), 'la vista previa dibuja el código de barras EAN-13')
  await labels.getByLabel('Copias de S Negro').fill('3')
  check((await labels.textContent()).includes('6 etiquetas para imprimir'), 'cuenta las etiquetas (3+1+1+1)')
  const printed = await page.locator('.labels-print-root .label-item').count()
  check(printed === 6, `hoja imprimible con ${printed} etiquetas`)
  await page.screenshot({ path: join(shots, 'etiquetas.png') })
  await page.evaluate(() => document.body.classList.add('printing-labels'))
  await page.emulateMedia({ media: 'print' })
  check((await page.locator('.labels-print-root .label-item').first().isVisible()) && !(await page.locator('.admin-shell').isVisible()), 'al imprimir solo se ven las etiquetas')
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => document.body.classList.remove('printing-labels'))
  await labels.getByRole('button', { name: 'Cerrar' }).first().click()

  // Editar la variante con If-Match y activar/inactivar
  await created.getByRole('button', { name: 'Editar' }).first().click()
  const editVariant = page.getByRole('dialog', { name: 'Editar variante' })
  await editVariant.getByLabel('Precio especial (C$)').fill('480')
  await editVariant.getByRole('button', { name: 'Guardar' }).click()
  await page.waitForTimeout(300)
  const put = mock.log.find((entry) => entry.method === 'PUT' && entry.path.startsWith('/api/v1/variants/'))
  check(put?.headers['if-match'] === '"1"' && put.body.priceOverride === 480, 'edita la variante con If-Match')
  await created.getByRole('button', { name: 'Inactivar producto' }).click()
  check(await visible(created.getByText('El producto quedó inactivo')), 'inactiva el producto')
  await context.close()
}

// ---------------------------------------------------------------- Inventario
console.log('Inventario')
{
  const { mock, page, context } = await open('inventario')
  check(await visible(page.getByText('Camisa Oxford').first()), 'carga la tabla de inventario')
  check(await visible(page.getByRole('columnheader', { name: 'Valor al costo' })), 'muestra costo y valor con inventory.cost.read')
  await page.getByRole('button', { name: 'Bajo stock', exact: true }).nth(0).click()
  await page.waitForTimeout(400)
  check(mock.log.some((entry) => entry.path === '/api/v1/inventory' && entry.query.filter === 'low'), 'filtro «Bajo stock» llama con filter=low')
  await page.getByRole('button', { name: 'Negativos' }).last().click()
  check(await visible(page.getByText('Requiere revisión').first()), 'resalta el stock negativo como «Requiere revisión»')
  await page.getByRole('button', { name: 'Todos', exact: true }).click()
  await page.getByLabel('Escáner de código de barras').fill('0000')
  await page.getByLabel('Escáner de código de barras').press('Enter')
  check(await visible(page.getByText('No existe ninguna variante con el código 0000.')), 'código inexistente avisa')
  await page.getByLabel('Escáner de código de barras').fill('4006381333931')
  await page.getByLabel('Escáner de código de barras').press('Enter')
  const panel = page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(panel), 'Enter en el escáner abre la ficha de la variante')
  check(await visible(panel.getByText('Existencia inicial')), 'muestra el Kardex')
  await panel.getByLabel('Tipo').selectOption('Loss')
  await panel.getByLabel('Cantidad', { exact: true }).fill('9')
  check((await panel.textContent()).includes('El saldo no puede quedar negativo'), 'previsualiza saldo negativo')
  check(await panel.getByRole('button', { name: 'Registrar movimiento' }).isDisabled(), 'bloquea el movimiento que deja saldo negativo')
  await panel.getByLabel('Cantidad', { exact: true }).fill('2')
  await panel.getByLabel('Motivo (obligatorio)').fill('Prenda dañada')
  check((await panel.textContent()).includes('5 → 3'), 'previsualiza el saldo resultante 5 → 3')
  await panel.getByRole('button', { name: 'Registrar movimiento' }).click()
  check(await visible(panel.getByText('Saldo actual: 3.')), 'registra la pérdida y actualiza el saldo')
  const adj = mock.log.find((entry) => entry.path === '/api/v1/inventory/adjustments')
  check(adj?.body.kind === 'Loss' && adj.body.delta === -2 && adj.body.reason === 'Prenda dañada', 'envía kind/delta/reason correctos')
  check(await visible(panel.getByRole('cell', { name: 'Pérdida' })), 'el Kardex muestra la pérdida')
  await page.screenshot({ path: join(shots, 'inventario-ficha.png') })
  await context.close()
}
{
  console.log('Inventario sin permiso de costos')
  const limited = { ...adminUser, permissions: ['inventory.read', 'inventory.adjust', 'inventory.kardex.read', 'product.read'] }
  const { page, context } = await open('inventario', { user: limited })
  check(await visible(page.getByText('Camisa Oxford').first()), 'carga sin costos')
  check((await page.getByRole('columnheader', { name: /Costo|Valor al costo/ }).count()) === 0, 'oculta costo y valor al costo')
  await context.close()
}

// ---------------------------------------------------------------- Caja y cierres
console.log('Caja y cierres')
{
  const { mock, page, context } = await open('caja')
  check(await visible(page.getByText('Total vendido').first()), 'muestra el consolidado')
  const text = await page.locator('main').textContent()
  check(text.includes('C$ 9,500.00') && text.includes('C$ 6,134.00') && text.includes('C$ 1,701.00') && text.includes('C$ 1,665.00') && text.includes('C$ 300.00'), 'tarjetas: total, efectivo, transferencia, POS y descuentos (equivalentes en C$)')
  check(text.includes('Incluye US$ 30.00') && text.includes('Incluye US$ 20.00'), 'las tarjetas de transferencia y POS indican la parte en dólares')
  check(text.includes('1 caja abierta') && text.includes('requieren revisión'), 'avisa de caja abierta y ventas por revisar')
  check(text.includes('BAC') && text.includes('Lafise') && text.includes('WhatsApp'), 'desglose por banco y canal')
  check(text.includes('C$ 1,401.00') && text.includes('US$ 30.00'), 'por banco: equivalente en C$ y la parte en US$')
  check(mock.log.some((entry) => entry.path === '/api/v1/cash/consolidated' && /^\d{4}-\d{2}-\d{2}$/.test(entry.query.date)), 'pide la fecha de hoy en formato ISO')

  // Tabla de cajas: indicador por método
  const row1 = page.getByRole('row', { name: /Caja 1/ })
  const row2 = page.getByRole('row', { name: /Caja 2/ })
  const cells1 = await row1.locator('td').allTextContents()
  const cells2 = await row2.locator('td').allTextContents()
  check(cells1[6].includes('Falta C$ 20.00') && cells1[7] === 'Cuadra' && cells1[8].includes('Falta C$ 9.00'), `Caja 1 cerrada: efectivo Falta, transferencia Cuadra, tarjeta Falta (${cells1.slice(6, 9).join(' | ')})`)
  check(cells2[6] === 'Pendiente' && cells2[7] === 'Pendiente' && cells2[8] === 'Pendiente', 'Caja 2 abierta: los tres métodos «Pendiente»')

  // Esperado vs verificado del día
  const cash = page.locator('[data-method=cash]')
  const transfer = page.locator('[data-method=transfer]')
  const card = page.locator('[data-method=card]')
  check(await visible(page.getByRole('heading', { name: 'Esperado vs verificado' })), 'bloque «Esperado vs verificado» del consolidado')
  const cashText = await cash.textContent()
  const transferText = await transfer.textContent()
  const cardText = await card.textContent()
  check(cashText.includes('C$ 6,400.00') && cashText.includes('US$ 60.00') && cashText.includes('Hay cajas abiertas') && cashText.includes('Pendiente'), 'efectivo del día: esperado por moneda y «Hay cajas abiertas»')
  check(transferText.includes('C$ 600.00') && transferText.includes('US$ 30.00') && transferText.includes('Verificado en banco'), 'transferencias del día: esperado C$ y US$')
  check(cardText.includes('C$ 931.00') && cardText.includes('US$ 20.00') && cardText.includes('Cierre de lote'), 'tarjeta del día: esperado C$ y US$')
  const tendered = page.getByRole('heading', { name: 'Recibido por método y moneda' }).locator('..')
  const tenderedText = await tendered.textContent()
  check(tenderedText.includes('Transferencia en US$') && tenderedText.includes('US$ 30.00 ≈ C$ 1,101.00') && tenderedText.includes('Tarjeta (POS) en US$'), 'recibido por método y moneda (dólares también en transferencia y tarjeta)')
  await page.screenshot({ path: join(shots, 'caja-consolidado.png'), fullPage: true })

  // Detalle de una caja cerrada
  await page.getByRole('button', { name: 'Detalle', exact: true }).click()
  const closedDetail = page.getByRole('dialog', { name: /Caja 1/ })
  check(await visible(closedDetail.getByRole('heading', { name: 'Esperado vs verificado' })), 'abre el detalle de la caja cerrada')
  const closedText = await closedDetail.textContent()
  check(closedText.includes('Falta C$ 20.00') && closedText.includes('Falta C$ 9.00') && closedText.includes('Cuadra') && !closedText.includes('Pendiente'), 'detalle cerrada: diferencias por método')
  check(closedText.includes('Parte en US$') && closedText.includes('C$ 667.00') && closedText.includes('US$ 10.00'), 'detalle cerrada: transferencias por banco con parte en US$')
  check(closedText.includes('Por revisar') && closedText.includes('1 anulada'), 'detalle cerrada: anuladas y por revisar')
  await page.screenshot({ path: join(shots, 'caja-detalle-cerrada.png') })
  await closedDetail.getByRole('button', { name: 'Cerrar', exact: true }).first().click()

  // Detalle de una caja abierta + impresión
  await page.getByRole('button', { name: 'Detalle / Cerrar' }).click()
  const detail = page.getByRole('dialog', { name: /Caja 2/ })
  check(await visible(detail.getByRole('heading', { name: 'Esperado vs verificado' })), 'abre el detalle de la caja abierta')
  check((await detail.locator('[data-method=transfer]').textContent()).includes('Pendiente'), 'caja abierta: conciliación «Pendiente»')
  const slipText = await page.locator('.cash-print-root').textContent()
  check(slipText.includes('TOTAL VENDIDO') && slipText.includes('Efectivo: esperado vs verificado') && slipText.includes('Transferencias: esperado vs verificado') && slipText.includes('Tarjeta (POS): esperado vs verificado'), 'prepara el cierre de 80 mm con las tres secciones')
  check(slipText.includes('Esperado') && slipText.includes('Diferencia') && slipText.includes('(US$ 20.00)'), 'cierre de 80 mm: esperado, diferencia y banco con parte en US$')
  await page.evaluate(() => document.body.classList.add('printing-cash'))
  await page.emulateMedia({ media: 'print' })
  check(await page.locator('.cash-slip').isVisible() && !(await page.locator('.admin-shell').isVisible()), 'al imprimir solo se ve el cierre de 80 mm')
  const slipWidth = await page.locator('.cash-slip').evaluate((el) => el.getBoundingClientRect().width)
  check(Math.abs(slipWidth - 302) < 6, `el cierre mide 80 mm (${Math.round(slipWidth)}px)`)
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => document.body.classList.remove('printing-cash'))

  // Cierre desde el administrador con transferencias y tarjeta verificadas
  await detail.getByRole('button', { name: 'Cerrar caja' }).click()
  const close = page.getByRole('dialog', { name: 'Cerrar Caja 2' })
  check((await close.textContent()).includes('Esperado C$') && (await close.textContent()).includes('C$ 532.00'), 'el cierre muestra el esperado de cada método')
  await close.getByLabel('Córdobas contados (C$)').fill('1900')
  await close.getByLabel('Dólares contados (US$)').fill('20')
  check(await visible(close.getByText('Falta C$ 100.00')), 'calcula la diferencia de efectivo mientras se escribe')
  await close.getByLabel('Transferencias verificadas US$').fill('25')
  check(await visible(close.getByText('Sobra US$ 5.00')), 'diferencia en vivo de transferencias en US$')
  await close.getByLabel('Tarjeta según terminal C$').fill('532')
  await close.getByLabel('Tarjeta según terminal US$').fill('18')
  check(await visible(close.getByText('Falta US$ 2.00')), 'diferencia en vivo de tarjeta en US$')
  await page.screenshot({ path: join(shots, 'caja-cierre.png') })
  await close.getByLabel('Notas (opcional)').fill('Faltante de cambio')
  await close.getByRole('button', { name: 'Cerrar caja' }).click()
  check(await visible(detail.getByText('La caja quedó cerrada.')), 'cierra la caja desde el administrador')
  const closeCall = mock.log.find((entry) => entry.path === '/api/v1/cash/sessions/cs2/close')
  const body = closeCall?.body ?? {}
  check(body.countedCashNio === 1900 && body.countedCashUsd === 20 && body.notes === 'Faltante de cambio', 'envía el efectivo contado por moneda')
  check(body.countedTransferUsd === 25 && body.countedCardNio === 532 && body.countedCardUsd === 18, 'envía transferencias y tarjeta verificadas')
  check(!('countedTransferNio' in body), 'no envía lo que quedó vacío (transferencias en C$ = no verificado)')
  await visible(detail.getByText('Sobra US$ 5.00'))
  const afterText = await detail.textContent()
  check(afterText.includes('Sobra US$ 5.00') && afterText.includes('Falta US$ 2.00') && afterText.includes('No verificado'), 'el detalle muestra las diferencias y lo «No verificado»')
  await page.screenshot({ path: join(shots, 'caja-detalle-tras-cierre.png') })
  await detail.getByRole('button', { name: 'Cerrar', exact: true }).first().click()
  await page.waitForTimeout(300)
  const dayText = await page.locator('main').textContent()
  check(!dayText.includes('Hay cajas abiertas'), 'el consolidado se actualiza tras el cierre')
  const cashDay = await page.locator('[data-method=cash]').textContent()
  const transferDay = await page.locator('[data-method=transfer]').textContent()
  check(cashDay.includes('C$ 6,280.00') && cashDay.includes('Falta C$ 120.00'), 'consolidado: efectivo contado C$ 6,280 y falta C$ 120')
  check(transferDay.includes('No verificado'), 'consolidado: transferencias en C$ sin verificar en una caja = «No verificado»')
  await page.screenshot({ path: join(shots, 'caja-consolidado-cerrado.png'), fullPage: true })
  const dayCells2 = await page.getByRole('row', { name: /Caja 2/ }).locator('td').allTextContents()
  check(dayCells2[6].includes('Falta C$ 100.00') && dayCells2[7].includes('Sobra US$ 5.00') && dayCells2[8].includes('Falta US$ 2.00'), `Caja 2 ya cerrada: indicadores por método (${dayCells2.slice(6, 9).join(' | ')})`)
  await page.getByRole('button', { name: 'Imprimir cierre del día' }).waitFor()
  const daySlip = await page.locator('.cash-print-root').textContent()
  check(daySlip.includes('Cierre del día') && daySlip.includes('Tarjeta (POS): esperado vs verificado') && daySlip.includes('Terminal'), 'cierre del día en 80 mm con las tres secciones')
  check(daySlip.includes('Efect.') && daySlip.includes('Transf.') && daySlip.includes('Tarj.'), 'cierre del día: estado de conciliación por caja')
  await context.close()
}

// ---------------------------------------------------------------- Ventas
console.log('Ventas')
{
  const { mock, page, context } = await open('ventas')
  check(await visible(page.getByText('V-000001')), 'lista ventas')
  await page.getByLabel('Buscar por número de venta').fill('V-000002')
  await page.waitForTimeout(500)
  check(mock.log.some((entry) => entry.path === '/api/v1/sales' && entry.query.number === 'V-000002'), 'filtra por número')
  await page.getByLabel('Buscar por número de venta').fill('')
  await page.getByText('Solo por revisar').click()
  await page.waitForTimeout(400)
  check(mock.log.some((entry) => entry.path === '/api/v1/sales' && entry.query.needsReview === 'true'), 'filtra «requiere revisión»')
  await page.getByText('Solo por revisar').click()
  await page.getByRole('row', { name: /V-000002/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Venta V-000002' })
  check(await visible(dialog.getByText('Stock insuficiente al sincronizar.')), 'muestra la nota de revisión y «sin conexión»')
  check((await dialog.textContent()).includes('Transferencia BAC · US$ 20.00 @ 36.7 = C$ 734.00'), 'el pago muestra método, banco, moneda, tasa y equivalente en C$')
  await dialog.getByRole('button', { name: 'Marcar revisión como resuelta' }).click()
  await dialog.getByLabel('Nota de resolución').fill('Stock verificado')
  await dialog.getByRole('button', { name: 'Marcar como resuelta' }).click()
  check(await visible(dialog.getByText('La revisión quedó resuelta.')), 'resuelve la revisión')
  await dialog.getByRole('button', { name: 'Anular venta' }).click()
  await dialog.getByLabel(/Motivo de la anulación/).fill('abc')
  await dialog.getByRole('button', { name: 'Sí, anular esta venta' }).click()
  check(await visible(dialog.getByText('al menos 5 caracteres')), 'exige un motivo de al menos 5 caracteres')
  check(!mock.log.some((entry) => entry.path.endsWith('/void')), 'no llama a la API con motivo corto')
  await dialog.getByLabel(/Motivo de la anulación/).fill('Cliente se arrepintió')
  await dialog.getByRole('button', { name: 'Sí, anular esta venta' }).click()
  check(await visible(dialog.getByText('Venta anulada.')), 'anula la venta con confirmación')
  check((await page.locator('.receipt-print-root').textContent()).includes('V-000002'), 'recibo listo para reimprimir')
  await page.screenshot({ path: join(shots, 'venta-detalle.png') })
  await context.close()
}

// ---------------------------------------------------------------- Configuración, Auditoría, Panel
console.log('Configuración')
{
  const { mock, page, context } = await open('configuracion')
  const rate = page.getByLabel(/Tasa del dólar/)
  await rate.waitFor()
  await rate.fill('37.1')
  await page.getByLabel('Nuevo banco').fill('Banpro')
  await page.getByRole('button', { name: 'Agregar banco' }).click()
  await page.getByRole('button', { name: 'Quitar Lafise' }).click()
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  check(await visible(page.getByText('Configuración guardada.')), 'guarda la configuración')
  const put = mock.log.find((entry) => entry.method === 'PUT' && entry.path === '/api/v1/settings')
  check(put?.body.usdRate === 37.1 && put.body.banks.join() === 'BAC,Banpro' && put.body.lowStockThreshold === 2, 'PUT /settings con tasa y bancos')
  await rate.fill('0')
  await page.getByLabel(/Límite de descuento/).fill('5')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  check(await visible(page.getByText('La tasa debe ser un número mayor que cero.')), 'valida la tasa')
  await context.close()
}
console.log('Auditoría y panel')
{
  const { mock, page, context } = await open('auditoria')
  check(await visible(page.getByText('Venta registrada').first()), 'traduce las acciones')
  await page.getByLabel('Filtrar por tipo de entidad').selectOption('InventoryMovement')
  await page.waitForTimeout(300)
  check(mock.log.some((entry) => entry.path === '/api/v1/audit' && entry.query.entityType === 'InventoryMovement'), 'filtra por tipo de entidad')
  await context.close()
  const dash = await open('panel')
  check(await visible(dash.page.getByText('Vendido hoy')), 'panel con consolidado real')
  const body = await dash.page.locator('main').textContent()
  check(body.includes('C$ 9,500.00') && body.includes('Agotados') && body.includes('Accesos rápidos'), 'panel: ventas, existencias y accesos')
  await dash.page.screenshot({ path: join(shots, 'panel.png'), fullPage: true })
  await dash.context.close()
}

// ---------------------------------------------------------------- Sin desbordes en móvil
console.log('Responsive 390px')
for (const hash of ['panel', 'caja', 'ventas', 'productos', 'inventario', 'configuracion', 'auditoria']) {
  const { page, context } = await open(hash, {}, { width: 390, height: 800 })
  await page.waitForTimeout(700)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(overflow <= 1, `${hash} sin scroll horizontal de página (${overflow}px)`)
  if (hash === 'productos') await page.screenshot({ path: join(shots, 'movil-productos.png') })
  await context.close()
}

console.log('Responsive 390px: detalle y cierre de caja')
{
  const { page, context } = await open('caja', {}, { width: 390, height: 800 })
  await page.getByRole('button', { name: 'Detalle / Cerrar' }).click()
  const detail = page.getByRole('dialog', { name: /Caja 2/ })
  await detail.waitFor()
  await page.waitForTimeout(400)
  check((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'detalle de caja sin scroll horizontal de página')
  check((await detail.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1, 'detalle de caja sin desborde interno')
  await page.screenshot({ path: join(shots, 'movil-caja-detalle.png') })
  await detail.getByRole('button', { name: 'Cerrar caja' }).click()
  const close = page.getByRole('dialog', { name: 'Cerrar Caja 2' })
  await close.waitFor()
  check((await close.evaluate((el) => el.scrollWidth - el.clientWidth)) <= 1 && (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, 'cierre de caja sin desborde a 390 px')
  await page.screenshot({ path: join(shots, 'movil-caja-cierre.png') })
  await context.close()
}

await browser.close()
if (consoleProblems.length) { console.log('\nErrores de consola:'); consoleProblems.forEach((line) => console.log('  ' + line)) }
console.log(failures === 0 ? '\nTodas las comprobaciones pasaron.' : `\n${failures} comprobación(es) fallaron.`)
console.log(`Capturas en ${shots}`)
process.exit(failures === 0 ? 0 : 1)
