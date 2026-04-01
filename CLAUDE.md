# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Development (server + app concurrently)
pnpm dev
pnpm dev:server        # server only (http://localhost:4200)
pnpm dev:app           # React UI only (http://localhost:5740)
pnpm dev:web           # marketing website
pnpm dev:relay         # relay server

# Production
pnpm start             # builds + runs everything via scripts/start.sh (background with nohup)
pnpm stop              # graceful shutdown
pnpm status            # check server/app process status

# Build
pnpm build             # all packages

# Tests (server package only, using Vitest)
cd packages/server && pnpm test
cd packages/server && pnpm test:watch

# CLI
pnpm cli               # run CLI directly
```

Logs go to `.logs/server.log` and `.logs/app.log` in production.

## Architecture Overview

CodeCrab v2 is a pnpm monorepo (`packages/*`) — an AI-powered coding engine with cross-platform clients.

### Packages

| Package | Purpose |
|---|---|
| `packages/server` | Core engine — the backbone |
| `packages/shared` | WebSocket protocol types, model configs, shared interfaces |
| `packages/app` | React web UI (chat, file preview) |
| `packages/web` | Marketing/docs website |
| `packages/cli` | CLI for init/start/token management |
| `packages/relay` | Public WSS proxy for LAN deployments |
| `packages/channels` | Plugin registry (Telegram, extensible) |
| `packages/iOS` | SwiftUI native iOS app with LiveActivity & ShareExtension |

### Server Architecture (4 Layers)

**Gateway** (`packages/server/src/gateway/`) — Express + WebSocket entry point. Handles token auth, routing, broadcasting events to clients.

**Core** (`packages/server/src/core/`) — Orchestrates everything.
- `CoreEngine` (index.ts) — central coordinator, emits lifecycle events
- `TurnManager` (turn.ts) — executes user queries by invoking the agent
- `SessionManager` (session.ts) — persists sessions to disk
- `ProjectManager` (project.ts) — multi-project support (each with own path, provider config)
- `QueryQueue` (queue.ts) — per-project FIFO queue with priority support
- `MessageRouter` (message-router.ts) — routes inter-agent thread messages

**Agent** (`packages/server/src/agent/`) — Wraps `@anthropic-ai/claude-agent-sdk`.
- `ClaudeAgent` uses an `AsyncChannel` pattern for permission/question callbacks
- MCP extension servers are built per turn: `chrome`, `cron`, `push`, `threads`

**Soul** (`packages/server/src/soul/`) — Optional "idle evolution" feature. After a turn completes, a timer fires and Claude runs a self-improvement query autonomously.

**Cron** (`packages/server/src/cron/`) — Scheduled tasks (both cron expressions and one-shot `at` times). Supports catch-up execution for missed jobs.

### Turn Lifecycle

```
Client PromptMessage → WebSocket Gateway → CoreEngine.submitTurn()
→ QueryQueue (per-project FIFO) → TurnManager → ClaudeAgent
→ streaming events → AsyncChannel → Broadcaster → all connected clients
→ turn:close → Soul idle timer starts
```

### WebSocket Protocol

All client↔server communication uses typed messages defined in `packages/shared/src/protocol.ts`:
- `PromptMessage` — user query
- `CommandMessage` — system commands
- `AbortMessage` — cancel running turn
- `ResumeSessionMessage` — continue a previous session

### Key Patterns

- **AsyncChannel** — custom async iterator used in `agent/index.ts` to bridge the SDK's permission callbacks with async/await flow
- **Event-driven Core** — `CoreEngine` emits `turn:start`, `turn:close`, `queue:status`, etc.; other layers subscribe
- **Project-scoped isolation** — sessions, queues, and agents are all scoped per project
- **MCP Extensions** — `buildExtensionServers()` in agent layer creates per-turn MCP servers; each can block on a Promise for user permission

### Auth

Token-based. CLI generates a token stored locally; QR code in terminal enables auto-login. WebSocket connections validate token on connect via `gateway/auth.ts`.

### Relay

For LAN deployments: Browser ↔ WSS ↔ Relay (public) ↔ WSS ↔ LAN Server. Relay is a transparent forwarder — no data persistence, has rate limiting.

### iOS App

`packages/iOS/SPEC.md` (Chinese) contains the full implementation spec. Uses URLSession for REST/WebSocket, Keychain for token storage, LiveActivity for dynamic island.
