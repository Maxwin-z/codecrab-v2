import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CronScheduler } from '../scheduler.js'
import type { CoreEngine } from '../../core/index.js'
import type { CronJob } from '../../types/index.js'

function createMockCore(): CoreEngine {
  const core = {
    submitTurn: vi.fn().mockResolvedValue('query-123'),
    projects: { get: vi.fn(), getPath: vi.fn(), list: vi.fn() },
    sessions: { getMeta: vi.fn() },
    on: vi.fn(),
    emit: vi.fn(),
  }
  return core as any
}

function makeCronJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: `cron-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Test Job',
    schedule: { kind: 'cron', expr: '* * * * *' },
    prompt: 'Run tests',
    context: { projectId: 'proj-1', sessionId: 'sess-1' },
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runCount: 0,
    ...overrides,
  }
}

describe('CronScheduler', () => {
  let core: CoreEngine
  let scheduler: CronScheduler
  let tmpDir: string

  beforeEach(async () => {
    core = createMockCore()
    tmpDir = await mkdtemp(join(tmpdir(), 'cron-test-'))
    scheduler = new CronScheduler(core, tmpDir)
  })

  afterEach(async () => {
    scheduler.destroy()
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('schedule', () => {
    it('should register a cron job with a valid expression', () => {
      const job = makeCronJob()
      scheduler.schedule(job)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(true)
    })

    it('should reject an invalid cron expression', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const job = makeCronJob({ schedule: { kind: 'cron', expr: 'not-a-cron' } })
      const result = scheduler.schedule(job)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(false)
      expect(result).toBe(false)
      consoleSpy.mockRestore()
    })

    it('should cancel existing schedule when re-scheduling same job', () => {
      const job = makeCronJob()
      scheduler.schedule(job)
      scheduler.schedule(job)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.size).toBe(1)
    })
  })

  describe('cancel', () => {
    it('should stop a scheduled job', () => {
      const job = makeCronJob()
      scheduler.schedule(job)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(true)

      scheduler.cancel(job.id)
      expect(scheduledTasks.has(job.id)).toBe(false)
    })

    it('should be a no-op for non-existent job', () => {
      expect(() => scheduler.cancel('non-existent')).not.toThrow()
    })
  })

  describe('destroy', () => {
    it('should stop all scheduled jobs', () => {
      const job1 = makeCronJob({ id: 'job-1' })
      const job2 = makeCronJob({ id: 'job-2' })
      scheduler.schedule(job1)
      scheduler.schedule(job2)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.size).toBe(2)

      scheduler.destroy()
      expect(scheduledTasks.size).toBe(0)
    })
  })

  describe('triggerJob / retry', () => {
    it('should call core.submitTurn with correct params', async () => {
      const job = makeCronJob({
        context: { projectId: 'proj-test', sessionId: 'sess-test' },
        prompt: 'Do the thing',
        name: 'My Cron',
      })

      await (scheduler as any).triggerJob(job)

      expect(core.submitTurn as any).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'proj-test',
          sessionId: 'sess-test',
          prompt: 'Do the thing',
          type: 'cron',
        }),
      )
    })

    it('should set status to pending and increment runCount on success', async () => {
      const job = makeCronJob()
      ;(core.submitTurn as any).mockResolvedValue('query-ok')

      await (scheduler as any).triggerJob(job)

      expect(job.status).toBe('pending')
      expect(job.runCount).toBe(1)
      expect(job.lastRunAt).toBeDefined()
    })

    it('should set status to failed after all retries exhausted', async () => {
      const job = makeCronJob()
      ;(core.submitTurn as any).mockRejectedValue(new Error('boom'))

      // Shorten retry delays for testing
      vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })

      await (scheduler as any).triggerJob(job)

      expect(job.status).toBe('failed')
      vi.restoreAllMocks()
    })

    it('should append runs to store on success and failure', async () => {
      const job = makeCronJob()
      ;(core.submitTurn as any).mockResolvedValue('ok')

      vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any })
      await (scheduler as any).triggerJob(job)
      vi.restoreAllMocks()

      const store = (scheduler as any).store
      const runs = store.getRuns(job.id)
      expect(runs.length).toBeGreaterThanOrEqual(1)
    })

    it('should auto-delete one-shot job when deleteAfterRun=true', async () => {
      const runAt = new Date(Date.now() + 10_000).toISOString()
      const job = makeCronJob({
        schedule: { kind: 'at', at: runAt },
        deleteAfterRun: true,
      })
      ;(core.submitTurn as any).mockResolvedValue('ok')

      await (scheduler as any).triggerJob(job)

      // Job should be deprecated (soft-deleted)
      const store = (scheduler as any).store
      const stored = store.getJob(job.id)
      expect(stored?.status).toBe('deprecated')
    })

    it('should disable job when maxRuns reached', async () => {
      const job = makeCronJob({ maxRuns: 1, runCount: 0 })
      ;(core.submitTurn as any).mockResolvedValue('ok')

      await (scheduler as any).triggerJob(job)

      expect(job.runCount).toBe(1)
      expect(job.status).toBe('disabled')
    })
  })

  describe('pause', () => {
    it('should set status to disabled and stop scheduling', () => {
      const job = makeCronJob()
      const store = (scheduler as any).store
      store.saveJob(job)
      scheduler.schedule(job)

      scheduler.pause(job.id)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(false)

      const stored = store.getJob(job.id)
      expect(stored.status).toBe('disabled')
    })
  })

  describe('resume', () => {
    it('should set status to pending and re-schedule', () => {
      const job = makeCronJob({ status: 'disabled' })
      const store = (scheduler as any).store
      store.saveJob(job)

      const result = scheduler.resume(job.id)

      expect(result).toBe(true)
      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(true)

      const stored = store.getJob(job.id)
      expect(stored.status).toBe('pending')
    })
  })

  describe('create', () => {
    it('should generate an ID and save to store', () => {
      const created = scheduler.create({
        name: 'New Job',
        schedule: { kind: 'cron', expr: '*/5 * * * *' },
        prompt: 'Check status',
        context: { projectId: 'proj-1', sessionId: 'sess-1' },
        status: 'pending',
      })

      expect(created.id).toMatch(/^cron-/)
      expect(created.name).toBe('New Job')
      expect(created.createdAt).toBeDefined()
      expect(created.runCount).toBe(0)

      const store = (scheduler as any).store
      expect(store.getJob(created.id)).not.toBeUndefined()
    })

    it('should schedule the job when status is pending', () => {
      const created = scheduler.create({
        name: 'Enabled Job',
        schedule: { kind: 'cron', expr: '*/10 * * * *' },
        prompt: 'Run',
        context: { projectId: 'proj-1', sessionId: 'sess-1' },
        status: 'pending',
      })

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(created.id)).toBe(true)
    })

    it('should not schedule when status is disabled', () => {
      const created = scheduler.create({
        name: 'Disabled Job',
        schedule: { kind: 'cron', expr: '*/10 * * * *' },
        prompt: 'Run',
        context: { projectId: 'proj-1', sessionId: 'sess-1' },
        status: 'disabled',
      })

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(created.id)).toBe(false)
    })
  })

  describe('delete', () => {
    it('should cancel and soft-delete (deprecate) from store', () => {
      const job = makeCronJob()
      const store = (scheduler as any).store
      store.saveJob(job)
      scheduler.schedule(job)

      scheduler.delete(job.id)

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.has(job.id)).toBe(false)

      const stored = store.getJob(job.id)
      expect(stored?.status).toBe('deprecated')
    })
  })

  describe('list', () => {
    it('should return all non-deprecated jobs', () => {
      const store = (scheduler as any).store
      store.saveJob(makeCronJob({ id: 'job-a', context: { projectId: 'proj-1', sessionId: 's' } }))
      store.saveJob(makeCronJob({ id: 'job-b', context: { projectId: 'proj-2', sessionId: 's' } }))

      const all = scheduler.list()
      expect(all).toHaveLength(2)
    })

    it('should filter by projectId', () => {
      const store = (scheduler as any).store
      store.saveJob(makeCronJob({ id: 'job-a', context: { projectId: 'proj-1', sessionId: 's' } }))
      store.saveJob(makeCronJob({ id: 'job-b', context: { projectId: 'proj-2', sessionId: 's' } }))

      const filtered = scheduler.list('proj-1')
      expect(filtered).toHaveLength(1)
      expect(filtered[0].context.projectId).toBe('proj-1')
    })
  })

  describe('init (catch-up)', () => {
    it('should skip disabled/failed/completed/deprecated jobs', () => {
      const store = (scheduler as any).store
      store.saveJob(makeCronJob({ id: 'j1', status: 'disabled' }))
      store.saveJob(makeCronJob({ id: 'j2', status: 'failed' }))
      store.saveJob(makeCronJob({ id: 'j3', status: 'completed' }))
      store.saveJob(makeCronJob({ id: 'j4', status: 'deprecated' }))

      scheduler.init()

      const scheduledTasks = (scheduler as any).scheduledTasks as Map<string, any>
      expect(scheduledTasks.size).toBe(0)
    })

    it('should mark expired one-shot job as failed (conservative catch-up)', () => {
      const store = (scheduler as any).store
      const expiredAt = new Date(Date.now() - 60_000).toISOString()
      const job = makeCronJob({
        id: 'expired',
        schedule: { kind: 'at', at: expiredAt },
        status: 'pending',
      })
      store.saveJob(job)

      scheduler.init()

      const stored = store.getJob('expired')
      expect(stored?.status).toBe('failed')
    })
  })

  describe('parseSchedule', () => {
    it('parses cron expression when recurring=true', () => {
      const { schedule, isValid } = CronScheduler.parseSchedule('0 9 * * *', true)
      expect(isValid).toBe(true)
      expect(schedule.kind).toBe('cron')
    })

    it('parses "every X minutes" when recurring=true', () => {
      const { schedule, isValid } = CronScheduler.parseSchedule('every 5 minutes', true)
      expect(isValid).toBe(true)
      expect(schedule.kind).toBe('every')
      if (schedule.kind === 'every') expect(schedule.everyMs).toBe(5 * 60 * 1000)
    })

    it('parses ISO timestamp as one-shot', () => {
      const iso = new Date(Date.now() + 60_000).toISOString()
      const { schedule, isValid } = CronScheduler.parseSchedule(iso)
      expect(isValid).toBe(true)
      expect(schedule.kind).toBe('at')
    })

    it('returns isValid=false for unparseable input', () => {
      const { isValid } = CronScheduler.parseSchedule('not-a-schedule')
      expect(isValid).toBe(false)
    })
  })
})
