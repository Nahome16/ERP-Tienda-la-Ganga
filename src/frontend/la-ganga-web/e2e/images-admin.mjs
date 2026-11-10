/**
 * Pruebas end-to-end de la interfaz de imágenes de productos (API simulada con context.route).
 *
 * Cubre: reducción en el navegador (tamaños de `file` y `thumb` en la petición multipart),
 * subir 2 fotos, rechazo de tipos/pesos inválidos, límite de 4 (+409 simulado), 422, marcar
 * principal / reordenar, eliminar con confirmación, solo lectura, alta con imágenes, miniaturas
 * en el listado y en el POS (tarjeta, selector, carrito, respaldo con iniciales) y caché sin red.
 *
 * Uso (desde src/frontend/la-ganga-web):
 *   npm run build && node e2e/images-admin.mjs      # levanta `vite preview` en 4173
 *   BASE_URL=http://127.0.0.1:5173 node e2e/images-admin.mjs   # usar un servidor ya levantado
 *   SHOTS=/ruta/capturas  guardar capturas · HEADED=1  ver el navegador
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import process from 'node:process'
import { adminUser, createMock } from './admin-mock.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:4173'
const SHOTS = process.env.SHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

let failures = 0
function check(condition, message) {
  if (condition) console.log(`  ok   ${message}`)
  else { failures += 1; console.log(`  FAIL ${message}`) }
}
async function visible(locator, timeout = 5000) {
  try { await locator.first().waitFor({ state: 'visible', timeout }); return true } catch { return false }
}
async function waitFor(fn, timeout = 6000) {
  const limit = Date.now() + timeout
  while (Date.now() < limit) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 80)) }
  return false
}
async function waitForServer(url) {
  const limit = Date.now() + 20000
  while (Date.now() < limit) {
    try { if ((await fetch(url)).ok) return } catch { /* aún no */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`El servidor ${url} no respondió. ¿Corriste «npm run build»?`)
}

// ---------- utilidades de imagen / multipart ----------
/** Dimensiones de un JPEG leyendo el marcador SOF. */
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue }
    const marker = buf[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}
function parseMultipart(request) {
  const type = request.headers()['content-type'] ?? ''
  const boundary = /boundary=(.+)$/.exec(type)?.[1]
  const body = request.postDataBuffer()
  const parts = {}
  if (!boundary || !body) return { type, parts }
  const marker = Buffer.from(`--${boundary}`)
  let start = body.indexOf(marker)
  while (start >= 0) {
    const next = body.indexOf(marker, start + marker.length)
    if (next < 0) break
    const chunk = body.subarray(start + marker.length + 2, next - 2)
    const split = chunk.indexOf('\r\n\r\n')
    const head = chunk.subarray(0, split).toString('latin1')
    const name = /name="([^"]+)"/.exec(head)?.[1]
    if (name) parts[name] = { head, data: chunk.subarray(split + 4) }
    start = next
  }
  return { type, parts }
}
/** Genera en el navegador una foto de prueba (con detalle para que el JPEG pese algo). */
async function makeImage(page, { width, height, mime }) {
  const bytes = await page.evaluate(async ({ width, height, mime }) => {
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#d94f30'); gradient.addColorStop(1, '#153a45')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height)
    for (let i = 0; i < 400; i += 1) { ctx.fillStyle = `hsl(${(i * 37) % 360} 70% 50%)`; ctx.fillRect((i * 97) % width, (i * 53) % height, 40, 40) }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.95))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, { width, height, mime })
  return Buffer.from(bytes)
}

