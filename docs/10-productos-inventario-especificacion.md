# Módulo 1 — Especificación de Productos e Inventario

Estado del documento: **Borrador funcional para validación**  
Objetivo: definir qué debe hacer el primer módulo antes de diseñar pantallas o
programar la solución.

## 1. Resultado esperado

Al finalizar este módulo, un usuario autorizado podrá:

1. Administrar los catálogos necesarios para describir prendas.
2. Registrar un producto una sola vez.
3. Crear únicamente sus combinaciones reales de talla y color.
4. Asociar hasta cuatro fotografías.
5. Registrar existencias iniciales por variante y ubicación.
6. Consultar cantidades, precios y disponibilidad.
7. Explicar cada cantidad mediante el Kardex.
8. Corregir diferencias mediante ajustes autorizados y trazables.

El módulo debe quedar preparado para que ventas y compras reutilicen los mismos
productos, variantes y movimientos.

## 2. Alcance

### 2.1 Incluido

- Categorías y subcategorías.
- Marcas.
- Cortes.
- Tallas y grupos de tallas.
- Colores.
- Productos y variantes.
- Imágenes de producto.
- Ubicaciones de inventario.
- Existencias iniciales.
- Ajustes positivos y negativos autorizados.
- Consulta de existencias.
- Kardex por variante.
- Borradores de producto.
- Activación, inactivación y archivo.
- Búsqueda, filtros, orden y paginación.
- Auditoría y permisos del módulo.

### 2.2 Fuera de este módulo

- Ventas y carrito del POS.
- Compras y recepción de proveedores.
- Devoluciones comerciales.
- Reservas de pedidos.
- Traslados, mientras exista una sola ubicación confirmada.
- Conteos físicos completos.
- Impresión de etiquetas y lectura de códigos de barras.
- Catálogo público.

Estas funciones usarán la base creada aquí, pero se diseñarán en sus módulos.

## 3. Conceptos del negocio

### 3.1 Producto

Representa la prenda común, por ejemplo:

```text
Pantalón Monday Palazzo talla especial
```

Contiene nombre, clasificación, fotografías y valores comerciales comunes.

### 3.2 Variante

Representa una combinación exacta:

```text
Producto + talla + color
```

Ejemplo:

```text
Monday Palazzo especial + talla 17 + negro
```

Cada combinación se registra una sola vez dentro del producto. `XL` y `1XL` son
valores diferentes.

### 3.3 Existencia

Es la cantidad actual de una variante en una ubicación. No se captura ni se
edita directamente después de confirmar la existencia inicial.

### 3.4 Movimiento

Es la explicación de una entrada o salida. La suma de movimientos confirmados
debe coincidir con la existencia actual.

### 3.5 Kardex

Es el historial ordenado de movimientos de una variante, con fecha, ubicación,
entrada, salida, saldo, motivo, documento y usuario.

## 4. Catálogos editables

Los valores iniciales no se programarán como listas fijas. Un administrador o
usuario autorizado podrá crear, editar, ordenar, activar e inactivar catálogos.

### 4.1 Categorías

Las categorías serán jerárquicas:

```text
Dama
└── Pantalones
```

Valores iniciales conocidos:

- Dama.
- Caballero.
- Juvenil.
- Niños.
- Pantalones.
- Camisas.
- Blusas.

Reglas propuestas:

- Un producto se asigna a la categoría más específica disponible.
- Inactivar una categoría impide asignarla a productos nuevos, pero conserva los
  productos históricos.
- No se permite crear ciclos en la jerarquía.

### 4.2 Marcas

Valores iniciales conocidos:

- Zolo Jeans, Kalua, Pop Sugar, Most Wanted, Chic Mi, JINGO, Hummer, Levi’s,
  Tesoro, Denim Lover, Monday, Soho, Zara, Morelli, Polo, Gold Rose y Never Legal.

La comparación para evitar duplicados ignorará espacios sobrantes y diferencias
de mayúsculas, sin modificar la forma visible elegida por el usuario.

### 4.3 Cortes

Valores iniciales:

- Straight Fit o recto.
- Skinny o tubo.
- Flare o campana.
- Wide Leg.
- Palazzo.
- Mom Jeans.
- Slim.
- Baggy.

El corte puede ser obligatorio para pantalones y opcional para otras categorías.
Esta regla debe confirmarse antes de programarla.

### 4.4 Tallas

La talla se almacena como texto y puede pertenecer a un grupo para facilitar la
captura y los filtros.

