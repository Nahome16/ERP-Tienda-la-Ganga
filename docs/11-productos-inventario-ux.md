# Módulo 1 — Pantallas y recorridos de Productos e Inventario

Estado del documento: **Borrador de experiencia para validación**  
Referencia visual: [Prototipo navegable](visualizations/modulo-1-productos-inventario.html).

## 1. Objetivo de experiencia

Un usuario nuevo debe poder registrar un producto con variantes y existencia
inicial con poca orientación, sin confundir un borrador con inventario confirmado.
La interfaz debe mostrar las acciones permitidas, conservar el trabajo ante fallos
y explicar los errores junto al campo correspondiente.

## 2. Navegación del módulo

Accesos principales:

1. **Productos:** listado, búsqueda y detalle.
2. **Nuevo producto:** captura guiada.
3. **Inventario:** consulta por variante y ubicación.
4. **Kardex:** historial de movimientos.
5. **Configuración:** catálogos y parámetros, solo con permiso.

En computadora se propone una navegación lateral. En celular se utilizará un
encabezado compacto y un menú desplegable; las acciones principales seguirán
visibles sin depender de pasar el cursor.

## 3. Estructura común

Cada pantalla tendrá:

- Título corto y descripción solamente cuando aporte contexto.
- Acción principal claramente identificada.
- Indicador visible de carga o guardado.
- Mensajes de éxito y error comprensibles.
- Navegación de regreso que conserve filtros y posición.
- Controles táctiles cómodos y orden de teclado lógico.
- Costos y márgenes únicamente cuando el usuario tenga permiso.

La identidad utiliza azul marino, naranja terracota, amarillo mostaza y crema. El
color nunca será el único indicador de estado.

## 4. Pantalla de Productos

### 4.1 Encabezado

- Título `Productos`.
- Acción primaria `Nuevo producto`.
- Búsqueda por nombre, marca o código.
- Botón de filtros con cantidad de filtros activos.

### 4.2 Filtros

- Categoría.
- Marca.
- Corte.
- Talla.
- Color.
- Estado.
- Disponibilidad.

En móvil se abren en un panel. `Aplicar filtros` y `Limpiar filtros` describen su
resultado. El filtro talla + color se aplica a la misma variante.

### 4.3 Resultados

En computadora se muestra una tabla con fotografía, producto, clasificación,
precio, existencias y estado. En celular se transforma en tarjetas compactas con
la información esencial; el resto queda en el detalle.

Estados de pantalla:

- Cargando.
- Resultados.
- Sin coincidencias, conservando los filtros.
- Sin productos registrados, con acceso a crear el primero.
- Error recuperable con acción `Reintentar`.

### 4.4 Acciones

- Abrir detalle.
- Editar, según permiso.
- Activar o inactivar.
- Abrir inventario filtrado por producto.

No se utilizará un botón de eliminación para productos con historial.

## 5. Formulario de producto

Se propone un flujo guiado de cinco pasos. El usuario puede guardar un borrador
desde cualquier paso.

### Paso 1 — Información

- Nombre.
- Categoría y subcategoría.
- Marca.
- Corte cuando corresponda.
- Precio de venta predeterminado.
- Descripción y notas internas opcionales.

### Paso 2 — Variantes

- Agregar filas específicas de talla y color.
- Detectar duplicados inmediatamente y también en el servidor.
- Permitir seleccionar un grupo de tallas como ayuda, sin crear combinaciones
  silenciosamente.
- Mostrar precio diferente solo cuando se active una excepción.

### Paso 3 — Fotografías

- Agregar hasta cuatro imágenes.
- Elegir imagen principal.
- Cambiar orden.
- Reintentar una imagen fallida sin perder las demás.
- Distinguir carga pendiente de imagen guardada.

### Paso 4 — Existencias

- Ubicación.
- Cantidad inicial por variante.
- Costo unitario por variante cuando la cantidad sea positiva.
- Acción `Aplicar costo a todas`, si se aprueba.
- Resumen de unidades y valor antes de confirmar.

### Paso 5 — Revisar

- Datos del producto.
- Variantes exactas.
- Imágenes.
- Existencias y costos visibles solamente con permiso.
- Advertencias pendientes.
- Acciones `Guardar borrador` y `Activar producto`.

Al activar, el botón se deshabilita mientras se procesa. Un reintento no duplica
el producto ni sus movimientos.

