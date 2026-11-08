# MVP — Contrato de API (POS, cajas, inventario)

Estado: **fuente de verdad para backend y frontend del MVP**. Si el backend
cambia un contrato, se actualiza este documento en el mismo cambio.

Convenciones generales (iguales a `/api/v1/catalog`):

- Base: `/api/v1`. JSON en `camelCase`. Enumeraciones como **texto**
  (`"Cash"`, `"Percent"`…). Fechas ISO 8601 UTC. Dinero como número decimal.
- Sesión por cookie. Toda operación que cambia datos exige el encabezado
  `X-CSRF-Token` (cookie `la_ganga_csrf`), como ya hace `lib/api.ts`.
- Errores: `application/problem+json` con `title` (mensaje para la persona),
  `code` (estable, para el código) y `errors` (campo → mensajes).
- Ediciones de producto/variante: `If-Match: "<version>"`; conflicto → 409
  `version_conflict`.
- Moneda base: córdoba (`NIO`). Se acepta `USD` solo en efectivo.
- Zona horaria de negocio: America/Managua (UTC−6 fijo, sin horario de verano).
- Paginación: `page` (desde 1) y `pageSize` (máx. 100) →
  `{ items, page, pageSize, totalCount, totalPages }`.

## Permisos nuevos

| Permiso | Para qué |
|---|---|
| `sale.create` | Usar el POS y registrar ventas |
| `sale.read` | Historial de ventas de toda la tienda |
| `sale.void` | Anular ventas y resolver ventas «Requiere revisión» |
| `sale.discount.unlimited` | Autorizar descuentos sobre el límite del vendedor |
| `cash.operate` | Abrir/cerrar la propia caja |
| `cash.report.read` | Ver cajas de otros, cierres y consolidado |
| `settings.manage` | Tasa USD, bancos, datos del recibo |
| `audit.read` | Consultar auditoría |

Vendedor: `catalog.read, product.read, inventory.read, sale.create, cash.operate`.
Encargado de inventario: lo que ya tenía. Administrador: todos.

## 1. Configuración

`GET /settings` — cualquier usuario con `sale.create` o `settings.manage`.
`PUT /settings` — `settings.manage`.

```ts
type StoreSettings = {
  usdRate: number                  // 36.7
  storeName: string
  storeAddress: string
  storePhone: string
  receiptFooter: string            // «Recibo interno — no es factura»
  banks: string[]                  // bancos para transferencia
  sellerDiscountLimitPercent: number // 10
  lowStockThreshold: number        // 2
}
```

## 2. Instantánea del POS (para trabajar sin conexión)

`GET /pos/snapshot` — `sale.create`.

```ts
type PosSnapshot = {
  generatedAtUtc: string
  settings: StoreSettings
  variants: PosVariant[]           // solo productos y variantes activos
}
type PosVariant = {
  variantId: string
  productId: string
  productName: string
  categoryName: string
  brandName: string
  sizeName: string
  colorName: string
  colorHex: string | null
  barcode: string                  // único
  price: number                    // precio efectivo (variante ?? producto)
  stock: number                    // puede ser ≤ 0
}
```

Nunca incluye costos.

## 3. Cajas

`GET /cash/registers` — `cash.operate`:
`[{ id, name, openSession: { id, openedAtUtc, openedByName } | null }]`
(hay dos cajas fijas: «Caja 1» y «Caja 2»).

`POST /cash/sessions` — `cash.operate`:
`{ registerId, openingFloatNio, openingFloatUsd }` → `CashSession`.
Errores 409: `register_in_use` (la caja ya está abierta) y
`user_has_open_session` (esa persona ya tiene otra caja abierta).

`GET /cash/sessions/current` — `cash.operate`: la caja abierta de quien llama,
o 404 `no_open_session`.

```ts
type CashSession = {
  id: string
  registerId: string
  registerName: string
  openedAtUtc: string
  openedByUserId: string
  openedByName: string
  openingFloatNio: number
  openingFloatUsd: number
  closedAtUtc: string | null
  closedByName: string | null
  countedCashNio: number | null
  countedCashUsd: number | null
  closingNotes: string | null
  countedTransferNio: number | null; countedTransferUsd: number | null   // null = no verificado
  countedCardNio: number | null;     countedCardUsd: number | null
}
```

