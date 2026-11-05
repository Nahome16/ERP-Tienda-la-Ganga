# Módulo 0 — Estados y transiciones

Estado del documento: **Borrador para validación del negocio**  
Este documento define el significado de los estados. No autoriza la
implementación de decisiones marcadas como **Pendiente**.

## 1. Objetivo

Evitar que un mismo campo intente representar situaciones diferentes. El ERP
debe separar, como mínimo:

- Estado del documento comercial.
- Estado del pago.
- Estado de la entrega.
- Disponibilidad de inventario.

Ejemplos válidos:

- Venta confirmada, pagada y pendiente de entrega.
- Venta confirmada, parcialmente pagada y entregada.
- Pedido confirmado, todavía no convertido en venta y sin pago.

## 2. Reglas generales

1. Los estados solo cambian mediante transiciones autorizadas por el servidor.
2. Cada transición registra usuario, fecha, estado anterior, estado nuevo y,
   cuando corresponda, motivo.
3. Un documento confirmado no se elimina ni se vuelve a editar como si fuera un
   borrador.
4. Una anulación exige permiso y motivo, y genera las reversiones necesarias.
5. La interfaz no calcula el estado definitivo: lo devuelve la API.
6. Los reintentos de una transición deben ser idempotentes.
7. Los estados derivados, como el estado de pago, se calculan usando registros
   confirmados; no se modifican manualmente.

## 3. Producto y variante

### 3.1 Estado del producto

| Estado | Significado | Puede venderse | Aparece en catálogo |
|---|---|---:|---:|
| Borrador | Registro incompleto que todavía no forma parte de la operación | No | No |
| Activo | Producto disponible para utilizar en el ERP | Sí, si existe una variante activa con unidades | Sí, según configuración |
| Inactivo | Producto suspendido temporalmente | No | No |
| Archivado | Producto retirado de uso habitual, conservado por su historial | No | No |

Transiciones propuestas:

```text
Borrador → Activo
Borrador → Archivado
Activo ↔ Inactivo
Inactivo → Archivado
Archivado → Inactivo  (solo con permiso administrativo)
```

Reglas:

- `Agotado` no es un estado del producto. Es una condición calculada a partir de
  las existencias.
- Archivar no borra ventas, movimientos ni imágenes históricas.
- Un producto no puede activarse sin nombre, categoría, precio válido y al menos
  una variante activa.

### 3.2 Estado de la variante

Una variante puede estar **Activa** o **Inactiva**. La variante representa una
combinación única de producto, talla y color.

- Una variante inactiva conserva existencias e historial, pero no puede venderse.
- Una variante con cero unidades puede continuar activa para recepción futura o
  para mostrarse como agotada, según la configuración del catálogo.
- No se permite crear dos variantes con la misma combinación dentro del producto.

## 4. Venta

### 4.1 Estado documental

| Estado | Significado | Afecta inventario | Afecta ventas |
|---|---|---:|---:|
| Borrador | Carrito o captura todavía editable | No | No |
| Confirmada | Venta aceptada y registrada completamente | Sí | Sí |
| Anulada | Venta confirmada posteriormente revertida con motivo | Reversión | Resta o separa la venta anulada en reportes |

Transiciones permitidas:

```text
Borrador → Confirmada
Borrador → Descartada (el borrador deja de utilizarse)
Confirmada → Anulada
```

`Descartada` puede ser una condición de borrador y no necesita convertirse en un
documento comercial numerado.

### 4.2 Confirmación atómica

Confirmar una venta debe realizar, en una sola transacción:

1. Revalidar permisos, precios, descuentos y existencia.
2. Asignar el número definitivo de venta.
3. Guardar los artículos con sus precios, descuentos y costos históricos.
4. Crear los movimientos de salida de inventario.
5. Registrar los pagos recibidos en ese momento.
6. Crear la cuenta por cobrar si queda un saldo permitido.
7. Registrar la auditoría.

Si una parte falla, ninguna de estas acciones queda confirmada.

### 4.3 Anulación

Anular una venta no modifica ni elimina sus detalles originales. Debe:

- Registrar usuario, fecha y motivo.
- Crear movimientos de inventario inversos cuando la mercadería regresa.
- Revertir o relacionar los efectos financieros correspondientes.
- Mantener visible el documento original y la anulación.

Una devolución parcial no es una anulación total; se manejará mediante un
documento de devolución vinculado a la venta original.

## 5. Estado de pago

El estado de pago se calcula comparando el total exigible con los pagos
confirmados y las devoluciones o reversiones aplicables.

| Estado | Regla |
|---|---|
| Pendiente | No existe dinero confirmado y queda saldo por cobrar |
| Parcial | Se recibió una parte y todavía existe saldo |
| Pagada | El saldo es cero |
| Reembolsada | El importe cobrado fue devuelto completamente |
| Reembolso parcial | Se devolvió parte del importe cobrado |

Reglas:

- Registrar un abono no crea una venta nueva.
- Un pago tiene fecha, método, importe, responsable y referencia opcional.
- Un pago confirmado no se elimina; se anula o revierte con motivo.
- No se permitirá un pago superior al saldo sin una regla explícita para anticipos
  o cambio. Esa regla continúa pendiente.

