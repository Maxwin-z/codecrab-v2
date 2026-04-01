#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"
LOG_DIR="$ROOT_DIR/.logs"

mkdir -p "$PID_DIR" "$LOG_DIR"

# Check if already running
if [ -f "$PID_DIR/server.pid" ]; then
  PID=$(cat "$PID_DIR/server.pid")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Already running (server PID=$PID). Run 'pnpm stop' first."
    exit 1
  fi
fi

echo "Building shared..."
cd "$ROOT_DIR/packages/shared" && pnpm build

echo "Building server..."
cd "$ROOT_DIR/packages/server" && pnpm build

echo "Building app..."
cd "$ROOT_DIR/packages/app" && pnpm build

SERVER_LOG="$LOG_DIR/server.log"
APP_LOG="$LOG_DIR/app.log"

echo "Starting server in background..."
cd "$ROOT_DIR/packages/server"
> "$SERVER_LOG"
nohup node dist/index.js >> "$SERVER_LOG" 2>&1 &
echo $! > "$PID_DIR/server.pid"

echo "Starting app preview in background..."
cd "$ROOT_DIR/packages/app"
> "$APP_LOG"
nohup pnpm preview >> "$APP_LOG" 2>&1 &
echo $! > "$PID_DIR/app.pid"

# Wait for server to boot and show QR code from log
echo ""
echo "Waiting for server to start..."
for i in $(seq 1 20); do
  if grep -q "Scan QR code" "$SERVER_LOG" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

# Get LAN IP address
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')

echo ""
echo "════════════════════════════════════════"
# Print everything from server log up to and including the QR code block
awk '/Scan QR code/,0' "$SERVER_LOG" | head -30
echo "════════════════════════════════════════"
echo ""
echo "  Web UI  → http://localhost:5740"
if [ -n "$LAN_IP" ]; then
  echo "           http://$LAN_IP:5740"
fi
echo "  API     → http://localhost:4200"
if [ -n "$LAN_IP" ]; then
  echo "           http://$LAN_IP:4200"
fi
echo ""
echo "  Logs: .logs/server.log  |  .logs/app.log"
echo "  Run 'pnpm stop' to stop"