`GET /cash/sessions/{id}/summary` — dueño de la caja o `cash.report.read`:

```ts
type CashTotals = {
  salesCount: number
  voidedCount: number
  voidedTotalNio: number
  reviewCount: number              // ventas «Requiere revisión» sin resolver
  grossTotalNio: number            // antes de descuentos
  discountTotalNio: number
  netTotalNio: number              // TOTAL VENDIDO (después de descuentos)
  cashNioTendered: number          // billetes C$ recibidos
  cashUsdTendered: number          // dólares recibidos (en USD)
  cashUsdEquivalentNio: number     // esos dólares convertidos a C$
  changeGivenNio: number           // cambio entregado (siempre C$)
  cashTotalNio: number             // efectivo neto = cashNioTendered + cashUsdEquivalentNio − changeGivenNio
  transferTotalNio: number         // equivalente en C$ (incluye las transferencias en US$)
  cardTotalNio: number             // «POS»: tarjeta con terminal externa (equivalente en C$)
  transferNioTendered: number      // transferencias recibidas en córdobas
  transferUsdTendered: number      // transferencias recibidas en dólares (en US$)
  transferUsdEquivalentNio: number
  cardNioTendered: number          // cobros con tarjeta en córdobas
  cardUsdTendered: number          // cobros con tarjeta en dólares (en US$)
  cardUsdEquivalentNio: number
  transfersByBank: { bank: string; totalNio: number; totalUsd: number }[]   // totalUsd: parte recibida en US$
  byChannel: { channel: SaleChannel; salesCount: number; totalNio: number }[]
}
// Invariante: cashTotalNio + transferTotalNio + cardTotalNio === netTotalNio

type CashSummary = {
  session: CashSession
  totals: CashTotals
  expectedCashNio: number          // openingFloatNio + cashNioTendered − changeGivenNio
  expectedCashUsd: number          // openingFloatUsd + cashUsdTendered
  differenceCashNio: number | null // contado − esperado (solo si está cerrada)
  differenceCashUsd: number | null
  expectedTransferNio: number      // = totals.transferNioTendered
  expectedTransferUsd: number      // = totals.transferUsdTendered
  differenceTransferNio: number | null  // verificado − esperado (null si no se verificó)
  differenceTransferUsd: number | null
  expectedCardNio: number          // = totals.cardNioTendered
  expectedCardUsd: number          // = totals.cardUsdTendered
  differenceCardNio: number | null
  differenceCardUsd: number | null
}
```

`POST /cash/sessions/{id}/close` — dueño o `cash.report.read`:

```ts
type CloseRequest = {
  countedCashNio: number; countedCashUsd: number   // efectivo contado (obligatorios; pueden ser 0)
  notes?: string | null
  // Verificación opcional (null/omitido = «no se verificó», sin diferencia):
  countedTransferNio?: number | null; countedTransferUsd?: number | null   // lo que se ve en el banco
  countedCardNio?: number | null;     countedCardUsd?: number | null       // lo que marca el cierre de lote de la terminal
}
```

→ `CashSummary` ya con diferencias. **Cada método se concilia por moneda** contra su
propia fuente: el efectivo contra el conteo físico, las transferencias contra el
banco y la tarjeta contra el cierre de lote de la terminal.

`GET /cash/sessions?from=YYYY-MM-DD&to=YYYY-MM-DD` — `cash.report.read`:
`CashSummary[]` (por fecha de apertura, hora de Managua).

`GET /cash/consolidated?date=YYYY-MM-DD` — `cash.report.read`:

```ts
type CashConsolidated = {
  date: string
  sessions: CashSummary[]          // turnos abiertos ese día (Managua)
  totals: CashTotals               // suma de todas las cajas
  expectedCashNio: number
  expectedCashUsd: number
  countedCashNio: number | null    // null si alguna caja sigue abierta
  countedCashUsd: number | null
  openSessionsCount: number
  expectedTransferNio: number; expectedTransferUsd: number
  countedTransferNio: number | null; countedTransferUsd: number | null   // null si hay cajas abiertas o sin verificar
  expectedCardNio: number; expectedCardUsd: number
  countedCardNio: number | null; countedCardUsd: number | null
}
```