### 5.1 Estado del registro de pago

Estados mínimos propuestos:

- **Confirmado:** dinero aceptado y contabilizado como cobro.
- **Anulado:** registro revertido con autorización y motivo.

**Pendiente:** confirmar si las transferencias necesitan un estado de verificación
antes de contarse como dinero cobrado.

## 6. Pedido

Un pedido representa una solicitud comercial previa a la venta confirmada.

| Estado | Significado |
|---|---|
| Borrador | Selección todavía editable y no enviada |
| Pendiente de confirmación | Pedido recibido, pero aún no aceptado por la tienda |
| Confirmado | La tienda aceptó cantidades, precios y condiciones |
| Convertido en venta | El pedido produjo una venta confirmada |
| Cancelado | El pedido no continuará; conserva el motivo |

Transiciones propuestas:

```text
Borrador → Pendiente de confirmación
Pendiente de confirmación → Confirmado
Pendiente de confirmación → Cancelado
Confirmado → Convertido en venta
Confirmado → Cancelado
```

Reglas:

- Agregar al carrito o crear un borrador no descuenta inventario.
- Convertir el pedido en venta utiliza el mismo proceso atómico del POS.
- La confirmación de un pedido no reservará inventario hasta que se apruebe una
  política de reservas y vencimiento.

## 7. Entrega

El estado de entrega es independiente del pago y del pedido o venta.

| Estado | Significado |
|---|---|
| Pendiente de asignación | La entrega está creada, pero no tiene repartidor |
| Asignada | Tiene un repartidor responsable |
| En ruta | La mercadería salió para entrega |
| Entregada | El cliente recibió la mercadería |
| No entregada | El intento falló y requiere seguimiento |
| Devuelta | La mercadería enviada regresó a la tienda |
| Cancelada | La entrega ya no debe realizarse |

Transiciones propuestas:

```text
Pendiente de asignación → Asignada
Asignada → En ruta
Asignada → Cancelada
En ruta → Entregada
En ruta → No entregada
En ruta → Devuelta
No entregada → Asignada
No entregada → Cancelada
```

Reglas:

- Marcar `Entregada` no marca automáticamente la venta como pagada.
- Registrar un cobro contra entrega crea un pago separado.
- Una entrega puede registrar intentos, evidencias y observaciones sin borrar el
  historial anterior.
- Las prendas enviadas para prueba de talla deben quedar identificadas hasta
  determinar cuáles fueron vendidas y cuáles regresaron.

## 8. Inventario y movimientos

Las existencias son el resultado de movimientos confirmados. Un movimiento no se
edita ni se elimina después de afectar inventario.

Tipos iniciales:

- Existencia inicial.
- Compra o recepción.
- Venta.
- Devolución de cliente.
- Devolución a proveedor.
- Ajuste positivo.
- Ajuste negativo.
- Traslado entre ubicaciones.
- Reversión.

Cada movimiento conserva variante, ubicación, cantidad con dirección de entrada
o salida, motivo, documento de referencia, usuario y fecha.

## 9. Fechas relevantes

Los documentos conservarán fechas distintas cuando corresponda:

- Creación.
- Última modificación del borrador.
- Confirmación.
- Anulación o cancelación.
- Pago.
- Entrega.

No se debe usar una sola fecha para representar todos estos eventos. Las fechas
se almacenarán de forma consistente y se mostrarán con el horario de Managua.

## 10. Criterios de aceptación

1. Agregar una prenda al carrito no cambia las existencias.
2. Confirmar una venta cambia inventario y venta en una sola operación.
3. Reintentar la confirmación no genera una segunda venta.
4. Una venta pagada puede continuar pendiente de entrega.
5. Una venta entregada puede conservar saldo pendiente si el crédito está
   autorizado.
6. Un abono cambia el saldo y los cobros, pero no aumenta las ventas.
7. Anular una venta conserva el documento y crea las reversiones trazables.
8. Un producto agotado no cambia automáticamente a inactivo.
9. Un usuario no puede forzar una transición modificando la solicitud a la API.
10. El historial muestra quién realizó cada transición y cuándo.

## 11. Decisiones abiertas de este bloque

| ID | Decisión | Propuesta |
|---|---|---|
| DEC-011 | Reserva de inventario en pedidos | No reservar hasta definir inicio y vencimiento |
| DEC-012 | Transferencias pendientes de verificación | Añadir estado pendiente solo si la operación real lo requiere |
| DEC-013 | Pagos superiores al saldo | Rechazarlos salvo que se habiliten anticipos |
| DEC-014 | Pruebas de talla | Crear control específico de prendas enviadas, vendidas y devueltas |
| DEC-015 | Política de devoluciones | Definir plazo, condición de prenda y tratamiento del dinero |
| DEC-016 | Quién puede anular ventas | Administrador inicialmente; autorizaciones adicionales por confirmar |

## 12. Próximo bloque

La numeración, auditoría y estructura conceptual se encuentran en
[Documentos, auditoría y modelo de datos](02-documentos-auditoria-modelo-datos.md).
El siguiente bloque definirá arquitectura, ambientes y estrategia de pruebas.
