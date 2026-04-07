#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Kill any process on port 4200
PID=$(lsof -ti :4200 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "Killing process on port 4200 (PID=$PID)..."
  kill -9 $PID
fi

cd "$ROOT_DIR"
pnpm dev:server
