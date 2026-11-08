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
$env:ConnectionStrings__DefaultConnection = "Host=localhost;Database=la_ganga_dev;Username=la_ganga;Password=TU_CLAVE_LOCAL"
dotnet tool restore
dotnet ef database update --project src/backend/LaGanga.Infrastructure --startup-project src/backend/LaGanga.Api
dotnet run --project src/backend/LaGanga.Api
```

La API queda en `http://localhost:5185`. Sus comprobaciones son:

- `GET /api/health`: respuesta JSON usada por la interfaz.
- `GET /health`: comprobación técnica simple.

### Crear la primera cuenta administradora

La migración debe estar aplicada y PostgreSQL en ejecución. Usá una contraseña
local de al menos 12 caracteres y no la guardés en Git:

```powershell
$env:LA_GANGA_ADMIN_USERNAME = "administrador"
$env:LA_GANGA_ADMIN_DISPLAY_NAME = "Administradora La Ganga"
$env:LA_GANGA_ADMIN_PASSWORD = "UNA_CLAVE_LOCAL_SEGURA"
dotnet run --project src/backend/LaGanga.Api -- --bootstrap-admin

Remove-Item Env:LA_GANGA_ADMIN_USERNAME
Remove-Item Env:LA_GANGA_ADMIN_DISPLAY_NAME
Remove-Item Env:LA_GANGA_ADMIN_PASSWORD
```

El comando sólo crea la cuenta cuando todavía no existe ningún usuario. Las
contraseñas se almacenan mediante el hash seguro provisto por ASP.NET Core.

La autenticación utiliza una cookie de sesión `HttpOnly`, una sesión revocable
en PostgreSQL y un token CSRF separado para operaciones protegidas. La interfaz
consulta `GET /api/v1/auth/me` y dirige Administrador al panel o Vendedor al POS.

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

El repositorio contiene la base ejecutable, el acceso por sesión, roles y
permisos, la migración inicial de identidad y el prototipo navegable de los
módulos. Los formularios de demostración todavía no confirman operaciones
comerciales ni modifican inventario real.
