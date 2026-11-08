#!/usr/bin/env bash
# La Ganga ERP - actualizar el sistema a la versión más reciente.
#
# Uso (desde esta carpeta, con el usuario que administra Docker):
#   ./update.sh                 actualiza (respaldo automático -> descarga -> compila -> reinicia -> verifica)
#   ./update.sh --forzar        reconstruye y reinicia aunque no haya cambios nuevos
#   ./update.sh --sin-respaldo  omite el respaldo previo (NO recomendado)
#   ./update.sh --revertir      vuelve a la versión que había antes de la última actualización
#
# Qué hace, en orden:
#   1. Descarga los cambios (git fetch) y muestra qué cambia.
#   2. Hace un respaldo de la base de datos ("antes-de-actualizar").
#   3. Compila las imágenes nuevas SIN apagar el sistema actual (si falla aquí, no pasa nada).
#   4. Reinicia los servicios con la versión nueva.
#   5. Espera a que la API responda como saludable y comprueba el sitio.
#   6. Si algo falla, le dice exactamente cómo volver atrás (--revertir).
set -Eeuo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

FORCE=0
SKIP_BACKUP=0
REVERT=0
VERSION_FILE="$DEPLOY_DIR/.ultima-version"

while (( $# > 0 )); do
  case "$1" in
    --forzar) FORCE=1 ;;
    --sin-respaldo) SKIP_BACKUP=1 ;;
    --revertir) REVERT=1 ;;
    -h|--help|--ayuda) sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "Opción desconocida: $1 (use --ayuda)" ;;
  esac
  shift
done

[[ -f "$ENV_FILE" ]] || fail "No existe $ENV_FILE. Cree primero la configuración con ./init-env.sh"
command -v docker >/dev/null 2>&1 || fail "Docker no está instalado. Ejecute antes setup-vps.sh"
docker info >/dev/null 2>&1 || fail "No tengo permiso para usar Docker. ¿Entró con el usuario correcto? (debe pertenecer al grupo docker)"
git -C "$REPO_DIR" rev-parse --git-dir >/dev/null 2>&1 || fail "$REPO_DIR no es un repositorio de Git."

show_status() {
  echo
  dc ps
  echo
}

rebuild_and_restart() {
  info "Compilando imágenes (la primera vez tarda varios minutos)..."
  dc build
  info "Reiniciando servicios con la versión nueva..."
  dc up -d --remove-orphans
}

verify_deploy() {
  info "Esperando a que la API esté saludable (hasta 4 minutos)..."
  if ! wait_healthy api 240; then
    return 1
  fi
  ok "La API responde correctamente."
  if ! wait_healthy web 60; then
    warn "El servidor web no reporta estado saludable."
    return 1
  fi
  local dominio
  dominio="$(env_get DOMINIO "")"
  if [[ -n "$dominio" ]] && command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 15 -o /dev/null "https://$dominio/api/health"; then
      ok "https://$dominio/api/health responde (certificado y DNS correctos)."
    else
      warn "No se pudo abrir https://$dominio/api/health desde el servidor."
      warn "Si es la primera instalación, puede que el DNS o el certificado aún no estén listos; revise: docker compose -f compose.prod.yml logs --tail=50 web"
    fi
  fi
  return 0
}

print_failure_help() {
  cat <<EOF

${C_RED}${C_BLD}La actualización no terminó bien.${C_OFF}
Para ver qué pasó:
  docker compose -f compose.prod.yml logs --tail=100 api
  docker compose -f compose.prod.yml logs --tail=50 web

Para volver a la versión anterior (lo más rápido):
  ./update.sh --revertir

Si después de volver atrás el sistema sigue mal, restaure la base con el respaldo
hecho justo antes de actualizar:
  ./restore.sh
  (elija el más reciente cuyo nombre termina en "antes-de-actualizar")
EOF
}

