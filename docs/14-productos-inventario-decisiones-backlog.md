# Módulo 1 — Decisiones y backlog técnico

Estado del documento: **En implementación** — Hitos 1, 2 y 3 construidos  
Objetivo: separar decisiones bloqueantes de decisiones aplazables y ordenar la
implementación en entregas pequeñas, comprobables y reversibles.

## 0. Estado de avance

| Hito | Estado | Notas |
|---|---|---|
| 0 — Decisiones | Resuelto para catálogos | Se parte de esta base (sin ZIP). Se aplican los valores recomendados de la sección 2 |
| 1 — Base técnica | Terminado | Incluye integración continua en GitHub Actions |
| 2 — Acceso y permisos | Terminado | Roles Administrador, Vendedor y Encargado de inventario; pantalla **Equipo**; desactivar o cambiar contraseña revoca sesiones |
| 3 — Catálogos | Terminado | API `/api/v1/catalog/*`, pantalla **Catálogos**, datos iniciales y pruebas contra PostgreSQL |
| MVP (10 nov 2026) | Construido | Productos y variantes con código de barras, existencia inicial, Kardex y ajustes, importación CSV, cajas, POS con modo sin conexión, pagos, descuentos, cierres y auditoría. Ver [contrato](30-mvp-contrato-api.md) |
| 4 — Borradores y variantes | Cubierto por el MVP (sin borradores) | Los productos nacen activos; los borradores y los cinco pasos quedan para después |
| 5 — Imágenes | Pendiente | Se aplaza tras el primer flujo de venta |

Decisiones aplicadas en el Hito 2:

- Permisos por rol según la matriz del Módulo 0. Lo marcado «Limitado» para el
  encargado de inventario (costos, autorizar ajustes) queda sin conceder hasta
  definir sus límites. Descuentos, caja y abonos se agregarán con sus módulos.
- Nuevo permiso `user.manage` para administrar cuentas, solo del Administrador.
- Nadie puede desactivarse ni quitarse el rol Administrador a sí mismo, y debe
  quedar al menos un administrador activo.
- La sesión no se renueva: dura como máximo 8 horas y se cierra tras 30 minutos
  sin actividad, como estaba definido.

Decisiones aplicadas en el Hito 3:

- `Sin marca` es un registro normal del catálogo de marcas.
- Las categorías iniciales se cargaron como Dama, Caballero, Juvenil y Niños,
  con Pantalones, Camisas y Blusas como subcategorías. Son editables.
- Los colores iniciales no tienen muestra visual; se pueden agregar desde la
  pantalla.
- Una talla pertenece a un solo grupo (o a ninguno).
- No se puede inactivar una categoría con subcategorías activas ni activar una
  subcategoría cuya superior está inactiva.
- Crear catálogos no exige `Idempotency-Key`: el nombre único ya impide
  duplicados ante reintentos. Las ediciones exigen `If-Match` con la versión.
- Toda operación de escritura de la API exige el encabezado CSRF.

## 1. Puerta de inicio

La programación del Módulo 1 puede comenzar únicamente cuando:

1. Se autorice expresamente iniciar implementación.
2. Se aprueben o modifiquen las decisiones bloqueantes de este documento.
3. Se confirme que el código existente del ZIP será entregado para auditoría o
   que la implementación iniciará desde una base nueva.
4. El repositorio local continúe limpio y se defina la conexión con GitHub cuando
   esté disponible.

No es necesario resolver desde ahora alojamiento productivo, facturación fiscal,
WhatsApp, entregas o funcionamiento sin conexión.

## 2. Decisiones recomendadas para comenzar

Estas decisiones afectan tablas, reglas o contratos del Módulo 1. Se propone
aprobarlas como conjunto y revisarlas individualmente si alguna no representa la
operación real de Tienda La Ganga.

### 2.1 Operación inicial

