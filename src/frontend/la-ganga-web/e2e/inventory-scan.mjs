/**
 * e2e contra el backend real: escanear un código en Inventario abre la ficha con producto, precio,
 * existencia y Kardex (regresión: antes salía «undefined» y «C$ NaN»). Un código inexistente avisa.
 * Requiere API en :5185, `vite preview` en :4173 y el usuario admin. Uso: node e2e/inventory-scan.mjs
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Clave-demo-2026-ganga'
let failures = 0
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures += 1 }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('auth/me') && !r.url().includes('by-barcode')) errors.push(`${r.status()} ${r.url()}`) })
await page.goto(BASE)
await page.getByLabel(/usuario/i).fill('admin')
await page.getByLabel(/contraseña/i).fill(PASSWORD)
await page.getByRole('button', { name: 'Entrar al sistema' }).click()
await page.waitForTimeout(1200)
await page.goto(`${BASE}/#inventario`); await page.waitForTimeout(1500)

// Toma el código de la primera fila de la tabla.
const firstRow = page.locator('tbody tr.clickable').first()
const barcode = (await firstRow.locator('td.adm-mono').innerText()).trim()
const price = (await firstRow.locator('td.numeric').first().innerText()).trim()
console.log(`  código de prueba ${barcode} (precio en tabla ${price})`)

await page.getByLabel('Escáner de código de barras').fill(barcode)
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
const dialog = page.getByRole('dialog')
const text = await dialog.innerText()
check(await dialog.count() === 1, 'se abrió la ficha de la variante')
check(!/undefined|NaN/.test(text), 'la ficha no muestra «undefined» ni «NaN»')
check(text.includes(barcode), 'la ficha muestra el código escaneado')
check(text.includes(price.replace(/\s/g, ' ')) || text.includes(price), `la ficha muestra el precio ${price}`)
check(/Existencia\s+-?\d+/.test(text), 'la ficha muestra la existencia como número')
check(!/No se pudo|error/i.test(text), 'el Kardex cargó sin error')
await page.screenshot({ path: process.env.SHOT ?? '/tmp/inventory-scan.png' })
await page.keyboard.press('Escape'); await page.waitForTimeout(400)

await page.getByLabel('Escáner de código de barras').fill('2999999999999')
await page.keyboard.press('Enter')
await page.waitForTimeout(1000)
check(await page.getByText(/No existe ninguna variante con el código 2999999999999/).isVisible(), 'un código inexistente avisa sin abrir la ficha')
check(errors.length === 0, `sin errores de red ni de página${errors.length ? ': ' + errors.join(' | ') : ''}`)
await browser.close()
console.log(failures === 0 ? 'TODO OK' : `${failures} FALLAS`)
process.exit(failures === 0 ? 0 : 1)
