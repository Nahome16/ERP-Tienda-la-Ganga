# Desarrollo local

Esta guía levanta la base técnica del ERP sin cargar datos comerciales ni
inventario de demostración.

## Requisitos

- .NET SDK 8 o posterior capaz de compilar `net8.0`.
- Node.js 20.19 o 22.13 como mínimo.
- Docker Desktop en ejecución para PostgreSQL.

## 1. Base de datos

Desde la raíz del repositorio:

```powershell
Copy-Item infrastructure/docker/.env.example infrastructure/docker/.env
docker compose --env-file infrastructure/docker/.env -f infrastructure/docker/compose.yml up -d
```

El valor de ejemplo es solo para desarrollo local. Antes de compartir un
entorno, debe reemplazarse con una contraseña secreta. El archivo `.env` no se
versiona.

## 2. API

```powershell
dotnet restore LaGanga.sln
dotnet run --project src/backend/LaGanga.Api
```

La API queda en `http://localhost:5185`. Sus comprobaciones son:

- `GET /api/health`: respuesta JSON usada por la interfaz.
- `GET /health`: comprobación técnica simple.

## 3. Interfaz

En otra terminal:

```powershell
Set-Location src/frontend/la-ganga-web
npm install
npm run dev
```

Abrir `http://127.0.0.1:5173`. Vite redirige las solicitudes `/api` hacia la
API local.

## 4. Verificación antes de guardar cambios

```powershell
dotnet build LaGanga.sln
dotnet test LaGanga.sln --no-build

Set-Location src/frontend/la-ganga-web
npm run lint
npm run build
```

## Alcance del hito

Este hito establece la solución, la separación de proyectos, la interfaz base,
la comprobación de conexión y PostgreSQL local. El modelo de productos,
migraciones y operaciones de inventario se implementan en el siguiente hito.