| Grupo inicial | Valores |
|---|---|
| Dama normal | 3, 5, 7, 9, 11, 13 |
| Dama especial | 15, 17, 19, 21, 23, 25 |
| Caballero | 30, 32, 34, 36, 38, 40, 42, 44 |
| Juvenil | 10, 12, 14, 16 |
| Camisas | S, M, L, XL, 1XL, 2XL, 3XL |

El grupo ayuda a seleccionar tallas, pero no asigna automáticamente todas sus
tallas al producto.

### 4.5 Colores

Valores iniciales:

- Negro, azul, azul oscuro, azul claro, celeste, petróleo, caqui, beige, café y
  gris.

Cada color tendrá nombre y, opcionalmente, una muestra visual. El nombre comercial
es el dato principal; la muestra no se utilizará como única forma de comunicarlo.

## 5. Datos del producto

| Campo | Regla propuesta |
|---|---|
| Nombre | Obligatorio, legible y único solo cuando la regla comercial lo requiera |
| Descripción | Opcional |
| Categoría | Obligatoria |
| Marca | Obligatoria para las prendas de marca; confirmar si se permite “Sin marca” |
| Corte | Condicional según categoría |
| Precio de venta predeterminado | Obligatorio para activar; mayor que cero |
| Estado | Borrador, activo, inactivo o archivado |
| Notas internas | Opcionales y no visibles al cliente |
| Fecha y responsable | Generados por el servidor |

### 5.1 Precio y costo

Propuesta:

- El producto define un precio de venta predeterminado.
- Una variante puede tener un precio diferente solo mediante una anulación del
  valor predeterminado claramente visible.
- El costo oficial pertenece a la existencia recibida y a la variante, no a una
  descripción general del producto.
- Al registrar inventario inicial se captura un costo unitario por variante.
- La interfaz puede ofrecer “aplicar este costo a todas” para agilizar la captura.
- El costo promedio ponderado continúa pendiente de aprobación.

Esto evita que cambiar un campo general altere el valor histórico del inventario
o de las ventas.

## 6. Datos y reglas de variantes

Cada variante tendrá:

- Producto.
- Talla.
- Color.
- Estado activo o inactivo.
- Código interno, cuando se apruebe su generación.
- Código de barras opcional.
- Precio de venta diferente, solo cuando se utilice una excepción.

Reglas:

- Talla y color deben pertenecer a catálogos activos al crear la variante.
- No se repite una combinación de talla y color dentro del producto.
- Una variante utilizada en movimientos no se elimina; se inactiva.
- Inactivar una variante no elimina sus unidades ni su historial.
- No se puede vender una variante inactiva, aunque tenga unidades.
- Activar el producto requiere al menos una variante activa.

### 6.1 Captura de combinaciones

La interfaz debe permitir agregar filas específicas:

| Talla | Color | Cantidad inicial | Costo unitario |
|---|---|---:|---:|
| 15 | Azul oscuro | Pendiente real | Pendiente real |
| 17 | Negro | Pendiente real | Pendiente real |

No debe crear el producto cartesiano de todas las tallas y colores seleccionados
sin mostrar y confirmar las combinaciones resultantes.

## 7. Imágenes

- Hasta cuatro imágenes por producto.
- Orden modificable; la primera será la imagen principal.
- Formatos web seguros y validados por contenido, no solo por extensión.
- Optimización de tamaño y dimensiones para listados y detalle.
- Texto alternativo o descripción cuando sea necesario.
- Una imagen pendiente de subir se distingue de una ya guardada.
- Si falla una carga, el resto del formulario no se pierde.
- Borrar una imagen requiere confirmación cuando ya fue guardada.

El proveedor continúa pendiente entre Cloudinary y Supabase Storage. La API
guardará referencias y metadatos; la base de datos no almacenará archivos binarios
de las fotografías.

## 8. Registro de producto

### 8.1 Flujo propuesto

1. Capturar información básica.
2. Elegir o crear valores de catálogo autorizados.
3. Agregar variantes específicas.
4. Cargar y ordenar imágenes.
5. Capturar existencia inicial y costo por variante.
6. Revisar el resumen.
7. Guardar como borrador o activar.

### 8.2 Guardado como borrador

- Un borrador del servidor queda asociado al usuario y puede retomarse desde otro
  dispositivo autorizado.
- Un apoyo local puede conservar datos aún no enviados si se pierde la conexión.
- La pantalla debe indicar qué parte está guardada en el servidor y qué parte
  continúa solo en el dispositivo.
- Al recuperar dos versiones se debe evitar sobrescribir silenciosamente la más
  reciente.

### 8.3 Activación atómica

Activar un producto con existencia inicial debe guardar en una sola transacción:

- Producto.
- Variantes.
- Referencias de imágenes ya confirmadas.
- Operación de inventario inicial.
- Movimientos por variante y ubicación.
- Existencias resultantes.
- Auditoría.