| Tema | Valor recomendado | Motivo |
|---|---|---|
| Ubicación inicial | Solo `Tienda Managua` | No inventar Casa o Bodega; el modelo admite agregarlas después |
| Cuentas | Una cuenta individual por persona | Permite permisos y auditoría confiable |
| Roles iniciales | Administrador, vendedor/cajero y encargado de inventario | Repartidor puede incorporarse con Entregas |
| Caja | Una caja inicial preparada para varias | Reduce configuración sin cerrar crecimiento |

Estas recomendaciones no fijan todavía cuántos vendedores existirán.

### 2.2 Productos y variantes

| Tema | Valor recomendado | Efecto |
|---|---|---|
| Marca | Obligatoria mediante catálogo; permitir `Sin marca` | Evita nulos ambiguos |
| Corte | Obligatorio solo para categorías configuradas, inicialmente pantalones | Mantiene formularios relevantes |
| Talla y color | Obligatorios para cada variante de ropa | Conserva combinaciones exactas |
| Precio | Predeterminado en producto con excepción opcional por variante | Evita repetir valores y permite casos especiales |
| Código interno | Columna única opcional al inicio; generación automática antes de etiquetas | No bloquea el primer registro |
| Código de barras | Requerido para el flujo ágil de POS e inventario; puede quedar pendiente mientras se prepara un borrador | Identifica una variante exacta y debe ser único |
| Producto activo sin existencias | Permitido | Facilita preparar mercadería próxima o mostrar agotados |
| Máximo de imágenes | Cuatro | Requisito confirmado del módulo inicial |

Si el negocio incorporara accesorios sin talla o color, se diseñarán valores
controlados como `Única` o `No aplica`; no se utilizarán nulos con significados
distintos.

### 2.3 Costos e inventario

| Tema | Valor recomendado | Efecto |
|---|---|---|
| Precisión de costo | `numeric(18,4)` | Protege cálculos intermedios |
| Precio y totales | `numeric(18,2)` | Coincide con importes cobrados |
| Costo inicial | Obligatorio y mayor que cero cuando hay unidades | Evita inventario sin valoración |
| Método de costo | Promedio ponderado por variante y ubicación | Conserva costos de entradas y calcula costo de ventas |
| Existencia mínima | Campo opcional por variante y ubicación | Permite alertas futuras sin obligar valores |
| Ajustes | Permiso específico y motivo obligatorio | Protege cantidades y trazabilidad |
| Ajustes negativos | Nunca pueden dejar saldo menor que cero | Regla esencial confirmada |
| Movimientos | Inmutables; las correcciones se revierten | Conserva Kardex confiable |

El costo promedio entra en uso completo cuando se implementen Compras y Ventas.
En el Módulo 1, la existencia inicial establece el primer costo promedio de la
variante y ubicación.

### 2.4 Experiencia

| Tema | Valor recomendado |
|---|---|
| Registro de producto | Cinco pasos con guardado de borrador |
| Listados en celular | Tarjetas compactas; tabla en computadora |
| Ajuste | Diálogo en computadora y panel completo en móvil |
| Aplicar costo a todas | Disponible con vista previa antes de confirmar |
| Creación rápida de catálogos | Solo con permiso; disponible dentro del formulario |
| Filtros | Conservar filtros, página y posición al regresar |

### 2.5 API y seguridad

| Tema | Valor recomendado |
|---|---|
| Versión de API | `/api/v1` |
| Paginación | Página y tamaño, máximo 100 |
| Concurrencia | ETag e identificador de versión |
| Idempotencia | Obligatoria para activación, ajustes e imágenes confirmadas |
| Retención de idempotencia | 30 días, configurable |
| Costos | Endpoint separado y permiso `inventory.cost.read` |
| Sesión | Máximo de 8 horas y cierre tras 30 minutos de inactividad, configurable |
| CSRF | Obligatorio en toda operación que cambie datos |

La duración de sesión debe revisarse con la rutina real de la tienda antes del
piloto. No afecta el esquema principal de productos.

## 3. Decisiones que pueden esperar