## 6. Detalle del producto

El detalle tendrá:

- Galería y datos principales.
- Estado del producto.
- Precio predeterminado.
- Tabla o tarjetas de variantes.
- Disponibilidad por ubicación.
- Accesos a editar, inactivar, inventario y Kardex según permisos.
- Historial breve de cambios sensibles.

En móvil, la acción primaria permanece fácil de encontrar, sin cubrir contenido.

## 7. Pantalla de Inventario

### 7.1 Consulta

- Buscar producto, código o variante.
- Filtrar por ubicación, talla, color y disponibilidad.
- Mostrar producto, talla, color, ubicación, cantidad y estado.
- Mostrar costo solamente con permiso.
- Resaltar existencias bajas con texto e indicador, no solo color.

### 7.2 Acciones

- Abrir Kardex de la variante.
- Registrar ajuste con permiso.
- Abrir detalle del producto.

La cantidad no será un campo editable dentro del listado.

## 8. Registro de ajuste

Se propone un diálogo o panel enfocado para evitar abandonar el contexto.

Campos:

- Variante y ubicación, no editables cuando se abre desde la fila.
- Existencia actual.
- Tipo de ajuste: entrada o salida.
- Cantidad.
- Motivo obligatorio.
- Observación opcional.
- Resumen de la existencia resultante.

La confirmación utiliza `Registrar ajuste`. Para una salida que exceda la
existencia se muestra el máximo disponible antes de enviar la operación.

## 9. Pantalla de Kardex

Encabezado:

- Producto y variante seleccionada.
- Existencia actual.
- Ubicación.

Filtros:

- Fecha desde y hasta.
- Tipo de movimiento.
- Documento o referencia.

La tabla muestra fecha, movimiento, entrada, salida, saldo, referencia y usuario.
Cada fila puede abrir su operación de origen. Las reversiones permanecen visibles.

## 10. Conservación del trabajo

- Guardado explícito y estados `Sin guardar`, `Guardando` y `Guardado`.
- Advertencia antes de abandonar cambios no guardados.
- Borrador local de apoyo ante pérdida de conexión.
- Indicación visible de qué información llegó al servidor.
- Recuperación que no sobrescribe una versión más reciente sin confirmación.

## 11. Accesibilidad y adaptación

- Etiquetas visibles para todos los campos.
- Errores vinculados al control correspondiente.
- Contraste suficiente.
- Foco perceptible.
- Navegación completa con teclado.
- Texto de al menos 16 píxeles en campos editables móviles.
- Acciones táctiles con espacio suficiente.
- Tablas transformadas o resumidas en móvil cuando el desplazamiento horizontal
  impida entenderlas.
- Las muestras de color incluyen siempre el nombre.

## 12. Criterios de aceptación de UX

1. Un usuario puede guardar un borrador desde cualquier paso.
2. Cambiar de paso no elimina datos válidos.
3. El formulario indica campos obligatorios antes de activar.
4. Una variante duplicada identifica las dos filas en conflicto.
5. Fallar una imagen no reinicia el formulario.
6. Una cantidad positiva sin costo señala la variante exacta.
7. El listado conserva filtros y página al regresar del detalle.
8. En celular se puede crear un producto sin superposiciones.
9. Todas las acciones principales se alcanzan con teclado.
10. Un vendedor no ve costos ni controles de ajuste sin permiso.
11. El ajuste muestra la cantidad resultante antes de confirmar.
12. Kardex permite explicar la existencia mostrada.

## 13. Decisiones de experiencia pendientes

| ID | Decisión | Propuesta |
|---|---|---|
| DEC-042 | Formulario guiado o pantalla única | Cinco pasos con guardado de borrador |
| DEC-043 | Presentación móvil de listados | Tarjetas compactas en lugar de tabla completa |
| DEC-044 | Ajuste como diálogo o pantalla | Diálogo en computadora y panel completo en móvil |
| DEC-045 | Creación rápida de catálogos | Permitirla dentro del formulario solo con permiso |
| DEC-046 | Aplicar costo a todas | Incluirlo con confirmación visual |
| DEC-047 | Resumen del valor de inventario | Visible únicamente con permiso de costos |

## 14. Próximo bloque

Después de validar los recorridos se detallará el modelo físico de datos del
Módulo 1: tablas, campos, restricciones, índices y transacciones.
