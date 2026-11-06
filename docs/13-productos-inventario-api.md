# Módulo 1 — Contratos de API de Productos e Inventario

Estado del documento: **Borrador técnico para validación**  
Base propuesta: `/api/v1`.  
Alcance: casos de uso, rutas, solicitudes, respuestas, permisos y errores. No es
todavía una especificación OpenAPI generada ni código ejecutable.

## 1. Principios del contrato

- La API es la autoridad sobre permisos, estados, precios, costos y existencias.
- Las rutas representan casos de uso; no existe una actualización genérica de
  cualquier tabla o columna.
- Las respuestas generales de productos nunca incluyen costos.
- Las operaciones que cambian inventario requieren idempotencia.
- Las modificaciones comprueban la versión del registro para evitar sobrescribir
  cambios de otra sesión.
- Los errores utilizan una estructura uniforme y no exponen detalles internos.
- Los listados se filtran y paginan en el servidor.
- El contrato se publicará mediante OpenAPI y generará o verificará tipos para el
  frontend TypeScript.

## 2. Seguridad HTTP

### 2.1 Autenticación

- JWT de acceso en cookie `HttpOnly`.
- Cookie `Secure` en producción.
- Política `SameSite` definida según el alojamiento final.
- El token no se guarda en `localStorage`.
- La API rechaza usuarios inactivos o sesiones revocadas.

### 2.2 CSRF

Toda solicitud que cambie datos debe presentar un token CSRF válido, por ejemplo
mediante el encabezado:

```text
X-CSRF-Token: valor-entregado-por-la-aplicacion
```

El nombre definitivo y el mecanismo de emisión se documentarán al implementar la
autenticación.

### 2.3 Idempotencia

Las operaciones críticas requieren:

```text
Idempotency-Key: clave-opaca-generada-por-el-cliente
```

Reglas:

- Máximo propuesto: 100 caracteres.
- La clave se evalúa dentro de un alcance, por ejemplo `product.activate`.
- Repetir clave y contenido devuelve el resultado original.
- Repetir clave con contenido diferente devuelve conflicto.
- La clave no sustituye el control de concurrencia.

### 2.4 Concurrencia

Las respuestas de recursos editables incluyen `version` y un encabezado ETag. Las
modificaciones requieren el ETag recibido:

```text
If-Match: "17"
```

Si el registro cambió, la API responde `409 Conflict` con el código
`stale_version`. El usuario debe revisar la versión actual antes de reintentar.

## 3. Formato común de respuestas

### 3.1 Fechas y dinero

- Fechas: cadenas ISO 8601 con zona o UTC inequívoca.
- Moneda: `NIO`.
- Importes: número decimal en JSON según el contrato generado.
- La interfaz muestra `C$` y horario de Managua.

### 3.2 Lista paginada

```json
{
  "items": [],
  "page": 1,
  "pageSize": 25,
  "totalCount": 0,
  "totalPages": 0,
  "sort": "name:asc"
}
```

Reglas propuestas:

- `page` comienza en 1.
- `pageSize` predeterminado 25.
- Máximo 100.
- El servidor agrega `id` como desempate para un orden estable.

### 3.3 Error uniforme

La API utilizará `ProblemDetails` ampliado:

```json
{
  "type": "https://laganga.example/problems/duplicate-variant",
  "title": "La variante ya existe",
  "status": 409,
  "detail": "Ya existe la combinación talla 17 y color negro.",
  "instance": "/api/v1/products/PRODUCT_ID/variants",
  "code": "duplicate_variant",
  "correlationId": "CORRELATION_ID",
  "errors": {
    "variants[1].colorId": [
      "Esta talla y color repiten otra variante del producto."
    ]
  }
}
```

`correlationId` sirve para soporte. No contiene información sensible ni revela
consultas, rutas internas o trazas de servidor.

## 4. Códigos HTTP

| Código | Uso |
|---:|---|
| 200 | Consulta o comando completado |
| 201 | Recurso creado; incluye ubicación |
| 204 | Acción completada sin contenido |
| 400 | Solicitud mal formada o parámetros inválidos |
| 401 | No existe una sesión válida |
| 403 | El usuario no tiene permiso |
| 404 | Recurso inexistente o no visible para el usuario |
| 409 | Duplicado, versión obsoleta o conflicto de idempotencia |
| 422 | Regla del negocio impide procesar datos bien formados |
| 429 | Demasiadas solicitudes o intentos repetidos |
| 500 | Error inesperado con mensaje seguro |

