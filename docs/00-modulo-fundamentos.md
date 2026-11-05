# Modulo 0 - Fundamentos de La Ganga ERP

Estado del documento: **Borrador para validacion del negocio**  
Regla de trabajo: una propuesta o decision pendiente no autoriza su
implementacion.

## 1. Objetivo del producto

La Ganga ERP administrara la tienda fisica de Managua y apoyara las ventas por
WhatsApp, Facebook e Instagram. La misma informacion del producto se reutilizara
en inventario, ventas, compras, devoluciones, catalogo y reportes.

El primer lanzamiento debe permitir:

1. Registrar productos y sus variantes de talla y color.
2. Conocer las existencias reales de cada variante.
3. Registrar una venta y descontar solamente las variantes vendidas.
4. Registrar el dinero cobrado y los saldos pendientes aprobados.
5. Consultar el historial basico del cliente.

## 2. Alcance y limites iniciales

### Confirmado

- Local fisico en Managua.
- Productos con variantes independientes por talla y color.
- Catalogos editables de tallas, colores, marcas, categorias y cortes.
- `XL` y `1XL` son valores diferentes.
- Cada producto recibe solo las tallas y colores que realmente ofrece.
- Interfaz adaptable a computadora, tableta y celular.
- Los permisos se validan en el servidor.
- Los datos demostrativos no se cargan como inventario real.
- Identidad visual basada en el logo proporcionado: azul marino, naranja
  terracota, amarillo mostaza y fondo crema.

### Fuera del primer lanzamiento

- Contabilidad formal.
- Nomina.
- Facturacion fiscal electronica.
- Campanas o mensajes automaticos de WhatsApp.
- Escaneo de facturas mediante inteligencia artificial.
- Aplicacion movil nativa.

Estas funciones pueden evaluarse como ampliaciones posteriores.

## 3. Principios obligatorios

- La base de datos es la fuente oficial del inventario y los saldos.
- No se permiten existencias negativas en una venta normal.
- Una operacion confirmada se anula con motivo y movimientos de reversion; no se
  elimina silenciosamente.
- Ventas, pagos y movimientos relacionados se guardan atomicamente cuando
  corresponda.
- Los reintentos y dobles clics no pueden duplicar operaciones.
- El servidor revalida permisos, precios y existencias.
- Los costos y margenes no se exponen a usuarios sin autorizacion.
- Toda accion sensible registra usuario, fecha, motivo y referencia.
- El sistema distingue claramente borradores de registros guardados.
- Los errores orientan al usuario sin revelar detalles internos.
- Las copias de respaldo solo se consideran validas despues de probar su
  restauracion.

## 4. Modelo de acceso

### 4.1 Usuarios

Cada persona debe usar una cuenta individual. No se compartiran cuentas entre
vendedores. Un usuario tendra como minimo:

- Nombre visible.
- Nombre de usuario o identificador de acceso.
- Estado activo o inactivo.
- Uno o mas roles.
- Registro de ultimo acceso y eventos de seguridad relevantes.

Las contrasenas se almacenaran mediante un algoritmo de hash seguro. Un usuario
inactivo no podra iniciar una sesion nueva.

### 4.2 Roles y permisos

Un **rol** es una plantilla de trabajo. Un **permiso** es la autorizacion concreta
que el servidor comprueba. La interfaz puede ocultar acciones no autorizadas,
pero esto no sustituye la validacion de la API.

Roles iniciales propuestos:

1. Propietario o administrador.
2. Vendedor o cajero.
3. Encargado de inventario.
4. Repartidor.

Todos estos roles, excepto el propietario o administrador requerido para iniciar
el sistema, permanecen como propuesta hasta confirmar la operacion real de la
tienda.

## 5. Matriz inicial de permisos

Leyenda:

- **Si**: incluido en el rol propuesto.
- **Limitado**: requiere una regla adicional o solo permite informacion asignada.
- **No**: no se concede al rol.
- **Pendiente**: depende de una decision del negocio.

| Accion | Administrador | Vendedor / cajero | Inventario | Repartidor |
|---|---:|---:|---:|---:|
| Iniciar sesion | Si | Si | Si | Si |
| Consultar productos y disponibilidad | Si | Si | Si | Limitado |
| Consultar costos y margenes | Si | No | Limitado | No |
| Crear o editar productos | Si | No | Si | No |
| Registrar existencia inicial | Si | No | Si | No |
| Registrar ajustes de inventario | Si | No | Limitado | No |
| Crear y confirmar ventas | Si | Si | No | No |
| Aplicar descuentos | Si | Limitado | No | No |
| Consultar y registrar clientes | Si | Si | No | Limitado |
| Consultar historial completo del cliente | Si | Limitado | No | No |
| Registrar abonos | Si | Pendiente | No | No |
| Abrir o cerrar caja | Si | Pendiente | No | No |
| Registrar compras | Si | No | Limitado | No |
| Consultar reportes financieros | Si | No | No | No |
| Administrar usuarios y permisos | Si | No | No | No |
| Consultar entregas asignadas | Si | No | No | Si |
| Ver telefono, direccion y monto de una entrega | Si | No | No | Limitado |
| Marcar una entrega asignada | Si | No | No | Si |
| Anular documentos confirmados | Si | No | No | No |

