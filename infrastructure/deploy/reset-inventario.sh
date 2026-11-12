#!/usr/bin/env bash
# La Ganga ERP - dejar el inventario en cero para cargarlo de nuevo.
#
# Uso (desde esta carpeta, con el usuario que administra Docker):
#   ./reset-inventario.sh            muestra qué se borra, pide confirmación y lo hace
#   ./reset-inventario.sh --contar   solo muestra qué se borraría (no cambia nada)
#
# BORRA: productos, tallas/colores (variantes), códigos de fábrica, fotos, registro de etiquetas,
#        existencias, lotes por socio, Kardex, y además las ventas, pagos,
#        cambios, autorizaciones de descuento y turnos de caja (todo eso está
#        ligado a los productos). Los recibos vuelven a empezar en V-000001 y
#        los cambios en CT-000001.
# CONSERVA: usuarios y roles, socios, catálogos (marcas, categorías, cortes,
#        colores, tallas), las cajas, la configuración y la bitácora de auditoría.
#        Los códigos internos de etiqueta NO se reinician: así una etiqueta vieja
#        nunca coincide con un producto nuevo.
#
# Seguridad:
#   1. Pide escribir BORRAR INVENTARIO.
#   2. Hace antes un respaldo completo (base + fotos) y guarda una copia en
#      backups/conservar/ (fuera de la limpieza automática de respaldos).
#   3. Si queda alguna caja abierta, se detiene: cierre las cajas y espere a que
#      no haya ventas pendientes de enviar en ninguna caja.
#   4. El borrado es una sola transacción: si algo falla, no se borra nada.
#   Para deshacerlo: ./restore.sh backups/conservar/<archivo del respaldo>
# shellcheck source=lib.sh
set -Eeuo pipefail
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$DEPLOY_DIR/lib.sh"

COUNT_ONLY=0
while (( $# > 0 )); do
  case "$1" in
    --contar|--solo-contar) COUNT_ONLY=1 ;;
    -h|--help|--ayuda) sed -n '2,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Opción desconocida: $1 (use --ayuda)" ;;
  esac
  shift
done

setup_pg
BACKUP_DIR="$(env_get BACKUP_DIR "$DEPLOY_DIR/backups")"
if [[ -n "${APP_STOP_CMD+x}" ]]; then read -r -a STOP_ARR <<<"$APP_STOP_CMD"; else STOP_ARR=(docker compose -f "$COMPOSE_FILE" stop api); fi
if [[ -n "${APP_START_CMD+x}" ]]; then read -r -a START_ARR <<<"$APP_START_CMD"; else START_ARR=(docker compose -f "$COMPOSE_FILE" start api); fi
if [[ -n "${IMAGES_CLEAR_CMD+x}" ]]; then read -r -a CLEAR_ARR <<<"$IMAGES_CLEAR_CMD"; else CLEAR_ARR=(docker compose -f "$COMPOSE_FILE" exec -T api find /data/images -mindepth 1 -delete); fi

# Orden: primero lo que depende de otras tablas.
WIPE_TABLES=(
  sales.sale_exchange_lines sales.sale_exchanges sales.sale_payments sales.sale_lines
  sales.sales sales.discount_approvals sales.cash_sessions
  inventory.lot_allocations inventory.inventory_movements inventory.stock_lots
  inventory.stock_balances inventory.product_color_barcodes inventory.product_images
  inventory.label_prints inventory.product_variants inventory.products
)

sql() { pgx psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -qtAX -c "$1"; }

# --- 1) Qué se va a borrar ---------------------------------------------------
echo "Esto se borrará (tabla: filas):"
TOTAL=0
for table in "${WIPE_TABLES[@]}"; do
  rows="$(sql "SELECT count(*) FROM $table")"
  printf '  %-36s %s\n' "$table" "$rows"
  TOTAL=$((TOTAL + rows))
done
echo "Se conservan: $(sql "SELECT count(*) FROM identity.users") usuarios, $(sql "SELECT count(*) FROM inventory.partners") socios, $(sql "SELECT count(*) FROM catalog.brands") marcas, $(sql "SELECT count(*) FROM catalog.colors") colores, $(sql "SELECT count(*) FROM catalog.sizes") tallas, $(sql "SELECT count(*) FROM sales.cash_registers") cajas y la configuración."