## 4. Ventas

`POST /pos/sales` — `sale.create`. **Idempotente** por `clientSaleId`:
reenviar la misma venta devuelve la ya guardada (200, `alreadyProcessed: true`);
una venta nueva devuelve 201.

```ts
type SaleChannel = 'Store' | 'WhatsApp' | 'Facebook'
type PaymentMethod = 'Cash' | 'Transfer' | 'Card'
type Currency = 'NIO' | 'USD'

type SaleRequest = {
  clientSaleId: string             // GUID generado en el equipo
  cashSessionId: string
  channel: SaleChannel
  createdAtUtc: string             // reloj del equipo (puede ser de hace horas)
  isOffline: boolean               // se creó sin conexión
  lines: { variantId: string; quantity: number; unitPrice: number }[]
  discount: { type: 'Percent' | 'Amount'; value: number } | null
  discountApprovalId: string | null
  payments: {
    method: PaymentMethod
    currency: Currency             // USD en cualquier método (con su tasa)
    amount: number                 // en la moneda indicada (lo entregado)
    exchangeRate: number | null    // obligatorio con USD (la tasa usada)
    bank: string | null            // Transfer
    reference: string | null       // Transfer (opcional)
  }[]
  note: string | null
}
```

Reglas del servidor (no confía en totales del cliente):

1. Calcula subtotal, descuento, total y cambio. `Percent` 0–100; `Amount`
   ≤ subtotal. El total se redondea a 2 decimales.
2. Descuento sobre `sellerDiscountLimitPercent` (en % equivalente) sin
   `discountApprovalId` válido y sin `sale.discount.unlimited` → 422
   `discount_not_authorized`.
3. Pagos < total → 422 `payment_insufficient`. Los dólares se aceptan en
   **efectivo, transferencia y tarjeta** (con `exchangeRate`). El cambio solo sale
   del efectivo y se entrega en córdobas; si no hay efectivo y sobra pago → 422
   `payment_exceeds_total`.
4. Variante inexistente → 422 `variant_not_found`. Una variante **inactiva**
   se acepta y la venta queda para revisión.
5. La venta **siempre se acepta** si es válida (la prenda ya se entregó):
   - **stock insuficiente: una venta hecha con conexión (`isOffline: false`) se
     rechaza con 422 `insufficient_stock`** (el saldo nunca queda negativo); solo
     una venta hecha sin conexión (`isOffline: true`) se acepta con el saldo
     negativo y `requiresReview = true`, porque la prenda ya se entregó;
   - `unitPrice` distinto del vigente, o tasa USD distinta de la vigente →
     se acepta con la nota correspondiente y `requiresReview = true`;
   - caja ya cerrada al sincronizar → se acepta y se marca para revisión.
6. Todo en una transacción: venta, líneas, pagos, movimientos de inventario,
   auditoría.

```ts
type SaleResult = {
  alreadyProcessed: boolean
  sale: Sale
}
type Sale = {
  id: string
  number: string                   // «V-000123» asignado por el servidor
  clientSaleId: string
  status: 'Confirmed' | 'Voided'
  channel: SaleChannel
  cashSessionId: string
  registerName: string
  sellerName: string
  createdAtUtc: string             // hora del equipo
  receivedAtUtc: string            // hora del servidor
  isOffline: boolean
  subtotalNio: number
  discountType: 'Percent' | 'Amount' | null
  discountValue: number | null
  discountNio: number
  totalNio: number
  changeNio: number
  requiresReview: boolean
  reviewNote: string | null
  note: string | null
  voidedAtUtc: string | null
  voidedByName: string | null
  voidReason: string | null
  lines: {
    variantId: string; productName: string; sizeName: string; colorName: string
    barcode: string; quantity: number; unitPrice: number; lineTotalNio: number
  }[]
  payments: {
    method: PaymentMethod; currency: Currency; amount: number
    exchangeRate: number | null; amountNio: number
    bank: string | null; reference: string | null
  }[]
}
```

`POST /pos/discount-approvals` — `sale.create`, con límite de intentos:
`{ username, password }` → `{ approvalId, approverName, expiresAtUtc }`
(vigente 15 min, un solo uso; la vigencia se compara con la hora de la venta).
El aprobador debe tener `sale.discount.unlimited`; si no, 403
`approver_not_allowed`; credenciales malas, **422** `invalid_credentials`
(no se usa 401 para no confundirlo con una sesión vencida). **Solo con conexión.**

