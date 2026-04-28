// MCP extension registry for server-v2
//
// Central registry of all available MCP extension servers.
// Each entry defines an id, metadata, and the tools array.
// At query time, only enabled extensions are registered with the SDK.

import { createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'
import { tools as chromeTools } from './chrome/tools.js'
import { buildCronTools, CRON_TOOL_COUNT } from './cron/tools.js'
import { tools as pushTools } from './push/tools.js'
import { buildThreadTools, THREAD_TOOL_COUNT } from './threads/tools.js'
import { isApnsConfigured } from '../../push/apns.js'

/** Per-query context bound into MCP tool closures. */
export interface ExtensionContext {
  projectId?: string
  sessionId?: string
  agentId?: string
}

export interface McpExtension {
  id: string
  name: string
  description: string
  icon: string
  toolCount: number
  /** Build tools with per-query context. Tools without per-query state ignore ctx. */
  buildTools: (ctx: ExtensionContext) => unknown[]
}

/** All registered MCP extension definitions */
const extensions: McpExtension[] = [
  {
    id: 'chrome',
    name: 'Chrome',
    description: 'Browser automation via Chrome DevTools Protocol — navigate, screenshot, click, type, evaluate JS',
    icon: '🌐',
    toolCount: chromeTools.length,
    buildTools: () => chromeTools,
  },
  {
    id: 'cron',
    name: 'Cron',
    description: 'Scheduled tasks — create reminders, recurring jobs, and timed actions via natural language',
    icon: '⏰',
    toolCount: CRON_TOOL_COUNT,
    buildTools: (ctx) => buildCronTools({ projectId: ctx.projectId, sessionId: ctx.sessionId }),
  },
  {
    id: 'push',
    name: 'Push',
    description: 'Send push notifications to iOS devices via Apple Push Notification service',
    icon: '🔔',
    toolCount: pushTools.length,
    buildTools: () => pushTools,
  },
  {
    id: 'threads',
    name: 'Threads',
    description: 'Inter-agent communication — send messages, share artifacts, manage collaboration threads',
    icon: '🔗',
    toolCount: THREAD_TOOL_COUNT,
    buildTools: (ctx) => buildThreadTools({ agentId: ctx.agentId, sessionId: ctx.sessionId }),
  },
]

/** Register a new extension at runtime */
export function registerExtension(ext: McpExtension): void {
  extensions.push(ext)
}

/** Get all registered extensions (copy) */
export function getExtensions(): McpExtension[] {
  return [...extensions]
}

/** Get extension info for client consumption */
export function getAvailableExtensions(): Array<{
  id: string
  name: string
  description: string
  icon: string
  toolCount: number
}> {
  return extensions
    .filter((ext) => ext.id !== 'push' || isApnsConfigured())
    .map((ext) => ({
      id: ext.id,
      name: ext.name,
      description: ext.description,
      icon: ext.icon,
      toolCount: ext.toolCount,
    }))
}

/**
 * Build mcpServers object for SDK query, filtered by enabled extension IDs.
 * If enabledMcps is undefined/null, all extensions are enabled (default).
 *
 * The `ctx` param binds per-query state (projectId, sessionId, agentId) into
 * tool closures so concurrent turns across different projects do NOT share
 * mutable global state.
 */
export function buildExtensionServers(
  enabledMcps?: string[],
  ctx: ExtensionContext = {},
): Record<string, unknown> {
  const servers: Record<string, unknown> = {}

  for (const ext of extensions) {
    if (!enabledMcps || enabledMcps.includes(ext.id)) {
      if (ext.id === 'push' && !isApnsConfigured()) continue

      const tools = ext.buildTools(ctx)
      if (tools.length > 0) {
        servers[ext.id] = createSdkMcpServer({
          name: ext.id,
          tools: tools as any,
        })
      }
    }
  }

  return servers
}
