#!/usr/bin/env bash
# La Ganga ERP - programa el respaldo automático diario (por defecto 2:00 a. m. hora de Managua).
#
# Uso (con el mismo usuario que administra Docker, NO con sudo):
#   ./install-cron.sh              instala o actualiza la tarea a las 2:00 a. m.
#   ./install-cron.sh --hora 3     la deja a las 3:00 a. m.
#   ./install-cron.sh --estado     muestra si está instalada y cuál fue el último respaldo
#   ./install-cron.sh --quitar     la elimina
#
# Es seguro ejecutarlo varias veces: nunca duplica la tarea.
# Nota: cron usa la hora del servidor. setup-vps.sh deja el servidor en
# America/Managua, así que "2:00" significa 2:00 a. m. de Managua.
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

MARK="# la-ganga-respaldo"
HOUR=2
ACTION="install"

while (( $# > 0 )); do
  case "$1" in
    --hora)
      shift
      [[ "${1:-}" =~ ^([0-9]|1[0-9]|2[0-3])$ ]] || fail "--hora necesita un número de 0 a 23."
      HOUR="$1" ;;
    --quitar) ACTION="remove" ;;
    --estado) ACTION="status" ;;
    -h|--help|--ayuda) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Opción desconocida: $1 (use --ayuda)" ;;
  esac
  shift
done

if (( EUID == 0 )); then
  warn "Está ejecutando como root. Lo recomendable es el usuario que administra el sistema (el mismo que usa docker). Se instalará para root."
fi
command -v crontab >/dev/null 2>&1 || fail "No está instalado cron. Instálelo con: sudo apt-get install -y cron"

BACKUP_DIR="$(env_get BACKUP_DIR "$DEPLOY_DIR/backups")"
current="$(crontab -l 2>/dev/null || true)"
others="$(printf '%s\n' "$current" | grep -vF "$MARK" || true)"

case "$ACTION" in
  status)
    if printf '%s\n' "$current" | grep -qF "$MARK"; then
      ok "Respaldo automático instalado:"
      printf '%s\n' "$current" | grep -F "$MARK"
    else
      warn "El respaldo automático NO está instalado. Ejecute ./install-cron.sh"
    fi
    if [[ -f "$BACKUP_DIR/ULTIMO_RESPALDO_OK.txt" ]]; then
      echo "Último respaldo correcto: $(cat "$BACKUP_DIR/ULTIMO_RESPALDO_OK.txt")"
    else
      echo "Todavía no hay respaldos registrados en $BACKUP_DIR"
    fi
    exit 0 ;;
  remove)
    printf '%s\n' "$others" | sed '/^$/N;/^\n$/D' | crontab -
    ok "Se eliminó la tarea de respaldo automático."
    exit 0 ;;
esac

# Instalar / actualizar
zone="$(timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null || echo desconocida)"
if [[ "$zone" != "$TZ_LOCAL" ]]; then
  warn "La zona horaria del servidor es '$zone', no '$TZ_LOCAL'. El respaldo correrá a las $HOUR:00 de esa zona."
  warn "Para corregirlo: sudo timedatectl set-timezone $TZ_LOCAL"
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
line="0 $HOUR * * * \"$DEPLOY_DIR/backup.sh\" >> \"$BACKUP_DIR/backup.log\" 2>&1 $MARK"
{
  if [[ -n "$others" ]]; then printf '%s\n' "$others"; fi
  printf '%s\n' "$line"
} | crontab -

ok "Respaldo automático programado todos los días a las $HOUR:00 (hora del servidor: $zone)."
echo "Registro: $BACKUP_DIR/backup.log"
echo "Para probarlo ahora mismo, sin esperar a la noche:  $DEPLOY_DIR/backup.sh"
