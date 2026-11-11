#!/usr/bin/env bash
# La Ganga ERP - restaurar un respaldo de la base de datos.
#
# Uso:
#   ./restore.sh --solo-verificar [archivo]   PRUEBA la restauración en una base
#                                             temporal y la borra. No toca la base
#                                             real. Es seguro hacerlo cuando quiera.
#   ./restore.sh [archivo]                    RESTAURA de verdad (reemplaza los datos
#                                             actuales por los del respaldo).
#
# Si no indica archivo, se muestra la lista de respaldos para elegir.
#
# Cómo funciona (restauración real):
#   1. Revisa el archivo (suma de verificación y que se pueda leer).
#   2. Pide confirmación escribiendo la palabra RESTAURAR.
#   3. Restaura primero en una base NUEVA y la valida (tablas y filas).
#   4. Hace un respaldo de seguridad de la base actual ("antes-de-restaurar").
#   5. Detiene la API, intercambia las bases (la actual queda guardada con el
#      sufijo _antes_FECHA) y vuelve a encender la API.
#
# Variables para pruebas: PG_EXEC (ver lib.sh), APP_STOP_CMD y APP_START_CMD
# (por defecto detienen/inician el servicio "api" con docker compose).
set -Eeuo pipefail
umask 077

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
setup_pg

BACKUP_DIR="$(env_get BACKUP_DIR "$DEPLOY_DIR/backups")"
VERIFY_ONLY=0
FILE=""

while (( $# > 0 )); do
  case "$1" in
    --solo-verificar|--verificar) VERIFY_ONLY=1 ;;
    -h|--help|--ayuda)
      sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) fail "Opción desconocida: $1 (use --ayuda)" ;;
    *) FILE="$1" ;;
  esac
  shift
done

# Comandos para detener/iniciar la API (arreglos, para no usar eval).
if [[ -n "${APP_STOP_CMD+x}" ]]; then read -r -a STOP_ARR <<<"$APP_STOP_CMD"; else STOP_ARR=(docker compose -f "$COMPOSE_FILE" stop api); fi
if [[ -n "${APP_START_CMD+x}" ]]; then read -r -a START_ARR <<<"$APP_START_CMD"; else START_ARR=(docker compose -f "$COMPOSE_FILE" start api); fi

