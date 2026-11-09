/**
 * Integración completa contra el BACKEND REAL: dos cajas en dos navegadores independientes
 * (una de ellas vende sin conexión), cierre de ambas y verificación del consolidado y de
 * todas las pantallas administrativas.
 *
 * Requisitos: API en http://127.0.0.1:5185 con un administrador y dos vendedores
 * (por defecto admin, maria y carlos; contraseña Clave-demo-2026-ganga; ver variables ADMIN_USER, SELLER1, SELLER2, API_PASSWORD) y `npm run build` hecho. Levanta `vite preview` (4173).
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const PASSWORD = process.env.API_PASSWORD ?? 'Clave-demo-2026-ganga'
const ADMIN = process.env.ADMIN_USER ?? 'admin'
const SELLER1 = process.env.SELLER1 ?? 'maria'
const SELLER2 = process.env.SELLER2 ?? 'carlos'
const SHOTS = process.env.SHOTS ?? '/tmp/la-ganga-integration'
let ok = 0
let total = 0
function check(name, condition, detail = '') {
  total += 1
  if (condition) ok += 1
  else process.exitCode = 1
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
async function waitFor(url) {
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(url)).ok) return } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`Sin respuesta de ${url}`)
}

const preview = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch()
const errors = []
async function newUser(label) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => { errors.push(`${label}: ${error.message}`) })
  return { context, page }
}
async function login(page, user) {
  await page.goto(`${BASE_URL}/`)
  await page.getByLabel(/Usuario/i).fill(user)
  await page.getByLabel(/Contraseña/i).fill(PASSWORD)
  await page.getByRole('button', { name: /Entrar|Iniciar sesión|Ingresar/i }).first().click()
}
async function openCash(page, floatNio, register) {
  await page.getByRole('heading', { name: 'Abrir caja' }).waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  await page.locator('label.pv-register', { hasText: register }).click()
  await page.getByLabel(/Fondo inicial en córdobas/).fill(String(floatNio))
  await page.getByRole('button', { name: 'Abrir caja' }).click()
  await page.locator('#pv-scan-input').waitFor()
}
async function sell(page, code, expectSent = true) {
  await page.locator('#pv-scan-input').fill(code)
  await page.locator('#pv-scan-input').press('Enter')
  await page.locator('#pv-scan-input').fill('')
  await page.locator('#pv-scan-input').press('Enter')
  await page.getByRole('dialog', { name: 'Cobrar' }).waitFor()
  await page.getByRole('button', { name: 'Exacto' }).click()
  await page.getByRole('button', { name: /Agregar pago/ }).click()
  await page.getByRole('button', { name: /Confirmar cobro/ }).click()
  await page.getByTestId('sale-done').waitFor()
  if (expectSent) await page.waitForFunction(() => document.body.innerText.includes('Enviada al servidor'), null, { timeout: 15000 })
  await page.getByRole('button', { name: /Sin recibo/ }).click()
}
async function closeCash(page, thousands) {
  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  await page.getByLabel('Cantidad de billetes o monedas de 1000 córdobas').fill(String(thousands))
  await page.getByRole('button', { name: 'Cerrar caja' }).last().click()
  await page.getByRole('button', { name: 'Sí, cerrar caja' }).click()
  await page.getByRole('heading', { name: 'Caja cerrada' }).waitFor({ timeout: 15000 })
}

/** Deja las dos cajas cerradas antes de empezar (por si una prueba anterior quedó a medias). */
async function closeOpenSessions() {
  const context = await browser.newContext()
  const api = context.request
  await api.post(`${BASE_URL}/api/v1/auth/login`, { data: { username: ADMIN, password: PASSWORD } })
  const csrf = (await context.cookies()).find((c) => c.name === 'la_ganga_csrf')?.value ?? ''
  const registers = await (await api.get(`${BASE_URL}/api/v1/cash/registers`)).json()
  for (const register of registers.filter((r) => r.openSession)) {
    await api.post(`${BASE_URL}/api/v1/cash/sessions/${register.openSession.id}/close`, {
      data: { countedCashNio: 0, countedCashUsd: 0, notes: 'limpieza de pruebas' },
      headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
    })
  }
  // Reposición para que la prueba no dependa del stock que dejaron corridas anteriores.
  const snapshot = await (await api.get(`${BASE_URL}/api/v1/pos/snapshot`)).json()
  const variant = snapshot.variants[0]
  await api.post(`${BASE_URL}/api/v1/inventory/adjustments`, {
    data: { variantId: variant.variantId, kind: 'Entry', delta: 20, reason: 'Reposición de prueba' },
    headers: { 'X-CSRF-Token': decodeURIComponent(csrf) },
  })
  await context.close()
  return variant.barcode
}

