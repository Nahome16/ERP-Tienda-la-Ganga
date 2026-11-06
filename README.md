# La Ganga ERP

Sistema comercial para administrar Tienda La Ganga: productos, variantes,
inventario, ventas, cobros, clientes y, en etapas posteriores, compras, caja,
pedidos, entregas y catalogo digital.

![Logo de Tienda La Ganga](docs/assets/logo-tienda-la-ganga.png)

El proyecto se encuentra en fase de diseno funcional. No se deben programar
reglas marcadas como **Propuesta** o **Pendiente** hasta que sean confirmadas.

## Documentacion actual

- [Modulo 0 - Fundamentos](docs/00-modulo-fundamentos.md)
- [Modulo 0 - Estados y transiciones](docs/01-estados-y-transiciones.md)
- [Modulo 0 - Documentos, auditoria y modelo de datos](docs/02-documentos-auditoria-modelo-datos.md)
- [Modulo 0 - Arquitectura, entornos y pruebas](docs/03-arquitectura-entornos-y-pruebas.md)
- [Modulo 1 - Productos e inventario](docs/10-productos-inventario-especificacion.md)
- [Modulo 1 - Pantallas y recorridos](docs/11-productos-inventario-ux.md)
- [Modulo 1 - Modelo fisico de datos](docs/12-productos-inventario-modelo-fisico.md)
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