// ---------- API simulada de imágenes ----------
function installImageApi(context, mock, state) {
  const json = (route, status, body) => route.fulfill({ status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body) })
  const problem = (route, status, title, code) => json(route, status, { title, code, errors: {} })
  const imagesOf = (id) => (state.images[id] ??= [])
  const view = (list) => list.map((img, index) => ({ id: img.id, url: `/api/v1/media/${img.id}.jpg`, thumbUrl: `/api/v1/media/${img.id}_t.jpg`, isPrimary: index === 0, sortOrder: index }))
  const sizeName = (id) => mock.state.sizes.find((x) => x.id === id)?.name
  const colorOf = (id) => mock.state.colors.find((x) => x.id === id)
  const item = (p) => {
    const vs = mock.state.variants.filter((v) => v.productId === p.id)
    return {
      id: p.id, name: p.name, categoryId: p.categoryId, categoryName: mock.state.categories.find((c) => c.id === p.categoryId)?.name,
      brandId: p.brandId, brandName: mock.state.brands.find((c) => c.id === p.brandId)?.name, cutId: p.cutId, cutName: null,
      basePrice: p.basePrice, isActive: p.isActive, variantCount: vs.length, totalStock: vs.reduce((a, v) => a + v.stock, 0), version: p.version,
      primaryImageUrl: imagesOf(p.id)[0] ? `/api/v1/media/${imagesOf(p.id)[0].id}_t.jpg` : null,
    }
  }
  const detail = (p) => ({
    ...item(p), images: view(imagesOf(p.id)),
    variants: mock.state.variants.filter((v) => v.productId === p.id).map((v) => ({
      id: v.id, productId: v.productId, sizeId: v.sizeId, sizeName: sizeName(v.sizeId), colorId: v.colorId, colorName: colorOf(v.colorId)?.name,
      colorHex: colorOf(v.colorId)?.swatchHex ?? null, barcode: v.barcode, priceOverride: v.priceOverride, price: v.priceOverride ?? p.basePrice,
      stock: v.stock, isActive: v.isActive, version: v.version, cost: v.cost,
    })),
  })

  return context.route('**/api/v1/**', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const method = request.method()
    let m
    if (pathname === '/api/v1/products' && method === 'GET') {
      const items = mock.state.products.map(item)
      return json(route, 200, { items, page: 1, pageSize: 25, totalCount: items.length, totalPages: 1 })
    }
    if (pathname === '/api/v1/products' && method === 'POST') {
      const body = request.postDataJSON()
      state.createCalls.push(body)
      mock.state.nextId += 1
      const id = `pn${mock.state.nextId}`
      mock.state.products.push({ id, name: body.name, categoryId: body.categoryId, brandId: body.brandId, cutId: body.cutId, basePrice: body.basePrice, isActive: true, version: 1 })
      body.variants.forEach((v, i) => mock.state.variants.push({ id: `vn${mock.state.nextId}${i}`, productId: id, sizeId: v.sizeId, colorId: v.colorId, barcode: `99900${mock.state.nextId}${i}`, priceOverride: null, cost: v.cost, stock: v.initialQuantity ?? 0, isActive: true, version: 1 }))
      return json(route, 201, detail(mock.state.products.at(-1)))
    }
    if ((m = pathname.match(/^\/api\/v1\/products\/([^/]+)$/)) && method === 'GET') {
      const p = mock.state.products.find((x) => x.id === m[1])
      return p ? json(route, 200, detail(p)) : problem(route, 404, 'No existe.', 'not_found')
    }
    if ((m = pathname.match(/^\/api\/v1\/products\/([^/]+)\/images$/)) && method === 'POST') {
      const list = imagesOf(m[1])
      const { type, parts } = parseMultipart(request)
      state.uploads.push({ productId: m[1], contentType: type, csrf: request.headers()['x-csrf-token'], file: parts.file, thumb: parts.thumb })
      if (state.delayUploadMs) await new Promise((r) => setTimeout(r, state.delayUploadMs))
      if (state.failNext) { const f = state.failNext; state.failNext = null; return f(route) }
      if (list.length >= 4) return problem(route, 409, 'Ya hay 4 imágenes.', 'image_limit')
      const id = `img${++state.seq}`
      list.push({ id, file: parts.file.data, thumb: parts.thumb.data })
      return json(route, 201, view(list).at(-1))
    }
    if ((m = pathname.match(/^\/api\/v1\/products\/([^/]+)\/images\/order$/)) && method === 'PUT') {
      const list = imagesOf(m[1])
      const body = request.postDataJSON()
      state.orders.push(body.imageIds)
      if (state.failOrder) { state.failOrder = false; return problem(route, 500, 'Falló el orden.', null) }
      state.images[m[1]] = body.imageIds.map((id) => list.find((x) => x.id === id)).filter(Boolean)
      return json(route, 200, view(state.images[m[1]]))
    }
    if ((m = pathname.match(/^\/api\/v1\/products\/([^/]+)\/images\/([^/]+)$/)) && method === 'DELETE') {
      state.deletes.push(m[2])
      state.images[m[1]] = imagesOf(m[1]).filter((x) => x.id !== m[2])
      return route.fulfill({ status: 204 })
    }
    if ((m = pathname.match(/^\/api\/v1\/media\/(.+?)(_t)?\.jpg$/))) {
      const img = Object.values(state.images).flat().find((x) => x.id === m[1])
      return img ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: m[2] ? img.thumb : img.file, headers: { 'cache-control': 'private, max-age=31536000, immutable' } }) : route.fulfill({ status: 404 })
    }
    return route.fallback()
  })
}