## 5. Permisos del módulo

| Permiso | Alcance |
|---|---|
| `catalog.read` | Consultar catálogos activos |
| `catalog.manage` | Crear, editar, ordenar e inactivar catálogos |
| `product.read` | Consultar productos y variantes sin costos |
| `product.create` | Crear borradores y variantes |
| `product.edit` | Editar productos permitidos |
| `product.status.manage` | Activar o inactivar |
| `product.archive` | Archivar y restaurar según regla |
| `product.images.manage` | Cargar, ordenar y remover imágenes |
| `inventory.read` | Consultar saldos |
| `inventory.kardex.read` | Consultar movimientos |
| `inventory.cost.read` | Consultar costos y valoración |
| `inventory.initial.confirm` | Confirmar existencia inicial |
| `inventory.adjust` | Registrar ajustes |
| `inventory.adjust.authorize` | Autorizar ajustes sujetos a límite |

Los permisos se comprueban en el caso de uso. Un usuario que no puede ver costos
no recibe esos campos, aunque modifique manualmente la solicitud.

## 6. Catálogos

Se utilizarán rutas específicas para conservar contratos claros:

```text
/api/v1/catalog/categories
/api/v1/catalog/brands
/api/v1/catalog/cuts
/api/v1/catalog/size-groups
/api/v1/catalog/sizes
/api/v1/catalog/colors
```

### 6.1 Consultar

```http
GET /api/v1/catalog/colors?status=active&search=azul&page=1&pageSize=25
```

Permiso: `catalog.read`.

Respuesta resumida:

```json
{
  "items": [
    {
      "id": "COLOR_ID",
      "name": "Azul oscuro",
      "swatchHex": null,
      "isActive": true,
      "sortOrder": 30,
      "version": 1
    }
  ],
  "page": 1,
  "pageSize": 25,
  "totalCount": 1,
  "totalPages": 1,
  "sort": "sortOrder:asc,name:asc"
}
```

### 6.2 Crear

```http
POST /api/v1/catalog/colors
Idempotency-Key: CLIENT_KEY
```

```json
{
  "name": "Azul oscuro",
  "swatchHex": null,
  "sortOrder": 30
}
```

Permiso: `catalog.manage`.  
Resultado: `201 Created`.

### 6.3 Editar

```http
PUT /api/v1/catalog/colors/COLOR_ID
If-Match: "1"
```

```json
{
  "name": "Azul oscuro",
  "swatchHex": "#183B56",
  "sortOrder": 30,
  "isActive": true
}
```

Permiso: `catalog.manage`.

Las categorías agregan `parentId`; las tallas agregan `sizeGroupId`; los demás
catálogos exponen únicamente sus campos aplicables.

### 6.4 Inactivar

```http
POST /api/v1/catalog/colors/COLOR_ID/inactivate
If-Match: "2"
```

No existe eliminación general de catálogos utilizados. La respuesta explica si
existen productos históricos relacionados.

## 7. Productos

### 7.1 Listar productos

```http
GET /api/v1/products
```

Parámetros:

| Parámetro | Uso |
|---|---|
| `search` | Nombre, marca o código |
| `categoryId` | Categoría o subcategoría |
| `brandId` | Marca |
| `cutId` | Corte |
| `sizeId` | Talla de una variante |
| `colorId` | Color de la misma variante filtrada |
| `status` | DRAFT, ACTIVE, INACTIVE o ARCHIVED |
| `availability` | in_stock, out_of_stock o low_stock |
| `locationId` | Ubicación para disponibilidad |
| `page`, `pageSize` | Paginación |
| `sort` | Orden permitido |

Permiso: `product.read`.

Respuesta por elemento:

```json
{
  "id": "PRODUCT_ID",
  "name": "Pantalón Monday Palazzo talla especial",
  "brand": { "id": "BRAND_ID", "name": "Monday" },
  "category": { "id": "CATEGORY_ID", "name": "Pantalones", "path": "Dama > Pantalones" },
  "cut": { "id": "CUT_ID", "name": "Palazzo" },
  "defaultSalePrice": 730.00,
  "currency": "NIO",
  "status": "DRAFT",
  "primaryImage": null,
  "variantCount": 6,
  "availability": {
    "totalUnits": null,
    "label": "not_loaded"
  },
  "version": 3
}
```

El precio y las cantidades anteriores solo se enviarán cuando estén registrados;
los datos demostrativos no se precargan. El listado no contiene costo ni margen.