# ---------------------------------------------------------------------------
if (( REVERT == 1 )); then
  [[ -f "$VERSION_FILE" ]] || fail "No hay una versión anterior registrada (.ultima-version). No se puede revertir automáticamente."
  PREV_SHA="$(sed -n '1p' "$VERSION_FILE")"
  [[ "$PREV_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "El archivo .ultima-version está dañado."
  git -C "$REPO_DIR" cat-file -e "$PREV_SHA^{commit}" 2>/dev/null || fail "La versión anterior ($PREV_SHA) ya no está en este servidor."
  echo "Versión actual:   $(git -C "$REPO_DIR" log -1 --format='%h %s (%cd)' --date=short HEAD)"
  echo "Se volverá a:     $(git -C "$REPO_DIR" log -1 --format='%h %s (%cd)' --date=short "$PREV_SHA")"
  echo
  echo "Esto NO deshace cambios en la base de datos. Si la versión nueva modificó la base y el"
  echo "sistema anterior no funciona, use después ./restore.sh con el respaldo 'antes-de-actualizar'."
  confirm_exact "REVERTIR" || fail "Cancelado. No se cambió nada."
  git -C "$REPO_DIR" reset --hard "$PREV_SHA"
  rebuild_and_restart
  if verify_deploy; then
    ok "Se volvió a la versión anterior y el sistema responde."
  else
    print_failure_help
    exit 1
  fi
  show_status
  exit 0
fi

# --- 1) Descargar cambios ----------------------------------------------------------
if [[ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]]; then
  git -C "$REPO_DIR" status --short --untracked-files=no
  fail "Hay archivos del sistema modificados a mano en el servidor (lista arriba). Revíselos antes de actualizar: no se tocó nada."
fi
git -C "$REPO_DIR" rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || fail "La rama actual no está enlazada a un repositorio remoto."

OLD_SHA="$(git -C "$REPO_DIR" rev-parse HEAD)"
info "Buscando cambios nuevos..."
git -C "$REPO_DIR" fetch --prune
NEW_SHA="$(git -C "$REPO_DIR" rev-parse '@{u}')"

if [[ "$OLD_SHA" == "$NEW_SHA" && $FORCE -eq 0 ]]; then
  ok "Ya tiene la versión más reciente ($(git -C "$REPO_DIR" log -1 --format='%h %s' HEAD)). No hay nada que actualizar."
  echo "(Use ./update.sh --forzar para reconstruir de todos modos.)"
  exit 0
fi
if ! git -C "$REPO_DIR" merge-base --is-ancestor "$OLD_SHA" "$NEW_SHA"; then
  fail "La versión del servidor y la del repositorio divergieron (no es una actualización simple). Pida ayuda técnica; no se tocó nada."
fi
if [[ "$OLD_SHA" != "$NEW_SHA" ]]; then
  echo "Cambios que se van a instalar:"
  git -C "$REPO_DIR" log --format='  %h %s (%cd)' --date=short "$OLD_SHA..$NEW_SHA" | head -n 30
  echo
fi

# --- 2) Respaldo previo -----------------------------------------------------------------
if (( SKIP_BACKUP == 1 )); then
  warn "Se omite el respaldo previo (--sin-respaldo)."
else
  info "Haciendo el respaldo previo..."
  if ! "$DEPLOY_DIR/backup.sh" antes-de-actualizar; then
    fail "El respaldo previo falló, así que NO se actualizó nada. Corrija el respaldo (o use --sin-respaldo bajo su responsabilidad)."
  fi
fi

# Guardar la versión actual para poder volver atrás.
printf '%s\n%s\n' "$OLD_SHA" "$(TZ="$TZ_LOCAL" date '+%Y-%m-%d %H:%M:%S')" >"$VERSION_FILE"

# --- 3) Traer el código y compilar -----------------------------------------------------------
if [[ "$OLD_SHA" != "$NEW_SHA" ]]; then
  git -C "$REPO_DIR" merge --ff-only '@{u}'
fi

info "Compilando imágenes nuevas (el sistema actual sigue funcionando mientras tanto)..."
if ! dc build; then
  warn "La compilación falló. Se vuelve al código anterior; el sistema sigue con la versión que tenía."
  git -C "$REPO_DIR" reset --hard "$OLD_SHA"
  fail "No se actualizó nada. Avise a quien mantiene el sistema (muestre el mensaje de error de arriba)."
fi

# --- 4) Reiniciar --------------------------------------------------------------------------------
info "Reiniciando servicios con la versión nueva..."
dc up -d --remove-orphans

# --- 5) Verificar --------------------------------------------------------------------------------
if verify_deploy; then
  info "Limpiando imágenes viejas..."
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter 'until=168h' >/dev/null 2>&1 || true
  show_status
  ok "Actualización terminada: $(git -C "$REPO_DIR" log -1 --format='%h %s' HEAD)"
  echo "Pida a las cajas que recarguen la página (o cierren y abran la aplicación) para recibir la versión nueva."
else
  print_failure_help
  exit 1
fi
