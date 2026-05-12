#!/bin/bash
set -e

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Mobile Cloud Browser — Installer       ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. System packages ──────────────────────────────────────────────────────
echo "▶ Updating apt packages..."
sudo apt update -y
sudo apt install -y curl git wget unzip ca-certificates gnupg lsb-release

# ── 2. Node.js 20 ───────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v)" != v20* ]]; then
  echo "▶ Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
else
  echo "✓ Node.js $(node -v) already installed"
fi

echo "✓ Node: $(node -v)  |  npm: $(npm -v)"

# ── 3. npm dependencies ─────────────────────────────────────────────────────
echo "▶ Installing npm dependencies..."
cd "$(dirname "$0")/server"
npm install

# ── 4. Playwright + Chromium ────────────────────────────────────────────────
echo "▶ Installing Playwright Chromium browser..."
npx playwright install chromium

echo "▶ Installing Playwright system dependencies..."
npx playwright install-deps chromium

cd ..

# ── 5. downloads folder ─────────────────────────────────────────────────────
echo "▶ Creating downloads folder..."
mkdir -p downloads

# ── 6. .env ─────────────────────────────────────────────────────────────────
if [ ! -f server/.env ]; then
  echo "▶ Creating server/.env from example..."
  cp .env.example server/.env
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅  Installation complete!              ║"
echo "║                                          ║"
echo "║   Run:  ./start.sh                       ║"
echo "║   Open: http://YOUR_VM_IP:3000           ║"
echo "╚══════════════════════════════════════════╝"
echo ""
