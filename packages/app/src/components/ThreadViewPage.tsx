import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useSearchParams, useNavigate } from 'react-router'
import { useStore } from '@/store/store'
import { selectThread } from '@/store/selectors'
import {
  fetchThreads,
  fetchThreadMessages,
  fetchArtifacts,
  fetchArtifactContent,
  getArtifactRawUrl,
  type ArtifactInfo,
  type ArtifactContent,
} from '@/lib/threads'
import { getToken, authFetch } from '@/lib/auth'
import type { ThreadInfo, ThreadMessageInfo } from '@/store/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  MessageCircle,
  FileText,
  FileCode,
  X,
  Download,
  Eye,
  Loader2,
  Paperclip,
  FolderOpen,
} from 'lucide-react'

// ── Agent color palette (matches iOS) ──

const AGENT_COLORS = [
  { r: 0.40, g: 0.60, b: 1.00 }, // blue
  { r: 0.65, g: 0.40, b: 1.00 }, // purple
  { r: 0.30, g: 0.75, b: 0.45 }, // green
  { r: 1.00, g: 0.70, b: 0.30 }, // orange
  { r: 1.00, g: 0.45, b: 0.60 }, // pink
  { r: 0.20, g: 0.75, b: 0.75 }, // teal
  { r: 0.50, g: 0.40, b: 0.90 }, // indigo
  { r: 0.30, g: 0.80, b: 0.70 }, // mint
]

function nameHash(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0
  return Math.abs(h)
}

function agentBubbleColor(name: string): string {
  const c = AGENT_COLORS[nameHash(name) % AGENT_COLORS.length]
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, 0.12)`
}

function agentAvatarColor(name: string): string {
  const c = AGENT_COLORS[nameHash(name) % AGENT_COLORS.length]
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, 0.15)`
}

// ── Status config ──

const STATUS_CONFIG = {
  active:    { label: 'Active',    color: 'text-emerald-500', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  completed: { label: 'Completed', color: 'text-blue-500',    bg: 'bg-blue-500/10',    dot: 'bg-blue-500'    },
  stalled:   { label: 'Stalled',   color: 'text-amber-500',   bg: 'bg-amber-500/10',   dot: 'bg-amber-500'   },
} as const

function StatusBadge({ status }: { status: ThreadInfo['status'] }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', cfg.bg, cfg.color)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot, status === 'active' && 'animate-pulse')} />
      {cfg.label}
    </span>
  )
}

// ── Date helpers ──

function formatTime(ts: number) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function dateSeparatorLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

// ── Merge messages ──

function mergeMessages(fetched: ThreadMessageInfo[], store: ThreadMessageInfo[]): ThreadMessageInfo[] {
  const map = new Map<string, ThreadMessageInfo>()
  for (const m of fetched) map.set(m.id, m)
  for (const m of store) map.set(m.id, m)
  return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp)
}

// ── Mime helpers ──

function isTextMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/xml'
  )
}

function isImageMime(mime: string): boolean {
  return mime.startsWith('image/')
}

function langFromMime(mime: string): string {
  const map: Record<string, string> = {
    'application/json': 'json',
    'application/javascript': 'javascript',
    'text/javascript': 'javascript',
    'text/html': 'html',
    'text/css': 'css',
    'text/markdown': 'markdown',
    'text/csv': 'csv',
    'application/xml': 'xml',
    'text/xml': 'xml',
    'image/svg+xml': 'svg',
  }
  return map[mime] ?? 'plaintext'
}

// ── Date Separator ──

function DateSeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex justify-center py-3">
      <span className="text-xs font-medium text-muted-foreground px-3 py-1 rounded-full bg-muted/60">
        {dateSeparatorLabel(timestamp)}
      </span>
    </div>
  )
}

// ── Chat Bubble Row ──

