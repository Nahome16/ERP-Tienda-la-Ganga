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

**MVP operativo (objetivo: 10 de noviembre de 2026)** — todo lo visible es funcional:

- Punto de venta con escáner, descuentos, pagos mixtos (efectivo C$/US$, transferencia, tarjeta) y recibo interno opcional.
- **Modo sin conexión**: el POS abre sin internet (PWA), vende contra una copia local y sincroniza solo, sin duplicar ventas.
- Dos cajas independientes (Caja 1 y Caja 2) con apertura, cierre y arqueo por moneda, más cierre consolidado.
- Productos con variantes talla/color, código de barras (EAN-13 interno si no trae), etiquetas e importación desde Excel/CSV.
- Inventario con Kardex, ajustes con motivo y alertas de stock.
- Ventas: historial, anulación con reversión de inventario y revisión de ventas con diferencias.
- Roles y permisos validados en el servidor, auditoría de acciones sensibles y configuración (tasa del dólar, bancos, datos del recibo).
- Kit de despliegue para VPS (Docker, SSL automático, respaldos): ver [Despliegue](docs/21-despliegue-hostinger.md).

Base técnica: ASP.NET Core 8 (API, aplicación, dominio, infraestructura), React + TypeScript, PostgreSQL 16, pruebas unitarias y de integración en CI.

Fuera del MVP (siguientes fases): catálogo digital, compras, clientes y CRM, reportes avanzados, devoluciones parciales, 2FA.

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
- [MVP - Contrato de API](docs/30-mvp-contrato-api.md)
- [Despliegue en VPS (Hostinger)](docs/21-despliegue-hostinger.md)
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