### 5.1 Reglas de privacidad para repartidores

El repartidor solo debe acceder a los datos necesarios para completar sus
entregas asignadas: nombre, telefono, direccion, referencia, ubicacion y monto a
cobrar. No debe ver el historial completo del cliente, costos, margenes ni otras
entregas.

### 5.2 Descuentos

**Propuesta pendiente:**

- El administrador puede aplicar descuentos sin un limite comercial fijo, pero
  debe quedar registrada la accion.
- El vendedor tiene un porcentaje maximo configurable.
- Un descuento superior requiere autorizacion administrativa y motivo.
- El servidor calcula y valida el descuento; no acepta como definitivo el total
  enviado por la interfaz.

## 6. Criterios de aceptacion del acceso y permisos

1. Un vendedor que solicita costos directamente a la API recibe una respuesta de
   acceso denegado y no recibe datos sensibles.
2. Desactivar un usuario impide nuevos accesos sin borrar su historial.
3. Una accion realizada queda asociada a la cuenta individual que la ejecuto.
4. Cambiar un permiso afecta las solicitudes posteriores del usuario.
5. Ocultar un boton no es la unica proteccion: la API rechaza la operacion.
6. Un repartidor no puede consultar entregas ajenas modificando una direccion o
   identificador de la solicitud.
7. Los mensajes de acceso denegado no revelan configuracion interna ni datos que
   el usuario no puede consultar.

## 7. Datos de productos conocidos

Los siguientes son catalogos iniciales editables, no variantes automaticas.

- Tallas dama normal: 3, 5, 7, 9, 11, 13.
- Tallas dama especial: 15, 17, 19, 21, 23, 25.
- Tallas caballero: 30, 32, 34, 36, 38, 40, 42, 44.
- Tallas juvenil: 10, 12, 14, 16.
- Tallas de camisas: S, M, L, XL, 1XL, 2XL, 3XL.
- Colores iniciales: negro, azul, azul oscuro, azul claro, celeste, petroleo,
  caqui, beige, cafe y gris.
- Categorias principales: dama, caballero, juvenil y ninos.
- Subcategorias iniciales: pantalones, camisas y blusas.
- Cortes iniciales: Straight Fit/recto, Skinny/tubo, Flare/campana, Wide Leg,
  Palazzo, Mom Jeans, Slim y Baggy.

Producto de referencia: `Pantalon Monday Palazzo talla especial`. Su costo,
precio vigente y existencias reales continuan pendientes. El costo C$550 y las
cantidades de la demostracion no son datos reales.

## 8. Registro de decisiones abiertas

| ID | Decision | Estado | Propuesta actual |
|---|---|---|---|
| DEC-001 | Cantidad inicial de usuarios | Pendiente | Administrador y cuentas individuales por vendedor |
| DEC-002 | Cantidad inicial de cajas | Pendiente | Una caja, con soporte futuro para varias |
| DEC-003 | Ubicaciones de inventario | Pendiente | Tienda Managua; confirmar casa o bodega |
| DEC-004 | Metodos de pago | Pendiente | Efectivo, transferencia, tarjeta y combinados |
| DEC-005 | Ventas a credito en tienda | Pendiente | Habilitarlas con cuenta por cobrar |
| DEC-006 | Limite de descuento para vendedores | Pendiente | Porcentaje configurable |
| DEC-007 | Codigos por variante | Pendiente | Codigo interno unico y codigo de barras opcional |
| DEC-008 | Metodo de valoracion del inventario | Pendiente | Costo promedio ponderado por variante |
| DEC-009 | Acceso del vendedor a registrar abonos | Pendiente | Concederlo mediante permiso especifico |
| DEC-010 | Acceso del vendedor a apertura y cierre | Pendiente | Concederlo al cajero responsable de la sesion |

## 9. Siguiente bloque del Modulo 0

Despues de validar roles y permisos se definiran:

1. Estados de producto, venta, pago, pedido y entrega.
2. Diferencia entre borrador, confirmacion, anulacion y reversion.
3. Numeracion y trazabilidad de documentos.
4. Reglas de sesiones, caja y autorizaciones administrativas.

