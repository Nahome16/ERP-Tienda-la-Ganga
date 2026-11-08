// Pruebas de extremo a extremo de la pantalla Reportes y de los atajos «Descargar Excel» con la API simulada.
// Uso: BASE_URL=http://127.0.0.1:5199 node e2e/reports.mjs   (con `npm run dev -- --port 5199` en marcha)
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adminUser, createMock } from './admin-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5199'
const shots = process.env.SHOTS_DIR ?? join(tmpdir(), 'la-ganga-reports-shots')
mkdirSync(shots, { recursive: true })

const xlsxMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
// Cuerpo falso con la firma de un .xlsx (zip): PK\x03\x04 + relleno.
const fakeXlsx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(2500, 7)])

// Misma regla que la pantalla: hoy en Managua (UTC−6 fijo).
const managuaToday = () => new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10)
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
const today = managuaToday()

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

/** Abre una pantalla con la API simulada más las rutas de reportes (`reportCalls` registra cada pedido). */
async function open(hash, { user = adminUser, viewport = { width: 1366, height: 900 }, reportHandler } = {}) {
  const mock = createMock({ user })
  const reportCalls = []
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  const page = await context.newPage()
  page.on('pageerror', (error) => consoleProblems.push(`pageerror ${hash}: ${error.message}`))
  page.on('console', (message) => { if (message.type() === 'error' && !/not_mocked|404|Failed to load resource|net::ERR/.test(message.text())) consoleProblems.push(`console ${hash}: ${message.text()}`) })
  await mock.install(page)
  // Playwright atiende primero la ruta registrada al final: esta gana sobre la simulación general.
  await page.route('**/api/v1/reports/**', async (route) => {
    const url = new URL(route.request().url())
    const kind = url.pathname.split('/').pop()
    reportCalls.push({ kind, from: url.searchParams.get('from'), to: url.searchParams.get('to') })
    if (reportHandler) return reportHandler(route, kind, url)
    const name = kind === 'inventory' ? 'existencias_2026.xlsx' : `${kind}_${url.searchParams.get('from')}_${url.searchParams.get('to')}.xlsx`
    return route.fulfill({
      status: 200, body: fakeXlsx,
      headers: { 'Content-Type': xlsxMime, 'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}` },
    })
  })
  await page.goto(`${base}/#${hash}`)
  return { mock, page, context, reportCalls }
}

const card = (page, title) => page.getByRole('region', { name: title })
const hasHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)

// ---------------------------------------------------------------- Tarjetas y permisos
console.log('Tarjetas según permisos')
{
  const { page, context } = await open('reportes')
  for (const title of ['Ventas', 'Existencias actuales', 'Movimientos de inventario', 'Cierres de caja']) {
    check(await visible(card(page, title)), `administrador ve la tarjeta «${title}»`)
  }
  check(await visible(page.getByText('Todavía no hay reporte de compras')), 'muestra la nota sobre compras (sin tarjeta)')
  check(await card(page, 'Compras').count() === 0, 'no hay tarjeta de compras')
  await page.screenshot({ path: join(shots, 'reportes-escritorio.png'), fullPage: true })
  await context.close()

  const limited = { ...adminUser, roles: ['Encargado'], permissions: ['sale.read', 'inventory.read'] }
  const second = await open('reportes', { user: limited })
  check(await visible(card(second.page, 'Ventas')) && await visible(card(second.page, 'Existencias actuales')), 'con sale.read e inventory.read ve esas dos tarjetas')
  check(await card(second.page, 'Cierres de caja').count() === 0 && await card(second.page, 'Movimientos de inventario').count() === 0, 'no ve Cierres ni Movimientos')
  check(await visible(second.page.getByText('la tuya no lo tiene')), 'avisa que sin permiso de costos el archivo no trae costos')
  await second.context.close()
}

