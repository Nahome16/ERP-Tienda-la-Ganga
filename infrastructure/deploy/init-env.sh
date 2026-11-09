#!/usr/bin/env bash
# La Ganga ERP - crea el archivo .env de producción de forma guiada.
#
# Uso:
#   ./init-env.sh               pregunta los datos y crea .env (con clave de base de datos generada)
#   ./init-env.sh --quitar-admin   borra los datos de creación del administrador inicial
#                                  (hágalo apenas termine de crear el administrador)
set -Eeuo pipefail
umask 077

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

if [[ "${1:-}" == "--quitar-admin" ]]; then
  [[ -f "$ENV_FILE" ]] || fail "No existe $ENV_FILE"
  sed -i 's/^LA_GANGA_ADMIN_PASSWORD=.*/LA_GANGA_ADMIN_PASSWORD=/' "$ENV_FILE"
  sed -i 's/^LA_GANGA_ADMIN_EMAIL=.*/LA_GANGA_ADMIN_EMAIL=/' "$ENV_FILE"
  ok "Se borraron los datos de creación del administrador inicial de $ENV_FILE"
  exit 0
fi

if [[ -f "$ENV_FILE" ]]; then
  warn "Ya existe $ENV_FILE."
  echo "Si lo reemplaza, se generará una contraseña NUEVA de base de datos y la actual"
  echo "dejará de coincidir con la base ya creada. Solo reemplácelo si aún no inició el sistema."
  confirm_exact "REEMPLAZAR" || fail "Cancelado. No se cambió nada."
  cp -p "$ENV_FILE" "$ENV_FILE.respaldo-$(TZ="$TZ_LOCAL" date +%Y%m%d%H%M%S)"
fi

ask() { # ask "pregunta" [defecto] -> responde en $REPLY
  local prompt="$1" default="${2:-}"
  if [[ -n "$default" ]]; then prompt="$prompt [$default]"; fi
  printf '%s: ' "$prompt"
  IFS= read -r REPLY || fail "Se cerró la entrada antes de terminar. Vuelva a ejecutar ./init-env.sh"
  REPLY="${REPLY:-$default}"
}

echo "Vamos a crear el archivo de configuración. Responda cada pregunta."
echo

while true; do
  ask "Dominio del sistema (ej. sistema.mitienda.com, sin https://)"
  DOMINIO="$(printf '%s' "$REPLY" | tr '[:upper:]' '[:lower:]')"
  [[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$ ]] && break
  warn "Ese dominio no parece válido. Escríbalo sin https:// ni barras."
done

