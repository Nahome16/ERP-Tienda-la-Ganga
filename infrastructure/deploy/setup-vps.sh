#!/usr/bin/env bash
# La Ganga ERP - preparación de un servidor Ubuntu 22.04 / 24.04 limpio.
#
# Qué hace (todo es seguro de repetir: si algo ya está hecho, lo salta):
#   1. Actualiza el sistema.
#   2. Pone la zona horaria America/Managua.
#   3. Instala Docker y el plugin "docker compose" (si no están).
#   4. Crea un usuario normal (no root) para administrar el sistema.
#   5. Configura el firewall (ufw): solo SSH, 80 y 443.
#   6. Instala fail2ban (bloquea a quien intente adivinar la contraseña por SSH).
#   7. Crea memoria de intercambio (swap) si el servidor tiene poca RAM.
#   8. Activa las actualizaciones automáticas de seguridad.
#
# Uso (como root, en el VPS recién creado):
#   bash setup-vps.sh
#   bash setup-vps.sh --usuario ganga       (nombre del usuario a crear; por defecto "ganga")
#
# NO cambia el acceso de root por SSH ni borra nada: no hay riesgo de quedarse
# sin acceso al servidor.
set -Eeuo pipefail

USUARIO="ganga"
TZ_LOCAL="America/Managua"
SWAP_SIZE_GB=2

paso() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
nota() { printf '  %s\n' "$*"; }
aviso() { printf '  \033[33mAVISO\033[0m  %s\n' "$*" >&2; }
fallo() { printf '\033[31mERROR\033[0m  %s\n' "$*" >&2; exit 1; }
trap 'fallo "Algo salió mal en la línea $LINENO. Corrija lo indicado arriba y vuelva a ejecutar el script: es seguro repetirlo."' ERR

while (( $# > 0 )); do
  case "$1" in
    --usuario)
      shift
      [[ "${1:-}" =~ ^[a-z][a-z0-9_-]{1,30}$ ]] || fallo "--usuario necesita un nombre en minúsculas (ej. ganga)."
      USUARIO="$1" ;;
    -h|--help|--ayuda) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) fallo "Opción desconocida: $1" ;;
  esac
  shift
done

# --- Comprobaciones previas ------------------------------------------------
(( EUID == 0 )) || fallo "Ejecute este script como root (o con sudo): sudo bash setup-vps.sh"

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if [[ "${ID:-}" != "ubuntu" ]]; then
    fallo "Este script es para Ubuntu (detectado: ${PRETTY_NAME:-desconocido})."
  fi
  case "${VERSION_ID:-}" in
    22.04|24.04) ok "Sistema detectado: ${PRETTY_NAME}" ;;
    *) aviso "Versión de Ubuntu no probada (${VERSION_ID:-?}). Se recomienda 22.04 o 24.04. Se continúa." ;;
  esac
fi

export DEBIAN_FRONTEND=noninteractive
export NEEDRESTART_MODE=a   # no pedir confirmación para reiniciar servicios

# --- 1) Actualizar el sistema ----------------------------------------------
paso "1/8  Actualizando el sistema (puede tardar unos minutos)"
apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
apt-get install -y ca-certificates curl gnupg git ufw fail2ban cron nano unattended-upgrades openssl
ok "Sistema actualizado y herramientas básicas instaladas."

# --- 2) Zona horaria -------------------------------------------------------
paso "2/8  Zona horaria $TZ_LOCAL"
if [[ "$(timedatectl show -p Timezone --value 2>/dev/null || true)" == "$TZ_LOCAL" ]]; then
  ok "Ya estaba configurada."
else
  timedatectl set-timezone "$TZ_LOCAL"
  ok "Zona horaria configurada: $(date '+%Z %z')."
fi

# --- 3) Docker ---------------------------------------------------------------
paso "3/8  Docker y docker compose"
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  ok "Docker ya está instalado: $(docker --version)"
else
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  ok "Docker instalado: $(docker --version)"
fi
systemctl enable --now docker
docker compose version >/dev/null 2>&1 || fallo "No se encontró 'docker compose'. Revise la instalación de Docker."

# --- 4) Usuario no root --------------------------------------------------------
paso "4/8  Usuario de administración '$USUARIO'"
if id "$USUARIO" >/dev/null 2>&1; then
  ok "El usuario '$USUARIO' ya existe."
else
  adduser --disabled-password --gecos "" "$USUARIO"
  ok "Usuario '$USUARIO' creado."
  NUEVO_USUARIO=1
fi
usermod -aG docker,sudo "$USUARIO"
ok "'$USUARIO' puede usar docker y sudo."

