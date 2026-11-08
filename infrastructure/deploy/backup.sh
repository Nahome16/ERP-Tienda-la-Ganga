#!/usr/bin/env bash
# La Ganga ERP - respaldo de la base de datos.
#
# Uso:
#   ./backup.sh                 respaldo normal (el que corre el cron cada noche)
#   ./backup.sh antes-de-algo   respaldo con etiqueta (update.sh y restore.sh lo usan)
#
# Qué hace:
#   1. Genera un archivo comprimido con pg_dump (formato "custom").
#   2. Verifica que no esté vacío y que se pueda leer (pg_restore --list).
#   3. Guarda el nombre con fecha y hora de Managua y una suma de verificación.
#   4. Aplica la retención: 14 diarios + 8 semanales (configurable).
#   5. Opcional: copia el archivo fuera del servidor (rclone o scp).
#
# Variables (se leen del entorno o del archivo .env; todas son opcionales):
#   BACKUP_DIR            carpeta de respaldos        (por defecto: ./backups)
#   BACKUP_KEEP_DAILY     cuántos respaldos recientes conservar    (14)
#   BACKUP_KEEP_WEEKLY    cuántas semanas anteriores conservar     (8)
#   BACKUP_KEEP_LABELED   respaldos con etiqueta a conservar       (5)
#   BACKUP_REMOTE         copia externa: "rclone:remoto:carpeta" o "scp:usuario@host:/ruta/"
#   BACKUP_REMOTE_KEEP_DAYS  (solo rclone) borrar copias externas con más de N días
#   PG_EXEC               prefijo para ejecutar pg_dump (ver lib.sh; para pruebas)
set -Eeuo pipefail
umask 077

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
setup_pg

BACKUP_DIR="$(env_get BACKUP_DIR "$DEPLOY_DIR/backups")"
KEEP_DAILY="$(env_get BACKUP_KEEP_DAILY 14)"
KEEP_WEEKLY="$(env_get BACKUP_KEEP_WEEKLY 8)"
KEEP_LABELED="$(env_get BACKUP_KEEP_LABELED 5)"
MIN_BYTES="$(env_get BACKUP_MIN_BYTES 1024)"
BACKUP_REMOTE="$(env_get BACKUP_REMOTE "")"
REMOTE_KEEP_DAYS="$(env_get BACKUP_REMOTE_KEEP_DAYS "")"
LABEL="${1:-}"

for n in "$KEEP_DAILY" "$KEEP_WEEKLY" "$KEEP_LABELED" "$MIN_BYTES"; do
  [[ "$n" =~ ^[0-9]+$ ]] || fail "Las cantidades de retención deben ser números enteros (valor recibido: '$n')."
done
if [[ -n "$LABEL" ]]; then
  [[ "$LABEL" =~ ^[a-z0-9-]+$ ]] || fail "La etiqueta solo puede tener letras minúsculas, números y guiones (recibido: '$LABEL')."
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Un solo respaldo a la vez (por ejemplo, el cron y una persona al mismo tiempo).
exec 9>"$BACKUP_DIR/.backup.lock"
if ! flock -n 9; then
  fail "Ya hay otro respaldo en curso. Intente de nuevo en unos minutos."
fi

# Mantiene el registro pequeño (el cron escribe en backup.log).
LOG_FILE="$BACKUP_DIR/backup.log"
if [[ -f "$LOG_FILE" ]] && (( $(stat -c %s "$LOG_FILE") > 1048576 )); then
  tail -n 1000 "$LOG_FILE" >"$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

STAMP="$(TZ="$TZ_LOCAL" date +%Y-%m-%d_%H%M%S)"
NAME="la_ganga_${STAMP}${LABEL:+_$LABEL}.dump"
FINAL="$BACKUP_DIR/$NAME"
PARTIAL="$BACKUP_DIR/.$NAME.partial"
LISTING="$BACKUP_DIR/.$NAME.list"
trap 'rm -f "$PARTIAL" "$LISTING"' EXIT

info "Iniciando respaldo de la base '$PG_DB' -> $NAME"

# 1) Volcado comprimido
if ! pgx pg_dump -U "$PG_USER" -d "$PG_DB" --format=custom --compress=6 \
      --no-owner --no-privileges >"$PARTIAL"; then
  fail "pg_dump falló. No se creó ningún respaldo. Revise que la base de datos esté encendida: docker compose -f compose.prod.yml ps"
fi

# 2) Verificación: tamaño y legibilidad
SIZE="$(stat -c %s "$PARTIAL")"
if (( SIZE < MIN_BYTES )); then
  fail "El respaldo salió casi vacío (${SIZE} bytes). Se descartó."
fi
if ! pgx pg_restore --list <"$PARTIAL" >"$LISTING" 2>/dev/null; then
  fail "El respaldo generado no se puede leer (pg_restore --list falló). Se descartó."