`GET /cash/sessions/{id}/sales` — dueño o `cash.report.read`: `Sale[]`.

`GET /sales?from&to&sessionId&status&needsReview&number&page&pageSize` —
`sale.read`: página de `Sale`.

`GET /sales/{id}` — dueño de la caja o `sale.read`: `Sale`.

`POST /sales/{id}/void` — `sale.void`: `{ reason }` (obligatorio, ≥ 5
caracteres) → `Sale`. Devuelve el stock con movimientos de reversión. 409
`already_voided`.

`POST /sales/{id}/resolve-review` — `sale.void`: `{ note }` → `Sale`
(`requiresReview = false`).

## 5. Productos y variantes

```ts
type ProductListItem = {
  id: string; name: string
  categoryId: string; categoryName: string
  brandId: string; brandName: string
  cutId: string | null; cutName: string | null
  basePrice: number; isActive: boolean
  variantCount: number; totalStock: number; version: number
}
type Variant = {
  id: string; productId: string
  sizeId: string; sizeName: string
  colorId: string; colorName: string; colorHex: string | null
  barcode: string
  priceOverride: number | null
  price: number                    // efectivo
  stock: number
  isActive: boolean
  version: number
  cost?: number | null             // SOLO si el usuario tiene inventory.cost.read
}
type ProductDetail = ProductListItem & { variants: Variant[] }
```

- `GET /products?search&categoryId&brandId&status=active|inactive|all&page&pageSize` — `product.read`.
- `GET /products/{id}` — `product.read`.
- `POST /products` — `product.create`:
  `{ name, categoryId, brandId, cutId, basePrice, variants: [{ sizeId, colorId, barcode, priceOverride, cost, initialQuantity }] }`
  → 201 `ProductDetail`. Los productos nacen **activos**. `barcode` vacío →
  el servidor genera un EAN-13 interno que empieza en `20`. La existencia
  inicial crea movimientos `InitialStock` (requiere además
  `inventory.initial.confirm` si algún `initialQuantity` > 0). 409
  `duplicate_barcode`, `duplicate_variant` (misma talla y color).
- `PUT /products/{id}` — `product.edit`, `If-Match`:
  `{ name, categoryId, brandId, cutId, basePrice, isActive }`.
- `POST /products/{id}/variants` — `product.edit`: una variante como arriba.
- `PUT /variants/{id}` — `product.edit`, `If-Match`:
  `{ barcode, priceOverride, cost, isActive }`. `cost` solo se acepta con
  `inventory.cost.read`.
- `GET /variants/by-barcode/{barcode}` — `product.read`: `Variant` + `productName`.
- `POST /products/import` — `product.create`:
  `{ dryRun: boolean, createMissingCatalogs: boolean, rows: ImportRow[] }`

```ts
type ImportRow = {
  productName: string; category: string; brand: string; cut: string | null
  size: string; color: string; barcode: string | null
  price: number; cost: number | null; quantity: number
}
type ImportResult = {
  dryRun: boolean
  productsCreated: number; variantsCreated: number; unitsLoaded: number
  catalogsCreated: string[]        // si createMissingCatalogs
  errors: { row: number; message: string }[] // fila desde 1
}
```

Todo o nada: si hay errores no se guarda nada. Filas con el mismo
`productName + category + brand` forman un producto. Cantidades > 0 exigen
`inventory.initial.confirm`.

## 6. Inventario

- `GET /inventory/summary` — `inventory.read`:
  `{ totalUnits, totalVariants, lowStockCount, outOfStockCount, negativeCount }`.
- `GET /inventory?search&filter=all|low|out|negative&page&pageSize` — `inventory.read`:
  filas `{ variantId, productId, productName, categoryName, sizeName, colorName, barcode, price, stock }`
  (+ `cost`, `stockValue` solo con `inventory.cost.read`). `search` busca en
  nombre, marca, talla, color y código de barras.
- `GET /inventory/variants/{id}/kardex?page&pageSize` — `inventory.kardex.read`:
  `{ type, quantity, balanceAfter, reason, saleNumber, userName, createdAtUtc }`
  con `type` en `InitialStock | Entry | Adjustment | Loss | Sale | SaleVoid`.