Si cualquier validación o movimiento falla, el producto puede permanecer como
borrador, pero no debe quedar activo con inventario incompleto.

## 9. Existencia inicial

Por cada variante y ubicación se captura:

- Cantidad entera mayor o igual a cero.
- Costo unitario cuando la cantidad sea mayor que cero.
- Motivo o referencia opcional del inventario inicial.

Reglas:

- Cero es válido para preparar una variante que llegará después.
- Una cantidad positiva requiere costo válido antes de confirmar.
- Confirmar crea movimientos de tipo `Existencia inicial`.
- La existencia inicial confirmada no se edita.
- Una corrección posterior utiliza un ajuste y exige motivo.
- El costo C$550 y las cantidades de la demostración nunca se precargan.

La ubicación inicial propuesta es `Tienda Managua`. No se creará `Casa` o
`Bodega` hasta que se confirme su manejo separado.

## 10. Ajustes de inventario

El ajuste se usa para corregir diferencias, daños, pérdidas o conteos, no para
registrar ventas o compras.

Un ajuste requiere:

- Variante.
- Ubicación.
- Tipo positivo o negativo.
- Cantidad entera mayor que cero.
- Motivo obligatorio.
- Observación opcional.
- Usuario y fecha del servidor.
- Autorización según permisos.

No se permite un ajuste negativo que deje existencia menor que cero. Un ajuste
confirmado se revierte con otro movimiento relacionado; no se edita ni se borra.

La aprobación adicional para ajustes superiores a una cantidad o valor permanece
pendiente.

## 11. Consulta de productos

El listado mostrará, según permisos:

- Fotografía principal.
- Nombre.
- Marca.
- Categoría.
- Corte.
- Precio de venta.
- Estado.
- Unidades totales o resumen de disponibilidad.
- Indicador de existencias bajas cuando se configure.

Los costos y márgenes no deben formar parte de la respuesta de la API para un
usuario sin permiso.

### 11.1 Búsqueda y filtros

- Nombre.
- Marca.
- Categoría y subcategoría.
- Corte.
- Talla.
- Color.
- Estado.
- Con existencias, agotado o bajo mínimo.
- Código interno o código de barras cuando estén habilitados.

### 11.2 Regla de talla y color

Cuando se elijan talla y color, ambas condiciones deben cumplirse sobre la misma
variante.

Ejemplo: un producto con talla 15 solamente en azul y talla 17 solamente en negro
no coincide con el filtro `talla 15 + negro`.

### 11.3 Comportamiento del listado

- Paginación del servidor.
- Orden estable.
- Filtros reflejados en la dirección o estado navegable cuando sea práctico.
- Al abrir un detalle y volver, se conservan filtros, página y posición.
- Estados de carga, vacío y error claramente diferenciados.

## 12. Detalle del producto

Debe mostrar:

- Información básica e imágenes.
- Estado del producto.
- Tabla de variantes.
- Existencias por ubicación.
- Precio predeterminado y excepciones.
- Costos únicamente con permiso.
- Acciones permitidas para el usuario.
- Fecha y responsable de los cambios principales.

Desde la variante se podrá abrir su Kardex.

## 13. Kardex

El Kardex tendrá filtros por:

- Variante.
- Ubicación.
- Tipo de movimiento.
- Rango de fechas.
- Documento o referencia.

Columnas mínimas:

| Fecha | Movimiento | Entrada | Salida | Saldo | Referencia | Usuario |
|---|---|---:|---:|---:|---|---|

Reglas:

- El saldo se calcula en orden consistente.
- Cada fila permite consultar su operación de origen.
- Un movimiento revertido continúa visible junto con su reversión.
- Las fechas se muestran en horario de Managua.
- Los movimientos no se editan desde la tabla.

## 14. Permisos del módulo

Permisos propuestos, independientes del nombre del rol:

- Consultar productos.
- Consultar disponibilidad.
- Consultar costos.
- Crear borradores de producto.
- Editar productos.
- Activar o inactivar productos.
- Archivar productos.
- Administrar catálogos.
- Registrar existencia inicial.
- Consultar Kardex.
- Registrar ajustes.
- Autorizar ajustes.
- Administrar imágenes.

El administrador recibe todos. El encargado de inventario recibe los necesarios
para su función. El vendedor consulta productos y disponibilidad sin costos ni
ajustes. Esta asignación continúa como propuesta hasta validar los roles.

## 15. Mensajes y prevención de errores

Ejemplos esperados:

- `Ya existe una variante talla 17, color negro en este producto.`
- `La cantidad inicial debe ser un número entero igual o mayor que cero.`
- `Ingresá el costo unitario para las variantes que tienen existencias.`
- `No se puede retirar 3 unidades: solamente quedan 2.`
- `El producto quedó guardado como borrador. La carga de una imagen sigue
  pendiente.`

Los mensajes deben explicar el problema y conservar los datos válidos ingresados.
Los botones usarán acciones concretas: `Guardar borrador`, `Activar producto`,
`Registrar ajuste` y `Reintentar imagen`.

## 16. Producto de referencia

Se utilizará para validar el diseño, sin inventar sus datos pendientes:

| Campo | Valor |
|---|---|
| Nombre | Pantalón Monday Palazzo talla especial |
| Marca | Monday |
| Categoría | Dama → Pantalones |
| Corte | Palazzo |
| Tallas | 15, 17, 19, 21, 23, 25 |
| Precio | Referencia anterior C$730; confirmar valor vigente |
| Costo | Pendiente real |
| Colores y cantidades | Pendientes reales |

Este producto no se utilizará como inventario real hasta recibir costo, precio y
cantidades confirmadas por talla y color.

## 17. Criterios de aceptación

1. Se crea un producto con solo las variantes seleccionadas.
2. `XL` y `1XL` permanecen como tallas diferentes.
3. No se permite repetir talla y color dentro del producto.
4. Confirmar existencia inicial crea un movimiento por cada cantidad positiva.
5. La suma de movimientos coincide con la existencia mostrada.
6. Un ajuste negativo nunca deja una cantidad menor que cero.
7. Un vendedor no puede obtener costos modificando una solicitud a la API.
8. Los filtros de talla y color se aplican a la misma variante.
9. Volver del detalle conserva los filtros del listado.
10. Una falla de imagen no elimina el resto del formulario.
11. Un doble clic no activa dos veces el producto ni duplica movimientos.
12. Inactivar una variante conserva sus existencias y Kardex.
13. Cambiar el precio no modifica información histórica ya confirmada.
14. Todas las acciones sensibles quedan asociadas al usuario.
15. Las pantallas principales funcionan en celular y mediante teclado.

## 18. Casos de prueba críticos

| Caso | Resultado esperado |
|---|---|
| Agregar dos veces talla 15 y negro | La segunda combinación es rechazada |
| Filtrar talla 15 y negro sin variante coincidente | El producto no aparece |
| Confirmar varias variantes con existencias | Se crean cantidades y movimientos correctos |
| Reintentar la activación por pérdida de conexión | No se duplican producto ni movimientos |
| Intentar consultar costos como vendedor | La API rechaza el acceso |
| Ajustar dos veces la misma variante simultáneamente | El servidor conserva una cantidad válida y trazable |
| Subir una imagen inválida | Se rechaza la imagen sin perder el formulario |
| Archivar un producto con historial | Se conserva toda la información relacionada |

## 19. Decisiones abiertas del módulo

| ID | Decisión | Propuesta actual |
|---|---|---|
| DEC-032 | Marca obligatoria | Permitir un valor controlado `Sin marca` |
| DEC-033 | Corte obligatorio | Exigirlo solo en categorías configuradas |
| DEC-034 | Precio distinto por variante | Permitir excepción visible sobre precio predeterminado |
| DEC-035 | Costo del inventario inicial | Capturarlo por variante y permitir aplicación masiva |
| DEC-036 | Ubicaciones iniciales | Solo Tienda Managua hasta confirmar casa o bodega |
| DEC-037 | Autorización de ajustes | Permiso específico y posible límite por cantidad o valor |
| DEC-038 | Generación de código interno | Automática por variante, formato pendiente |
| DEC-039 | Existencia mínima | Configurable por variante o producto; confirmar necesidad inicial |
| DEC-040 | Proveedor de imágenes | Cloudinary o Supabase Storage |
| DEC-041 | Tamaño máximo de imagen | Definir después de probar calidad y rendimiento |

## 20. Orden de diseño e implementación

1. Confirmar campos y decisiones que bloquean la base de datos.
2. Diseñar recorridos y pantallas.
3. Detallar el modelo físico y las restricciones.
4. Definir contratos de API.
5. Crear base técnica y migraciones.
6. Implementar catálogos y productos.
7. Implementar imágenes y borradores.
8. Implementar existencia inicial, ajustes y Kardex.
9. Integrar listados, filtros y detalle.
10. Ejecutar pruebas críticas, respaldo y restauración.

## 21. Próximo bloque

El siguiente bloque diseñará las pantallas y recorridos de usuario del módulo:
listado, formulario de producto, matriz de variantes, detalle, consulta de
inventario, ajuste y Kardex.
