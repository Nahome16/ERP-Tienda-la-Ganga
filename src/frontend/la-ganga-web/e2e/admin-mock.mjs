// API simulada (según docs/30-mvp-contrato-api.md) para probar las pantallas administrativas con Playwright.
// Uso: const mock = createMock(); await mock.install(page)

const now = () => new Date().toISOString()
const page = (items, p, size) => {
  const start = (p - 1) * size
  return { items: items.slice(start, start + size), page: p, pageSize: size, totalCount: items.length, totalPages: Math.max(1, Math.ceil(items.length / size)) }
}
const cat = (id, name, extra = {}) => ({ id, name, isActive: true, sortOrder: 1, version: 1, parentId: null, sizeGroupId: null, swatchHex: null, updatedAtUtc: now(), ...extra })

export const adminUser = {
  id: 'u-admin', username: 'admin', displayName: 'Administrador', roles: ['Administrador'],
  permissions: ['catalog.read', 'catalog.manage', 'product.read', 'product.create', 'product.edit', 'inventory.read', 'inventory.kardex.read',
    'inventory.cost.read', 'inventory.initial.confirm', 'inventory.adjust', 'sale.create', 'sale.read', 'sale.void', 'cash.operate',
    'cash.report.read', 'settings.manage', 'audit.read', 'user.manage'],
}