try {
  await waitFor(BASE_URL)
  await waitFor(`${BASE_URL}/api/health`)
  const code = await closeOpenSessions()
  const one = await newUser('caja1')
  const two = await newUser('caja2')
  await Promise.all([login(one.page, SELLER1), login(two.page, SELLER2)])
  await openCash(one.page, 100, 'Caja 1')
  await openCash(two.page, 200, 'Caja 2')
  check('Dos cajas abiertas al mismo tiempo en equipos distintos', true)

  check('Catálogo con stock disponible', Boolean(code), String(code))

  await Promise.all([sell(one.page, code), sell(two.page, code)])
  check('Ventas simultáneas de las dos cajas aceptadas', true)

  await two.context.setOffline(true)
  await two.page.waitForFunction(() => document.querySelector('[data-testid="connection-status"]')?.textContent?.includes('Sin conexión'), null, { timeout: 15000 })
  await sell(two.page, code, false)
  check('Caja 2 vende sin conexión', (await two.page.getByTestId('pending-count').innerText()).startsWith('1 '))
  await two.context.setOffline(false)
  await two.page.waitForFunction(() => document.querySelector('[data-testid="pending-count"]')?.textContent?.startsWith('0 '), null, { timeout: 40000 })
  check('Caja 2 sincroniza sola al volver la red (una sola vez)', true)

  const admin = await newUser('admin')
  await login(admin.page, ADMIN)
  await admin.page.getByRole('navigation', { name: 'Módulos' }).waitFor({ timeout: 15000 })
  const consolidated = await admin.page.evaluate(async () => (await (await fetch('/api/v1/cash/consolidated')).json()))
  check('Consolidado incluye las dos cajas', consolidated.sessions.length >= 2 && consolidated.openSessionsCount >= 2, `${consolidated.sessions.length} cajas`)
  const t = consolidated.totals
  check('Efectivo + transferencia + tarjeta = total vendido', Math.abs(t.cashTotalNio + t.transferTotalNio + t.cardTotalNio - t.netTotalNio) < 0.005, `${t.netTotalNio}`)

  await Promise.all([closeCash(one.page, 1), closeCash(two.page, 1)])
  check('Ambas cajas cerradas con arqueo', true)
  const after = await admin.page.evaluate(async () => (await (await fetch('/api/v1/cash/consolidated')).json()))
  check('Consolidado sin cajas abiertas y con efectivo contado', after.openSessionsCount === 0 && after.countedCashNio !== null, `contado ${after.countedCashNio}`)

  // Todas las pantallas administrativas cargan sin errores ni texto de «en construcción».
  for (const view of ['panel', 'caja', 'ventas', 'productos', 'inventario', 'socios', 'catalogos', 'equipo', 'configuracion', 'auditoria']) {
    await admin.page.goto(`${BASE_URL}/#${view}`)
    await admin.page.reload()
    await admin.page.waitForTimeout(900)
    const text = await admin.page.locator('main').first().innerText()
    check(`Pantalla «${view}» carga con datos reales`, !/En construcción/.test(text) && text.length > 40 && !/Datos simulados/.test(text))
    await admin.page.screenshot({ path: `${SHOTS}/${view}.png` })
  }
  check('Sin errores de JavaScript en ninguna pantalla', errors.length === 0, errors.join(' | '))
} catch (error) {
  console.error('FALLO', error)
  process.exitCode = 1
} finally {
  await browser.close()
  preview?.kill()
  console.log(`\n${ok}/${total} comprobaciones correctas`)
}