### 7.2 Obtener detalle

```http
GET /api/v1/products/PRODUCT_ID
```

Permiso: `product.read`.

Incluye:

- Datos generales.
- Variantes.
- Imágenes listas y pendientes visibles al propietario del borrador.
- Resumen de disponibilidad sin costos.
- Acciones permitidas para el usuario.
- Versión y ETag.

### 7.3 Crear borrador

```http
POST /api/v1/products
Idempotency-Key: CLIENT_KEY
```

```json
{
  "name": "Pantalón Monday Palazzo talla especial",
  "description": null,
  "internalNotes": null,
  "categoryId": "CATEGORY_ID",
  "brandId": "BRAND_ID",
  "cutId": "CUT_ID",
  "defaultSalePrice": 730.00,
  "variants": [
    {
      "clientKey": "row-1",
      "sizeId": "SIZE_15_ID",
      "colorId": "DARK_BLUE_ID",
      "salePriceOverride": null
    }
  ]
}
```

Permiso: `product.create`.  
Resultado: `201 Created`, estado DRAFT.

`clientKey` identifica la fila del formulario dentro de la respuesta de validación;
no se guarda como identidad del negocio.

### 7.4 Editar producto

```http
PUT /api/v1/products/PRODUCT_ID
If-Match: "3"
```

La solicitud contiene los campos generales editables. Un borrador puede enviar
su conjunto completo de variantes. Para un producto activo se aplican reglas más
estrictas y las variantes con historial no desaparecen.

Permiso: `product.edit`.

### 7.5 Agregar variante a producto activo

```http
POST /api/v1/products/PRODUCT_ID/variants
Idempotency-Key: CLIENT_KEY
If-Match: "5"
```

```json
{
  "sizeId": "SIZE_ID",
  "colorId": "COLOR_ID",
  "salePriceOverride": null,
  "internalCode": null,
  "barcode": null
}
```

Permisos: `product.edit`; la existencia inicial se confirma mediante el flujo de
inventario, no escribiendo una cantidad en esta ruta.

### 7.6 Editar o inactivar variante

```http
PUT /api/v1/products/PRODUCT_ID/variants/VARIANT_ID
If-Match: "2"
```

Campos editables:

- Precio diferente.
- Código interno cuando se apruebe.
- Código de barras.
- Estado activo o inactivo mediante comando explícito.

No se permite cambiar talla o color de una variante con movimientos. En ese caso
se inactiva y se crea una variante nueva.

### 7.7 Activar producto

```http
POST /api/v1/products/PRODUCT_ID/activate
Idempotency-Key: CLIENT_KEY
If-Match: "4"
```

```json
{
  "locationId": "MANAGUA_LOCATION_ID",
  "initialStock": [
    {
      "variantId": "VARIANT_ID",
      "quantity": 0,
      "unitCost": null
    }
  ]
}
```

Permisos:

- `product.status.manage`.
- `inventory.initial.confirm` cuando existen cantidades positivas.
- `inventory.cost.read` no es necesario para enviar el costo autorizado, pero el
  flujo y la pantalla deben corresponder al rol operativo aprobado.

La respuesta contiene producto activo, operación de inventario cuando exista y
ETag nuevo. Producto, saldos, movimientos, auditoría e idempotencia se confirman
en una sola transacción.

### 7.8 Inactivar, reactivar y archivar

```text
POST /api/v1/products/PRODUCT_ID/inactivate
POST /api/v1/products/PRODUCT_ID/reactivate
POST /api/v1/products/PRODUCT_ID/archive
```

Todas requieren `If-Match`; archivar requiere motivo. No existe
`DELETE /products/{id}` para productos con historial.

## 8. Imágenes

### 8.1 Solicitar carga

```http
POST /api/v1/products/PRODUCT_ID/images/upload-intents
Idempotency-Key: CLIENT_KEY
```

```json
{
  "fileName": "monday-palazzo-frente.webp",
  "contentType": "image/webp",
  "byteSize": 245000,
  "position": 1
}
```

Permiso: `product.images.manage`.

Respuesta:

```json
{
  "imageId": "IMAGE_ID",
  "status": "PENDING",
  "upload": {
    "method": "POST",
    "url": "SIGNED_PROVIDER_URL",
    "fields": {}
  },
  "expiresAt": "2026-11-06T18:00:00Z"
}
```

La URL es temporal. Nunca incluye una clave privada persistente.

### 8.2 Confirmar carga

