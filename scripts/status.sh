#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"

check_process() {
  local name=$1
  local pid_file="$PID_DIR/$name.pid"

  if [ ! -f "$pid_file" ]; then
    echo "  $name: stopped"
    return
  fi

  local PID
  PID=$(cat "$pid_file")

  if kill -0 "$PID" 2>/dev/null; then
    echo "  $name: running (PID=$PID)"
  else
    echo "  $name: stopped (stale PID=$PID)"
    rm -f "$pid_file"
  fi
}

echo "Status:"
check_process "server"
check_process "app"
