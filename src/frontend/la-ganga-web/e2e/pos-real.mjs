/**
 * Humo contra el BACKEND REAL (sin simular la API): login, abrir caja, venta en línea,
 * corte de red (context.setOffline), venta sin conexión, recuperación y cierre de caja.
 *
 * Requisitos: API en http://127.0.0.1:5185 con el vendedor de pruebas y `npm run build` hecho.
 *   API_USER=vendedor.uno API_PASSWORD=... node e2e/pos-real.mjs
 * Levanta `vite preview` (puerto 4173, con proxy /api -> 5185) salvo que se defina BASE_URL.
 * Deja la caja cerrada al terminar. Ojo: crea ventas reales en la base de datos local.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const USER = process.env.API_USER ?? 'vendedor.uno'
const PASSWORD = process.env.API_PASSWORD ?? 'Clave-local-2026-ganga'

const results = []
function check(name, condition, detail = '') {
  results.push(Boolean(condition))
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!condition) process.exitCode = 1
}
async function waitForServer(url, ms = 20000) {
  const limit = Date.now() + ms
  while (Date.now() < limit) {
    try { const r = await fetch(url); if (r.ok) return } catch { /* aún no */ }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`Sin respuesta de ${url}`)
}

const preview = process.env.BASE_URL ? null : spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
const browser = await chromium.launch()
try {
  await waitForServer(BASE_URL)
  await waitForServer(`${BASE_URL}/api/health`)
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => { console.log('PAGE ERROR', error.message); process.exitCode = 1 })
  const scan = async (code) => { await page.locator('#pv-scan-input').fill(code); await page.locator('#pv-scan-input').press('Enter') }
  const pending = () => page.getByTestId('pending-count').innerText()
  async function sell() {
    await page.locator('#pv-scan-input').fill('')
    await page.locator('#pv-scan-input').press('Enter')
    await page.getByRole('dialog', { name: 'Cobrar' }).waitFor()
    await page.getByRole('button', { name: 'Exacto' }).click()
    await page.getByRole('button', { name: /Agregar pago/ }).click()
    await page.getByRole('button', { name: /Confirmar cobro/ }).click()
    await page.getByTestId('sale-done').waitFor()
  }

  await page.goto(`${BASE_URL}/`)
  await page.getByLabel(/Usuario/i).fill(USER)
  await page.getByLabel(/Contraseña/i).fill(PASSWORD)
  await page.getByRole('button', { name: /Entrar|Iniciar sesión|Ingresar/i }).first().click()
  const heading = await Promise.race([
    page.getByRole('heading', { name: 'Abrir caja' }).waitFor().then(() => 'open'),
    page.locator('#pv-scan-input').waitFor().then(() => 'sell'),
  ])
  if (heading === 'open') {
    await page.getByLabel(/Fondo inicial en córdobas/).fill('100')
    await page.getByRole('button', { name: 'Abrir caja' }).click()
    await page.locator('#pv-scan-input').waitFor()
  }
  check('POS abierto con caja', true)

  // Código real tomado de la instantánea
  const code = await page.evaluate(async () => (await (await fetch('/api/v1/pos/snapshot')).json()).variants.find((v) => v.stock > 3)?.barcode)
  check('Hay una variante con stock en el catálogo real', Boolean(code), String(code))

  await scan(code)
  await sell()
  await page.waitForFunction(() => document.body.innerText.includes('Enviada al servidor'), null, { timeout: 15000 })
  check('Venta en línea aceptada por el servidor real', true)
  await page.getByRole('button', { name: /Sin recibo/ }).click()

  // Descuento sobre el límite: requiere aprobación del administrador (con conexión)
  const ADMIN = process.env.ADMIN_USER ?? 'admin.local'
  await scan(code)
  await page.getByLabel('Porcentaje de descuento').fill('20')
  await page.getByRole('button', { name: 'Pedir aprobación' }).click()
  await page.getByLabel('Usuario del administrador').fill(ADMIN)
  await page.getByLabel('Contraseña').fill('contraseña-incorrecta')
  await page.getByRole('button', { name: 'Aprobar descuento' }).click()
  await page.locator('.pv-modal .pv-error').waitFor()
  check('Credenciales malas muestran error y no aprueban', await page.getByRole('dialog', { name: 'Aprobación de descuento' }).isVisible())
  await page.getByLabel('Contraseña').fill(PASSWORD)
  await page.getByRole('button', { name: 'Aprobar descuento' }).click()
  await page.getByText(/Aprobado por/).waitFor()
  check('Descuento aprobado por el administrador', true)
  await sell()
  await page.waitForFunction(() => document.body.innerText.includes('Enviada al servidor'), null, { timeout: 15000 })
  check('Venta con descuento aprobado aceptada', true)
  await page.getByRole('button', { name: /Sin recibo/ }).click()

  await context.setOffline(true)
  await page.waitForFunction(() => document.querySelector('[data-testid="connection-status"]')?.textContent?.includes('Sin conexión'), null, { timeout: 15000 })
  await scan(code)
  await sell()
  await page.getByRole('button', { name: /Sin recibo/ }).click()
  check('Venta sin conexión queda pendiente', (await pending()).startsWith('1 '))

  await context.setOffline(false)
  await page.waitForFunction(() => document.querySelector('[data-testid="pending-count"]')?.textContent?.startsWith('0 '), null, { timeout: 40000 })
  check('Cola enviada al recuperar la red', true)
  await page.getByRole('button', { name: 'Ventas de esta caja' }).click()
  const text = await page.getByRole('dialog').innerText()
  check('Tres ventas con número oficial V-', (text.match(/V-\d+/g) ?? []).length >= 3, text.replace(/\s+/g, ' ').slice(0, 160))
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Cerrar caja' }).click()
  await page.getByLabel('Cantidad de billetes o monedas de 1000 córdobas').fill('1')
  await page.getByRole('button', { name: 'Cerrar caja' }).last().click()
  await page.getByRole('button', { name: 'Sí, cerrar caja' }).click()
  await page.getByRole('heading', { name: 'Caja cerrada' }).waitFor({ timeout: 15000 })
  check('Cierre de caja real con resumen', await page.getByText('Arqueo de efectivo').isVisible())
} catch (error) {
  console.error('FALLO', error)
  process.exitCode = 1
} finally {
  await browser.close()
  preview?.kill()
  console.log(`\n${results.filter(Boolean).length}/${results.length} comprobaciones correctas`)
}
