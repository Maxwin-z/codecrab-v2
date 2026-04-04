import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { listSessions as sdkListSessions } from '@anthropic-ai/claude-agent-sdk'
import type { SessionInfo, ChatMessage } from '@codecrab/shared'
import type { SessionMeta, ProjectConfig, PermissionMode, SessionUsage } from '../types/index.js'
import { createEmptyUsage } from '../types/index.js'

const META_DIR = join(homedir(), '.codecrab', 'session-meta')

export class SessionManager {
  // In-memory cache: sdkSessionId -> SessionMeta
  private metas = new Map<string, SessionMeta>()

  // Idle callbacks keyed by meta object — survives session ID remapping (pending → real SDK ID)
  private idleCallbacks = new Map<SessionMeta, Array<() => void>>()

  /** Allow overriding the meta directory for testing */
  private metaDir: string

  constructor(metaDir?: string) {
    this.metaDir = metaDir || META_DIR
  }

  async load(): Promise<void> {
    try {
      await mkdir(this.metaDir, { recursive: true })
      const files = await readdir(this.metaDir)
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const data = await readFile(join(this.metaDir, file), 'utf-8')
          const raw = JSON.parse(data)
          // Migrate legacy 'model' field from pre-rename era
          if (raw.model && !raw.providerId) {
            raw.providerId = raw.model
            delete raw.model
            // Re-persist migrated data
            await writeFile(join(this.metaDir, file), JSON.stringify(raw, null, 2)).catch(() => {})
          }
          const meta: SessionMeta = raw
          if (meta.sdkSessionId) {
            // Clear stale pending interactions — resolvers are in-memory only
            // and cannot survive a server restart
            if (meta.pendingQuestion) meta.pendingQuestion = null
            if (meta.pendingPermissionRequest) meta.pendingPermissionRequest = null
            this.metas.set(meta.sdkSessionId, meta)
          }
        } catch {
          // Skip corrupted files
        }
      }
    } catch {
      // META_DIR doesn't exist yet
    }
  }

  /** Create a new session — provider is locked at creation time */
  create(
    projectId: string,
    project: ProjectConfig,
    overrides?: {
      providerId?: string
      permissionMode?: PermissionMode
      cronJobId?: string
      cronJobName?: string
    },
  ): SessionMeta {
    const meta: SessionMeta = {
      sdkSessionId: '', // Will be filled when SDK initializes
      projectId,
      status: 'idle',
      providerId: overrides?.providerId || project.defaultProviderId,
      permissionMode: overrides?.permissionMode || project.defaultPermissionMode,
      cronJobId: overrides?.cronJobId,
      cronJobName: overrides?.cronJobName,
      createdAt: Date.now(),
      usage: createEmptyUsage(),
    }
    return meta
  }

  /** Register a session after SDK initialization provides the sdkSessionId */
  register(sdkSessionId: string, meta: SessionMeta): void {
    meta.sdkSessionId = sdkSessionId
    this.metas.set(sdkSessionId, meta)
  }

  getMeta(sessionId: string): SessionMeta | null {
    return this.metas.get(sessionId) ?? null
  }

  /** List all session metas from in-memory cache, optionally filtered by projectId */
  list(projectId?: string): SessionMeta[] {
    const all = Array.from(this.metas.values())
    if (projectId) {
      return all.filter((m) => m.projectId === projectId)
    }
    return all
  }

  /**
   * List sessions for a project using SDK as source of truth.
   * Merges SDK session data with our stored SessionMeta.
   * Falls back to in-memory metas for sessions the SDK fails to list
   * (e.g. when the first message is a large image that overflows the SDK's
   * 64 KB head buffer, making firstPrompt/lastPrompt unextractable).
   */
  async listForProject(projectId: string, projectPath: string): Promise<SessionInfo[]> {
    // Query SDK for sessions in this project directory
    const sdkSessions = await sdkListSessions({ dir: projectPath })

    // Build a lookup of our metas by sdkSessionId
    const metasBySessionId = new Map<string, SessionMeta>()
    for (const meta of this.metas.values()) {
      if (meta.projectId === projectId && meta.sdkSessionId) {
        metasBySessionId.set(meta.sdkSessionId, meta)
      }
    }

    const sdkSessionIds = new Set(sdkSessions.map((s) => s.sessionId))

    const result: SessionInfo[] = sdkSessions.map((sdk) => {
      const meta = metasBySessionId.get(sdk.sessionId)
      return {
        sessionId: sdk.sessionId,
        summary: sdk.customTitle || sdk.summary || '',
        lastModified: sdk.lastModified,
        firstPrompt: sdk.firstPrompt,
        cwd: sdk.cwd,
        status: meta?.status ?? 'idle',
        isActive: meta?.status === 'processing',
        projectId,
        cronJobName: meta?.cronJobName,
        providerId: meta?.providerId,
      }
    })

    // Include sessions known to us but missing from the SDK list.
    // This covers cases where the SDK's buffer-based summary extraction fails
    // (e.g. large image as first message) or the JSONL hasn't been flushed yet.
    for (const meta of metasBySessionId.values()) {
      if (sdkSessionIds.has(meta.sdkSessionId)) continue
      result.push({
        sessionId: meta.sdkSessionId,
        summary: '',
        lastModified: meta.createdAt ?? 0,
        projectId,
        status: meta.status ?? 'idle',
        isActive: meta.status === 'processing',
        cronJobName: meta.cronJobName,
        providerId: meta.providerId,
      })
    }

    // Sort by last modified desc
    result.sort((a, b) => b.lastModified - a.lastModified)
    return result
  }

  /**
   * Get session history by reading the JSONL file directly.
   * Unlike sdkGetSessionMessages, this returns the full history including
   * messages before any context-compression (compact) point.
   */
  async getHistory(sessionId: string, projectPath?: string): Promise<ChatMessage[]> {
    const jsonlPath = this.resolveJsonlPath(sessionId, projectPath)
    let raw: string
    try {
      raw = await readFile(jsonlPath, 'utf-8')
    } catch {
      return []
    }

    const lines = raw.split('\n').filter(Boolean)
    const sdkMessages: Array<{ type: string; uuid: string; message: any }> = []
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.type === 'user' || obj.type === 'assistant') {
          sdkMessages.push({ type: obj.type, uuid: obj.uuid ?? '', message: obj.message })
        }
      } catch {
        // skip malformed lines
      }
    }

    if (sdkMessages.length === 0) return []

    const messages: ChatMessage[] = []
    const toolUseMap = new Map<string, { msgIndex: number; toolIndex: number }>()
    const baseTimestamp = Date.now()
    let msgCounter = 0

    for (const sdkMsg of sdkMessages) {
      const content = sdkMsg.message as any
      if (!content) continue

      if (sdkMsg.type === 'assistant') {
        const blocks = Array.isArray(content.content) ? content.content : []

        let text = ''
        let thinking = ''
        const toolCalls: ChatMessage['toolCalls'] = []

        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            text += (text ? '\n' : '') + block.text
          } else if (block.type === 'thinking' && block.thinking) {
            thinking += (thinking ? '\n' : '') + block.thinking
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              name: block.name,
              id: block.id,
              input: block.input,
            })
          }
        }

        text = text
          .replace(/\n?\[SUMMARY:\s*.+\]\s*$/m, '')
          .replace(/\n?\[SUGGESTIONS:\s*.+\]\s*$/m, '')
          .trim()

        if (!text && !thinking && toolCalls.length === 0) continue

        const msgIndex = messages.length
        messages.push({
          id: sdkMsg.uuid || `msg-${msgIndex}`,
          role: 'assistant',
          content: text,
          thinking: thinking || undefined,
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          timestamp: baseTimestamp + (msgCounter++),
        })

        for (let i = 0; i < toolCalls.length; i++) {
          toolUseMap.set(toolCalls[i].id, { msgIndex, toolIndex: i })
        }
      } else if (sdkMsg.type === 'user') {
        const rawContent = content.content
        const blocks = Array.isArray(rawContent) ? rawContent : []

        let text = typeof rawContent === 'string' ? rawContent : ''
        for (const block of blocks) {
          if (block.type === 'text' && block.text) {
            text += (text ? '\n' : '') + block.text
          } else if (block.type === 'tool_result') {
            const ref = toolUseMap.get(block.tool_use_id)
            if (ref) {
              const msg = messages[ref.msgIndex]
              if (msg?.toolCalls?.[ref.toolIndex]) {
                const resultContent = Array.isArray(block.content)
                  ? block.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
                  : typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content)
                msg.toolCalls[ref.toolIndex].result = resultContent
                msg.toolCalls[ref.toolIndex].isError = block.is_error || false
              }
            }
          }
        }

        if (text) {
          messages.push({
            id: sdkMsg.uuid || `msg-${messages.length}`,
            role: 'user',
            content: text,
            timestamp: baseTimestamp + (msgCounter++),
          })
        }
      }
    }

    return messages
  }

  /**
   * Resolve the JSONL file path for a session.
   * Claude Code stores sessions at: ~/.claude/projects/<encoded-path>/<sessionId>.jsonl
   * where <encoded-path> is the project path with all non-alphanumeric characters replaced by '-'.
   */
  private resolveJsonlPath(sessionId: string, projectPath?: string): string {
    const claudeDir = join(homedir(), '.claude', 'projects')
    if (projectPath) {
      const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, '-')
      return join(claudeDir, encoded, `${sessionId}.jsonl`)
    }
    // Fallback: look up from in-memory meta
    const meta = this.metas.get(sessionId)
    if (meta) {
      // projectPath not provided but meta doesn't carry it — caller should pass it
    }
    return join(claudeDir, `${sessionId}.jsonl`)
  }

  /** Update session metadata */
  update(sessionId: string, partial: Partial<SessionMeta>): void {
    const meta = this.metas.get(sessionId)
    if (!meta) return
    Object.assign(meta, partial)
  }

  /** Set session status — fires idle callbacks when transitioning to 'idle' */
  setStatus(sessionId: string, status: 'idle' | 'processing' | 'error' | 'paused'): void {
    this.update(sessionId, { status })
    if (status === 'idle') {
      const meta = this.metas.get(sessionId)
      if (meta) {
        const callbacks = this.idleCallbacks.get(meta)
        if (callbacks?.length) {
          this.idleCallbacks.delete(meta)
          callbacks.forEach((cb) => cb())
        }
      }
    }
  }

  /**
   * Wait until the session transitions to idle. Returns immediately if already idle.
   *
   * Keyed by the meta object so it survives the pending-id → real-SDK-id remap
   * that happens during session_init (both IDs point to the same SessionMeta).
   */
  waitForIdle(sessionId: string): Promise<void> {
    const meta = this.metas.get(sessionId)
    if (!meta || meta.status === 'idle' || meta.status === 'error' || meta.status === 'paused') {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const existing = this.idleCallbacks.get(meta)
      if (existing) {
        existing.push(resolve)
      } else {
        this.idleCallbacks.set(meta, [resolve])
      }
    })
  }

  /** Set pause state — stores reason + prompt so the session can be resumed later */
  setPauseState(sessionId: string, pauseReason: string, pausedPrompt: string): void {
    this.update(sessionId, { status: 'paused', pauseReason, pausedPrompt })
  }

  /** Clear pause state — call before re-submitting the paused prompt */
  clearPauseState(sessionId: string): void {
    this.update(sessionId, { status: 'idle', pauseReason: null, pausedPrompt: null })
  }

  /** Set pending question */
  setPendingQuestion(sessionId: string, toolId: string, questions: any[]): void {
    this.update(sessionId, { pendingQuestion: { toolId, questions } })
  }

  /** Clear pending question */
  clearPendingQuestion(sessionId: string): void {
    this.update(sessionId, { pendingQuestion: null })
  }

  /** Set pending permission request */
  setPendingPermission(
    sessionId: string,
    request: {
      requestId: string
      toolName: string
      input: unknown
      reason?: string
    },
  ): void {
    this.update(sessionId, { pendingPermissionRequest: request })
  }

  /** Clear pending permission request */
  clearPendingPermission(sessionId: string): void {
    this.update(sessionId, { pendingPermissionRequest: null })
  }

  /** Update cumulative usage after a turn completes */
  addUsage(
    sessionId: string,
    usage: {
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      cacheCreateTokens: number
      costUsd: number
      durationMs: number
      contextWindowUsed: number
      contextWindowMax: number
    },
  ): void {
    const meta = this.metas.get(sessionId)
    if (!meta) return
    meta.usage.totalInputTokens += usage.inputTokens
    meta.usage.totalOutputTokens += usage.outputTokens
    meta.usage.totalCacheReadTokens += usage.cacheReadTokens
    meta.usage.totalCacheCreateTokens += usage.cacheCreateTokens
    meta.usage.totalCostUsd += usage.costUsd
    meta.usage.totalDurationMs += usage.durationMs
    meta.usage.queryCount += 1
    meta.usage.contextWindowUsed = usage.contextWindowUsed
    meta.usage.contextWindowMax = usage.contextWindowMax
  }

  /** Delete a session's metadata */
  async delete(sessionId: string): Promise<void> {
    this.metas.delete(sessionId)
    try {
      await unlink(join(this.metaDir, `${sessionId}.json`))
    } catch {
      // File may not exist
    }
  }

  /** Persist a session's metadata to disk */
  async persist(sessionId: string): Promise<void> {
    const meta = this.metas.get(sessionId)
    if (!meta) return
    await mkdir(this.metaDir, { recursive: true })
    await writeFile(join(this.metaDir, `${sessionId}.json`), JSON.stringify(meta, null, 2))
  }

  /** Find active session for a project (status === 'processing') */
  findActive(projectId: string): SessionMeta | null {
    for (const meta of this.metas.values()) {
      if (meta.projectId === projectId && meta.status === 'processing') {
        return meta
      }
    }
    return null
  }

  /** Find or get the most recent session for a project */
  findLatest(projectId: string): SessionMeta | null {
    let latest: SessionMeta | null = null
    for (const meta of this.metas.values()) {
      if (meta.projectId === projectId) {
        if (!latest || meta.createdAt > latest.createdAt) {
          latest = meta
        }
      }
    }
    return latest
  }
}
