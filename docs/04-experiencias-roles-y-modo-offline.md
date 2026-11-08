# Experiencias por rol y continuidad del punto de venta

Estado del documento: **Requisitos confirmados y decisiones offline pendientes**
Fecha de actualización: 8 de noviembre de 2026.

## 1. Objetivo

La Ganga ERP tendrá un único inicio de sesión, pero dos experiencias claramente
separadas. La API determinará las capacidades de la cuenta y la interfaz abrirá
el espacio correspondiente sin depender únicamente de ocultar botones.

## 2. Experiencia administrativa

Después de iniciar sesión, el administrador accede a `/admin`. Su navegación
principal tendrá estos módulos:

| Módulo visible | Responsabilidad dentro del sistema |
|---|---|
| Ventas | Resumen comercial, indicadores, devoluciones y operaciones que requieren seguimiento |
| Punto de venta | Acceso al mismo flujo de cobro utilizado por el vendedor |
| Caja | Aperturas, cierres, ingresos, egresos, dinero esperado y diferencias |
| Historial de ventas | Búsqueda de comprobantes, detalle, reimpresión, anulaciones y devoluciones autorizadas |
| Delivery | Entregas, asignaciones, motorizados, rutas, montos por cobrar y comprobantes |
| Pedidos | Pedidos de tienda y canales digitales, estados de preparación, pago y entrega |
| Clientes | CRM, contactos, direcciones, compras, preferencias, abonos y saldos |
| Compras | Proveedores, recepción de mercadería, costos y cuentas por pagar habilitadas |
| Inventario | Productos, variantes, imágenes, existencias, movimientos, Kardex, ajustes y catálogos relacionados |

Para conservar esta navegación, productos, tallas, colores, marcas, categorías y
cortes se administrarán dentro de **Inventario**. Usuarios, permisos,
configuración y respaldos podrán ubicarse en un menú administrativo secundario,
sin competir con los módulos operativos principales.

La apariencia definitiva del panel queda pendiente de la referencia visual que
proporcionará la propietaria. La visualización actual no se considera diseño
aprobado.

## 3. Experiencia del vendedor

Después de iniciar sesión, una cuenta con rol vendedor accede directamente a
`/pos`. No verá el panel administrativo ni su navegación.

El espacio del vendedor incluirá únicamente lo necesario para vender:

1. Estado de su caja o turno, mostrado dentro del POS.
2. Escaneo prioritario por código de barras y búsqueda manual alternativa por
   nombre, código, marca, talla, color y corte.
3. Selección exacta de variante y consulta de disponibilidad.
4. Carrito, cantidades y descuentos permitidos.
5. Selección o registro mínimo del cliente cuando corresponda.
6. Método de pago, monto recibido, cambio y saldo autorizado.
7. Confirmación, comprobante y nueva venta.
8. Estado de conexión y de sincronización visible en todo momento.

Aunque el administrador y el vendedor utilicen el mismo componente de punto de
venta, la API validará los permisos en cada operación. Escribir manualmente una
ruta administrativa no permitirá al vendedor consultar costos, reportes,
compras, ajustes u otras funciones protegidas.

## 4. Inicio de sesión y enrutamiento

El flujo será:

```text
Inicio de sesión
  ↓
API valida cuenta, estado, sesión, roles y permisos
  ├─ Administrador → /admin
  └─ Vendedor      → /pos
```

Una cuenta individual puede tener varios permisos, pero el primer lanzamiento
utilizará una experiencia principal por cuenta para evitar una interfaz ambigua.
Un administrador podrá abrir el Punto de venta desde su propio panel.

## 5. Alcance offline recomendado

El funcionamiento sin conexión se limitará al POS. El panel administrativo
requiere conexión para modificar datos oficiales.

### 5.1 Etapa offline A — continuidad de la interfaz

Primera entrega recomendada:

- Instalar la interfaz como PWA.
- Conservar de forma local el armazón del POS y un catálogo sincronizado.
- Conservar el índice `código de barras → variante` necesario para escanear sin
  conexión.
- Recuperar un carrito o borrador después de un corte de red o cierre accidental.
- Mostrar cuándo se realizó la última sincronización.
- Permitir búsquedas y preparación del carrito sin conexión.
- No confirmar todavía una venta offline.

Esta etapa mejora la continuidad sin introducir riesgo de vender existencias que
otra caja ya utilizó.

### 5.2 Etapa offline B — venta controlada sin red

Para confirmar ventas sin conexión se recomienda asignar previamente a cada
terminal una **cuota offline por variante**. El equipo solo podrá vender hasta esa
cuota mientras esté desconectado.

Cada operación offline tendrá:

- Identificador único generado en el equipo.
- Terminal, usuario, caja y secuencia local.
- Fecha local y fecha de recepción del servidor.
- Artículos, variantes, cantidades, precios y pagos usados.
- Estado `Pendiente de sincronizar`, `Sincronizando`, `Aceptada` o `Requiere revisión`.
- Reintentos idempotentes para que una venta no se duplique.

La cola se guardará en IndexedDB; no en `localStorage`. Se conservarán únicamente
los datos necesarios, se limpiarán al cerrar sesión cuando sea seguro y nunca se
guardarán contraseñas, cookies de sesión o datos completos de tarjetas.

### 5.3 Pagos durante una caída

- **Efectivo:** puede registrarse offline dentro de la cuota autorizada.
- **Transferencia:** queda pendiente de verificación hasta recuperar conexión,
  salvo que el negocio defina otro procedimiento.
- **Tarjeta:** no se declarará aprobada sin respuesta del proveedor del cobro.
- **Crédito:** requiere una regla específica y datos del cliente disponibles; no
  se habilita offline por defecto.

## 6. Sincronización

Cuando vuelve la conexión:

1. El POS autentica nuevamente la sesión si venció.
2. Envía la cola en orden con sus identificadores únicos.
3. La API reconoce reintentos y no duplica ventas.
4. La API valida terminal, cuota, usuario, precios y permisos.
5. Una venta aceptada genera venta, pago, caja e inventario en una transacción.
6. Un conflicto queda visible para revisión administrativa; nunca se oculta.
7. El POS actualiza catálogo, precios, existencias y cuota disponible.

## 7. Decisiones pendientes antes de programar ventas offline

| ID | Decisión | Recomendación |
|---|---|---|
| OFF-001 | Nivel inicial | Implementar Etapa A antes que ventas offline completas |
| OFF-002 | Inventario offline | Cuota reservada por terminal y variante |
| OFF-003 | Medios de pago | Efectivo permitido; transferencia pendiente; tarjeta requiere confirmación externa |
| OFF-004 | Duración máxima sin sincronizar | Definir con la operación real; propuesta inicial de un turno |
| OFF-005 | Cantidad de terminales POS | Confirmar antes de calcular cuotas |
| OFF-006 | Ventas a crédito offline | No habilitar inicialmente |
| OFF-007 | Resolución de conflictos | Revisión administrativa con trazabilidad y sin borrar la operación local |

## 8. Criterios de aceptación

1. El administrador entra al panel administrativo después del login.
2. El vendedor entra directamente al POS y no recibe datos administrativos.
3. El administrador puede abrir el POS desde su panel.
4. El vendedor recibe 403 al solicitar directamente una función sin permiso.
5. El POS muestra claramente conexión, última sincronización y operaciones
   pendientes.
6. Recargar o cerrar el navegador no pierde el carrito recuperable.
7. Un reintento de sincronización no duplica una venta.
8. Ninguna venta offline supera la cuota autorizada para su variante.
9. El panel administrativo no confirma operaciones cuando no puede validar la
   información oficial del servidor.
