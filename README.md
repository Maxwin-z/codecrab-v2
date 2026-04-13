# CodeCrab v2

AI-powered coding engine with a React web UI, iOS app, and CLI.

## Requirements

- Node.js 20+
- pnpm 10+
- pm2 (`npm install -g pm2`)

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure server port (optional, default is 42001 in production)
#    Edit packages/server/.env
PORT=42001

# 3. Build and start all services via pm2
pnpm pm2
```

On first boot, a QR code is printed to the terminal. Scan it with the iOS app to connect, or open the web UI at `http://localhost:5740`.

## Start / Stop / Status

```bash
pnpm pm2          # build + start (server, app, frpc if configured)
pm2 stop ecosystem.config.cjs    # stop all processes
pm2 delete ecosystem.config.cjs  # stop and unregister all processes
pm2 list          # show process status
pm2 logs          # tail all logs
```

Logs are written to `.logs/`:

| File | Description |
|---|---|
| `.logs/server-out.log` | API server stdout |
| `.logs/server-error.log` | API server stderr |
| `.logs/app-out.log` | Web UI stdout |
| `.logs/app-error.log` | Web UI stderr |
| `.logs/frpc-out.log` | frpc tunnel stdout (if enabled) |

## Port Configuration

### API server port

Edit `packages/server/.env`:

```env
PORT=42001
```

The server listens on `0.0.0.0` so it is reachable from other devices on the LAN.

### Web UI port

The web UI (`vite preview`) runs on port **5740** by default, configured in `packages/app/vite.config.ts`. To change it, update the `preview.port` field:

```ts
preview: {
  port: 5740,   // change here
  ...
}
```

### Connecting the web UI to a different server

The web UI proxies `/api` and `/ws` to the API server. The proxy target port is read from `VITE_API_PORT` (defaults to `4200` in dev, `42001` in production via `ecosystem.config.cjs`).

To point the UI at a remote server instead, open the web UI, go to Settings, and enter the server URL (e.g. `http://192.168.1.10:42001`). This is saved in browser localStorage under `codecrab_server_url`.

### frpc tunnel (optional)

If `/opt/homebrew/bin/frpc` and `/opt/homebrew/etc/frp/frpc.toml` both exist, pm2 will automatically start frpc alongside the server. Otherwise it is silently skipped.

## Development

```bash
pnpm dev           # server + app with hot reload
pnpm dev:server    # server only (port 4200)
pnpm dev:app       # web UI only (port 5740, proxies to port 4200)
pnpm dev:relay     # relay server
```

## Packages

| Package | Description |
|---|---|
| `packages/server` | Core API server |
| `packages/app` | React web UI |
| `packages/shared` | Shared protocol types |
| `packages/cli` | CLI (init, token management) |
| `packages/relay` | Public WSS proxy for remote access |
| `packages/channels` | Plugin registry (Telegram, etc.) |
| `packages/iOS` | SwiftUI iOS app |
| `packages/web` | Marketing website |