// ---------------------------------------------------------------- Descarga correcta
console.log('Descarga de Ventas')
{
  const { page, context, reportCalls } = await open('reportes')
  const ventas = card(page, 'Ventas')
  await ventas.getByRole('button', { name: 'Últimos 7 días' }).click()
  check(await ventas.getByRole('button', { name: 'Últimos 7 días' }).getAttribute('aria-pressed') === 'true', 'el atajo elegido queda marcado')
  check(await ventas.getByLabel('Desde').inputValue() === addDays(today, -6) && await ventas.getByLabel('Hasta').inputValue() === today, 'Últimos 7 días llena desde/hasta en hora de Managua')
  const [download] = await Promise.all([page.waitForEvent('download'), ventas.getByRole('button', { name: 'Descargar Excel' }).click()])
  const expected = `sales_${addDays(today, -6)}_${today}.xlsx`
  check(download.suggestedFilename() === expected, `descarga con el nombre del servidor (${download.suggestedFilename()})`)
  const path = await download.path()
  check(path !== null && readFileSync(path).equals(fakeXlsx), 'el contenido descargado es el del servidor')
  check(await visible(ventas.getByText(expected)) && await visible(ventas.getByText(/2\.4 KB|2\.5 KB/)), 'muestra nombre y tamaño al terminar')
  check(reportCalls.length === 1 && reportCalls[0].kind === 'sales' && reportCalls[0].from === addDays(today, -6) && reportCalls[0].to === today, 'llamó a /reports/sales con from y to')

  await ventas.getByRole('button', { name: 'Ayer' }).click()
  check(await ventas.getByLabel('Desde').inputValue() === addDays(today, -1) && await ventas.getByLabel('Hasta').inputValue() === addDays(today, -1), 'Ayer')
  const first = today.slice(0, 7) + '-01'
  await ventas.getByRole('button', { name: 'Este mes' }).click()
  check(await ventas.getByLabel('Desde').inputValue() === first, 'Este mes empieza el día 1')
  await ventas.getByRole('button', { name: 'Mes pasado' }).click()
  check(await ventas.getByLabel('Hasta').inputValue() === addDays(first, -1), 'Mes pasado termina el último día del mes anterior')

  const inv = card(page, 'Existencias actuales')
  check(await inv.getByLabel('Desde').count() === 0, 'Existencias no pide fechas')
  const [invDownload] = await Promise.all([page.waitForEvent('download'), inv.getByRole('button', { name: 'Descargar Excel' }).click()])
  check(invDownload.suggestedFilename() === 'existencias_2026.xlsx', 'Existencias descarga con su nombre')
  check(reportCalls.at(-1).kind === 'inventory' && reportCalls.at(-1).from === null, 'Existencias llamó sin fechas')
  await context.close()
}

// ---------------------------------------------------------------- Estado de carga
console.log('Estado de carga')
{
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { page, context } = await open('reportes', {
    reportHandler: async (route) => {
      await gate
      await route.fulfill({ status: 200, body: fakeXlsx, headers: { 'Content-Type': xlsxMime, 'Content-Disposition': 'attachment; filename="lento.xlsx"' } })
    },
  })
  const caja = card(page, 'Cierres de caja')
  const button = caja.getByRole('button', { name: /Descargar Excel|Preparando/ })
  const downloadPromise = page.waitForEvent('download')
  await button.click()
  check(await visible(caja.getByRole('button', { name: 'Preparando archivo…' })), 'muestra «Preparando archivo…»')
  check(await caja.getByRole('button', { name: 'Preparando archivo…' }).isDisabled(), 'el botón queda deshabilitado mientras carga')
  check(await caja.getByRole('button', { name: 'Preparando archivo…' }).getAttribute('aria-busy') === 'true', 'aria-busy en el botón')
  release()
  const download = await downloadPromise
  check(download.suggestedFilename() === 'lento.xlsx', 'termina y descarga')
  check(await visible(caja.getByRole('button', { name: 'Descargar Excel' })), 'el botón vuelve a estar disponible')
  await context.close()
}

