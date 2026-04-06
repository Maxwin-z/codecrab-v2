import * as cron from 'node-cron'
import * as chrono from 'chrono-node'
import { CronExpressionParser } from 'cron-parser'
import type { CoreEngine } from '../core/index.js'
import type { CronJob, CronJobRun, CronSchedule } from '../types/index.js'
import { CronStore } from './store.js'

// ── setTimeout max delay: ~24.8 days (2^31 - 1 ms) ─────────────────────────
const MAX_TIMEOUT_MS = 2_147_483_647

interface ScheduledTask {
  jobId: string
  task?: cron.ScheduledTask
  timeoutId?: NodeJS.Timeout
}

export class CronScheduler {
  private scheduledTasks = new Map<string, ScheduledTask>()
  private store: CronStore

  private static readonly MAX_RETRIES = 3
  private static readonly RETRY_BASE_MS = 5_000

  constructor(
    private core: CoreEngine,
    baseDir?: string,
  ) {
    this.store = new CronStore(baseDir)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init(): void {
    console.log('[CronScheduler] Starting...')
    const jobs = this.store.loadJobs()
    let skipped = 0
    let cleaned = 0
    let migrated = 0

    // Migrate deprecated one-shot jobs that actually ran (old deleteAfterRun behavior)
    // to 'completed' so they appear in history.
    for (const job of jobs.values()) {
      if (
        job.status === 'deprecated' &&
        job.lastRunAt !== null && job.lastRunAt !== undefined &&
        job.deleteAfterRun === true &&
        job.schedule.kind === 'at'
      ) {
        job.status = 'completed'
        if (job.runCount === 0) job.runCount = 1
        job.updatedAt = new Date().toISOString()
        this.store.saveJob(job)
        migrated++
      }
    }
    if (migrated > 0) console.log(`[CronScheduler] Migrated ${migrated} deprecated→completed jobs`)

    for (const job of jobs.values()) {
      // Skip terminal / inactive states
      if (
        job.status === 'disabled' ||
        job.status === 'failed' ||
        job.status === 'completed' ||
        job.status === 'deprecated'
      ) {
        skipped++
        continue
      }

      // Conservative catch-up: expired one-shot jobs are marked failed, not re-executed
      if (job.schedule.kind === 'at') {
        const runTime = new Date(job.schedule.at).getTime()
        if (runTime <= Date.now()) {
          console.log(`[CronScheduler] Cleaning up expired one-shot job: ${job.id} (${job.name})`)
          if (job.deleteAfterRun) {
            this.store.deleteJob(job.id)
          } else {
            job.status = 'failed'
            this.store.saveJob(job)
          }
          cleaned++
          continue
        }
      }

      this.schedule(job)
    }

    if (skipped > 0) console.log(`[CronScheduler] Skipped ${skipped} finished/disabled jobs`)
    if (cleaned > 0) console.log(`[CronScheduler] Cleaned up ${cleaned} expired one-shot jobs`)
    console.log(`[CronScheduler] Loaded ${this.scheduledTasks.size} active jobs`)
  }

  destroy(): void {
    console.log('[CronScheduler] Stopping...')
    for (const scheduled of this.scheduledTasks.values()) {
      scheduled.task?.stop()
      if (scheduled.timeoutId) clearTimeout(scheduled.timeoutId)
    }
    this.scheduledTasks.clear()
  }

  // ── Scheduling ────────────────────────────────────────────────────────────

  /** Schedule a job. Returns false if the schedule is invalid. */
  schedule(job: CronJob): boolean {
    console.log(`[CronScheduler] Scheduling job: ${job.id} (${job.name})`)
    this.cancel(job.id)

    const nextRun = CronScheduler.calculateNextRun(job.schedule)
    if (!nextRun) {
      console.warn(`[CronScheduler] Cannot calculate next run for job ${job.id}`)
      return false
    }

    job.nextRunAt = nextRun.toISOString()
    this.store.saveJob(job)

    if (job.schedule.kind === 'at') {
      const delay = nextRun.getTime() - Date.now()
      if (delay <= 0) {
        void this.triggerJob(job)
      } else {
        this.scheduleTimeout(job, delay)
      }
    } else if (job.schedule.kind === 'cron') {
      if (!cron.validate(job.schedule.expr)) {
        console.error(`[CronScheduler] Invalid cron expression: ${job.schedule.expr}`)
        return false
      }
      const task = cron.schedule(job.schedule.expr, () => void this.triggerJob(job), {
        timezone: job.schedule.tz,
      })
      this.scheduledTasks.set(job.id, { jobId: job.id, task })
    } else if (job.schedule.kind === 'every') {
      this.scheduleTimeout(job, job.schedule.everyMs)
    }

    return true
  }

  private scheduleTimeout(job: CronJob, delayMs: number): void {
    // Chain to handle delays exceeding setTimeout max (~24.8 days)
    if (delayMs > MAX_TIMEOUT_MS) {
      const timeoutId = setTimeout(() => {
        this.scheduledTasks.delete(job.id)
        this.scheduleTimeout(job, delayMs - MAX_TIMEOUT_MS)
      }, MAX_TIMEOUT_MS)
      this.scheduledTasks.set(job.id, { jobId: job.id, timeoutId })
      return
    }

    const timeoutId = setTimeout(() => void this.triggerJob(job), delayMs)
    this.scheduledTasks.set(job.id, { jobId: job.id, timeoutId })
  }

  cancel(jobId: string): void {
    const scheduled = this.scheduledTasks.get(jobId)
    if (scheduled) {
      scheduled.task?.stop()
      if (scheduled.timeoutId) clearTimeout(scheduled.timeoutId)
      this.scheduledTasks.delete(jobId)
    }
  }

  // ── Execution with retry ──────────────────────────────────────────────────

  private async triggerJob(job: CronJob): Promise<void> {
    const maxRetries = CronScheduler.MAX_RETRIES
    const baseBackoffMs = CronScheduler.RETRY_BASE_MS

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const runId = this.store.generateRunId()
      const isRetry = attempt > 0
      console.log(
        `[CronScheduler] ${isRetry ? `Retry ${attempt}/${maxRetries}` : 'Triggering'} job: ${job.id} (${job.name}), runId=${runId}`,
      )

      job.status = 'running'
      job.lastRunAt = new Date().toISOString()
      this.store.saveJob(job)

      this.store.appendRun(job.id, {
        id: runId,
        jobId: job.id,
        startedAt: new Date().toISOString(),
        status: 'running',
      })

      const startTime = Date.now()

      try {
        const projectId = job.context.projectId!
        const project = this.core.projects.get(projectId)
        if (!project) throw new Error(`Project not found: ${projectId}`)

        const sessionMeta = this.core.sessions.create(projectId, project, {
          cronJobId: job.id,
          cronJobName: job.name,
          permissionMode: 'bypassPermissions',
        })
        const cronSessionId = `cron-${job.id}-${Date.now()}`
        this.core.sessions.register(cronSessionId, sessionMeta)

        await this.core.submitTurn({
          projectId,
          sessionId: cronSessionId,
          prompt: job.prompt,
          type: 'cron',
          metadata: {
            cronJobId: job.id,
            cronJobName: job.name,
          },
        })

        // Success
        const durationMs = Date.now() - startTime
        job.runCount++
        job.status = 'pending'

        const run: CronJobRun = {
          id: runId,
          jobId: job.id,
          startedAt: job.lastRunAt!,
          endedAt: new Date().toISOString(),
          status: 'completed',
          output: 'Task executed successfully',
          durationMs,
        }
        this.store.appendRun(job.id, run)
        console.log(`[CronScheduler] Job ${job.id} completed in ${durationMs}ms`)

        if (job.schedule.kind === 'at') {
          // One-shot job completed — mark as completed so it appears in history
          job.status = 'completed'
          this.cancel(job.id)
          this.store.saveJob(job)
          return
        }

        if (job.maxRuns && job.runCount >= job.maxRuns) {
          job.status = 'disabled'
          this.cancel(job.id)
        }

        this.store.saveJob(job)

        // Reschedule recurring jobs
        if (job.status === 'pending' && (job.schedule.kind === 'cron' || job.schedule.kind === 'every')) {
          this.schedule(job)
        }

        return // Success — exit retry loop
      } catch (err) {
        const durationMs = Date.now() - startTime
        console.error(`[CronScheduler] Job ${job.id} attempt ${attempt + 1}/${maxRetries + 1} failed:`, err)

        this.store.appendRun(job.id, {
          id: runId,
          jobId: job.id,
          startedAt: job.lastRunAt!,
          endedAt: new Date().toISOString(),
          status: 'failed',
          error: String(err),
          durationMs,
        })

        if (attempt < maxRetries) {
          const backoffMs = baseBackoffMs * Math.pow(2, attempt) // 5s, 10s, 20s
          console.log(`[CronScheduler] Retrying job ${job.id} in ${backoffMs}ms...`)
          await new Promise((resolve) => setTimeout(resolve, backoffMs))
          continue
        }

        // Final failure after all retries
        console.error(`[CronScheduler] Job ${job.id} failed after ${maxRetries + 1} attempts`)
        job.status = 'failed'
        this.store.saveJob(job)
      }
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  create(params: Omit<CronJob, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): CronJob {
    const job: CronJob = {
      ...params,
      id: this.store.generateJobId(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runCount: 0,
    }
    this.store.saveJob(job)
    if (job.status === 'pending') {
      this.schedule(job)
    }
    return job
  }

  get(jobId: string): CronJob | null {
    return this.store.getJob(jobId) ?? null
  }

  update(
    jobId: string,
    params: {
      name?: string
      prompt?: string
      description?: string
      schedule?: CronSchedule
      deleteAfterRun?: boolean
      maxRuns?: number
    },
  ): CronJob | null {
    const job = this.store.getJob(jobId)
    if (!job) return null

    if (params.name !== undefined) job.name = params.name
    if (params.prompt !== undefined) job.prompt = params.prompt
    if (params.description !== undefined) job.description = params.description
    if (params.deleteAfterRun !== undefined) job.deleteAfterRun = params.deleteAfterRun
    if (params.maxRuns !== undefined) job.maxRuns = params.maxRuns === 0 ? undefined : params.maxRuns

    let needsReschedule = false
    if (params.schedule !== undefined) {
      job.schedule = params.schedule
      needsReschedule = true
    }

    job.updatedAt = new Date().toISOString()
    this.store.saveJob(job)

    if (needsReschedule && (job.status === 'pending' || job.status === 'running')) {
      this.cancel(jobId)
      this.schedule(job)
    }

    return job
  }

  delete(jobId: string): void {
    this.cancel(jobId)
    this.store.deleteJob(jobId)
  }

  list(projectId?: string): CronJob[] {
    return this.store.listJobs({ projectId })
  }

  pause(jobId: string): void {
    this.cancel(jobId)
    const job = this.store.getJob(jobId)
    if (job) {
      job.status = 'disabled'
      job.updatedAt = new Date().toISOString()
      this.store.saveJob(job)
    }
  }

  resume(jobId: string): boolean {
    const job = this.store.getJob(jobId)
    if (!job) return false
    job.status = 'pending'
    job.updatedAt = new Date().toISOString()
    this.store.saveJob(job)
    return this.schedule(job)
  }

  trigger(jobId: string): void {
    const job = this.store.getJob(jobId)
    if (job) void this.triggerJob(job)
  }

  getHistory(jobId: string, limit = 50): CronJobRun[] {
    return this.store.getRuns(jobId, limit)
  }

  // ── Static helpers ────────────────────────────────────────────────────────

  static calculateNextRun(schedule: CronSchedule): Date | null {
    const now = new Date()
    switch (schedule.kind) {
      case 'at': {
        const date = new Date(schedule.at)
        return isNaN(date.getTime()) ? null : date
      }
      case 'every':
        return new Date(now.getTime() + schedule.everyMs)
      case 'cron': {
        try {
          const interval = CronExpressionParser.parse(schedule.expr, {
            currentDate: now,
            tz: schedule.tz,
          })
          return interval.next().toDate()
        } catch {
          return null
        }
      }
      default:
        return null
    }
  }

  static parseTime(input: string, referenceDate: Date = new Date()): Date | null {
    const iso = new Date(input)
    if (!isNaN(iso.getTime())) return iso
    return chrono.parseDate(input, referenceDate)
  }

  static parseSchedule(
    when: string,
    recurring = false,
  ): { schedule: CronSchedule; isValid: boolean } {
    // Explicit cron expression
    if (recurring && cron.validate(when)) {
      return { schedule: { kind: 'cron', expr: when }, isValid: true }
    }

    // "every X minutes/hours/days" pattern
    const everyMatch = when.match(/every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)/i)
    if (everyMatch && recurring) {
      const num = parseInt(everyMatch[1])
      const unit = everyMatch[2].toLowerCase()
      let ms = num * 60 * 1000
      if (unit.startsWith('hour')) ms = num * 60 * 60 * 1000
      if (unit.startsWith('day')) ms = num * 24 * 60 * 60 * 1000
      return { schedule: { kind: 'every', everyMs: ms }, isValid: true }
    }

    // Absolute time (ISO or natural language via chrono-node)
    const parsed = CronScheduler.parseTime(when)
    if (parsed) {
      return { schedule: { kind: 'at', at: parsed.toISOString() }, isValid: true }
    }

    return { schedule: { kind: 'at', at: '' }, isValid: false }
  }
}

export function initCronScheduler(core: CoreEngine, baseDir?: string): CronScheduler {
  const scheduler = new CronScheduler(core, baseDir)
  scheduler.init()
  return scheduler
}
