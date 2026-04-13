#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.logs"
mkdir -p "$LOG_DIR"

# Check pm2 is available
if ! command -v pm2 &>/dev/null; then
  echo "pm2 not found. Install it with: npm install -g pm2"
  exit 1
fi

echo "Building shared..."
cd "$ROOT_DIR/packages/shared" && pnpm build

echo "Building server..."
cd "$ROOT_DIR/packages/server" && pnpm build

echo "Building app..."
cd "$ROOT_DIR/packages/app" && pnpm build

cd "$ROOT_DIR"

echo "Starting with pm2..."
pm2 start ecosystem.config.cjs

pm2 save

# Wait for server to boot
echo ""
echo "Waiting for server to start..."
for i in $(seq 1 20); do
  if grep -q "Scan QR code" "$LOG_DIR/server-out.log" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# Get LAN IP
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo "════════════════════════════════════════"
awk '/Scan QR code/,0' "$LOG_DIR/server-out.log" 2>/dev/null | head -30
echo "════════════════════════════════════════"
echo ""
echo "  App  → http://localhost:5740"
[ -n "$LAN_IP" ] && echo "         http://$LAN_IP:5740"
echo "  API  → http://localhost:42001"
[ -n "$LAN_IP" ] && echo "         http://$LAN_IP:42001"
echo ""
echo "  Logs: .logs/server-out.log  |  .logs/app-out.log  |  .logs/frpc-out.log"
echo "  pm2 status:  pm2 list"
echo "  pm2 stop:    pm2 stop ecosystem.config.cjs"
echo "  pm2 delete:  pm2 delete ecosystem.config.cjs"
echo ""