```http
POST /api/v1/products/PRODUCT_ID/images/IMAGE_ID/confirm
Idempotency-Key: CLIENT_KEY
```

La API verifica existencia, propiedad, tipo, tamaño y dimensiones en el
proveedor. Solo después cambia la imagen a READY.

### 8.3 Reordenar

```http
PUT /api/v1/products/PRODUCT_ID/images/order
If-Match: "PRODUCT_VERSION"
```

```json
{
  "imageIds": ["IMAGE_2", "IMAGE_1", "IMAGE_3"]
}
```

### 8.4 Remover

```http
DELETE /api/v1/products/PRODUCT_ID/images/IMAGE_ID
If-Match: "PRODUCT_VERSION"
```

La respuesta `204` significa que dejó de mostrarse. La limpieza física puede
ocurrir después de manera segura.

## 9. Inventario

### 9.1 Consultar saldos

```http
GET /api/v1/inventory/balances
```

Filtros:

- `search`.
- `productId`.
- `variantId`.
- `locationId`.
- `sizeId`.
- `colorId`.
- `availability`.
- `page`, `pageSize`, `sort`.

Permiso: `inventory.read`.

Elemento sin costos:

```json
{
  "productId": "PRODUCT_ID",
  "productName": "Pantalón Monday Palazzo talla especial",
  "variantId": "VARIANT_ID",
  "size": { "id": "SIZE_ID", "name": "15" },
  "color": { "id": "COLOR_ID", "name": "Azul oscuro" },
  "location": { "id": "LOCATION_ID", "name": "Tienda Managua" },
  "quantityOnHand": 0,
  "minimumQuantity": null,
  "variantStatus": "ACTIVE",
  "version": 1
}
```

### 9.2 Consultar valoración

```http
GET /api/v1/inventory/valuation?locationId=LOCATION_ID&page=1&pageSize=25
```

Permiso exclusivo: `inventory.cost.read`.

Esta ruta puede incluir costo promedio y valor de inventario. No existe un
parámetro en el listado general que permita eludir este permiso.

### 9.3 Consultar Kardex

```http
GET /api/v1/inventory/variants/VARIANT_ID/movements
```

Parámetros:

- `locationId` obligatorio cuando exista más de una ubicación.
- `from`, `to`.
- `operationType`.
- `reference`.
- `page`, `pageSize`.

Permiso: `inventory.kardex.read`.

Respuesta por movimiento:

```json
{
  "movementId": "MOVEMENT_ID",
  "operationId": "OPERATION_ID",
  "operationNumber": "AJU-MGA-000001",
  "operationType": "ADJUSTMENT",
  "occurredAt": "2026-11-06T15:30:00Z",
  "quantityIn": 1,
  "quantityOut": 0,
  "balanceAfter": 4,
  "reason": "Corrección de conteo",
  "performedBy": { "id": "USER_ID", "name": "Usuario autorizado" }
}
```

Los valores son ejemplos estructurales, no movimientos reales.

### 9.4 Registrar ajuste

```http
POST /api/v1/inventory/adjustments
Idempotency-Key: CLIENT_KEY
```

```json
{
  "variantId": "VARIANT_ID",
  "locationId": "LOCATION_ID",
  "direction": "IN",
  "quantity": 1,
  "reasonCode": "COUNT_CORRECTION",
  "notes": "Diferencia encontrada en conteo",
  "expectedBalanceVersion": 3
}
```

Permiso: `inventory.adjust`; puede requerir `inventory.adjust.authorize` según el
límite que se apruebe.

Respuesta:

```json
{
  "operationId": "OPERATION_ID",
  "operationNumber": "AJU-MGA-000001",
  "variantId": "VARIANT_ID",
  "locationId": "LOCATION_ID",
  "previousQuantity": 3,
  "quantityDelta": 1,
  "quantityOnHand": 4,
  "balanceVersion": 4,
  "confirmedAt": "2026-11-06T15:30:00Z"
}
```

Una salida que excede la existencia devuelve `422` con el código
`insufficient_stock` y la cantidad disponible autorizada para mostrar.

### 9.5 Consultar operación

```http
GET /api/v1/inventory/operations/OPERATION_ID
```

Permiso: `inventory.kardex.read`. Devuelve encabezado, líneas y reversión
relacionada. Los costos se omiten si falta `inventory.cost.read`.

## 10. Errores del dominio