| Decisión | Momento límite |
|---|---|
| Cloudinary o Supabase Storage | Antes del hito de imágenes |
| Formato legible del código interno | Antes de generar etiquetas |
| Casa o bodega como ubicación | Antes de registrar mercadería separada |
| Límite de ajuste que requiere autorización | Antes de habilitar ajustes a usuarios no administradores |
| Proveedor de alojamiento | Antes de preproducción |
| Frecuencia y conservación de respaldos | Antes de producción |
| Integración continua en GitHub | Cuando el repositorio remoto esté conectado |
| Reservas, pedidos y catálogo | En sus módulos correspondientes |

El desarrollo utilizará una abstracción de almacenamiento de imágenes para evitar
que elegir proveedor cambie el dominio de productos.

## 4. Datos reales que no bloquean el código

Los siguientes datos son necesarios para cargar inventario real y realizar el
piloto, pero no para construir las funciones:

- Precio vigente del Monday Palazzo.
- Costo real.
- Colores reales.
- Cantidades por talla y color.
- Cantidad final de vendedores.
- Logo original en SVG o PNG transparente de mayor calidad, si existe.

No se utilizarán valores demostrativos mientras estén pendientes.

## 5. Estrategia de entregas

Cada hito debe:

- Tener un resultado visible o comprobable.
- Incluir sus migraciones y pruebas.
- Evitar mezclar funciones de hitos posteriores.
- Mantener el repositorio compilable.
- Actualizar documentación.
- Guardarse en Git con cambios pequeños y descriptivos.

## 6. Backlog ordenado

### Hito 0 — Decisiones y auditoría del punto de partida

**Resultado:** existe una base aprobada para programar sin inventar reglas.

Tareas:

- `M1-000` Aprobar o modificar las decisiones bloqueantes.
- `M1-001` Recibir y revisar el ZIP de la primera etapa, si se reutilizará.
- `M1-002` Documentar qué código se conserva, corrige o reemplaza.
- `M1-003` Conectar el repositorio a GitHub cuando se proporcione el remoto.

Dependencias: información o autorización del propietario.  
Validación: registro de decisiones actualizado y repositorio sin cambios
desconocidos.  
Cierre: se conoce si el trabajo parte del ZIP o de una base nueva.

### Hito 1 — Base técnica ejecutable

**Resultado visible:** frontend, API y PostgreSQL se ejecutan localmente y muestran
una comprobación de salud sin funciones comerciales ficticias.

Tareas:

- `M1-010` Crear estructura de solución y proyectos.
- `M1-011` Configurar React y TypeScript con análisis estático.
- `M1-012` Configurar ASP.NET Core 8 y capas acordadas.
- `M1-013` Configurar PostgreSQL local con Docker.
- `M1-014` Agregar configuración segura por ambiente.
- `M1-015` Crear proyectos de pruebas y comprobación de salud.
- `M1-016` Documentar instalación y comandos.

Límite: no incluye productos, usuarios reales ni inventario.  
Pruebas: compilación, salud de API, conexión PostgreSQL y prueba mínima de cada
proyecto.  
Cierre: una instalación nueva puede levantarse siguiendo la documentación.

### Hito 2 — Acceso y permisos mínimos

**Resultado visible:** un administrador inicia y cierra sesión; un usuario sin
permiso no puede ejecutar operaciones protegidas.

Tareas:

- `M1-020` Crear esquema mínimo de usuarios, roles, permisos y sesiones.
- `M1-021` Crear el administrador inicial mediante proceso seguro.
- `M1-022` Implementar inicio, renovación y cierre de sesión.
- `M1-023` Implementar protección CSRF y limitación de intentos.
- `M1-024` Implementar políticas de permisos del Módulo 1.
- `M1-025` Probar revocación, acceso denegado y ocultación de costos.

Dependencias: duración de sesión y roles iniciales.  
Límite: sin administración completa de usuarios; solo lo necesario para trabajar
de forma segura.  
Cierre: la API rechaza correctamente accesos no autorizados.