fi
TABLES="$(grep -E '^[0-9]+; [0-9]+ [0-9]+ TABLE ' "$LISTING" | grep -vc ' TABLE DATA ' || true)"
DATA_ENTRIES="$(grep -cE ' TABLE DATA ' "$LISTING" || true)"
if (( TABLES < 1 )); then
  fail "El respaldo no contiene ninguna tabla. Se descartó."
fi
if (( DATA_ENTRIES < 1 )); then
  warn "El respaldo tiene tablas pero ninguna con datos (¿base nueva?)."
fi

# 3) Nombre definitivo + suma de verificación
mv "$PARTIAL" "$FINAL"
chmod 600 "$FINAL"
(cd "$BACKUP_DIR" && sha256sum "$NAME" >"$NAME.sha256")
chmod 600 "$BACKUP_DIR/$NAME.sha256"
HUMAN="$(du -h "$FINAL" | cut -f1)"
ok "Respaldo creado: $FINAL ($HUMAN, $TABLES tablas, $DATA_ENTRIES con datos)"

# 4) Retención ------------------------------------------------------------
delete_backup() {
  rm -f -- "$1" "$1.sha256"
  info "Retención: se eliminó $(basename "$1")"
}

apply_retention() {
  local -a daily=() labeled=()
  local f base idx date week kept_weeks=0
  local -A seen_weeks=()

  # De más nuevo a más viejo (el nombre ordena cronológicamente).
  while IFS= read -r f; do
    base="$(basename "$f")"
    if [[ "$base" =~ ^la_ganga_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\.dump$ ]]; then
      daily+=("$f")
    elif [[ "$base" =~ ^la_ganga_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}_[a-z0-9-]+\.dump$ ]]; then
      labeled+=("$f")
    fi
  done < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'la_ganga_*.dump' | sort -r)

  # Respaldos con etiqueta: se conservan los N más recientes.
  for idx in "${!labeled[@]}"; do
    if (( idx >= KEEP_LABELED )); then delete_backup "${labeled[$idx]}"; fi
  done

  # Respaldos normales: los N más recientes + el más reciente de cada semana anterior.
  for idx in "${!daily[@]}"; do
    f="${daily[$idx]}"
    (( idx < KEEP_DAILY )) && continue
    base="$(basename "$f")"
    date="${base:9:10}"
    week="$(date -d "$date" +%G-%V 2>/dev/null || echo "$date")"
    if [[ -z "${seen_weeks[$week]:-}" ]] && (( kept_weeks < KEEP_WEEKLY )); then
      seen_weeks[$week]=1
      kept_weeks=$((kept_weeks + 1))
    else
      delete_backup "$f"
    fi
  done
}
apply_retention

# 5) Copia externa (opcional) --------------------------------------------
REMOTE_STATUS=0
copy_remote() {
  case "$BACKUP_REMOTE" in
    "")
      return 0 ;;
    rclone:*)
      command -v rclone >/dev/null 2>&1 || { warn "BACKUP_REMOTE usa rclone pero rclone no está instalado."; return 1; }
      local dest="${BACKUP_REMOTE#rclone:}"
      info "Copiando a $dest con rclone ..."
      rclone copyto "$FINAL" "${dest%/}/$NAME" || return 1
      rclone copyto "$FINAL.sha256" "${dest%/}/$NAME.sha256" || return 1
      if [[ "$REMOTE_KEEP_DAYS" =~ ^[0-9]+$ ]] && (( REMOTE_KEEP_DAYS > 0 )); then
        rclone delete "$dest" --min-age "${REMOTE_KEEP_DAYS}d" || warn "No se pudieron limpiar copias externas viejas."
      fi
      ;;
    scp:*)
      command -v scp >/dev/null 2>&1 || { warn "BACKUP_REMOTE usa scp pero scp no está instalado."; return 1; }
      local target="${BACKUP_REMOTE#scp:}"
      info "Copiando a $target con scp ..."
      scp -q -o BatchMode=yes -o ConnectTimeout=20 "$FINAL" "$FINAL.sha256" "$target" || return 1
      ;;
    *)
      warn "BACKUP_REMOTE no se entiende ('$BACKUP_REMOTE'). Use rclone:remoto:carpeta o scp:usuario@host:/ruta/"
      return 1 ;;
  esac
  ok "Copia externa lista."
}
if ! copy_remote; then
  REMOTE_STATUS=1
  warn "La copia externa FALLÓ. El respaldo local sí está guardado."
fi

echo "$STAMP $NAME $SIZE bytes" >"$BACKUP_DIR/ULTIMO_RESPALDO_OK.txt"
info "Espacio libre en la carpeta de respaldos: $(df -h --output=avail "$BACKUP_DIR" | tail -n 1 | tr -d ' ')"
if (( REMOTE_STATUS != 0 )); then
  exit 3
fi
ok "Respaldo terminado."