while true; do
  ask "Correo del administrador (para avisos del certificado HTTPS)"
  ACME_EMAIL="$REPLY"
  [[ "$ACME_EMAIL" =~ ^[^[:space:]@\'\"]+@[^[:space:]@\'\"]+\.[^[:space:]@\'\"]+$ ]] && break
  warn "Ese correo no parece válido."
done

while true; do
  ask "Usuario del administrador inicial" "administrador"
  ADMIN_USER="$REPLY"
  [[ "$ADMIN_USER" =~ ^[A-Za-z0-9._-]+$ ]] && break
  warn "Use solo letras, números, punto, guion o guion bajo (sin espacios)."
done

while true; do
  ask "Nombre completo que se mostrará" "Administrador La Ganga"
  ADMIN_NAME="$REPLY"
  [[ -n "$ADMIN_NAME" && "$ADMIN_NAME" != *"'"* ]] && break
  warn "Escriba un nombre sin apóstrofos."
done

while true; do
  ask "Correo de acceso del administrador inicial" "$ACME_EMAIL"
  ADMIN_EMAIL="$REPLY"
  [[ "$ADMIN_EMAIL" =~ ^[^[:space:]@\'\"]+@[^[:space:]@\'\"]+\.[^[:space:]@\'\"]+$ ]] && break
  warn "Ese correo no parece válido."
done

ask "Servidor SMTP (ej. smtp.gmail.com)"
EMAIL_HOST="$REPLY"
[[ -n "$EMAIL_HOST" && "$EMAIL_HOST" != *"'"* ]] || fail "El servidor SMTP no puede quedar vacío ni contener apóstrofos."
ask "Puerto SMTP" "587"
EMAIL_PORT="$REPLY"
[[ "$EMAIL_PORT" =~ ^[0-9]+$ ]] && (( EMAIL_PORT >= 1 && EMAIL_PORT <= 65535 )) || fail "Puerto SMTP inválido."
ask "Usuario SMTP (normalmente el correo remitente)" "$ADMIN_EMAIL"
EMAIL_USERNAME="$REPLY"
[[ "$EMAIL_USERNAME" != *"'"* ]] || fail "El usuario SMTP no puede contener apóstrofos."
printf 'Contraseña SMTP o contraseña de aplicación (no se ve al escribir): '
IFS= read -r -s EMAIL_PASSWORD || fail "Se cerró la entrada antes de terminar. Vuelva a ejecutar ./init-env.sh"
echo
[[ -n "$EMAIL_PASSWORD" && "$EMAIL_PASSWORD" != *"'"* ]] || fail "La contraseña SMTP no puede quedar vacía ni contener apóstrofos."
ask "Correo remitente" "$EMAIL_USERNAME"
EMAIL_FROM_ADDRESS="$REPLY"
[[ "$EMAIL_FROM_ADDRESS" != *"'"* ]] || fail "El remitente no puede contener apóstrofos."

command -v openssl >/dev/null 2>&1 || fail "Falta openssl (sudo apt-get install -y openssl)."
DB_PASS="$(openssl rand -hex 24)"

TEMPLATE="$DEPLOY_DIR/.env.example"
{
  echo "# La Ganga ERP - configuración de producción. Generado por init-env.sh el $(TZ="$TZ_LOCAL" date '+%Y-%m-%d %H:%M')."
  echo "# NO subir a Git ni compartir. Permisos: solo su usuario."
  echo
  printf 'DOMINIO=%s\n' "$DOMINIO"
  printf 'ACME_EMAIL=%s\n' "$ACME_EMAIL"
  echo
  echo "POSTGRES_DB=la_ganga"
  echo "POSTGRES_USER=la_ganga"
  printf 'POSTGRES_PASSWORD=%s\n' "$DB_PASS"
  echo
  printf "EMAIL_HOST='%s'\n" "$EMAIL_HOST"
  printf 'EMAIL_PORT=%s\n' "$EMAIL_PORT"
  printf "EMAIL_USERNAME='%s'\n" "$EMAIL_USERNAME"
  printf "EMAIL_PASSWORD='%s'\n" "$EMAIL_PASSWORD"
  printf "EMAIL_FROM_ADDRESS='%s'\n" "$EMAIL_FROM_ADDRESS"
  echo "EMAIL_FROM_NAME='Tienda La Ganga'"
  echo "EMAIL_ENABLE_SSL=true"
  echo
  echo "# Administrador inicial: BORRE estos datos después de crearlo (./init-env.sh --quitar-admin)."
  printf "LA_GANGA_ADMIN_USERNAME='%s'\n" "$ADMIN_USER"
  printf "LA_GANGA_ADMIN_DISPLAY_NAME='%s'\n" "$ADMIN_NAME"
  printf "LA_GANGA_ADMIN_EMAIL='%s'\n" "$ADMIN_EMAIL"
  echo "LA_GANGA_ADMIN_PASSWORD="
  echo
  echo "TZ=America/Managua"
  echo
  if [[ -f "$TEMPLATE" ]]; then sed -n '/^# ---- Respaldos/,$p' "$TEMPLATE"; fi
} >"$ENV_FILE"
chmod 600 "$ENV_FILE"

ok "Se creó $ENV_FILE (permisos 600)."
echo
echo "Siguiente paso:  docker compose -f compose.prod.yml up -d --build"
echo "El administrador recibirá un código por correo al ejecutar --bootstrap-admin."