export function createMock(options = {}) {
  const user = options.user ?? adminUser
  const log = [] // { method, path, body }
  const s = {
    settings: { usdRate: 36.7, storeName: 'Tienda La Ganga', storeAddress: 'Managua', storePhone: '2222-0000', receiptFooter: 'Recibo interno — no es factura', banks: ['BAC', 'Lafise'], sellerDiscountLimitPercent: 10, lowStockThreshold: 2, exchangeWindowDays: 4 },
    categories: [cat('c1', 'Camisas'), cat('c2', 'Pantalones')],
    brands: [cat('b1', 'Bossini'), cat('b2', 'Levis')],
    cuts: [cat('k1', 'Regular'), cat('k2', 'Slim')],
    sizeGroups: [cat('g1', 'Ropa'), cat('g2', 'Pantalón')],
    sizes: [cat('s1', 'S', { sizeGroupId: 'g1', sortOrder: 1 }), cat('s2', 'M', { sizeGroupId: 'g1', sortOrder: 2 }), cat('s3', 'L', { sizeGroupId: 'g1', sortOrder: 3 }), cat('s4', '32', { sizeGroupId: 'g2' })],
    colors: [cat('o1', 'Negro', { swatchHex: '#111111' }), cat('o2', 'Azul', { swatchHex: '#2255aa' }), cat('o3', 'Blanco', { swatchHex: '#ffffff' })],
    variants: [],
    products: [],
    sales: [],
    importCalls: [],
    nextId: 100,
  }
  const sizeName = (id) => s.sizes.find((x) => x.id === id)?.name ?? '?'
  const colorOf = (id) => s.colors.find((x) => x.id === id)
  const barcodeFor = () => {
    s.nextId += 1
    const body = `20000000${String(s.nextId).padStart(4, '0')}`
    const sum = [...body].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
    return body + String((10 - (sum % 10)) % 10)
  }

  function addProduct(name, categoryId, brandId, cutId, basePrice, variants, id) {
    const product = { id: id ?? `p${++s.nextId}`, name, categoryId, brandId, cutId, basePrice, isActive: true, version: 1 }
    s.products.push(product)
    for (const v of variants) {
      s.variants.push({
        id: `v${++s.nextId}`, productId: product.id, sizeId: v.sizeId, colorId: v.colorId, barcode: v.barcode || barcodeFor(),
        priceOverride: v.priceOverride ?? null, cost: v.cost ?? null, stock: v.initialQuantity ?? 0, isActive: true, version: 1,
        movements: v.initialQuantity ? [{ type: 'InitialStock', quantity: v.initialQuantity, balanceAfter: v.initialQuantity, reason: null, saleNumber: null, userName: 'Administrador', createdAtUtc: now() }] : [],
      })
    }
    return product
  }
  const variantView = (v) => {
    const p = s.products.find((x) => x.id === v.productId)
    const out = {
      id: v.id, productId: v.productId, sizeId: v.sizeId, sizeName: sizeName(v.sizeId), colorId: v.colorId,
      colorName: colorOf(v.colorId)?.name, colorHex: colorOf(v.colorId)?.swatchHex ?? null, barcode: v.barcode, priceOverride: v.priceOverride,
      price: v.priceOverride ?? p.basePrice, stock: v.stock, isActive: v.isActive, version: v.version,
    }
    if (user.permissions.includes('inventory.cost.read')) out.cost = v.cost
    return out
  }
  const productItem = (p) => {
    const vs = s.variants.filter((v) => v.productId === p.id)
    return {
      id: p.id, name: p.name, categoryId: p.categoryId, categoryName: s.categories.find((c) => c.id === p.categoryId)?.name,
      brandId: p.brandId, brandName: s.brands.find((c) => c.id === p.brandId)?.name, cutId: p.cutId, cutName: s.cuts.find((c) => c.id === p.cutId)?.name ?? null,
      basePrice: p.basePrice, isActive: p.isActive, variantCount: vs.length, totalStock: vs.reduce((a, v) => a + v.stock, 0), version: p.version,
    }
  }
  const productDetail = (p) => ({ ...productItem(p), variants: s.variants.filter((v) => v.productId === p.id).map(variantView) })
  const invRow = (v) => {
    const p = s.products.find((x) => x.id === v.productId)
    const row = { variantId: v.id, productId: p.id, productName: p.name, categoryName: s.categories.find((c) => c.id === p.categoryId)?.name, sizeName: sizeName(v.sizeId), colorName: colorOf(v.colorId)?.name, barcode: v.barcode, price: v.priceOverride ?? p.basePrice, stock: v.stock }
    if (user.permissions.includes('inventory.cost.read')) { row.cost = v.cost; row.stockValue = (v.cost ?? 0) * v.stock }
    return row
  }

  // Datos iniciales
  addProduct('Camisa Oxford', 'c1', 'b1', 'k1', 650, [
    { sizeId: 's2', colorId: 'o2', initialQuantity: 5, cost: 380, barcode: '4006381333931' },
    { sizeId: 's3', colorId: 'o2', initialQuantity: 1, cost: 380, barcode: '5901234123457' },
    { sizeId: 's2', colorId: 'o1', initialQuantity: 0, cost: 380, barcode: 'ABC-123' },
    { sizeId: 's3', colorId: 'o1', initialQuantity: -2, cost: 380 },
  ], 'p1')
  addProduct('Pantalón Jean Slim', 'c2', 'b2', 'k2', 1200, [{ sizeId: 's4', colorId: 'o1', initialQuantity: 8, cost: 700 }], 'p2')

  // Totales por caja (cada caja cuadra: efectivo + transferencia + tarjeta = total vendido, todo en C$ equivalentes).
  const emptyTotals = {
    salesCount: 0, voidedCount: 0, voidedTotalNio: 0, reviewCount: 0, grossTotalNio: 0, discountTotalNio: 0, netTotalNio: 0,
    cashNioTendered: 0, cashUsdTendered: 0, cashUsdEquivalentNio: 0, changeGivenNio: 0, cashTotalNio: 0,
    transferTotalNio: 0, cardTotalNio: 0, transferNioTendered: 0, transferUsdTendered: 0, transferUsdEquivalentNio: 0,
    cardNioTendered: 0, cardUsdTendered: 0, cardUsdEquivalentNio: 0, transfersByBank: [], byChannel: [],
  }
  const sumTotals = (list) => {
    const out = { ...emptyTotals, transfersByBank: [], byChannel: [] }
    for (const t of list) {
      for (const key of Object.keys(emptyTotals)) if (typeof emptyTotals[key] === 'number') out[key] += t[key]
      for (const bank of t.transfersByBank) {
        const found = out.transfersByBank.find((x) => x.bank === bank.bank)
        if (found) { found.totalNio += bank.totalNio; found.totalUsd += bank.totalUsd } else out.transfersByBank.push({ ...bank })
      }
      for (const channel of t.byChannel) {
        const found = out.byChannel.find((x) => x.channel === channel.channel)
        if (found) { found.salesCount += channel.salesCount; found.totalNio += channel.totalNio } else out.byChannel.push({ ...channel })
      }
    }
    return out
  }
  const totals1 = {
    ...emptyTotals, salesCount: 8, voidedCount: 1, voidedTotalNio: 350, reviewCount: 1, grossTotalNio: 6200, discountTotalNio: 200, netTotalNio: 6000,
    cashNioTendered: 4000, cashUsdTendered: 20, cashUsdEquivalentNio: 734, changeGivenNio: 100, cashTotalNio: 4634,
    transferNioTendered: 600, transferUsdTendered: 10, transferUsdEquivalentNio: 367, transferTotalNio: 967,
    cardNioTendered: 399, cardUsdTendered: 0, cardUsdEquivalentNio: 0, cardTotalNio: 399,
    transfersByBank: [{ bank: 'BAC', totalNio: 667, totalUsd: 10 }, { bank: 'Lafise', totalNio: 300, totalUsd: 0 }],
    byChannel: [{ channel: 'Store', salesCount: 6, totalNio: 4500 }, { channel: 'WhatsApp', salesCount: 2, totalNio: 1500 }],
  }
  const totals2 = {
    ...emptyTotals, salesCount: 4, voidedCount: 0, voidedTotalNio: 0, reviewCount: 1, grossTotalNio: 3600, discountTotalNio: 100, netTotalNio: 3500,
    cashNioTendered: 1500, cashUsdTendered: 0, cashUsdEquivalentNio: 0, changeGivenNio: 0, cashTotalNio: 1500,
    transferNioTendered: 0, transferUsdTendered: 20, transferUsdEquivalentNio: 734, transferTotalNio: 734,
    cardNioTendered: 532, cardUsdTendered: 20, cardUsdEquivalentNio: 734, cardTotalNio: 1266,
    transfersByBank: [{ bank: 'BAC', totalNio: 734, totalUsd: 20 }],
    byChannel: [{ channel: 'Store', salesCount: 4, totalNio: 3500 }],
  }
  const session = (id, registerName, closed, extra = {}) => ({
    id, registerId: `r-${id}`, registerName, openedAtUtc: '2026-11-08T14:00:00Z', openedByUserId: 'u-s', openedByName: id === 'cs1' ? 'Marta Pérez' : 'Luis Gómez',
    openingFloatNio: 500, openingFloatUsd: 20, closedAtUtc: closed ? '2026-11-08T23:30:00Z' : null, closedByName: closed ? 'Administrador' : null,
    countedCashNio: closed ? 4380 : null, countedCashUsd: closed ? 40 : null, closingNotes: closed ? 'Faltan C$ 20' : null,
    countedTransferNio: closed ? 600 : null, countedTransferUsd: closed ? 10 : null,
    countedCardNio: closed ? 390 : null, countedCardUsd: closed ? 0 : null, ...extra,
  })
  const diff = (counted, expected) => (counted === null || counted === undefined ? null : Math.round((counted - expected) * 100) / 100)
  // Resumen de una caja: lo esperado sale de los totales; las diferencias, de lo verificado.
  const summarize = (sess, t) => {
    const expected = {
      expectedCashNio: sess.openingFloatNio + t.cashNioTendered - t.changeGivenNio, expectedCashUsd: sess.openingFloatUsd + t.cashUsdTendered,
      expectedTransferNio: t.transferNioTendered, expectedTransferUsd: t.transferUsdTendered,
      expectedCardNio: t.cardNioTendered, expectedCardUsd: t.cardUsdTendered,
    }
    return {
      session: sess, totals: t, ...expected,
      differenceCashNio: diff(sess.countedCashNio, expected.expectedCashNio), differenceCashUsd: diff(sess.countedCashUsd, expected.expectedCashUsd),
      differenceTransferNio: diff(sess.countedTransferNio, expected.expectedTransferNio), differenceTransferUsd: diff(sess.countedTransferUsd, expected.expectedTransferUsd),
      differenceCardNio: diff(sess.countedCardNio, expected.expectedCardNio), differenceCardUsd: diff(sess.countedCardUsd, expected.expectedCardUsd),
    }
  }
  s.cash = { cs1: summarize(session('cs1', 'Caja 1', true), totals1), cs2: summarize(session('cs2', 'Caja 2', false), totals2) }
  const mkSale = (n, extra = {}) => ({
    id: `sale${n}`, number: `V-${String(n).padStart(6, '0')}`, clientSaleId: `cid${n}`, status: 'Confirmed', channel: 'Store', cashSessionId: 'cs1', registerName: 'Caja 1', sellerName: 'Marta Pérez',
    createdAtUtc: '2026-11-08T15:00:00Z', receivedAtUtc: '2026-11-08T15:00:05Z', isOffline: false, subtotalNio: 650, discountType: null, discountValue: null, discountNio: 0, totalNio: 650, changeNio: 50,
    requiresReview: false, reviewNote: null, note: null, voidedAtUtc: null, voidedByName: null, voidReason: null,
    lines: [{ variantId: 'v1', productName: 'Camisa Oxford', sizeName: 'M', colorName: 'Azul', barcode: '4006381333931', quantity: 1, unitPrice: 650, lineTotalNio: 650 }],
    payments: [{ method: 'Cash', currency: 'NIO', amount: 700, exchangeRate: null, amountNio: 700, bank: null, reference: null }], ...extra,
  })
  s.sales = [mkSale(1), mkSale(2, {
    requiresReview: true, reviewNote: 'Stock insuficiente al sincronizar.', isOffline: true, subtotalNio: 734, totalNio: 734, changeNio: 0,
    lines: [{ variantId: 'v1', productName: 'Camisa Oxford', sizeName: 'M', colorName: 'Azul', barcode: '4006381333931', quantity: 1, unitPrice: 734, lineTotalNio: 734 }],
    payments: [{ method: 'Transfer', currency: 'USD', amount: 20, exchangeRate: 36.7, amountNio: 734, bank: 'BAC', reference: 'TX-778' }],
  }), mkSale(3, { status: 'Voided', voidReason: 'Error de precio', voidedByName: 'Administrador', voidedAtUtc: now() })]
  s.audit = Array.from({ length: 35 }, (_, i) => ({ id: `a${i}`, occurredAtUtc: now(), userName: i % 2 ? 'Administrador' : 'Marta Pérez', action: i % 3 ? 'sale.confirmed' : 'inventory.adjusted', entityType: i % 3 ? 'Sale' : 'InventoryMovement', entityId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, summary: `Registro ${i}` }))

  const json = (route, status, body, headers = {}) => route.fulfill({ status, contentType: status >= 400 ? 'application/problem+json' : 'application/json', body: JSON.stringify(body), headers })
  const problem = (route, status, title, code, errors) => json(route, status, { title, code, errors })

  async function handle(route) {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const method = request.method()
    const q = url.searchParams
    let body = null
    try { body = request.postDataJSON() } catch { body = null }
    log.push({ method, path, query: Object.fromEntries(q), body, headers: request.headers() })
    const m = (re) => path.match(re)
    let r

    if (path === '/api/health') return json(route, 200, { service: 'la-ganga', status: 'healthy', timeZone: 'America/Managua', checkedAtUtc: now() })
    if (path === '/api/v1/auth/me') return json(route, 200, user)
    if ((r = m(/^\/api\/v1\/catalog\/([a-z-]+)$/))) {
      const map = { categories: s.categories, brands: s.brands, cuts: s.cuts, 'size-groups': s.sizeGroups, sizes: s.sizes, colors: s.colors }
      return json(route, 200, page(map[r[1]] ?? [], Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 25)))
    }
    if (path === '/api/v1/settings') {
      if (method === 'PUT') { s.settings = body; return json(route, 200, s.settings) }
      return json(route, 200, s.settings)
    }
    if (path === '/api/v1/users') return json(route, 200, [{ id: 'u-admin', username: 'admin', displayName: 'Administrador', isActive: true, roles: [], createdAtUtc: now(), lastLoginAtUtc: null }])

    // Productos
    if (path === '/api/v1/products' && method === 'GET') {
      const term = (q.get('search') ?? '').toLowerCase()
      let items = s.products.map(productItem)
      if (term) items = items.filter((p) => p.name.toLowerCase().includes(term))
      if (q.get('categoryId')) items = items.filter((p) => p.categoryId === q.get('categoryId'))
      if (q.get('brandId')) items = items.filter((p) => p.brandId === q.get('brandId'))
      const status = q.get('status') ?? 'active'
      if (status !== 'all') items = items.filter((p) => p.isActive === (status === 'active'))
      return json(route, 200, page(items, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 25)))
    }
    if (path === '/api/v1/products' && method === 'POST') {
      const barcodes = new Set(s.variants.map((v) => v.barcode))
      for (const v of body.variants) if (v.barcode && barcodes.has(v.barcode)) return problem(route, 409, 'Ese código de barras ya existe.', 'duplicate_barcode', {})
      const p = addProduct(body.name, body.categoryId, body.brandId, body.cutId, body.basePrice, body.variants)
      return json(route, 201, productDetail(p))
    }
    if (path === '/api/v1/products/import') {
      s.importCalls.push(body)
      const errors = []
      const added = []
      body.rows.forEach((row, i) => {
        if (!body.createMissingCatalogs && !s.categories.some((c) => c.name.toLowerCase() === row.category.toLowerCase())) errors.push({ row: i + 1, message: `La categoría «${row.category}» no existe.` })
        else if (!s.categories.some((c) => c.name.toLowerCase() === row.category.toLowerCase())) added.push(`Categoría: ${row.category}`)
      })
      const result = { dryRun: body.dryRun, productsCreated: errors.length ? 0 : new Set(body.rows.map((r2) => r2.productName)).size, variantsCreated: errors.length ? 0 : body.rows.length, unitsLoaded: errors.length ? 0 : body.rows.reduce((a, r2) => a + r2.quantity, 0), catalogsCreated: Array.from(new Set(added)), errors }
      if (!body.dryRun && errors.length === 0) for (const row of body.rows) addProduct(row.productName, 'c1', 'b1', null, row.price, [{ sizeId: 's1', colorId: 'o1', initialQuantity: row.quantity }])
      return json(route, 200, result)
    }
    if ((r = m(/^\/api\/v1\/products\/([^/]+)\/variants$/)) && method === 'POST') {
      const p = s.products.find((x) => x.id === r[1])
      if (s.variants.some((v) => v.productId === p.id && v.sizeId === body.sizeId && v.colorId === body.colorId)) return problem(route, 409, 'La variante ya existe.', 'duplicate_variant', {})
      s.variants.push({ id: `v${++s.nextId}`, productId: p.id, sizeId: body.sizeId, colorId: body.colorId, barcode: body.barcode || barcodeFor(), priceOverride: body.priceOverride, cost: body.cost, stock: body.initialQuantity, isActive: true, version: 1, movements: [] })
      return json(route, 201, variantView(s.variants.at(-1)))
    }
    if ((r = m(/^\/api\/v1\/products\/([^/]+)$/))) {
      const p = s.products.find((x) => x.id === r[1])
      if (!p) return problem(route, 404, 'No existe el producto.', 'not_found', {})
      if (method === 'PUT') {
        if (request.headers()['if-match'] !== `"${p.version}"`) return problem(route, 409, 'Otra persona modificó el producto.', 'version_conflict', {})
        Object.assign(p, body, { version: p.version + 1 })
        return json(route, 200, productItem(p))
      }
      return json(route, 200, productDetail(p))
    }
    if ((r = m(/^\/api\/v1\/variants\/by-barcode\/(.+)$/))) {
      const v = s.variants.find((x) => x.barcode === decodeURIComponent(r[1]))
      if (!v) return problem(route, 404, 'No existe esa variante.', 'not_found', {})
      return json(route, 200, { ...variantView(v), productName: s.products.find((p) => p.id === v.productId).name })
    }
    if ((r = m(/^\/api\/v1\/variants\/([^/]+)$/)) && method === 'PUT') {
      const v = s.variants.find((x) => x.id === r[1])
      Object.assign(v, { barcode: body.barcode, priceOverride: body.priceOverride, isActive: body.isActive, version: v.version + 1 }, 'cost' in body ? { cost: body.cost } : {})
      return json(route, 200, variantView(v))
    }

    // Inventario
    if (path === '/api/v1/inventory/summary') {
      return json(route, 200, { totalUnits: s.variants.reduce((a, v) => a + v.stock, 0), totalVariants: s.variants.length, lowStockCount: s.variants.filter((v) => v.stock > 0 && v.stock <= 2).length, outOfStockCount: s.variants.filter((v) => v.stock === 0).length, negativeCount: s.variants.filter((v) => v.stock < 0).length })
    }
    if (path === '/api/v1/inventory') {
      let rows = s.variants.map(invRow)
      const filter = q.get('filter') ?? 'all'
      if (filter === 'low') rows = rows.filter((x) => x.stock > 0 && x.stock <= 2)
      if (filter === 'out') rows = rows.filter((x) => x.stock === 0)
      if (filter === 'negative') rows = rows.filter((x) => x.stock < 0)
      const term = (q.get('search') ?? '').toLowerCase()
      if (term) rows = rows.filter((x) => `${x.productName} ${x.sizeName} ${x.colorName} ${x.barcode}`.toLowerCase().includes(term))
      return json(route, 200, page(rows, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 25)))
    }
    if ((r = m(/^\/api\/v1\/inventory\/variants\/([^/]+)\/kardex$/))) {
      const v = s.variants.find((x) => x.id === r[1])
      return json(route, 200, page([...v.movements].reverse(), Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 10)))
    }
    if (path === '/api/v1/inventory/adjustments') {
      const v = s.variants.find((x) => x.id === body.variantId)
      if (v.stock + body.delta < 0) return problem(route, 422, 'El saldo no puede quedar negativo.', 'negative_stock', {})
      v.stock += body.delta
      v.movements.push({ type: body.kind, quantity: body.delta, balanceAfter: v.stock, reason: body.reason, saleNumber: null, userName: 'Administrador', createdAtUtc: now() })
      return json(route, 200, {})
    }

    // Cajas
    if (path === '/api/v1/cash/consolidated') {
      const sessions = Object.values(s.cash)
      const open = sessions.filter((x) => !x.session.closedAtUtc).length
      const sum = (pick) => sessions.reduce((a, x) => a + pick(x), 0)
      // Verificado: null si hay cajas abiertas o alguna no verificó ese monto.
      const verified = (pick) => (open || sessions.some((x) => pick(x.session) === null || pick(x.session) === undefined) ? null : sum((x) => pick(x.session)))
      return json(route, 200, {
        date: q.get('date'), sessions, totals: sumTotals(sessions.map((x) => x.totals)), openSessionsCount: open,
        expectedCashNio: sum((x) => x.expectedCashNio), expectedCashUsd: sum((x) => x.expectedCashUsd),
        countedCashNio: verified((x) => x.countedCashNio), countedCashUsd: verified((x) => x.countedCashUsd),
        expectedTransferNio: sum((x) => x.expectedTransferNio), expectedTransferUsd: sum((x) => x.expectedTransferUsd),
        countedTransferNio: verified((x) => x.countedTransferNio), countedTransferUsd: verified((x) => x.countedTransferUsd),
        expectedCardNio: sum((x) => x.expectedCardNio), expectedCardUsd: sum((x) => x.expectedCardUsd),
        countedCardNio: verified((x) => x.countedCardNio), countedCardUsd: verified((x) => x.countedCardUsd),
      })
    }
    if ((r = m(/^\/api\/v1\/cash\/sessions\/([^/]+)\/summary$/))) return json(route, 200, s.cash[r[1]])
    if ((r = m(/^\/api\/v1\/cash\/sessions\/([^/]+)\/close$/))) {
      const c = s.cash[r[1]]
      const val = (v) => (v === undefined ? null : v)
      Object.assign(c.session, {
        closedAtUtc: now(), closedByName: 'Administrador', countedCashNio: body.countedCashNio, countedCashUsd: body.countedCashUsd, closingNotes: body.notes,
        countedTransferNio: val(body.countedTransferNio), countedTransferUsd: val(body.countedTransferUsd),
        countedCardNio: val(body.countedCardNio), countedCardUsd: val(body.countedCardUsd),
      })
      s.cash[r[1]] = summarize(c.session, c.totals)
      return json(route, 200, s.cash[r[1]])
    }
    if (path === '/api/v1/cash/sessions') return json(route, 200, Object.values(s.cash))

    // Ventas
    if (path === '/api/v1/sales') {
      let items = [...s.sales]
      if (q.get('status')) items = items.filter((x) => x.status === q.get('status'))
      if (q.get('needsReview')) items = items.filter((x) => x.requiresReview)
      if (q.get('number')) items = items.filter((x) => x.number.toLowerCase().includes(q.get('number').toLowerCase()))
      if (q.get('sessionId')) items = items.filter((x) => x.cashSessionId === q.get('sessionId'))
      return json(route, 200, page(items, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 25)))
    }
    if ((r = m(/^\/api\/v1\/sales\/([^/]+)\/void$/))) {
      const sale = s.sales.find((x) => x.id === r[1])
      if (!body.reason || body.reason.length < 5) return problem(route, 422, 'El motivo es obligatorio.', 'validation_failed', { reason: ['Mínimo 5 caracteres.'] })
      Object.assign(sale, { status: 'Voided', voidReason: body.reason, voidedByName: 'Administrador', voidedAtUtc: now() })
      return json(route, 200, sale)
    }
    if ((r = m(/^\/api\/v1\/sales\/([^/]+)\/resolve-review$/))) {
      const sale = s.sales.find((x) => x.id === r[1])
      Object.assign(sale, { requiresReview: false, reviewNote: null })
      return json(route, 200, sale)
    }
    if (path === '/api/v1/audit') {
      let items = s.audit
      if (q.get('entityType')) items = items.filter((x) => x.entityType === q.get('entityType'))
      return json(route, 200, page(items, Number(q.get('page') ?? 1), Number(q.get('pageSize') ?? 30)))
    }
    return json(route, 404, { title: `Sin simulación para ${method} ${path}`, code: 'not_mocked' })
  }

  return {
    state: s,
    log,
    async install(pw) {
      await pw.route('**/api/**', handle)
    },
  }
}