| Código | HTTP | Significado |
|---|---:|---|
| `validation_failed` | 400 | Campos o parámetros inválidos |
| `duplicate_catalog_value` | 409 | Valor de catálogo repetido |
| `duplicate_variant` | 409 | Misma talla y color en el producto |
| `duplicate_code` | 409 | Código interno o de barras repetido |
| `stale_version` | 409 | Otra sesión modificó el registro |
| `idempotency_conflict` | 409 | Misma clave con otro contenido |
| `product_not_ready` | 422 | Faltan datos para activar |
| `image_not_ready` | 422 | Carga no confirmada |
| `image_limit_reached` | 422 | Se intentó superar cuatro imágenes |
| `invalid_state_transition` | 422 | Cambio de estado no permitido |
| `initial_cost_required` | 422 | Unidades positivas sin costo válido |
| `insufficient_stock` | 422 | Una salida dejaría saldo negativo |
| `adjustment_reason_required` | 422 | Ajuste sin motivo |
| `permission_denied` | 403 | Falta permiso del servidor |

Los mensajes se localizarán para el usuario; el frontend decidirá la ubicación
visual utilizando `code` y `errors`, no comparando textos completos.

## 11. Reglas de filtrado

Cuando `sizeId` y `colorId` se envían juntos, la consulta exige una misma variante:

```text
EXISTS variant
WHERE variant.product_id = product.id
  AND variant.size_id = sizeId
  AND variant.color_id = colorId
```

No se aplican dos búsquedas independientes que puedan coincidir con variantes
distintas del mismo producto.

## 12. OpenAPI

La especificación publicada debe incluir:

- Esquemas de solicitudes y respuestas.
- Campos obligatorios, límites y formatos.
- Enumeraciones.
- Permisos requeridos por operación en descripción o extensión documentada.
- Ejemplos sin datos reales.
- Todos los errores esperados.
- Encabezados ETag, `If-Match`, CSRF e idempotencia.
- Paginación y orden permitidos.

El frontend utilizará un cliente generado o tipos verificados automáticamente.
Una diferencia incompatible entre API y frontend debe fallar durante integración
continua.

## 13. Pruebas de contrato y autorización

1. El OpenAPI generado es válido y no cambia accidentalmente.
2. Un vendedor consulta productos sin recibir costos.
3. Solicitar valoración sin permiso devuelve 403 y ningún dato parcial.
4. Crear variante duplicada devuelve 409 con error de campo.
5. Actualizar con ETag anterior devuelve `stale_version`.
6. Repetir activación con igual idempotencia devuelve el resultado original.
7. Reutilizar clave con otro contenido devuelve `idempotency_conflict`.
8. Una activación inválida no deja movimientos parciales.
9. Dos ajustes concurrentes conservan un saldo correcto.
10. Una salida mayor que la existencia devuelve `insufficient_stock`.
11. Talla y color se aplican sobre la misma variante.
12. Las trazas internas nunca aparecen en ProblemDetails de producción.

## 14. Decisiones abiertas del contrato

| ID | Decisión | Propuesta actual |
|---|---|---|
| DEC-057 | ETag y versión | ETag para HTTP y `version` visible en DTO |
| DEC-058 | Paginación inicial | Página y tamaño; evaluar cursor si el volumen lo exige |
| DEC-059 | Duración de idempotencia | Definir antes de implementación |
| DEC-060 | Nombres finales de permisos | Conservar permisos granulares por capacidad |
| DEC-061 | Límite de ajuste | Definir cantidad o valor que requiere autorización |
| DEC-062 | Carga directa de imágenes | Usar URL firmada del proveedor elegido |
| DEC-063 | Exposición de acciones permitidas | Incluir lista informativa; el servidor siempre revalida |
| DEC-064 | Ruta de valoración | Separada del inventario general para proteger costos |

## 15. Criterios de cierre

El contrato estará listo para implementación cuando:

- Las operaciones OpenAPI representen todos los casos de uso aprobados.
- Los DTO no expongan entidades de base de datos directamente.
- Cada ruta tenga permiso, errores y pruebas definidos.
- Se confirmen las decisiones que afectan autenticación e imágenes.
- Los ejemplos no contengan datos reales ni secretos.
- Frontend y backend puedan generar tipos compatibles.

## 16. Próximo bloque

Las decisiones y tareas se consolidan en
[Decisiones y backlog técnico](14-productos-inventario-decisiones-backlog.md).
No se crearán la API, la interfaz ni las migraciones hasta recibir autorización
para programar y aprobar las decisiones aplicables.
