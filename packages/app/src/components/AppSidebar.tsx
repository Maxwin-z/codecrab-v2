import React, { useState, useEffect, useCallback, useRef } from 'react'
import { AgentAvatar } from '@/components/AgentAvatar'
import { useNavigate, useSearchParams, useLocation } from 'react-router'
import { useWs } from '@/hooks/WebSocketContext'
import { useStore } from '@/store/store'
import { selectProjectStatuses, selectThreads, selectActiveHeartbeats } from '@/store/selectors'
import type { ActivityHeartbeat } from '@/store/types'
import { authFetch } from '@/lib/auth'
import { fetchThreads } from '@/lib/threads'
import { cn } from '@/lib/utils'
import type { ThreadInfo } from '@/store/types'
import { Search, Settings, FolderOpen, Plus, ChevronRight, Pencil, MessageCircle, Sun, Moon, Clock, UserPen } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { Input } from '@/components/ui/input'
import { CreateAgentDialog } from '@/components/CreateAgentDialog'
import { EditAgentDialog } from '@/components/EditAgentDialog'
import { useCronSummary } from '@/hooks/useCron'

interface Project {
  id: string
  name: string
  path: string
  icon: string
}

interface Agent {
  id: string
  name: string
  emoji: string
  description?: string
}

const RECENTLY_ACTIVE_MS = 10 * 60 * 1000

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

function ActivityRow({ heartbeat }: { heartbeat: ActivityHeartbeat }) {
  const { lastActivityType, lastToolName, textSnippet } = heartbeat
  if (lastActivityType === 'thinking' || lastActivityType === 'thinking_delta') {
    return (
      <div className="flex items-center gap-1 pl-6 w-full min-w-0">
        <span className="text-xs shrink-0">💭</span>
        <span className="text-xs text-muted-foreground truncate font-mono">
          {textSnippet ? `...${textSnippet.slice(-60)}` : '...'}
        </span>
      </div>
    )
  }
  if (lastActivityType === 'tool_use') {
    return (
      <div className="flex items-center gap-1 pl-6 w-full min-w-0">
        <span className="text-xs shrink-0">🔧</span>
        <span className="text-xs text-muted-foreground truncate font-mono">
          {lastToolName ?? 'tool'}
        </span>
      </div>
    )
  }
  if ((lastActivityType === 'text' || lastActivityType === 'text_delta') && textSnippet) {
    return (
      <div className="flex items-center gap-1 pl-6 w-full min-w-0">
        <span className="text-xs shrink-0">💬</span>
        <span className="text-xs text-muted-foreground truncate font-mono">
          {`...${textSnippet.slice(-60)}`}
        </span>
      </div>
    )
  }
  return null
}