function ChatBubbleRow({
  message,
  emoji,
  showAvatar,
  renderMarkdown,
  onArtifactClick,
}: {
  message: ThreadMessageInfo
  emoji: string
  showAvatar: boolean
  renderMarkdown: boolean
  onArtifactClick?: (id: string) => void
}) {
  const bubbleBg = agentBubbleColor(message.from)
  const avatarBg = agentAvatarColor(message.from)
  const bubbleRadius = showAvatar ? '2px 12px 12px 12px' : '12px'

  return (
    <div className={cn('flex items-start gap-2', showAvatar ? 'pt-1.5' : 'pt-0')}>
      {/* Avatar column */}
      <div className="shrink-0 w-9">
        {showAvatar ? (
          <div
            className="w-9 h-9 flex items-center justify-center text-lg rounded-lg"
            style={{ background: avatarBg }}
          >
            {emoji}
          </div>
        ) : (
          <div className="w-9 h-9" />
        )}
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0 pr-10">
        {/* Header: name + recipient + time */}
        {showAvatar && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-semibold text-foreground">{message.from}</span>
            {message.to !== 'broadcast' && (
              <>
                <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground/50 shrink-0">
                  <path d="M1 4h6M4 1l3 3-3 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs text-muted-foreground">{message.to}</span>
              </>
            )}
            <span className="text-[10px] text-muted-foreground/70">{formatTime(message.timestamp)}</span>
          </div>
        )}

        {/* Bubble */}
        <div
          className="inline-block max-w-full px-3 py-2"
          style={{ background: bubbleBg, borderRadius: bubbleRadius }}
        >
          {renderMarkdown ? (
            <div className="text-sm prose prose-sm dark:prose-invert max-w-none prose-pre:bg-background/60 prose-pre:text-foreground prose-code:text-foreground prose-p:my-1 prose-headings:my-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
              {message.content}
            </p>
          )}

          {/* Inline artifacts */}
          {message.artifacts.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {message.artifacts.map(a => (
                <button
                  key={a.id}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-background/60 text-foreground/80 hover:bg-background/90 transition-colors cursor-pointer"
                  onClick={() => onArtifactClick?.(a.id)}
                  title="View artifact"
                >
                  <Paperclip className="h-2.5 w-2.5" />
                  {a.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Artifact Content Viewer ──

function ArtifactViewer({
  artifact,
  threadId,
  onClose,
  onUnauthorized,
}: {
  artifact: ArtifactInfo
  threadId: string
  onClose: () => void
  onUnauthorized?: () => void
}) {
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchArtifactContent(threadId, artifact.id, onUnauthorized)
      .then(data => {
        if (data) {
          setContent(data)
        } else {
          setError('Failed to load content')
        }
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load content')
        setLoading(false)
      })
  }, [threadId, artifact.id, onUnauthorized])

  const rawUrl = getArtifactRawUrl(threadId, artifact.id)
  const token = getToken()
  const downloadUrl = token ? `${rawUrl}?token=${encodeURIComponent(token)}` : rawUrl

  const openOnComputer = () => {
    const dir = artifact.path.slice(0, artifact.path.lastIndexOf('/'))
    const base = import.meta.env.BASE_URL.replace(/\/$/, '') || ''
    window.open(`${base}/files?path=${encodeURIComponent(dir)}`, '_blank')
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30 shrink-0">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{artifact.name}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          {artifact.mimeType} &middot; {formatBytes(artifact.size)}
        </span>
        <button
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          onClick={openOnComputer}
          title="Open on computer"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
        <a
          href={downloadUrl}
          download={artifact.name}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          title="Download"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <a href={downloadUrl} download={artifact.name} className="text-xs text-blue-500 hover:underline">
              Download file instead
            </a>
          </div>
        )}

        {!loading && !error && content && (
          <>
            {isImageMime(artifact.mimeType) && (
              <div className="p-6 flex items-center justify-center bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
                <img src={downloadUrl} alt={artifact.name} className="max-w-full max-h-[70vh] object-contain rounded shadow-sm" />
              </div>
            )}

            {isTextMime(artifact.mimeType) && (
              <div className="relative">
                <div className="absolute top-2 right-3 text-xs text-muted-foreground/60 select-none">
                  {langFromMime(artifact.mimeType)}
                </div>
                <pre className="p-4 text-sm leading-relaxed overflow-x-auto">
                  <code>{content.content}</code>
                </pre>
              </div>
            )}

            {artifact.mimeType === 'image/svg+xml' && (
              <div className="space-y-4">
                <div className="p-6 flex items-center justify-center border-b border-border bg-[repeating-conic-gradient(#80808015_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
                  <div className="max-w-full max-h-[40vh] overflow-auto" dangerouslySetInnerHTML={{ __html: content.content }} />
                </div>
                <div className="relative">
                  <div className="absolute top-2 right-3 text-xs text-muted-foreground/60 select-none">svg</div>
                  <pre className="p-4 text-sm leading-relaxed overflow-x-auto"><code>{content.content}</code></pre>
                </div>
              </div>
            )}

            {artifact.mimeType === 'application/pdf' && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm font-medium">{artifact.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(artifact.size)}</p>
                <a href={downloadUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Eye className="h-4 w-4" /> Open PDF
                </a>
              </div>
            )}

            {!isTextMime(artifact.mimeType) && !isImageMime(artifact.mimeType) &&
             artifact.mimeType !== 'image/svg+xml' && artifact.mimeType !== 'application/pdf' && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <FileText className="h-12 w-12 text-muted-foreground" />
                <p className="text-sm font-medium">{artifact.name}</p>
                <p className="text-xs text-muted-foreground">{artifact.mimeType} &middot; {formatBytes(artifact.size)}</p>
                <a href={downloadUrl} download={artifact.name}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Download className="h-4 w-4" /> Download
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ──

interface AgentMeta { id: string; name: string; emoji: string }

export function ThreadViewPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const threadId = searchParams.get('id')

  const storeThread = useStore(selectThread(threadId))
  const [restThread, setRestThread] = useState<ThreadInfo | null>(null)
  const [fetchedMessages, setFetchedMessages] = useState<ThreadMessageInfo[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([])
  const [agentMeta, setAgentMeta] = useState<AgentMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [renderMarkdown, setRenderMarkdown] = useState(true)
  const [viewingArtifact, setViewingArtifact] = useState<ArtifactInfo | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Emoji lookup by agent name (lowercased)
  const emojiMap = Object.fromEntries(agentMeta.map(a => [a.name.toLowerCase(), a.emoji]))
  function getEmoji(name: string) { return emojiMap[name.toLowerCase()] ?? '🤖' }

  useEffect(() => {
    if (!threadId) return
    setLoading(true)
    setViewingArtifact(null)
    Promise.all([
      fetchThreads(undefined, onUnauthorized),
      fetchThreadMessages(threadId, 100, onUnauthorized),
      fetchArtifacts(threadId, onUnauthorized),
      authFetch('/api/agents', {}, onUnauthorized).then(r => r.ok ? r.json() : []).catch(() => []),
    ]).then(([threads, msgs, arts, agents]) => {
      const found = threads.find(t => t.id === threadId) ?? null
      setRestThread(found)
      setFetchedMessages(msgs)
      setArtifacts(arts)
      setAgentMeta(agents)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [threadId, onUnauthorized])

  const thread = storeThread ?? restThread
  const storeMessages = storeThread?.messages ?? []
  const messages = mergeMessages(fetchedMessages, storeMessages)

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    setAutoScroll(isAtBottom)
  }, [])

  useEffect(() => {
    if (autoScroll) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, autoScroll])

  const handleArtifactRefClick = (artifactId: string) => {
    const found = artifacts.find(a => a.id === artifactId)
    if (found) setViewingArtifact(found)
  }

  if (!threadId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Select a thread from the sidebar</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">Loading thread...</p>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <MessageCircle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Thread not found</p>
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Go back
        </Button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-sm font-semibold truncate flex-1">{thread.title}</h1>
          <StatusBadge status={thread.status} />
          <button
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer',
              renderMarkdown
                ? 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                : 'bg-accent text-foreground',
            )}
            onClick={() => setRenderMarkdown(!renderMarkdown)}
            title={renderMarkdown ? 'Switch to plain text' : 'Switch to Markdown'}
          >
            <FileCode className="h-3.5 w-3.5" />
          </button>
          {artifacts.length > 0 && (
            <button
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors cursor-pointer text-muted-foreground hover:text-foreground hover:bg-accent/50"
              onClick={() => {
                const dir = artifacts[0].path.slice(0, artifacts[0].path.lastIndexOf('/'))
                const base = import.meta.env.BASE_URL.replace(/\/$/, '') || ''
                window.open(`${base}/files?path=${encodeURIComponent(dir)}`, '_blank')
              }}
              title="Open artifacts folder"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {artifacts.length}
            </button>
          )}
        </div>
      </header>

      {/* Messages */}
      {!viewingArtifact && (
        <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          <div className="py-2 px-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No messages yet</p>
              </div>
            ) : (
              messages.map((msg, index) => {
                const prev = index > 0 ? messages[index - 1] : null
                const showDateSep = !prev || !isSameDay(prev.timestamp, msg.timestamp)
                const showAvatar = !prev || prev.from !== msg.from || showDateSep
                return (
                  <div key={msg.id}>
                    {showDateSep && <DateSeparator timestamp={msg.timestamp} />}
                    <ChatBubbleRow
                      message={msg}
                      emoji={getEmoji(msg.from)}
                      showAvatar={showAvatar}
                      renderMarkdown={renderMarkdown}
                      onArtifactClick={handleArtifactRefClick}
                    />
                  </div>
                )
              })
            )}

            {thread.status === 'active' && messages.length > 0 && (
              <div className="flex items-center gap-2 py-3 justify-center">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">Listening for new messages...</span>
              </div>
            )}

            <div ref={messagesEndRef} />

            {/* Thread footer */}
            <div className="mt-6 mb-2 mx-1 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 space-y-2.5">
              {/* Participants */}
              <div className="flex flex-wrap items-center gap-2">
                {thread.participants.map(p => (
                  <div key={p.agentId} className="flex items-center gap-1.5">
                    <div
                      className="w-5 h-5 flex items-center justify-center text-xs rounded"
                      style={{ background: agentAvatarColor(p.agentName) }}
                    >
                      {getEmoji(p.agentName)}
                    </div>
                    <span className="text-xs text-muted-foreground">@{p.agentName}</span>
                  </div>
                ))}
              </div>

              {/* Divider */}
              <div className="border-t border-border/40" />

              {/* Meta row */}
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  <span className="text-foreground/50">Messages</span> {messages.length}
                </span>
                <span className="text-xs text-muted-foreground">
                  <span className="text-foreground/50">Created</span>{' '}
                  {new Date(thread.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <span className="text-xs text-muted-foreground">
                  <span className="text-foreground/50">Updated</span>{' '}
                  {formatTime(thread.updatedAt)}
                </span>
                {thread.parentThreadId && (
                  <span className="text-xs text-muted-foreground">
                    <span className="text-foreground/50">Sub-thread</span>
                  </span>
                )}
              </div>

              {/* Stalled reason */}
              {thread.stalledReason && (
                <p className="text-xs text-amber-600 leading-relaxed">{thread.stalledReason}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Artifact viewer */}
      {viewingArtifact && threadId && (
        <ArtifactViewer
          artifact={viewingArtifact} threadId={threadId}
          onClose={() => setViewingArtifact(null)} onUnauthorized={onUnauthorized}
        />
      )}
    </div>
  )
}
