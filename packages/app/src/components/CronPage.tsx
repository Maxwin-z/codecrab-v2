import { useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ArrowLeft, Clock, Play, Pause, CheckCircle, XCircle,
  Timer, Repeat, Calendar, ChevronDown, ChevronRight, Terminal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCronJobs } from '@/hooks/useCron'
import type { CronJobItem, CronSchedule } from '@/hooks/useCron'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  if (diff < 0) return 'overdue'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function formatSchedule(schedule: CronSchedule): string {
  switch (schedule.kind) {
    case 'at':
      if (schedule.at) {
        const d = new Date(schedule.at)
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      }
      return 'One-time'
    case 'every': {
      if (!schedule.everyMs) return 'Recurring'
      const mins = Math.floor(schedule.everyMs / 60000)
      if (mins < 60) return `Every ${mins}m`
      const hours = Math.floor(mins / 60)
      if (hours < 24) return `Every ${hours}h`
      return `Every ${Math.floor(hours / 24)}d`
    }
    case 'cron':
      return schedule.expr || 'Cron'
    default:
      return 'Unknown'
  }
}

function scheduleTypeIcon(schedule: CronSchedule): typeof Clock {
  switch (schedule.kind) {
    case 'at': return Calendar
    case 'every': return Timer
    case 'cron': return Repeat
    default: return Clock
  }
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; bgColor: string; label: string }> = {
  pending: { icon: Clock, color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-500/15', label: 'Pending' },
  running: { icon: Play, color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/15', label: 'Running' },
  completed: { icon: CheckCircle, color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-500/15', label: 'Completed' },
  failed: { icon: XCircle, color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/15', label: 'Failed' },
  disabled: { icon: Pause, color: 'text-muted-foreground', bgColor: 'bg-secondary', label: 'Paused' },
}

function JobRow({ job, expanded, onToggle }: { job: CronJobItem; expanded: boolean; onToggle: () => void }) {
  const config = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.pending
  const StatusIcon = config.icon
  const ScheduleIcon = scheduleTypeIcon(job.schedule)

  return (
    <div className="rounded-lg border bg-card flex flex-col overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 flex flex-col gap-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
      >
        {/* Top row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {expanded
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            }
            <StatusIcon className={`h-4 w-4 shrink-0 ${config.color}`} />
            <h3 className="text-sm font-medium truncate">{job.name}</h3>
          </div>
          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs shrink-0 ${config.bgColor} ${config.color}`}>
            {config.label}
          </span>
        </div>

        {/* Prompt preview (collapsed) */}
        {!expanded && job.prompt && (
          <p className="text-xs text-muted-foreground line-clamp-1 pl-7">{job.prompt}</p>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pl-7">
          <span className="inline-flex items-center gap-1">
            <ScheduleIcon className="h-3 w-3" />
            {formatSchedule(job.schedule)}
          </span>
          <span>
            {job.runCount} run{job.runCount !== 1 ? 's' : ''}
            {job.maxRuns ? ` / ${job.maxRuns}` : ''}
          </span>
          {job.nextRunAt && (job.status === 'pending' || job.status === 'running') && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              next {timeUntil(job.nextRunAt)}
            </span>
          )}
          {job.lastRunAt && (
            <span className="text-muted-foreground/60">last ran {timeAgo(job.lastRunAt)}</span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 flex flex-col gap-4 bg-muted/30">
          {job.description && (
            <div>
              <h4 className="text-xs font-medium text-muted-foreground mb-1">Description</h4>
              <p className="text-sm">{job.description}</p>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
              <Terminal className="h-3 w-3" />
              Prompt
            </h4>
            <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words rounded-md border bg-background p-3 font-mono max-h-80 overflow-y-auto">
              {job.prompt}
            </pre>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-muted-foreground">Status</span>
              <p className={`font-medium ${config.color}`}>{config.label}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Schedule</span>
              <p className="font-medium">{formatSchedule(job.schedule)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Created</span>
              <p>{new Date(job.createdAt).toLocaleString()}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Updated</span>
              <p>{new Date(job.updatedAt).toLocaleString()}</p>
            </div>
            {job.nextRunAt && (
              <div>
                <span className="text-muted-foreground">Next Run</span>
                <p>{new Date(job.nextRunAt).toLocaleString()}</p>
              </div>
            )}
            {job.lastRunAt && (
              <div>
                <span className="text-muted-foreground">Last Run</span>
                <p>{new Date(job.lastRunAt).toLocaleString()}</p>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Runs</span>
              <p>{job.runCount}{job.maxRuns ? ` / ${job.maxRuns}` : ''}</p>
            </div>
            {job.context.projectId && (
              <div>
                <span className="text-muted-foreground">Project ID</span>
                <p className="font-mono truncate">{job.context.projectId}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function CronPage({ onUnauthorized }: { onUnauthorized?: () => void }) {
  const navigate = useNavigate()
  const { jobs, loading, refresh } = useCronJobs(onUnauthorized)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggle = (id: string) => setExpandedId(prev => prev === id ? null : id)

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running')
  const pausedJobs = jobs.filter(j => j.status === 'disabled')
  const historyJobs = jobs.filter(j => j.status === 'completed' || j.status === 'failed')

  if (loading) {
    return (
      <div className="flex-1 flex flex-col bg-background">
        <header className="flex items-center gap-3 px-4 py-3 border-b">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">Scheduled Tasks</h1>
        </header>
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-base font-semibold">Scheduled Tasks</h1>
          <span className="text-xs text-muted-foreground">{jobs.length} total</span>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh}>
          <Repeat className="h-3.5 w-3.5 mr-1" />
          Refresh
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">

          {jobs.length === 0 && (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary flex items-center justify-center">
                <Clock className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-base font-medium mb-2">No Scheduled Tasks</h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Scheduled tasks are created during chat sessions. Ask the assistant to set up recurring workflows or one-time reminders.
              </p>
            </div>
          )}

          {activeJobs.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Active ({activeJobs.length})
              </h2>
              <div className="flex flex-col gap-2">
                {activeJobs.map(job => (
                  <JobRow key={job.id} job={job} expanded={expandedId === job.id} onToggle={() => toggle(job.id)} />
                ))}
              </div>
            </section>
          )}

          {pausedJobs.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                Paused ({pausedJobs.length})
              </h2>
              <div className="flex flex-col gap-2">
                {pausedJobs.map(job => (
                  <JobRow key={job.id} job={job} expanded={expandedId === job.id} onToggle={() => toggle(job.id)} />
                ))}
              </div>
            </section>
          )}

          {historyJobs.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-muted-foreground/20" />
                History ({historyJobs.length})
              </h2>
              <div className="flex flex-col gap-2">
                {historyJobs.map(job => (
                  <JobRow key={job.id} job={job} expanded={expandedId === job.id} onToggle={() => toggle(job.id)} />
                ))}
              </div>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
