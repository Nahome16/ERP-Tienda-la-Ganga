# La Ganga ERP

Sistema comercial para administrar Tienda La Ganga: productos, variantes,
inventario, ventas, cobros, clientes y, en etapas posteriores, compras, caja,
pedidos, entregas y catalogo digital.

![Logo de Tienda La Ganga](docs/assets/logo-tienda-la-ganga.png)

El proyecto está en construcción por módulos. La especificación funcional del
primer módulo está lista y el repositorio ya contiene la base técnica ejecutable.
No se programan reglas marcadas como **Propuesta** o **Pendiente** hasta que sean
confirmadas.

## Estado actual

- Solución ASP.NET Core 8 separada en API, aplicación, dominio e infraestructura.
- Interfaz React + TypeScript adaptable a celular y computadora.
- Comprobación de conexión entre la interfaz y la API.
- PostgreSQL 16 preparado para desarrollo local con Docker.
- Proyectos de pruebas unitarias y de integración.

La puesta en marcha está explicada en [Desarrollo local](docs/20-desarrollo-local.md).

## Documentacion actual

- [Modulo 0 - Fundamentos](docs/00-modulo-fundamentos.md)
- [Modulo 0 - Estados y transiciones](docs/01-estados-y-transiciones.md)
- [Modulo 0 - Documentos, auditoria y modelo de datos](docs/02-documentos-auditoria-modelo-datos.md)
- [Modulo 0 - Arquitectura, entornos y pruebas](docs/03-arquitectura-entornos-y-pruebas.md)
- [Experiencias por rol y continuidad del POS](docs/04-experiencias-roles-y-modo-offline.md)
- [Códigos de barras y flujos de escaneo](docs/05-codigos-barras-y-flujos-escaneo.md)
- [Sistema visual y pantallas principales](docs/06-sistema-visual-y-pantallas.md)
- [Modulo 1 - Productos e inventario](docs/10-productos-inventario-especificacion.md)
- [Modulo 1 - Pantallas y recorridos](docs/11-productos-inventario-ux.md)
- [Modulo 1 - Modelo fisico de datos](docs/12-productos-inventario-modelo-fisico.md)
- [Modulo 1 - Contratos de API](docs/13-productos-inventario-api.md)
- [Modulo 1 - Decisiones y backlog tecnico](docs/14-productos-inventario-decisiones-backlog.md)
- [Desarrollo local](docs/20-desarrollo-local.md)
- [Prototipo navegable del Modulo 1](docs/visualizations/modulo-1-productos-inventario.html)

## Primer lanzamiento

El primer lanzamiento debe permitir registrar mercaderia, venderla, cobrarla y
consultar existencias y saldos con confianza.

## Tecnologia acordada

- Interfaz: React y TypeScript.
- API: ASP.NET Core 8 Web API.
- Base de datos: PostgreSQL.
- Moneda visible: cordobas (C$).
- Zona horaria de negocio: America/Managua.