# --- Elegir archivo -------------------------------------------------------
if [[ -z "$FILE" ]]; then
  mapfile -t CANDIDATES < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'la_ganga_*.dump' 2>/dev/null | sort -r)
  (( ${#CANDIDATES[@]} > 0 )) || fail "No hay respaldos en $BACKUP_DIR"
  echo "Respaldos disponibles (el más reciente primero):"
  for i in "${!CANDIDATES[@]}"; do
    printf '  %2d) %s  (%s)\n' "$((i + 1))" "$(basename "${CANDIDATES[$i]}")" "$(du -h "${CANDIDATES[$i]}" | cut -f1)"
    (( i >= 19 )) && { echo "  ... (se muestran solo los 20 más recientes)"; break; }
  done
  printf 'Número del respaldo (Enter = el 1, el más reciente): '
  IFS= read -r CHOICE || CHOICE=""
  CHOICE="${CHOICE:-1}"
  if ! [[ "$CHOICE" =~ ^[0-9]+$ ]] || (( CHOICE < 1 || CHOICE > ${#CANDIDATES[@]} )); then fail "Opción inválida."; fi
  FILE="${CANDIDATES[$((CHOICE - 1))]}"
fi
[[ -f "$FILE" ]] || fail "No existe el archivo: $FILE"
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

# --- 1) Revisar el archivo ----------------------------------------------
info "Revisando $(basename "$FILE") ..."
(( $(stat -c %s "$FILE") > 0 )) || fail "El archivo está vacío."
if [[ -f "$FILE.sha256" ]]; then
  if (cd "$(dirname "$FILE")" && sha256sum --check --status "$(basename "$FILE").sha256"); then
    ok "Suma de verificación correcta."
  else
    fail "La suma de verificación NO coincide: el archivo está dañado o fue modificado."
  fi
else
  warn "No hay archivo .sha256 junto al respaldo; no se puede verificar su integridad."
fi
LISTING="$(mktemp)"
pgx pg_restore --list <"$FILE" >"$LISTING" 2>/dev/null || { rm -f "$LISTING"; fail "El archivo no es un respaldo válido de PostgreSQL."; }
# Tablas de TODOS los esquemas (catalog, sales, inventory, identity, system, public…),
# no solo «public»: los datos de La Ganga viven en esquemas propios.
EXPECTED_TABLES="$(grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE ' "$LISTING" | grep -vc ' TABLE DATA ' || true)"
EXPECTED_SCHEMAS="$(grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE ' "$LISTING" | grep -v ' TABLE DATA ' | awk '{print $5}' | sort -u | paste -sd ' ' -)"
rm -f "$LISTING"
(( EXPECTED_TABLES > 0 )) || fail "El respaldo no contiene ninguna tabla."
ok "El archivo es legible: $EXPECTED_TABLES tablas (esquemas: $EXPECTED_SCHEMAS)."

# --- 2) Confirmación ----------------------------------------------------
if (( VERIFY_ONLY == 1 )); then
  info "Modo PRUEBA: se restaurará en una base temporal y luego se borrará. Los datos reales no se tocan."
else
  cat <<MSG

${C_RED}${C_BLD}ATENCIÓN${C_OFF}: va a REEMPLAZAR los datos actuales de '$PG_DB' por los de:
  $(basename "$FILE")
Todo lo registrado DESPUÉS de ese respaldo se perderá (ventas, cambios de
inventario, usuarios). Antes de reemplazar se guardará un respaldo de seguridad
de lo que hay ahora, y el sistema estará fuera de servicio unos minutos.

MSG
  confirm_exact "RESTAURAR" || fail "Cancelado. No se cambió nada."
fi

# --- 3) Restaurar en una base nueva -------------------------------------
SUFFIX="$(TZ="$TZ_LOCAL" date +%Y%m%d%H%M%S)"
TMP_DB="${PG_DB}_verif_${SUFFIX}"
CLEANUP_DB=""
cleanup() {
  if [[ -n "$CLEANUP_DB" ]]; then
    psql_admin "DROP DATABASE IF EXISTS \"$CLEANUP_DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

info "Creando base temporal '$TMP_DB' y restaurando (puede tardar) ..."
psql_admin "CREATE DATABASE \"$TMP_DB\"" >/dev/null
CLEANUP_DB="$TMP_DB"
pgx pg_restore -U "$PG_USER" -d "$TMP_DB" --no-owner --no-privileges --exit-on-error <"$FILE" \
  || fail "La restauración en la base temporal falló. La base real NO se tocó."

# --- 4) Validar -----------------------------------------------------------
ACTUAL_TABLES="$(pgx psql -U "$PG_USER" -d "$TMP_DB" -v ON_ERROR_STOP=1 -qtAX -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg\\_%' AND table_type='BASE TABLE'")"
[[ "$ACTUAL_TABLES" == "$EXPECTED_TABLES" ]] \
  || fail "Validación fallida: se esperaban $EXPECTED_TABLES tablas y hay $ACTUAL_TABLES. La base real NO se tocó."

COUNTS="$(pgx psql -U "$PG_USER" -d "$TMP_DB" -v ON_ERROR_STOP=1 -qtAX -F ' ' -c \
  "SELECT table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') AND table_schema NOT LIKE 'pg\\_%' AND table_type='BASE TABLE' ORDER BY 1")"
TOTAL_ROWS=0
EMPTY_TABLES=0
echo "Contenido de la base restaurada (tablas con datos: filas):"
while read -r tname tcount; do
  [[ -n "$tname" ]] || continue
  if (( tcount > 0 )); then
    printf '  %-48s %s\n' "$tname" "$tcount"
  else
    EMPTY_TABLES=$((EMPTY_TABLES + 1))
  fi
  TOTAL_ROWS=$((TOTAL_ROWS + tcount))
done <<<"$COUNTS"
(( EMPTY_TABLES == 0 )) || echo "  (+ $EMPTY_TABLES tablas todavía vacías)"
(( TOTAL_ROWS > 0 )) || fail "La base restaurada no tiene ninguna fila. La base real NO se tocó."

HAS_HISTORY="$(pgx psql -U "$PG_USER" -d "$TMP_DB" -qtAX -c "SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL")"
if [[ "$HAS_HISTORY" == "t" ]]; then
  MIGRATIONS="$(pgx psql -U "$PG_USER" -d "$TMP_DB" -qtAX -c 'SELECT count(*) FROM "__EFMigrationsHistory"')"
  (( MIGRATIONS > 0 )) || fail "El historial de migraciones está vacío: el respaldo no parece ser de La Ganga."
  info "Migraciones registradas: $MIGRATIONS"
else
  warn "No se encontró la tabla __EFMigrationsHistory (¿es un respaldo de La Ganga?)."
fi
ok "Restauración validada: $EXPECTED_TABLES tablas, $TOTAL_ROWS filas en total."

if (( VERIFY_ONLY == 1 )); then
  psql_admin "DROP DATABASE \"$TMP_DB\" WITH (FORCE)" >/dev/null
  CLEANUP_DB=""
  ok "PRUEBA EXITOSA: este respaldo se puede restaurar. La base temporal fue borrada y los datos reales no se tocaron."
  exit 0
fi

# --- 5) Respaldo de seguridad e intercambio -------------------------------
info "Guardando un respaldo de seguridad de la base actual ..."
"$DEPLOY_DIR/backup.sh" antes-de-restaurar || fail "No se pudo hacer el respaldo de seguridad. No se cambió nada."

OLD_DB="${PG_DB}_antes_${SUFFIX}"
info "Deteniendo la API ..."
"${STOP_ARR[@]}" || warn "No se pudo detener la API; se continúa y se cierran las conexiones a la fuerza."

swap_ok=0
restart_app() {
  info "Iniciando la API ..."
  "${START_ARR[@]}" || warn "No se pudo iniciar la API. Inicie manualmente: docker compose -f compose.prod.yml start api"
}

if psql_admin "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$PG_DB' AND pid <> pg_backend_pid()" >/dev/null \
   && psql_admin "ALTER DATABASE \"$PG_DB\" RENAME TO \"$OLD_DB\"" >/dev/null; then
  if psql_admin "ALTER DATABASE \"$TMP_DB\" RENAME TO \"$PG_DB\"" >/dev/null; then
    swap_ok=1
    CLEANUP_DB=""   # la base temporal ahora es la real: no borrarla
  else
    warn "No se pudo poner la base restaurada en su lugar; devolviendo la base original."
    psql_admin "ALTER DATABASE \"$OLD_DB\" RENAME TO \"$PG_DB\"" >/dev/null || warn "No se pudo devolver la base original: revise a mano."
  fi
fi
if (( swap_ok == 0 )); then
  restart_app
  fail "No se pudo intercambiar las bases. Se dejó todo como estaba."
fi

restart_app
if [[ -z "${RESTORE_SKIP_WAIT:-}" ]] && [[ -z "${APP_START_CMD+x}" ]]; then
  if wait_healthy api 180; then ok "La API volvió a responder."; else warn "La API no reporta estado saludable; revise: docker compose -f compose.prod.yml logs --tail=100 api"; fi
fi

ok "RESTAURACIÓN TERMINADA con $(basename "$FILE")."
echo "La base anterior se conservó como '$OLD_DB' por seguridad. Cuando confirme que todo está bien,"
echo "puede borrarla para liberar espacio con:"
echo "  ${PG_EXEC_ARR[*]} psql -U $PG_USER -d postgres -c 'DROP DATABASE \"$OLD_DB\"'"
