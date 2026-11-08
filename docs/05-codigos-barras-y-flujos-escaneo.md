# Códigos de barras y flujos de escaneo

Estado del documento: **Requisito confirmado**

## 1. Objetivo

El código de barras será el acceso rápido a una variante exacta en el Punto de
venta y en los flujos de inventario. No identificará solamente al producto
general: debe resolver la combinación correcta de producto, talla y color.

Ejemplo:

```text
Código escaneado
  ↓
Monday Palazzo / Azul oscuro / Talla 17
```

## 2. Equipos compatibles

La primera versión priorizará lectores USB o Bluetooth que funcionen como
teclado y finalicen la lectura con `Enter`. Esto evita depender de controladores
especiales y permite utilizarlos en computadora o tableta compatible.

El escaneo mediante cámara de celular puede agregarse posteriormente. No será
necesario para cerrar la primera versión del POS.

## 3. Reglas del código

- El código se guarda como texto para conservar ceros iniciales.
- Se eliminan espacios accidentales al inicio y al final.
- La comparación exacta no distingue mayúsculas y minúsculas cuando existan
  letras.
- Un código activo identifica una sola variante en todo el sistema.
- No puede asignarse el mismo código a dos variantes.
- El código del fabricante puede registrarse al recibir la prenda.
- Si una prenda no trae código, el sistema podrá generar un código interno e
  imprimir una etiqueta en una etapa posterior.
- Cambiar o retirar un código utilizado requiere permiso y auditoría.

La primera estructura permitirá un código principal por variante. Antes de
implementar proveedores con múltiples etiquetas se evaluará si una variante
necesita códigos alternos.

## 4. Escaneo en el Punto de venta

El POS tendrá un campo de escaneo preparado para recuperar el foco sin obligar
al vendedor a utilizar el mouse en cada artículo.

Al leer un código:

1. Resolver la variante exacta.
2. Verificar que producto y variante estén activos.
3. Obtener el precio vigente desde la fuente autorizada.
4. Consultar existencia disponible o cuota offline.
5. Agregar una unidad al carrito.
6. Un nuevo escaneo del mismo código aumenta la cantidad en uno.
7. Si supera la disponibilidad, no aumenta y muestra un aviso claro.

Un código desconocido no creará productos ni existencias automáticamente. El POS
mostrará `Código no encontrado` y permitirá búsqueda manual o solicitar revisión
de inventario.

El vendedor podrá seguir buscando por nombre, talla, color, marca o código si el
lector falla o la etiqueta está dañada.

## 5. Escaneo en Inventario

Escanear no incrementa existencias por sí solo. Primero identifica la variante y
la cantidad se incorpora mediante una operación trazable:

- Existencia inicial.
- Recepción de compra.
- Devolución.
- Ajuste autorizado.
- Traslado, cuando existan varias ubicaciones.

Flujo recomendado para recepción o conteo:

1. Elegir el tipo de operación y ubicación.
2. Escanear una variante.
3. Cada lectura suma una unidad a la línea temporal; también puede escribirse una
   cantidad.
4. Revisar el resumen por talla y color.
5. Confirmar la operación completa.
6. La API guarda operación, movimientos y saldos en una sola transacción.

Cuando un código nuevo se escanea desde Inventario, un usuario autorizado podrá
asignarlo a una variante previamente seleccionada. La asignación no crea stock y
debe comprobar unicidad antes de guardarse.

## 6. Uso sin conexión

El catálogo offline del POS incluirá un índice local mínimo:

```text
código → variante, descripción, precio sincronizado y cuota offline
```

Así el lector puede continuar agregando artículos al carrito sin red. La pantalla
mostrará que el precio y la cuota corresponden a la última sincronización. Una
venta offline seguirá las reglas definidas en
[Experiencias por rol y continuidad del POS](04-experiencias-roles-y-modo-offline.md).

El panel administrativo no realizará entradas o ajustes offline: esas
operaciones necesitan validación del servidor y trazabilidad inmediata.

## 7. Contratos previstos

- Resolver una variante por código exacto.
- Asignar o reemplazar código con permiso `product.edit`.
- Devolver `404 barcode_not_found` sin revelar información adicional.
- Devolver `409 duplicate_barcode` cuando el código ya pertenece a otra variante.
- Incluir el código en búsquedas y respuestas autorizadas de variantes.
- Sincronizar el índice de códigos necesario para el POS offline.

## 8. Pruebas obligatorias

1. Escanear una variante agrega únicamente esa talla y color al carrito.
2. Escanearla dos veces aumenta la cantidad a dos.
3. No se puede superar la disponibilidad o cuota offline.
4. Un código desconocido no modifica inventario.
5. Un código duplicado es rechazado por API y base de datos.
6. Los ceros iniciales se conservan.
7. Escanear durante una recepción acumula cantidades, pero el Kardex cambia solo
   al confirmar.
8. Reintentar la confirmación no duplica entradas ni ventas.
9. El índice local permite resolver códigos durante una caída de red.
10. Un vendedor sin permiso no puede reasignar códigos manipulando la solicitud.
