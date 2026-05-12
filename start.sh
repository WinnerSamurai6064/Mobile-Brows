#!/bin/bash

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "▶ Starting Mobile Cloud Browser..."

export NODE_ENV=production
export PORT="${PORT:-3000}"

cd "$ROOT_DIR/server"

# Copy .env if missing
if [ ! -f .env ] && [ -f "$ROOT_DIR/.env.example" ]; then
  cp "$ROOT_DIR/.env.example" .env
fi

echo "  PORT     : $PORT"
echo "  NODE_ENV : $NODE_ENV"
echo "  URL      : http://$(hostname -I | awk '{print $1}'):$PORT"
echo ""

node server.js