export function AppSidebar({
  onUnauthorized,
  style,
}: {
  onUnauthorized?: () => void
  style?: React.CSSProperties
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { switchProject } = useWs()
  const projectStatuses = useStore(selectProjectStatuses)
  const storeThreads = useStore(selectThreads)
  const activeHeartbeats = useStore(selectActiveHeartbeats)
  const [recentlyCompleted, setRecentlyCompleted] = useState<Map<string, number>>(new Map())
  const prevStatusesRef = useRef<Map<string, string>>(new Map())
  const [projects, setProjects] = useState<Project[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [restThreads, setRestThreads] = useState<ThreadInfo[]>([])
  const [filter, setFilter] = useState('')
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
  const [threadsCollapsed, setThreadsCollapsed] = useState(false)
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [editingAgentInfo, setEditingAgentInfo] = useState<Agent | null>(null)
  const addMenuRef = useRef<HTMLDivElement>(null)
  const { theme, toggleTheme } = useTheme()
  const { summary: cronSummary } = useCronSummary(onUnauthorized)
  const currentProjectId = searchParams.get('project')
  const currentThreadId = searchParams.get('id')

  // Detect processing → idle transitions and record completion time
  useEffect(() => {
    const prev = prevStatusesRef.current
    let changed = false
    const newMap = new Map(recentlyCompleted)
    const now = Date.now()
    for (const { projectId, status } of projectStatuses) {
      if (prev.get(projectId) === 'processing' && status === 'idle') {
        newMap.set(projectId, now)
        changed = true
      }
      prev.set(projectId, status)
    }
    if (changed) setRecentlyCompleted(newMap)
  }, [projectStatuses]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear entries after 10 minutes
  useEffect(() => {
    const timeouts: ReturnType<typeof setTimeout>[] = []
    for (const [projectId, completedAt] of recentlyCompleted) {
      const remaining = RECENTLY_ACTIVE_MS - (Date.now() - completedAt)
      if (remaining <= 0) {
        setRecentlyCompleted(prev => { const next = new Map(prev); next.delete(projectId); return next })
      } else {
        timeouts.push(setTimeout(() => {
          setRecentlyCompleted(prev => { const next = new Map(prev); next.delete(projectId); return next })
        }, remaining))
      }
    }
    return () => timeouts.forEach(clearTimeout)
  }, [recentlyCompleted])

  const isRecentlyActive = (id: string) => {
    const t = recentlyCompleted.get(id)
    return t !== undefined && Date.now() - t < RECENTLY_ACTIVE_MS
  }

  const loadData = useCallback(async () => {
    try {
      const [projectsRes, agentsRes, threads] = await Promise.all([
        authFetch('/api/projects', {}, onUnauthorized),
        authFetch('/api/agents', {}, onUnauthorized),
        fetchThreads(undefined, onUnauthorized),
      ])
      if (projectsRes.ok) {
        const all: Project[] = await projectsRes.json()
        // Filter out internal agent projects (prefixed with __)
        setProjects(all.filter(p => !p.id.startsWith('__')))
      }
      if (agentsRes.ok) {
        setAgents(await agentsRes.json())
      }
      setRestThreads(threads)
    } catch { /* ignore */ }
  }, [onUnauthorized])

  // Reload on mount and on route changes (e.g. after creating a project/agent)
  useEffect(() => {
    loadData()
  }, [loadData, location.pathname])

  const getLastModified = (id: string) =>
    projectStatuses.find(s => s.projectId === id)?.lastModified

  const filterLower = filter.toLowerCase()
  const filteredProjects = projects
    .filter(p => p.name.toLowerCase().includes(filterLower))
    .sort((a, b) => (getLastModified(b.id) ?? 0) - (getLastModified(a.id) ?? 0))

  const filteredAgents = agents
    .filter(a => a.name.toLowerCase().includes(filterLower))
    .sort((a, b) => (getLastModified(`__agent-${b.id}`) ?? 0) - (getLastModified(`__agent-${a.id}`) ?? 0))

  const handleSelectProject = (p: Project) => {
    switchProject(p.id)
    navigate(`/chat?project=${p.id}`)
  }

  const handleSelectAgent = async (agent: Agent) => {
    try {
      const res = await authFetch(`/api/agents/${agent.id}/use`, { method: 'POST' }, onUnauthorized)
      if (res.ok) {
        const project = await res.json()
        switchProject(project.id)
        navigate(`/chat?project=${project.id}`)
      }
    } catch { /* ignore */ }
  }

  const handleEditAgent = async (e: React.MouseEvent, agent: Agent) => {
    e.stopPropagation()
    try {
      const res = await authFetch(`/api/agents/${agent.id}/edit`, { method: 'POST' }, onUnauthorized)
      if (res.ok) {
        const data = await res.json()
        switchProject(data.projectId)
        navigate(`/chat?project=${data.projectId}`)
      }
    } catch { /* ignore */ }
  }

  const getProjectStatus = (id: string) =>
    projectStatuses.find(s => s.projectId === id)?.status ?? 'idle'

  // Check if an agent's internal project is currently active
  const isAgentActive = (agentId: string) =>
    currentProjectId === `__agent-${agentId}`

  const getAgentStatus = (agentId: string) =>
    getProjectStatus(`__agent-${agentId}`)

  // Merge REST threads with real-time store threads (store wins)
  const mergedThreads = (() => {
    const map = new Map<string, ThreadInfo>()
    for (const t of restThreads) map.set(t.id, t)
    for (const t of storeThreads) map.set(t.id, t)
    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  })()

  const filteredThreads = mergedThreads.filter(t =>
    t.title.toLowerCase().includes(filterLower),
  )

  const handleSelectThread = (thread: ThreadInfo) => {
    navigate(`/thread?id=${thread.id}`)
  }

  const totalFiltered = filteredProjects.length + filteredAgents.length + filteredThreads.length
  const hasData = projects.length > 0 || agents.length > 0 || mergedThreads.length > 0

  return (
    <aside className="w-56 border-r border-sidebar-border bg-sidebar flex flex-col h-full shrink-0" style={style}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-sidebar-border flex items-center justify-between">
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => navigate('/')}
        >
          <img src="/codecrab.png" alt="CodeCrab" className="w-6 h-6 rounded-md" />
          <h2 className="font-semibold text-sm text-sidebar-foreground">
            CodeCrab
          </h2>
        </div>
        <div
          ref={addMenuRef}
          className="relative"
          onMouseEnter={() => setShowAddMenu(true)}
          onMouseLeave={() => setShowAddMenu(false)}
        >
          <button
            className="flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
            title="New..."
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {showAddMenu && (
            <div className="absolute right-0 top-full z-50 w-36 pt-1">
            <div className="rounded-md border border-sidebar-border bg-sidebar shadow-md py-1">
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
                onClick={() => { setShowAddMenu(false); setShowCreateAgent(true) }}
              >
                <span>🤖</span>
                New Agent
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors cursor-pointer"
                onClick={() => { setShowAddMenu(false); navigate('/projects/new') }}
              >
                <span>📁</span>
                New Project
              </button>
            </div>
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 h-7 text-xs"
          />
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-1">
        {/* Agents section */}
        {(filteredAgents.length > 0 || !filter) && (
          <div>
            <button
              className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground transition-colors cursor-pointer"
              onClick={() => setAgentsCollapsed(!agentsCollapsed)}
            >
              <ChevronRight className={cn('h-3 w-3 transition-transform', !agentsCollapsed && 'rotate-90')} />
              Agents
              <span className="text-muted-foreground/60 ml-auto">{filteredAgents.length}</span>
            </button>

            {!agentsCollapsed && (
              <>
                {filteredAgents.map(a => {
                  const active = isAgentActive(a.id)
                  const status = getAgentStatus(a.id)
                  const agentProjectId = `__agent-${a.id}`
                  const lastModified = getLastModified(agentProjectId)
                  return (
                    <div key={a.id} className="group relative">
                      <button
                        className={cn(
                          'w-full flex flex-col gap-0.5 px-2 py-2 rounded-md text-sm text-left transition-colors cursor-pointer',
                          active
                            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                            : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                        )}
                        onClick={() => handleSelectAgent(a)}
                      >
                        <div className="flex items-center gap-2 w-full min-w-0">
                          <AgentAvatar value={a.emoji || '🤖'} size="md" />
                          <div className="flex flex-col min-w-0 flex-1">
                            <span className="truncate">{a.name}</span>
                            {a.description && (
                              <span className="truncate text-xs text-muted-foreground/60 leading-tight">{a.description}</span>
                            )}
                          </div>
                          {status === 'processing' ? (
                            <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
                          ) : isRecentlyActive(agentProjectId) ? (
                            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                          ) : null}
                        </div>
                        {status === 'processing' && activeHeartbeats[agentProjectId] ? (
                          <ActivityRow heartbeat={activeHeartbeats[agentProjectId]} />
                        ) : lastModified ? (
                          <div className="pl-6 w-full min-w-0">
                            <span className="text-xs text-muted-foreground/60">{formatRelativeTime(lastModified)}</span>
                          </div>
                        ) : null}
                      </button>
                      <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/80 cursor-pointer"
                          onClick={e => { e.stopPropagation(); setEditingAgentInfo(a) }}
                          title="Edit name and avatar"
                        >
                          <UserPen className="h-3 w-3" />
                        </button>
                        <button
                          className="h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/80 cursor-pointer"
                          onClick={e => handleEditAgent(e, a)}
                          title="Edit role definition"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* Projects section */}
        {(filteredProjects.length > 0 || !filter) && (
          <div className="mt-1">
            <button
              className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground transition-colors cursor-pointer"
              onClick={() => setProjectsCollapsed(!projectsCollapsed)}
            >
              <ChevronRight className={cn('h-3 w-3 transition-transform', !projectsCollapsed && 'rotate-90')} />
              Projects
              <span className="text-muted-foreground/60 ml-auto">{filteredProjects.length}</span>
            </button>

            {!projectsCollapsed && (
              <>
                {filteredProjects.map(p => {
                  const status = getProjectStatus(p.id)
                  const isActive = currentProjectId === p.id
                  const lastModified = getLastModified(p.id)
                  return (
                    <button
                      key={p.id}
                      className={cn(
                        'w-full flex flex-col gap-0.5 px-2 py-2 rounded-md text-sm text-left transition-colors cursor-pointer',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                      )}
                      onClick={() => handleSelectProject(p)}
                    >
                      <div className="flex items-center gap-2 w-full min-w-0">
                        <span className="text-base shrink-0">{p.icon || '📁'}</span>
                        <span className="truncate flex-1">{p.name}</span>
                        {status === 'processing' ? (
                          <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse shrink-0" />
                        ) : isRecentlyActive(p.id) ? (
                          <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                        ) : null}
                      </div>
                      {status === 'processing' && activeHeartbeats[p.id] ? (
                        <ActivityRow heartbeat={activeHeartbeats[p.id]} />
                      ) : lastModified ? (
                        <div className="pl-6 w-full min-w-0">
                          <span className="text-xs text-muted-foreground/60">{formatRelativeTime(lastModified)}</span>
                        </div>
                      ) : null}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}

        {/* Threads section */}
        {(filteredThreads.length > 0 || !filter) && mergedThreads.length > 0 && (
          <div className="mt-1">
            <button
              className="w-full flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-sidebar-foreground transition-colors cursor-pointer"
              onClick={() => setThreadsCollapsed(!threadsCollapsed)}
            >
              <ChevronRight className={cn('h-3 w-3 transition-transform', !threadsCollapsed && 'rotate-90')} />
              Threads
              <span className="text-muted-foreground/60 ml-auto">{filteredThreads.length}</span>
            </button>

            {!threadsCollapsed && (
              <>
                {filteredThreads.map(t => {
                  const isActive = location.pathname === '/thread' && currentThreadId === t.id
                  return (
                    <button
                      key={t.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors cursor-pointer',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                      )}
                      onClick={() => handleSelectThread(t)}
                    >
                      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate flex-1">{t.title}</span>
                      {t.status === 'active' && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      )}
                      {t.status === 'stalled' && (
                        <span className="h-2 w-2 rounded-full bg-amber-500 shrink-0" />
                      )}
                      {t.status === 'completed' && (
                        <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                      )}
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}

        {totalFiltered === 0 && hasData && (
          <p className="text-xs text-muted-foreground text-center py-4">No matches</p>
        )}
        {!hasData && (
          <div className="text-center py-6 space-y-2">
            <FolderOpen className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No projects or agents yet</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-sidebar-border flex items-center">
        <button
          className={cn(
            'flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors cursor-pointer',
            location.pathname === '/cron'
              ? 'text-sidebar-foreground bg-sidebar-accent/60'
              : 'text-muted-foreground hover:bg-sidebar-accent/50',
          )}
          onClick={() => navigate('/cron')}
          title="Scheduled Tasks"
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {cronSummary && cronSummary.totalActive > 0 && (
            <span className="text-[10px] font-medium tabular-nums bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded px-1">
              {cronSummary.totalActive}
            </span>
          )}
        </button>
        <button
          className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
          onClick={() => navigate('/settings')}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </button>
        <button
          className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-sidebar-accent/50 transition-colors cursor-pointer"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </button>
      </div>

      <CreateAgentDialog
        open={showCreateAgent}
        onOpenChange={setShowCreateAgent}
        onCreated={() => loadData()}
        onUnauthorized={onUnauthorized}
      />

      <EditAgentDialog
        open={editingAgentInfo !== null}
        onOpenChange={open => { if (!open) setEditingAgentInfo(null) }}
        agent={editingAgentInfo}
        onSaved={() => { setEditingAgentInfo(null); loadData() }}
        onUnauthorized={onUnauthorized}
      />
    </aside>
  )
}