### Hito 3 — Catálogos

**Resultado visible:** un usuario autorizado administra categorías, marcas,
cortes, tallas, grupos y colores.

Tareas:

- `M1-030` Crear migraciones y datos iniciales aprobados.
- `M1-031` Implementar casos de uso y restricciones.
- `M1-032` Publicar endpoints OpenAPI.
- `M1-033` Crear pantallas de consulta y edición.
- `M1-034` Probar duplicados, jerarquías, inactivación y concurrencia.

Dependencias: marca, corte y pertenencia de tallas confirmados.  
Límite: no crea productos.  
Cierre: los catálogos iniciales se pueden editar sin afectar historia.

### Hito 4 — Borradores de productos y variantes

**Resultado visible:** se crea, guarda y retoma un producto en borrador con sus
combinaciones exactas de talla y color.

Tareas:

- `M1-040` Crear migraciones de productos y variantes.
- `M1-041` Implementar creación y edición con ETag.
- `M1-042` Implementar detección de variantes y códigos duplicados.
- `M1-043` Crear pasos Información y Variantes del formulario.
- `M1-044` Implementar listado, búsqueda, filtros y detalle.
- `M1-045` Conservar filtros al regresar del detalle.
- `M1-046` Probar idempotencia y ediciones simultáneas.

Dependencias: catálogos y reglas de precio.  
Límite: el borrador no afecta inventario.  
Cierre: cerrar y volver a abrir el navegador recupera el borrador del servidor.

### Hito 5 — Imágenes

**Resultado visible:** un producto conserva hasta cuatro imágenes ordenables y
una imagen fallida puede reintentarse sin perder el formulario.

Tareas:

- `M1-050` Elegir proveedor y configurar una abstracción.
- `M1-051` Crear referencias, carga firmada y confirmación.
- `M1-052` Verificar tipo, tamaño y dimensiones.
- `M1-053` Crear orden, principal, remoción y limpieza de huérfanos.
- `M1-054` Implementar experiencia de carga y reintento.
- `M1-055` Probar límites, permisos y fallos parciales.

Dependencias: proveedor de imágenes elegido.  
Límite: no publica catálogo externo.  
Cierre: solo referencias READY aparecen en el producto.

### Hito 6 — Existencia inicial y activación

**Resultado visible:** un borrador válido se activa con existencias por variante y
la cantidad queda explicada en movimientos.

Tareas:

- `M1-060` Crear migraciones de ubicación, saldo, operación y movimiento.
- `M1-061` Implementar transacción de activación.
- `M1-062` Implementar costo inicial y promedio aprobado.
- `M1-063` Crear pasos Existencias y Revisar.
- `M1-064` Implementar idempotencia y numeración de operación.
- `M1-065` Probar reversión completa ante una línea inválida.

Dependencias: precisión y método de costo; ubicación inicial.  
Límite: solo existencia inicial, no compras ni ventas.  
Cierre: saldo, movimientos y producto se confirman juntos o no se confirma nada.

### Hito 7 — Consulta de inventario y Kardex

**Resultado visible:** se consultan existencias por variante y cada saldo puede
explicarse mediante su historial.

Tareas:

- `M1-070` Implementar consulta paginada de saldos.
- `M1-071` Implementar filtros sobre la misma variante.
- `M1-072` Implementar consulta de Kardex.
- `M1-073` Implementar valoración separada y protegida.
- `M1-074` Crear pantallas adaptables de Inventario y Kardex.
- `M1-075` Probar que saldos y movimientos coinciden.

Dependencias: activación e inventario.  
Cierre: un vendedor consulta unidades sin recibir costos; un administrador puede
consultar valoración con permiso.

### Hito 8 — Ajustes

**Resultado visible:** un usuario autorizado corrige inventario con motivo y sin
crear saldos negativos.

Tareas:

- `M1-080` Confirmar permisos y límite de autorización.
- `M1-081` Implementar transacción de ajuste.
- `M1-082` Crear diálogo y panel móvil.
- `M1-083` Implementar reversión de un ajuste confirmado.
- `M1-084` Probar simultaneidad, idempotencia y saldo negativo.
- `M1-085` Verificar auditoría completa.

Dependencias: inventario y política de ajustes.  
Cierre: toda corrección aparece en Kardex y conserva usuario y motivo.

### Hito 9 — Fortalecimiento y piloto

**Resultado visible:** el módulo puede probarse con datos controlados antes de
registrar inventario real.

Tareas:

- `M1-090` Ejecutar recorridos de extremo a extremo.
- `M1-091` Revisar accesibilidad, teclado y celular.
- `M1-092` Medir búsquedas, filtros e imágenes.
- `M1-093` Probar migraciones desde una base vacía y una versión anterior.
- `M1-094` Crear y restaurar un respaldo de prueba.
- `M1-095` Elaborar manual de Productos e Inventario.
- `M1-096` Realizar prueba de aceptación con el producto real confirmado.

Dependencias: todos los hitos anteriores y datos reales de prueba.  
Cierre: los criterios de aceptación del Módulo 1 están comprobados y documentados.

## 7. Orden obligatorio

```text
Decisiones
  ↓
Base técnica
  ↓
Acceso y permisos
  ↓
Catálogos
  ↓
Borradores y variantes
  ↓
Imágenes
  ↓
Existencia inicial
  ↓
Inventario y Kardex
  ↓
Ajustes
  ↓
Fortalecimiento y piloto
```

Imágenes puede avanzar en paralelo con parte del formulario solamente después de
definir su contrato y proveedor. La activación no se adelantará a la seguridad,
catálogos y restricciones de variantes.

## 8. Definición de preparado

Una tarea puede comenzar cuando:

- Tiene resultado esperado y límite claro.
- Sus dependencias están terminadas.
- Las decisiones aplicables están aprobadas.
- Se conocen permisos y errores.
- Existen criterios de prueba.
- No depende de datos demostrativos presentados como reales.

## 9. Definición de terminado

Una tarea está terminada cuando:

- Código y migraciones compilan y se ejecutan.
- Pruebas proporcionales al riesgo pasan.
- Permisos se validan en el servidor.
- Estados de carga, error y éxito existen en la interfaz.
- Auditoría está presente cuando corresponde.
- Documentación y OpenAPI están actualizados.
- No se incluyeron secretos ni datos reales.
- El cambio quedó guardado en Git.

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Reutilizar código del ZIP sin auditar | Revisar estructura, dependencias, migraciones y pruebas antes de integrarlo |
| Definir costos tarde | Aprobar precisión y promedio antes de migraciones de inventario |
| Exponer costos al vendedor | DTO y endpoint separados, más pruebas de autorización |
| Duplicar activaciones | Idempotencia y transacción única |
| Vender o ajustar la última unidad simultáneamente | Bloqueo transaccional por saldo |
| Perder imágenes o formulario | Cargas confirmables, borradores y reintentos independientes |
| Crecer con filtros lentos | Paginación, índices y medición con datos representativos |
| Publicar migraciones irreversibles | Compatibilidad progresiva, respaldo y ensayo en preproducción |

## 11. Trabajo no autorizado todavía

Este backlog no autoriza:

- Crear la solución React o ASP.NET.
- Instalar dependencias.
- Crear migraciones.
- Configurar servicios de imágenes.
- Crear cuentas externas o alojamiento.
- Cargar inventario real.
- Publicar el sistema.

Estas acciones comienzan solamente cuando el usuario autorice expresamente la
implementación y se cierre la puerta de decisiones aplicable.

## 12. Próximo paso

Revisar y aprobar las decisiones recomendadas de la sección 2. Después se podrá
iniciar el Hito 0 y, según el estado del ZIP, crear o adaptar la base técnica.
