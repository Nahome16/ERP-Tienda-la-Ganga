/**
 * e2e contra el backend real: «Ingresar mercadería» de un producto (fotos, edición, tallas nuevas,
 * cantidades por talla y color) desde Inventario. Requiere API en :5185 con el usuario admin y
 * `vite preview` en :4173. Uso: node e2e/receive-stock.mjs [carpeta con foto1.png y foto2.png]
 */
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Clave-demo-2026-ganga'

function crc(buf) { let c, crcv = 0xffffffff; for (const b of buf) { c = (crcv ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcv = (crcv >>> 8) ^ c } return (crcv ^ 0xffffffff) >>> 0 }
function png(path, w, h, [r, g, b]) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}
const dir = mkdtempSync(join(tmpdir(), 'receive-'))
png(join(dir, 'foto1.png'), 300, 400, [200, 60, 60]); png(join(dir, 'foto2.png'), 300, 400, [60, 60, 200])

let failures = 0
const check = (ok, msg) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures += 1 }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('auth/me')) errors.push(`${r.status()} ${r.request().method()} ${r.url()}`) })

await page.goto(BASE)
await page.getByLabel(/usuario/i).fill('admin')
await page.getByLabel(/contraseña/i).fill(PASSWORD)
await page.getByRole('button', { name: 'Entrar al sistema' }).click()
await page.waitForTimeout(1200)
const unique = `Blusa Ingreso ${Date.now() % 100000}`

// 1. Crear un producto mínimo para el ingreso (S/Negro).
await page.goto(`${BASE}/#inventario`); await page.waitForTimeout(1200)
await page.getByRole('button', { name: /nuevo producto/i }).click()
let dlg = page.getByRole('dialog')
await dlg.getByLabel('Nombre del producto').fill(unique)
await dlg.getByLabel('Categoría').selectOption({ label: 'Dama › Blusas' })
await dlg.getByLabel('Marca').selectOption({ label: 'Zara' })
await dlg.getByLabel(/precio base/i).fill('350')
await dlg.getByRole('checkbox', { name: 'S', exact: true }).check()
await dlg.getByRole('checkbox', { name: 'Negro', exact: true }).check()
await dlg.getByRole('button', { name: /crear producto/i }).click()
await page.waitForTimeout(1500)
await page.keyboard.press('Escape'); await page.waitForTimeout(400)

// 2. Ingresar mercadería desde Inventario → buscar el producto.
await page.getByRole('button', { name: /ingresar mercadería/i }).click()
dlg = page.getByRole('dialog')
await dlg.getByLabel('Buscar producto').fill(unique.slice(0, 14))
await dlg.getByRole('button', { name: new RegExp(unique) }).click()
await page.waitForTimeout(800)
dlg = page.getByRole('dialog')
check(await dlg.getByText(/Fotos del producto/).isVisible(), 'el diálogo muestra la sección de fotos')

// 3. Subir 2 fotos (la sección está abierta porque el producto aún no tiene fotos).
await dlg.locator('input[type=file]').first().setInputFiles([join(dir, 'foto1.png'), join(dir, 'foto2.png')])
await page.waitForTimeout(2500)
check(await dlg.getByText(/2 de 4/).first().isVisible(), 'se subieron 2 fotos')

// 4. Editar el producto (precio base).
await dlg.getByRole('button', { name: /editar datos del producto/i }).click()
let edit = page.getByRole('dialog', { name: 'Editar producto' })
await edit.getByLabel(/precio base/i).fill('399')
await edit.getByRole('button', { name: /guardar cambios/i }).click()
await page.waitForTimeout(1200)
check(await page.getByRole('dialog').first().getByText(/399/).first().isVisible(), 'el precio base editado se refleja (C$ 399)')

// 5. Agregar talla M y color Azul nuevos.
await page.getByRole('dialog').first().getByRole('button', { name: /agregar talla o color nuevo/i }).click()
const add = page.getByRole('dialog', { name: 'Agregar variantes' })
await add.getByRole('checkbox', { name: 'M', exact: true }).check()
await add.getByRole('checkbox', { name: 'Azul', exact: true }).check()
await add.getByRole('button', { name: /agregar \d+ variante/i }).click()
await page.waitForTimeout(1500)
const hub = page.getByRole('dialog').first()
check(await hub.getByRole('spinbutton', { name: /cantidad que ingresa/i }).count() === 2, 'la tabla ahora lista la talla M / Azul nueva (2 variantes)')

// 6. Cargar cantidades y registrar.
const inputs = hub.getByRole('spinbutton', { name: /cantidad que ingresa/i })
const n = await inputs.count()
for (let i = 0; i < n; i += 1) await inputs.nth(i).fill(String(i + 2))
await hub.getByLabel('Motivo (obligatorio)').fill('Llegó pedido de prueba')
await hub.getByRole('button', { name: /registrar ingreso/i }).click()
await page.waitForTimeout(2000)
check(await hub.getByText(/Se registraron/).isVisible(), 'mensaje de ingreso registrado')
const stocks = await hub.locator('tbody tr td:nth-child(4)').allInnerTexts()
console.log('  existencias tras el ingreso:', stocks.join(', '))
check(stocks.every((s, i) => Number(s) === i + 2), 'las existencias coinciden con lo ingresado')
await page.screenshot({ path: process.env.SHOT ?? join(dir, 'hub.png') })

// 7. Cerrar y comprobar en Inventario.
await hub.locator('footer').getByRole('button', { name: 'Cerrar', exact: true }).click()
await page.waitForTimeout(800)
await page.getByRole('searchbox', { name: 'Buscar en inventario' }).fill(unique.slice(0, 14))
await page.waitForTimeout(1200)
check(await page.getByRole('row', { name: new RegExp(unique) }).count() === n, `Inventario muestra las ${n} variantes del producto`)
console.log('  errores de red/consola:', errors.length ? errors.join(' | ') : 'ninguno')
check(errors.length === 0, 'sin errores de red ni de página')
await browser.close()
console.log(failures === 0 ? 'TODO OK' : `${failures} FALLAS`)
process.exit(failures === 0 ? 0 : 1)