// ---------------------------------------------------------------- Validación de fechas
console.log('Validación de fechas')
{
  const { page, context, reportCalls } = await open('reportes')
  const ventas = card(page, 'Ventas')
  const download = ventas.getByRole('button', { name: 'Descargar Excel' })

  await ventas.getByLabel('Desde').fill(today)
  await ventas.getByLabel('Hasta').fill(addDays(today, -2))
  check(await visible(ventas.getByText('La fecha «Desde» no puede ser posterior a «Hasta».')), 'desde > hasta muestra el error')
  check(await download.isDisabled(), 'con error el botón no deja descargar')
  check(await ventas.getByLabel('Desde').getAttribute('aria-invalid') === 'true', 'los campos se marcan aria-invalid')

  await ventas.getByLabel('Desde').fill(addDays(today, -400))
  await ventas.getByLabel('Hasta').fill(today)
  check(await visible(ventas.getByText(/El rango máximo es de 366 días y elegiste 401/)), 'más de 366 días muestra el error')

  // El input type=date ya limita el máximo, pero el teclado puede forzar una fecha futura.
  await ventas.getByLabel('Desde').fill(today)
  await ventas.getByLabel('Hasta').fill(addDays(today, 3))
  check(await visible(ventas.getByText(/no admite fechas futuras/)), 'Ventas rechaza fechas futuras')
  check(await ventas.getByLabel('Hasta').getAttribute('max') === today, 'el campo «Hasta» de Ventas tiene max = hoy')

  const mov = card(page, 'Movimientos de inventario')
  await mov.getByLabel('Desde').fill(today)
  await mov.getByLabel('Hasta').fill(addDays(today, 3))
  check(await mov.getByText(/futuras/).count() === 0 && await mov.getByRole('button', { name: 'Descargar Excel' }).isEnabled(), 'Movimientos sí admite fechas futuras')

  await ventas.getByRole('button', { name: 'Hoy' }).click()
  check(await ventas.getByText(/rango máximo|futuras|posterior/).count() === 0 && await download.isEnabled(), 'al corregir, el error desaparece')
  check(reportCalls.length === 0, 'ninguna validación fallida llegó al servidor')
  await context.close()
}

// ---------------------------------------------------------------- Errores del servidor
console.log('Errores')
for (const [status, title, shown] of [
  [400, 'El rango de fechas no puede superar 366 días.', 'El rango de fechas no puede superar 366 días.'],
  [403, null, 'Tu cuenta no tiene permiso para descargar este reporte.'],
  [401, null, 'Tu sesión terminó. Volvé a iniciar sesión.'],
]) {
  const { page, context } = await open('reportes', {
    reportHandler: (route) => route.fulfill({
      status, headers: { 'Content-Type': 'application/problem+json' },
      body: JSON.stringify(title ? { title, status, code: 'invalid_range' } : { status }),
    }),
  })
  await card(page, 'Ventas').getByRole('button', { name: 'Descargar Excel' }).click()
  const alert = card(page, 'Ventas').getByRole('alert')
  check(await visible(alert) && (await alert.textContent()).includes(shown), `${status}: «${shown}»`)
  check(await card(page, 'Ventas').getByRole('button', { name: 'Descargar Excel' }).isEnabled(), `${status}: el botón queda disponible para reintentar`)
  await context.close()
}
{
  const { page, context } = await open('reportes', { reportHandler: (route) => route.fulfill({ status: 500, body: '<html>boom</html>', contentType: 'text/html' }) })
  await card(page, 'Cierres de caja').getByRole('button', { name: 'Descargar Excel' }).click()
  check(await visible(card(page, 'Cierres de caja').getByText('No fue posible generar el reporte.')), '500 sin JSON: mensaje genérico')
  await context.close()
}
{
  // Con el contexto sin red, las rutas simuladas igual responderían: se corta la petición como lo haría el navegador.
  const { page, context } = await open('reportes', { reportHandler: (route) => route.abort('internetdisconnected') })
  await page.getByRole('heading', { name: 'Reportes' }).waitFor()
  await context.setOffline(true)
  await card(page, 'Ventas').getByRole('button', { name: 'Descargar Excel' }).click()
  const alert = card(page, 'Ventas').getByRole('alert')
  check(await visible(alert) && (await alert.textContent()).includes('Los reportes necesitan conexión con el servidor'), 'sin conexión: «Los reportes necesitan conexión con el servidor»')
  await context.setOffline(false)
  await context.close()
}