- `POST /inventory/adjustments` — `inventory.adjust`:
  `{ variantId, kind: 'Entry'|'Adjustment'|'Loss', delta, reason }`.
  `delta` ≠ 0 y `Entry` > 0, `Loss` < 0; motivo obligatorio. El saldo no puede
  quedar negativo por un ajuste manual (422 `negative_stock`).

## 7. Auditoría

`GET /audit?entityType&userId&from&to&page&pageSize` — `audit.read`:
`{ id, occurredAtUtc, userName, action, entityType, entityId, summary }`.
Acciones registradas: `sale.confirmed`, `sale.voided`, `sale.review_resolved`,
`discount.approved`, `cash.opened`, `cash.closed`, `inventory.adjusted`,
`product.created`, `product.updated`, `product.imported`, `settings.updated`,
`user.created`, `user.updated`, `user.password_reset`.

## 8. Modo sin conexión (resumen para el POS)

- El POS descarga `PosSnapshot` y lo guarda en IndexedDB; busca y escanea
  siempre contra la copia local.
- Cada venta se guarda **primero** en una cola local (`clientSaleId`) y luego se
  envía a `POST /pos/sales`; si no hay red queda pendiente y se reintenta.
- El recibo se imprime desde los datos locales; mientras no haya número oficial
  usa la referencia corta `#` + primeros 6 caracteres del `clientSaleId`.
- No se puede cerrar la caja con ventas pendientes de envío.
- Descuentos por encima del límite requieren conexión (aprobación).

## 9. Imágenes de productos

Hasta **4 imágenes por producto**; la primera es la principal. El navegador
reduce la foto antes de subirla (máx. 1200 px, JPEG) y genera una miniatura
(320 px); el servidor guarda ambos archivos en disco (volumen del despliegue) y
valida tipo real (JPEG, PNG o WebP por firma del archivo) y tamaño.

```ts
type ProductImage = { id: string; url: string; thumbUrl: string; isPrimary: boolean; sortOrder: number }
// ProductListItem.primaryImageUrl: string | null     (miniatura de la principal)
// ProductDetail.images: ProductImage[]
// PosVariant.imageUrl: string | null                  (miniatura de la principal)
```

- `POST /products/{id}/images` — `product.images.manage`, `multipart/form-data`
  con `file` (imagen, ≤ 2 MB) y `thumb` (miniatura, ≤ 300 KB) → 201 `ProductImage`.
  Errores: 409 `image_limit` (ya hay 4), 422 `invalid_image`, 404.
- `PUT /products/{id}/images/order` — `product.images.manage`:
  `{ imageIds: string[] }` (todas las imágenes, la primera queda como principal)
  → `ProductImage[]`.
- `DELETE /products/{id}/images/{imageId}` — `product.images.manage` → 204.
- `GET /media/{fileName}` es `/api/v1/media/{fileName}` (requiere sesión). Las URL
  de las imágenes son relativas, p. ej. `/api/v1/media/3f2c….jpg` y
  `/api/v1/media/3f2c…_t.jpg`; el archivo nunca cambia para un mismo nombre, así
  que se envía con `Cache-Control: private, max-age=31536000, immutable`.

## 10. Reportes en Excel (.xlsx)

Todos son `GET`, devuelven un archivo (`Content-Disposition: attachment`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`) y usan hora
de Managua. `from` y `to` son `YYYY-MM-DD` (por defecto, hoy; máximo 366 días;
errores como JSON `problem+json` con 400).

| Endpoint | Permiso | Hojas |
|---|---|---|
| `/api/v1/reports/sales?from&to` | `sale.read` | Resumen, Ventas, Detalle (una fila por línea), Pagos |
| `/api/v1/reports/inventory` | `inventory.read` | Existencias (costo y valor solo con `inventory.cost.read`), Resumen |
| `/api/v1/reports/movements?from&to` | `inventory.kardex.read` | Movimientos (Kardex general) |
| `/api/v1/reports/cash?from&to` | `cash.report.read` | Cierres por caja, Consolidado por día, Transferencias por banco |

Aún no hay reporte de compras (no existe el módulo).
