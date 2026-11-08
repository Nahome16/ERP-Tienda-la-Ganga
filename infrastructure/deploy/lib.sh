#!/usr/bin/env bash
# La Ganga ERP - funciones comunes de los scripts de despliegue.
# Este archivo se "incluye" desde los otros scripts (source); no se ejecuta solo.
# shellcheck shell=bash

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/../.." && pwd)"
export REPO_DIR
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env}"
COMPOSE_FILE="$DEPLOY_DIR/compose.prod.yml"
TZ_LOCAL="America/Managua"

# cron usa un PATH mínimo; nos aseguramos de encontrar docker, flock, etc.
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_BLD=""; C_OFF=""
fi

now_ts() { TZ="$TZ_LOCAL" date '+%Y-%m-%d %H:%M:%S'; }
info() { printf '[%s] %s\n' "$(now_ts)" "$*"; }
ok()   { printf '[%s] %sOK%s  %s\n' "$(now_ts)" "$C_GRN" "$C_OFF" "$*"; }
warn() { printf '[%s] %sAVISO%s  %s\n' "$(now_ts)" "$C_YEL" "$C_OFF" "$*" >&2; }
fail() { printf '[%s] %sERROR%s  %s\n' "$(now_ts)" "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

# env_get CLAVE [VALOR_POR_DEFECTO]
# Lee primero la variable de entorno y, si no existe, el archivo .env.
# No se usa "source" a propósito: así una contraseña con símbolos no rompe nada.
env_get() {
  local key="$1" default="${2:-}" line value
  if [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
    return 0
  fi
  if [[ -f "$ENV_FILE" ]]; then
    line="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      value="${line#*=}"
      value="${value%$'\r'}"
      if [[ "$value" =~ ^\'(.*)\'[[:space:]]*$ ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$value" =~ ^\"(.*)\"[[:space:]]*$ ]]; then
        value="${BASH_REMATCH[1]}"
      else
        value="${value%%[[:space:]]#*}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
      fi
      if [[ -n "$value" ]]; then
        printf '%s' "$value"
        return 0
      fi
    fi
  fi
  printf '%s' "$default"
}

dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Prefijo para ejecutar las herramientas de PostgreSQL (pg_dump, psql, ...).
#  - Por defecto: dentro del contenedor "db" con docker compose.
#  - PG_EXEC="" (vacío): usa las herramientas instaladas en este mismo equipo
#    (sirve para pruebas; combine con PGHOST/PGPASSWORD o "env PGPASSWORD=x").
#  - PG_EXEC="otro comando ...": cualquier prefijo (palabras separadas por espacios).
setup_pg() {
  PG_USER="$(env_get POSTGRES_USER la_ganga)"
  PG_DB="$(env_get POSTGRES_DB la_ganga)"
  [[ "$PG_USER" =~ ^[A-Za-z0-9_]+$ ]] || fail "POSTGRES_USER solo puede tener letras, números y guion bajo."
  [[ "$PG_DB" =~ ^[A-Za-z0-9_]+$ ]] || fail "POSTGRES_DB solo puede tener letras, números y guion bajo."
  if [[ -n "${PG_EXEC+x}" ]]; then
    PG_EXEC_ARR=()
    if [[ -n "$PG_EXEC" ]]; then
      read -r -a PG_EXEC_ARR <<<"$PG_EXEC"
    fi
  else
    PG_EXEC_ARR=(docker compose -f "$COMPOSE_FILE" exec -T db)
  fi
}

# pgx COMANDO ARGS...  -> ejecuta la herramienta de PostgreSQL con el prefijo elegido
pgx() { "${PG_EXEC_ARR[@]}" "$@"; }

# psql_admin "SQL" -> ejecuta SQL en la base de mantenimiento "postgres"
psql_admin() {
  pgx psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -qtAX -c "$1"
}

# Espera a que un servicio de compose reporte "healthy".
# wait_healthy SERVICIO [SEGUNDOS]
wait_healthy() {
  local service="$1" timeout="${2:-180}" waited=0 cid status
  while (( waited < timeout )); do
    cid="$(dc ps -q "$service" 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || echo desconocido)"
      case "$status" in
        healthy|running) return 0 ;;
        unhealthy|exited|dead) return 1 ;;
      esac
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

# Pregunta que exige escribir una palabra exacta. Lee de la entrada estándar.
confirm_exact() {
  local word="$1" answer
  printf '%s' "Para continuar escriba exactamente ${C_BLD}${word}${C_OFF} y presione Enter (cualquier otra cosa cancela): "
  IFS= read -r answer || answer=""
  [[ "$answer" == "$word" ]]
}