if (( COUNT_ONLY == 1 )); then
  ok "Solo conteo: no se cambió nada."
  exit 0
fi
(( TOTAL > 0 )) || { ok "El inventario ya está vacío. No hay nada que borrar."; exit 0; }

OPEN_SESSIONS="$(sql "SELECT count(*) FROM sales.cash_sessions WHERE \"ClosedAtUtc\" IS NULL")"
if (( OPEN_SESSIONS > 0 )); then
  fail "Hay $OPEN_SESSIONS caja(s) abierta(s). Cierre todas las cajas y revise que no tengan ventas pendientes de enviar; luego vuelva a correr este comando. No se cambió nada."
fi

cat <<MSG

${C_RED}${C_BLD}ATENCIÓN${C_OFF}: se borrarán $TOTAL registros: TODOS los productos, existencias, fotos,
Kardex, ventas, cambios y turnos de caja. Los recibos volverán a empezar en V-000001.
Antes se hará un respaldo completo para poder deshacerlo.

MSG
confirm_exact "BORRAR INVENTARIO" || fail "Cancelado. No se cambió nada."

# --- 2) Respaldo previo (base + fotos) ----------------------------------------
info "Haciendo el respaldo previo..."
"$DEPLOY_DIR/backup.sh" antes-de-reiniciar-inventario || fail "El respaldo previo falló, así que NO se borró nada."
KEEP_DIR="$BACKUP_DIR/conservar"
mkdir -p "$KEEP_DIR"
LAST_DUMP="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'la_ganga_*antes-de-reiniciar-inventario.dump' | sort -r | head -n 1)"
[[ -n "$LAST_DUMP" ]] || fail "No encontré el respaldo recién creado. No se borró nada."
cp -p "$LAST_DUMP" "$LAST_DUMP.sha256" "$KEEP_DIR/" 2>/dev/null || cp -p "$LAST_DUMP" "$KEEP_DIR/"
LAST_IMAGES="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'imagenes_*antes-de-reiniciar-inventario.tar.gz' | sort -r | head -n 1)"
[[ -n "$LAST_IMAGES" ]] && cp -p "$LAST_IMAGES" "$KEEP_DIR/"
ok "Copia guardada en $KEEP_DIR (no la borra la limpieza automática)."

# --- 3) Borrar fotos ------------------------------------------------------------
info "Borrando las fotos de los productos..."
"${CLEAR_ARR[@]}" || warn "No se pudieron borrar las fotos del disco (quedan archivos sueltos, no afectan el sistema)."

# --- 4) Borrar datos (una sola transacción) -------------------------------------
info "Deteniendo la API..."
"${STOP_ARR[@]}" >/dev/null
restart_api() { "${START_ARR[@]}" >/dev/null || warn "No se pudo encender la API: docker compose -f compose.prod.yml start api"; }
trap restart_api EXIT

TABLE_LIST="$(IFS=,; echo "${WIPE_TABLES[*]}")"
info "Borrando productos, existencias, ventas y cajas..."
pgx psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;
TRUNCATE $TABLE_LIST;
ALTER SEQUENCE sales.sale_number_seq RESTART WITH 1;
ALTER SEQUENCE sales.exchange_number_seq RESTART WITH 1;
COMMIT;
SQL

LEFT="$(sql "SELECT (SELECT count(*) FROM inventory.products) + (SELECT count(*) FROM sales.sales)")"
[[ "$LEFT" == "0" ]] || fail "Quedaron registros sin borrar ($LEFT). Revise y, si hace falta, restaure: ./restore.sh $KEEP_DIR/$(basename "$LAST_DUMP")"

info "Encendiendo la API..."
trap - EXIT
restart_api
ok "Inventario en cero. Ya puede cargar los productos de nuevo."
echo "En cada caja: recargue la página (Ctrl+Shift+R) para que el catálogo de la caja quede vacío."
echo "Para deshacerlo: ./restore.sh $KEEP_DIR/$(basename "$LAST_DUMP")"
