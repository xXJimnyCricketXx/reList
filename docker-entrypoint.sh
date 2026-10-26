#!/bin/sh
# Startet als root, übergibt den Datenordner an PUID/PGID und läuft dann ohne Root-Rechte weiter.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