// ---------------------------------------------------------------- Atajos en otras pantallas
console.log('Atajos «Descargar Excel»')
{
  const { page, context, reportCalls } = await open('ventas')
  const button = page.getByRole('button', { name: 'Descargar Excel' })
  check(await visible(button), 'Ventas tiene el botón')
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  check(download.suggestedFilename() === `sales_${today}_${today}.xlsx`, `Ventas descarga con su nombre (${download.suggestedFilename()})`)
  check(reportCalls[0]?.kind === 'sales' && reportCalls[0].from === today && reportCalls[0].to === today, 'Ventas usa el rango de sus filtros (hoy)')
  await page.getByLabel('Desde').fill(addDays(today, -3))
  const [again] = await Promise.all([page.waitForEvent('download'), button.click()])
  check(reportCalls[1].from === addDays(today, -3) && reportCalls[1].to === today && again.suggestedFilename().includes(addDays(today, -3)), 'Ventas usa el «Desde» cambiado')
  await page.getByLabel('Hasta').fill(addDays(today, -5)).catch(() => {})
  await context.close()
}
{
  const { page, context, reportCalls } = await open('caja')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar Excel' }).click()])
  check(download.suggestedFilename().startsWith('cash_'), 'Caja descarga el cierre')
  check(reportCalls[0]?.kind === 'cash' && reportCalls[0].from === today && reportCalls[0].to === today, 'Caja usa la fecha mostrada')
  await page.getByRole('button', { name: 'Día anterior' }).click()
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar Excel' }).click()])
  check(reportCalls[1].from === addDays(today, -1) && reportCalls[1].to === addDays(today, -1), 'Caja usa la fecha anterior tras navegar')
  await context.close()
}
{
  const { page, context, reportCalls } = await open('inventario')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar Excel' }).click()])
  check(download.suggestedFilename() === 'existencias_2026.xlsx' && reportCalls[0]?.kind === 'inventory' && reportCalls[0].from === null, 'Inventario descarga existencias actuales')
  await context.close()
}

// ---------------------------------------------------------------- Móvil
console.log('Móvil 390 px')
{
  const { page, context } = await open('reportes', { viewport: { width: 390, height: 844 } })
  await visible(card(page, 'Ventas'))
  check(!(await hasHorizontalScroll(page)), 'Reportes sin scroll horizontal')
  await page.screenshot({ path: join(shots, 'reportes-movil.png'), fullPage: true })
  await card(page, 'Ventas').getByLabel('Hasta').fill(addDays(today, 5))
  check(!(await hasHorizontalScroll(page)), 'sin scroll horizontal con mensaje de error')
  await context.close()
  for (const hash of ['ventas', 'caja', 'inventario']) {
    const view = await open(hash, { viewport: { width: 390, height: 844 } })
    await visible(view.page.getByRole('button', { name: 'Descargar Excel' }))
    await Promise.all([view.page.waitForEvent('download'), view.page.getByRole('button', { name: 'Descargar Excel' }).click()])
    await view.page.getByText(/Descargado:/).waitFor()
    check(!(await hasHorizontalScroll(view.page)), `${hash} sin scroll horizontal con el botón y su resultado`)
    await view.context.close()
  }
}

await browser.close()
if (consoleProblems.length) { console.log('Problemas de consola:'); consoleProblems.forEach((line) => console.log(`  ${line}`)) }
console.log(failures === 0 && consoleProblems.length === 0 ? '\nTodo bien.' : `\n${failures} fallo(s), ${consoleProblems.length} problema(s) de consola.`)
process.exit(failures === 0 && consoleProblems.length === 0 ? 0 : 1)