# Acceso por SSH: si root entra con llave, se copia la llave; si no, se pide una contraseña.
HOME_USUARIO="$(getent passwd "$USUARIO" | cut -d: -f6)"
if [[ -s /root/.ssh/authorized_keys ]]; then
  install -d -m 700 -o "$USUARIO" -g "$USUARIO" "$HOME_USUARIO/.ssh"
  touch "$HOME_USUARIO/.ssh/authorized_keys"
  # Agrega solo las llaves que falten.
  while IFS= read -r llave; do
    [[ -n "$llave" ]] || continue
    grep -qxF "$llave" "$HOME_USUARIO/.ssh/authorized_keys" || echo "$llave" >>"$HOME_USUARIO/.ssh/authorized_keys"
  done </root/.ssh/authorized_keys
  chown "$USUARIO:$USUARIO" "$HOME_USUARIO/.ssh/authorized_keys"
  chmod 600 "$HOME_USUARIO/.ssh/authorized_keys"
  ok "Se copiaron las llaves SSH de root a '$USUARIO'."
fi
if [[ "${NUEVO_USUARIO:-0}" == "1" ]]; then
  if [[ -s "$HOME_USUARIO/.ssh/authorized_keys" ]]; then
    nota "Puede entrar como '$USUARIO' con su llave SSH. (Opcional) defina también una contraseña, que sudo pedirá:"
  else
    nota "Defina ahora la contraseña de '$USUARIO' (con ella entrará por SSH y la usará con sudo):"
  fi
  if [[ -t 0 ]]; then
    passwd "$USUARIO" || aviso "No se definió la contraseña. Hágalo luego con: passwd $USUARIO"
  else
    aviso "No hay terminal interactiva. Defina la contraseña luego con: passwd $USUARIO"
  fi
fi

# --- 5) Firewall ----------------------------------------------------------------
paso "5/8  Firewall (ufw): SSH, 80 y 443"
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
SSH_PORT="${SSH_PORT:-22}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP (certificado SSL)' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow 443/udp comment 'HTTP/3' >/dev/null
ufw --force enable >/dev/null
ok "Firewall activo. Puertos abiertos: ${SSH_PORT} (SSH), 80, 443. Todo lo demás queda cerrado."
nota "La base de datos no se publica en ningún puerto, así que no es accesible desde internet."

# --- 6) fail2ban ----------------------------------------------------------------
paso "6/8  fail2ban (protección contra intentos de entrada por SSH)"
cat >/etc/fail2ban/jail.d/la-ganga.local <<EOF
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port    = ${SSH_PORT}
EOF
systemctl enable fail2ban >/dev/null 2>&1
systemctl restart fail2ban
ok "fail2ban activo: 5 intentos fallidos en 10 minutos bloquean la IP por 1 hora."

# --- 7) Swap ------------------------------------------------------------------------
paso "7/8  Memoria de intercambio (swap)"
RAM_MB="$(awk '/^MemTotal:/{printf "%d", $2/1024}' /proc/meminfo)"
SWAP_ACTIVO="$(swapon --show --noheadings 2>/dev/null || true)"
if [[ -n "$SWAP_ACTIVO" ]]; then
  ok "Ya hay swap activo: $(printf '%s\n' "$SWAP_ACTIVO" | awk '{print $1" "$3}' | paste -sd, -)"
elif (( RAM_MB >= 3500 )); then
  ok "El servidor tiene ${RAM_MB} MB de RAM; no hace falta swap."
else
  nota "RAM: ${RAM_MB} MB. Creando swap de ${SWAP_SIZE_GB} GB para evitar que se agote la memoria al compilar..."
  if [[ ! -f /swapfile ]]; then
    fallocate -l "${SWAP_SIZE_GB}G" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=$((SWAP_SIZE_GB * 1024)) status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -qE '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "Swap de ${SWAP_SIZE_GB} GB activo."
fi
cat >/etc/sysctl.d/99-la-ganga.conf <<EOF
vm.swappiness = 10
EOF
sysctl -q --system >/dev/null 2>&1 || true

# --- 8) Actualizaciones automáticas de seguridad ------------------------------------------
paso "8/8  Actualizaciones automáticas de seguridad"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
ok "Activadas (instalan solo parches de seguridad; no reinician el servidor solas)."

if [[ -f /var/run/reboot-required ]]; then
  aviso "El sistema pide reiniciar para terminar de aplicar actualizaciones. Reinicie con: reboot"
  nota "(Después del reinicio, entre de nuevo por SSH y continúe con la guía.)"
fi

trap - ERR
printf '\n\033[1m\033[32mServidor listo.\033[0m\n'
cat <<EOF

Siguientes pasos:
  1. Salga de esta sesión (exit) y entre como el usuario nuevo:
       ssh ${USUARIO}@IP_DE_SU_SERVIDOR
  2. Descargue el sistema y configúrelo siguiendo docs/21-despliegue-hostinger.md
       (sección "Instalar La Ganga").

EOF