let preview = null
if (!process.env.BASE_URL) preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore', shell: process.platform === 'win32' })
const browser = await chromium.launch({ headless: !process.env.HEADED })
const pageErrors = []

try {
  await waitForServer(BASE_URL)

  // =============================== ADMINISTRACIÓN ===============================
  console.log('Gestor de imágenes (administración)')
  const permissions = [...adminUser.permissions, 'product.images.manage']
  const mock = createMock({ user: { ...adminUser, permissions } })
  const state = { images: {}, uploads: [], orders: [], deletes: [], createCalls: [], seq: 0, failNext: null, failOrder: false, delayUploadMs: 0 }
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
  await context.addCookies([{ name: 'la_ganga_csrf', value: 'tok-csrf-123', url: BASE_URL }])
  await mock.install(context)
  await installImageApi(context, mock, state)
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${BASE_URL}/#productos`)

  const row = page.locator('tbody tr', { hasText: 'Camisa Oxford' })
  check(await visible(row), 'el listado carga')
  check(await row.locator('.img-placeholder').count() === 1, 'sin imagen: el listado muestra un marcador neutro')
  await row.getByRole('button', { name: 'Ver' }).click()
  const dialog = page.getByRole('dialog', { name: 'Camisa Oxford' })
  check(await visible(dialog.getByRole('region', { name: 'Imágenes del producto' })), 'el detalle muestra el gestor de imágenes')
  check(await dialog.getByText('0 de 4').isVisible(), 'indica 0 de 4 imágenes')

  // --- subir 2 fotos: una JPEG grande horizontal y una PNG pequeña
  const big = await makeImage(page, { width: 3000, height: 2000, mime: 'image/jpeg' })
  const small = await makeImage(page, { width: 800, height: 600, mime: 'image/png' })
  state.delayUploadMs = 400
  await dialog.getByTestId('image-input').setInputFiles([
    { name: 'frente.jpg', mimeType: 'image/jpeg', buffer: big },
    { name: 'detalle.png', mimeType: 'image/png', buffer: small },
  ])
  check(await visible(dialog.getByTestId('image-upload')), 'muestra el avance por imagen mientras sube')
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 2), 'las 2 fotos quedan en la galería sin recargar la pantalla')
  state.delayUploadMs = 0
  check(state.uploads.length === 2, 'se hicieron 2 peticiones POST')
  const [u1, u2] = state.uploads
  check(/^multipart\/form-data; boundary=/.test(u1.contentType), `Content-Type multipart con boundary automático (${u1.contentType.slice(0, 45)}…)`)
  check(u1.csrf === 'tok-csrf-123', `envía X-CSRF-Token leído de la cookie (${u1.csrf})`)
  const s1 = jpegSize(u1.file.data); const t1 = jpegSize(u1.thumb.data)
  check(s1?.width === 1200 && s1?.height === 800, `foto grande: file reducido a 1200x800 (${s1?.width}x${s1?.height}, ${u1.file.data.length} B)`)
  check(t1?.width === 320 && t1?.height === 213, `foto grande: thumb 320x213 (${t1?.width}x${t1?.height}, ${u1.thumb.data.length} B)`)
  const s2 = jpegSize(u2.file.data); const t2 = jpegSize(u2.thumb.data)
  check(s2?.width === 800 && s2?.height === 600, `foto pequeña: file NO se amplía, sigue 800x600 (${s2?.width}x${s2?.height})`)
  check(t2?.width === 320 && t2?.height === 240, `foto pequeña: thumb 320x240 (${t2?.width}x${t2?.height})`)
  check(u1.file.data.length < 2 * 1024 * 1024 && u1.thumb.data.length < 300 * 1024, 'file ≤ 2 MB y thumb ≤ 300 KB (topes del servidor)')
  check(/filename="[^"]+"/.test(u1.file.head) && /name="thumb"/.test(u1.thumb.head), 'campos «file» y «thumb» presentes')
  check(await dialog.getByText('Principal', { exact: true }).count() === 1, 'solo una imagen marcada como principal')
  check(await dialog.getByText('2 de 4').isVisible(), 'indica 2 de 4')
  await page.screenshot({ path: SHOTS ? `${SHOTS}/admin-detalle.png` : undefined }).catch(() => {})

  // --- el listado (detrás) se actualizó con la miniatura principal
  check(await waitFor(async () => (await row.locator('.img-thumb img').count()) === 1), 'el listado muestra la miniatura principal tras subir')

  // --- tipo inválido y peso excesivo: se rechazan en el navegador, sin llamar al servidor
  const before = state.uploads.length
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'animado.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') }])
  check(await visible(dialog.getByText(/animado\.gif.*no es una imagen válida/)), 'rechaza GIF con mensaje claro')
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'enorme.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024, 1) }])
  check(await visible(dialog.getByText(/enorme\.jpg.*El máximo es 15 MB/)), 'rechaza archivos de más de 15 MB')
  check(state.uploads.length === before, 'las inválidas no llegan al servidor')

  // --- 422 invalid_image: la foto queda con error y se puede reintentar/descartar
  state.failNext = (route) => route.fulfill({ status: 422, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Imagen inválida.', code: 'invalid_image', errors: {} }) })
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'rara.jpg', mimeType: 'image/jpeg', buffer: big }])
  check(await visible(dialog.getByRole('alert').filter({ hasText: /no aceptó la imagen/ })), '422 invalid_image: muestra el error en esa imagen')
  await dialog.getByRole('button', { name: 'Reintentar' }).click()
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 3), 'Reintentar la sube bien (3 imágenes)')

  // --- error de red
  await context.route('**/api/v1/products/*/images', (route) => route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback())
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'sinred.jpg', mimeType: 'image/jpeg', buffer: big }])
  check(await visible(dialog.getByRole('alert').filter({ hasText: /No hay conexión/ })), 'error de red: avisa que no hay conexión')
  await dialog.getByRole('button', { name: 'Descartar' }).click()
  await context.unroute('**/api/v1/products/*/images')
  check(await dialog.getByTestId('image-upload').count() === 0, 'Descartar quita la foto fallida')

  // --- límite de 4
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'cuarta.jpg', mimeType: 'image/jpeg', buffer: small }])
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 4), 'llega a 4 imágenes')
  check(await visible(dialog.getByText(/Ya hay 4 imágenes, que es el máximo/)), 'explica que ya hay 4 (máximo)')
  check(await dialog.getByRole('button', { name: 'Subir fotos' }).isDisabled() && await dialog.getByRole('button', { name: 'Tomar foto' }).isDisabled(), 'deshabilita «Subir fotos» y «Tomar foto»')
  check(await dialog.locator('.img-add').count() === 0, 'desaparece el botón «Agregar fotos»')
  await page.screenshot({ path: SHOTS ? `${SHOTS}/admin-4-imagenes.png` : undefined }).catch(() => {})

  // --- 409 image_limit de una carrera: se explica y se refresca desde el servidor
  await dialog.getByRole('button', { name: 'Eliminar' }).nth(3).click()
  await dialog.getByRole('button', { name: 'Sí, eliminar' }).click()
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 3), 'eliminar la 4.ª deja 3')
  state.images.p1.push({ id: 'imgx', file: big, thumb: small }) // otra persona subió una mientras tanto
  await dialog.getByTestId('image-input').setInputFiles([{ name: 'carrera.jpg', mimeType: 'image/jpeg', buffer: small }])
  check(await visible(dialog.getByRole('alert').filter({ hasText: /ya tiene 4 imágenes/ })), '409 image_limit: explica el límite')
  await dialog.getByRole('button', { name: 'Descartar' }).click()
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 4), 'se refresca la galería desde el servidor (4)')
  state.images.p1 = state.images.p1.filter((x) => x.id !== 'imgx')
  await dialog.getByRole('button', { name: 'Eliminar' }).last().click()
  await dialog.getByRole('button', { name: 'Sí, eliminar' }).click()
  await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 3)

  // --- marcar principal / reordenar
  const ids = () => state.images.p1.map((x) => x.id)
  const idsBefore = ids()
  state.orders.length = 0
  await dialog.getByTestId('image-tile').nth(2).getByRole('button', { name: 'Hacer principal' }).click()
  check(await waitFor(async () => state.orders.length === 1), 'Hacer principal llama a PUT /images/order')
  check(JSON.stringify(state.orders[0]) === JSON.stringify([idsBefore[2], idsBefore[0], idsBefore[1]]), 'envía todas las imágenes con la elegida primero')
  check(await dialog.getByTestId('image-tile').first().getByText('Principal').isVisible(), 'la elegida queda marcada como principal')
  check(await waitFor(async () => (await row.locator('.img-thumb img').getAttribute('src')).includes(`${idsBefore[2]}_t`)), 'el listado cambia a la nueva miniatura principal')
  await dialog.getByTestId('image-tile').nth(1).getByRole('button', { name: 'Mover a la derecha' }).click()
  check(await waitFor(async () => state.orders.length === 2), 'mover con las flechas guarda el orden')
  check(JSON.stringify(state.orders[1]) === JSON.stringify([idsBefore[2], idsBefore[1], idsBefore[0]]), 'orden resultante correcto')
  // arrastrar la 3.ª sobre la 1.ª
  await dialog.getByTestId('image-tile').nth(2).dragTo(dialog.getByTestId('image-tile').nth(0))
  check(await waitFor(async () => state.orders.length === 3) && state.orders[2][0] === idsBefore[0], 'arrastrar y soltar reordena')
  // fallo al guardar el orden: vuelve al orden anterior
  const orderNow = ids()
  state.failOrder = true
  await dialog.getByTestId('image-tile').nth(1).getByRole('button', { name: 'Mover a la derecha' }).click()
  check(await visible(dialog.getByRole('alert').filter({ hasText: /Falló el orden/ })), 'si falla el orden, avisa')
  check(JSON.stringify(await dialog.getByTestId('image-tile').evaluateAll((els) => els.length)) === '3' && JSON.stringify(ids()) === JSON.stringify(orderNow), 'y la galería vuelve a como estaba')

  // --- eliminar con confirmación
  const toDelete = ids()[1]
  await dialog.getByTestId('image-tile').nth(1).getByRole('button', { name: 'Eliminar' }).click()
  check(await visible(dialog.getByText('¿Eliminar esta imagen?')), 'pide confirmación')
  const deletesBefore = state.deletes.length
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
  check(state.deletes.length === deletesBefore, 'Cancelar no elimina')
  await dialog.getByTestId('image-tile').nth(1).getByRole('button', { name: 'Eliminar' }).click()
  await dialog.getByRole('button', { name: 'Sí, eliminar' }).click()
  check(await waitFor(async () => state.deletes.length === deletesBefore + 1 && state.deletes.at(-1) === toDelete), 'confirmar llama a DELETE de esa imagen')
  check(await waitFor(async () => (await dialog.getByTestId('image-tile').count()) === 2), 'queda con 2 imágenes')
  await dialog.getByRole('button', { name: 'Cerrar' }).click()

  // --- alta de producto con imágenes
  await page.getByRole('button', { name: /Nuevo producto/ }).click()
  const create = page.getByRole('dialog', { name: 'Nuevo producto' })
  await create.getByLabel('Nombre del producto').fill('Blusa Lino')
  await create.getByLabel('Categoría').selectOption({ label: 'Camisas' })
  await create.getByLabel('Marca').selectOption({ label: 'Bossini' })
  await create.getByLabel('Precio base (C$)').fill('450')
  await create.getByRole('checkbox', { name: 'S', exact: true }).check()
  await create.getByRole('checkbox', { name: 'Negro' }).check()
  await create.getByTestId('create-image-input').setInputFiles([
    { name: 'a.jpg', mimeType: 'image/jpeg', buffer: big }, { name: 'b.png', mimeType: 'image/png', buffer: small },
  ])
  check(await create.getByTestId('pending-image').count() === 2, 'el alta permite elegir imágenes antes de guardar')
  await create.getByRole('button', { name: /Crear producto/ }).click()
  check(await waitFor(async () => Object.values(state.images).some((l) => l.length === 2 && l !== state.images.p1)), 'tras crear, sube las 2 imágenes al producto nuevo')
  check(await visible(page.getByText(/Se subieron 2 imágenes/)), 'avisa que se subieron')
  // creación con una imagen que falla
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  await page.getByRole('button', { name: /Nuevo producto/ }).click()
  const create2 = page.getByRole('dialog', { name: 'Nuevo producto' })
  await create2.getByLabel('Nombre del producto').fill('Falda Plisada')
  await create2.getByLabel('Categoría').selectOption({ label: 'Camisas' })
  await create2.getByLabel('Marca').selectOption({ label: 'Bossini' })
  await create2.getByLabel('Precio base (C$)').fill('300')
  await create2.getByRole('checkbox', { name: 'S', exact: true }).check()
  await create2.getByRole('checkbox', { name: 'Negro' }).check()
  await create2.getByTestId('create-image-input').setInputFiles([{ name: 'falla.jpg', mimeType: 'image/jpeg', buffer: big }])
  state.failNext = (route) => route.fulfill({ status: 422, contentType: 'application/problem+json', body: JSON.stringify({ title: 'Imagen inválida.', code: 'invalid_image', errors: {} }) })
  await create2.getByRole('button', { name: /Crear producto/ }).click()
  check(await visible(page.getByText(/El producto quedó creado, pero no se pudo subir: «falla\.jpg»/)), 'si una imagen falla, el producto queda creado y se avisa cuál')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click()
  check(await visible(page.locator('tbody tr', { hasText: 'Falda Plisada' })), 'el producto aparece en el listado')
  await context.close()

  // --- solo lectura (sin product.images.manage)
  {
    const roMock = createMock({ user: { ...adminUser, permissions: adminUser.permissions } })
    const roState = { images: { p1: [{ id: 'r1', file: big, thumb: small }, { id: 'r2', file: big, thumb: small }] }, uploads: [], orders: [], deletes: [], createCalls: [], seq: 0 }
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' })
    await roMock.install(ctx); await installImageApi(ctx, roMock, roState)
    const p = await ctx.newPage()
    await p.goto(`${BASE_URL}/#productos`)
    await p.locator('tbody tr', { hasText: 'Camisa Oxford' }).getByRole('button', { name: 'Ver' }).click()
    const d = p.getByRole('dialog', { name: 'Camisa Oxford' })
    check(await waitFor(async () => (await d.getByTestId('image-tile').count()) === 2), 'solo lectura: se ve la galería')
    check(await d.getByRole('button', { name: /Subir|Eliminar|Hacer principal|Tomar foto/ }).count() === 0 && await d.getByTestId('image-input').count() === 0, 'solo lectura: sin acciones de subir/ordenar/eliminar')
    await ctx.close()
  }

  // =============================== POS ===============================
  console.log('Miniaturas en el POS')
  const user = { id: 'u1', username: 'vendedor', displayName: 'Vendedor Uno', roles: ['Vendedor'], mustChangePassword: false, permissions: ['catalog.read', 'product.read', 'inventory.read', 'sale.create', 'cash.operate'] }
  const settings = { usdRate: 36.7, storeName: 'Tienda La Ganga', storeAddress: 'Managua', storePhone: '2222-0000', receiptFooter: 'x', banks: ['BAC'], sellerDiscountLimitPercent: 10, lowStockThreshold: 2, exchangeWindowDays: 4 }
  const pageForJpeg = await browser.newPage()
  await pageForJpeg.goto('about:blank')
  const tiny = await makeImage(pageForJpeg, { width: 96, height: 96, mime: 'image/jpeg' })
  await pageForJpeg.close()
  const variants = [
    { variantId: 'v1', productId: 'p1', productName: 'Camisa Oxford', categoryName: 'Camisas', brandName: 'Ganga', sizeName: 'M', colorName: 'Azul', colorHex: '#2a5db0', barcode: '7000000000011', price: 350, stock: 5, imageUrl: '/api/v1/media/aaa_t.jpg' },
    { variantId: 'v2', productId: 'p1', productName: 'Camisa Oxford', categoryName: 'Camisas', brandName: 'Ganga', sizeName: 'L', colorName: 'Azul', colorHex: '#2a5db0', barcode: '7000000000028', price: 350, stock: 3, imageUrl: '/api/v1/media/aaa_t.jpg' },
    { variantId: 'v3', productId: 'p2', productName: 'Jean Slim', categoryName: 'Pantalones', brandName: 'Denim', sizeName: '32', colorName: 'Negro', colorHex: '#111', barcode: '7000000000035', price: 600, stock: 8, imageUrl: '/api/v1/media/rota_t.jpg' },
    { variantId: 'v4', productId: 'p3', productName: 'Gorra Lisa', categoryName: 'Accesorios', brandName: 'Ganga', sizeName: 'U', colorName: 'Rojo', colorHex: '#c00', barcode: '7000000000042', price: 150, stock: 8 },
  ]
  let mediaHits = 0
  let offline = false
  const posCtx = await browser.newContext({ viewport: { width: 1366, height: 800 } })
  const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await posCtx.route('**/api/**', (route) => {
    const { pathname } = new URL(route.request().url())
    if (offline) return route.abort('internetdisconnected')
    if (pathname === '/api/health') return json(route, 200, { status: 'healthy' })
    if (pathname === '/api/v1/auth/me') return json(route, 200, user)
    if (pathname === '/api/v1/pos/snapshot') return json(route, 200, { generatedAtUtc: new Date().toISOString(), settings, variants })
    if (pathname === '/api/v1/cash/sessions/current') return json(route, 200, { id: 'cs1', registerId: 'r1', registerName: 'Caja 1', openedAtUtc: new Date().toISOString(), openedByUserId: 'u1', openedByName: 'Vendedor Uno', openingFloatNio: 0, openingFloatUsd: 0, closedAtUtc: null, closedByName: null, countedCashNio: null, countedCashUsd: null, closingNotes: null })
    if (pathname === '/api/v1/media/aaa_t.jpg') { mediaHits += 1; return route.fulfill({ status: 200, contentType: 'image/jpeg', body: tiny, headers: { 'cache-control': 'private, max-age=31536000, immutable' } }) }
    if (pathname.startsWith('/api/v1/media/')) return route.fulfill({ status: 404 })
    return route.fulfill({ status: 404, contentType: 'application/problem+json', body: JSON.stringify({ title: 'no simulada', code: 'not_mocked', errors: {} }) })
  })
  const pos = await posCtx.newPage()
  pos.on('pageerror', (error) => pageErrors.push(error.message))
  await pos.goto(`${BASE_URL}/#pos`)
  await pos.locator('#pv-scan-input').waitFor({ timeout: 15000 })
  const cards = pos.locator('.pv-product')
  check(await cards.count() === 3, 'POS: 3 tarjetas de producto')
  const withImg = pos.locator('.pv-product', { hasText: 'Camisa Oxford' })
  check(await waitFor(() => withImg.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0)), 'tarjeta con imagen carga la miniatura')
  check(await withImg.locator('img').getAttribute('loading') === 'lazy', 'la miniatura usa loading="lazy"')
  const broken = pos.locator('.pv-product', { hasText: 'Jean Slim' })
  check(await broken.locator('.pv-thumb img').count() === 0 && await visible(broken.locator('.pv-thumb i')) && (await broken.locator('.pv-thumb i').innerText()) === 'JS', 'imagen que falla (404): muestra iniciales «JS»')
  const none = pos.locator('.pv-product', { hasText: 'Gorra Lisa' })
  check(await none.locator('.pv-thumb i').innerText() === 'GL', 'sin imageUrl (snapshot antiguo): muestra iniciales «GL»')
  const boxes = await cards.evaluateAll((els) => els.map((el) => el.querySelector('.pv-thumb').getBoundingClientRect()).map((r) => `${Math.round(r.width)}x${Math.round(r.height)}`))
  check(new Set(boxes).size === 1, `todas las miniaturas ocupan lo mismo (${boxes[0]}), sin saltos de layout`)
  await withImg.click()
  const variantsPanel = pos.getByRole('article', { name: /Variantes de Camisa Oxford/ })
  check(await visible(variantsPanel.locator('.pv-thumb img')), 'el selector de variantes muestra la miniatura')
  await variantsPanel.getByRole('button', { name: /Camisa Oxford · Azul · M/ }).click()
  check(await visible(pos.locator('.pv-line .pv-thumb img')), 'la línea del carrito muestra la miniatura')
  await pos.locator('#pv-scan-input').fill('7000000000042'); await pos.locator('#pv-scan-input').press('Enter')
  check(await pos.locator('.pv-line', { hasText: 'Gorra Lisa' }).locator('.pv-thumb i').innerText() === 'GL', 'línea sin imagen: iniciales en el carrito')
  if (SHOTS) await pos.screenshot({ path: `${SHOTS}/pos-miniaturas.png` })

  // Sin conexión: la caché del service worker sirve las fotos
  await pos.evaluate(async () => { await navigator.serviceWorker.ready })
  await pos.reload()
  await pos.locator('#pv-scan-input').waitFor()
  await waitFor(() => withImg.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false))
  const hitsOnline = mediaHits
  await pos.waitForTimeout(500)
  const cacheKeys = await pos.evaluate(async () => { try { const c = await caches.open('product-images'); return (await c.keys()).map((r) => new URL(r.url).pathname) } catch { return [] } })
  check(cacheKeys.includes('/api/v1/media/aaa_t.jpg') && !cacheKeys.some((k) => !k.startsWith('/api/v1/media/')), `caché «product-images» guarda solo /api/v1/media (${cacheKeys.join(', ')})`)
  const apiCaches = await pos.evaluate(async () => {
    const out = []
    for (const name of await caches.keys()) { const c = await caches.open(name); for (const r of await c.keys()) if (new URL(r.url).pathname.startsWith('/api/') && !new URL(r.url).pathname.startsWith('/api/v1/media/')) out.push(r.url) }
    return out
  })
  check(apiCaches.length === 0, 'ninguna otra ruta /api queda en caché')
  offline = true
  await posCtx.setOffline(true)
  await pos.reload()
  await pos.locator('#pv-scan-input').waitFor({ timeout: 15000 })
  const offImg = pos.locator('.pv-product', { hasText: 'Camisa Oxford' }).locator('img')
  check(await waitFor(() => offImg.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false), 8000), 'sin conexión: la miniatura sale de la caché')
  check(mediaHits === hitsOnline, 'sin pedirla otra vez al servidor')
  await posCtx.close()

  console.log(pageErrors.length === 0 ? '  ok   sin errores de JavaScript en la página' : `  FAIL errores de página: ${pageErrors.join(' | ')}`)
  if (pageErrors.length) failures += 1
} catch (error) {
  failures += 1
  console.log('ERROR', error)
} finally {
  await browser.close()
  preview?.kill()
}
console.log(failures === 0 ? '\nTodo bien.' : `\n${failures} comprobación(es) fallaron.`)
process.exit(failures === 0 ? 0 : 1)
