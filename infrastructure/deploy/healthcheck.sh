#!/usr/bin/env bash
# Comprobación de salud de la API (se ejecuta DENTRO del contenedor "api").
# La imagen de ASP.NET no trae curl ni wget, por eso se usa bash puro.
# Responde 0 si GET /health devuelve 200, y 1 en cualquier otro caso.
set -eu
port="${HEALTHCHECK_PORT:-8080}"
path="${HEALTHCHECK_PATH:-/health}"
# "localhost" debe estar permitido en AllowedHosts (compose.prod.yml ya lo hace).
host="${HEALTHCHECK_HOST:-localhost}"

exec 3<>"/dev/tcp/127.0.0.1/${port}"
printf 'GET %s HTTP/1.0\r\nHost: %s\r\nX-Forwarded-Proto: https\r\nConnection: close\r\n\r\n' \
  "$path" "$host" >&3
IFS= read -r -t 4 status <&3 || exit 1
case "$status" in
  "HTTP/"*" 200"*) exit 0 ;;
  *) exit 1 ;;
esac
