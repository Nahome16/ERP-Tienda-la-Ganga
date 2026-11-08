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
Al crear la cuenta también carga los catálogos iniciales.

### Cargar los catálogos iniciales

Si la base ya tenía un administrador antes de este hito, cargá los catálogos
documentados en la especificación del Módulo 1 (marcas, cortes, tallas,
colores y categorías):

```powershell
dotnet run --project src/backend/LaGanga.Api -- --seed-catalogs
```

Cada catálogo se carga solo si está vacío, así que repetir el comando no
duplica datos ni pisa cambios hechos desde la pantalla **Catálogos**.

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
# Opcional: habilita las pruebas de integración contra PostgreSQL. Cada
# ejecución crea y elimina su propia base temporal.
$env:LA_GANGA_TEST_CONNECTION = "Host=localhost;Database=postgres;Username=la_ganga;Password=TU_CLAVE_LOCAL"
dotnet test LaGanga.sln --no-build

Set-Location src/frontend/la-ganga-web
npm run lint
npm run build
```

Sin `LA_GANGA_TEST_CONNECTION`, las pruebas de integración se omiten.

GitHub Actions (`.github/workflows/ci.yml`) ejecuta lo mismo en cada pull request
y en cada cambio a `master`: compila con advertencias como errores, verifica que
no falten migraciones, aplica las migraciones a una base vacía y corre todas las
pruebas contra PostgreSQL 16. Si el modelo cambió sin migración, el registro del
job incluye la migración generada para revisarla.

## Alcance actual

- Base ejecutable, acceso por sesión, roles y permisos.
- **Catálogos reales** (Hito 3): categorías jerárquicas, marcas, cortes, grupos
  de tallas, tallas y colores, guardados en PostgreSQL y editables desde
  **Catálogos** en el menú.
- El resto de los módulos sigue siendo un prototipo navegable con datos
  simulados: no confirma ventas ni modifica inventario real.
