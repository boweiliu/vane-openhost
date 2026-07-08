#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/vane}"
APP_DATA_DIR="${OPENHOST_APP_DATA_DIR:-/data/app_data/vane}"
VANE_DATA_DIR="$APP_DATA_DIR/data"
VANE_UPLOADS_DIR="$APP_DATA_DIR/uploads"

mkdir -p "$VANE_DATA_DIR" "$VANE_UPLOADS_DIR"
rm -rf "$APP_DIR/data" "$APP_DIR/uploads"
ln -s "$VANE_DATA_DIR" "$APP_DIR/data"
ln -s "$VANE_UPLOADS_DIR" "$APP_DIR/uploads"

export DATA_DIR="$APP_DATA_DIR"
export SEARXNG_API_URL="${SEARXNG_API_URL:-https://searxng.oh.bowei.in/}"
export HOSTNAME=127.0.0.1
export PORT="${VANE_PORT:-3000}"
export APP_PORT="${APP_PORT:-8080}"
export VANE_PORT="${VANE_PORT:-3000}"

echo "[entrypoint] app dir: $APP_DIR"
echo "[entrypoint] data dir: $APP_DATA_DIR"
echo "[entrypoint] searxng: $SEARXNG_API_URL"

echo "[entrypoint] seeding Vane config from OpenHost secrets..."
node /app/openhost/seed-config.mjs || echo "[entrypoint] config seeding failed; continuing with existing/default config"

cd "$APP_DIR"
node server.js &
vane_pid=$!

caddy run --config /app/Caddyfile --adapter caddyfile &
caddy_pid=$!

trap 'kill "$vane_pid" "$caddy_pid" 2>/dev/null || true' EXIT
wait -n "$vane_pid" "$caddy_pid"
