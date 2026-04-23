# Cron Auto-Loop Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kind: 'loop'` schedule to the cron subsystem that re-triggers a task with a fresh session every time the previous turn closes, with optional cooldown and stop-on-error semantics.

**Architecture:** A 4th `CronSchedule` variant (`{ kind: 'loop'; cooldownMs?: number }`). The scheduler's `triggerJob` gets a new path that subscribes to `core.on('turn:close')` filtered by the cron-issued `sessionId`, awaits the close event, then either schedules the next iteration (success) or marks the job failed (error). Pause/delete/restart all reuse existing CronJob plumbing.

**Tech Stack:** TypeScript (Node 20+), `@anthropic-ai/claude-agent-sdk`, Vitest, pnpm monorepo. Cron logic lives in `packages/server`.

**Spec:** `docs/superpowers/specs/2026-04-23-cron-loop-mode-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/server/src/types/index.ts` | Modify | Add `loop` variant to `CronSchedule` |
| `packages/server/src/cron/scheduler.ts` | Modify | New `loop` branches in `schedule()`, `triggerJob()`, `calculateNextRun()`; keyword fallback in `parseSchedule()` |
| `packages/server/src/agent/extensions/cron/tools.ts` | Modify | New `loop` / `cooldownMs` inputs in `cron_create` & `cron_update`; `loop` branch in `formatSchedule()`; updated descriptions |
| `packages/server/src/cron/__tests__/scheduler.test.ts` | Modify | Add `describe('loop mode', ...)` with 10 test cases |

The plan is intentionally TDD: write failing test, run it, write minimal impl, run test, commit. Implementation tasks are split per behavior so each commit is self-contained.

---

## Task 1: Schema — add `loop` variant

**Files:**
- Modify: `packages/server/src/types/index.ts:485-488`

- [ ] **Step 1: Read the current type definition**

Run: `Read /Users/maxwin/codecrab-v2/packages/server/src/types/index.ts offset=485 limit=8`
Expected: see the existing `CronSchedule` union with three variants.

- [ ] **Step 2: Extend the union with `loop`**

Edit `packages/server/src/types/index.ts`. Replace:

```ts
export type CronSchedule =
  | { kind: 'at'; at: string }           // ISO 8601 one-shot
  | { kind: 'every'; everyMs: number }   // millisecond interval
  | { kind: 'cron'; expr: string; tz?: string } // cron expression + optional timezone
```

with:

```ts
export type CronSchedule =
  | { kind: 'at'; at: string }           // ISO 8601 one-shot
  | { kind: 'every'; everyMs: number }   // millisecond interval
  | { kind: 'cron'; expr: string; tz?: string } // cron expression + optional timezone
  | { kind: 'loop'; cooldownMs?: number } // re-trigger after each turn:close; cooldownMs gates next start
```

- [ ] **Step 3: Type-check the package**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec tsc --noEmit`
Expected: should fail with exhaustiveness errors in `scheduler.ts` (`calculateNextRun`, `formatSchedule`, etc.) — that proves the union is wired up. Note the failing files; they get fixed in later tasks.

- [ ] **Step 4: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/types/index.ts
git commit -m "feat(cron): add loop variant to CronSchedule union"
```

---

## Task 2: `calculateNextRun` — handle `loop` (returns null)

**Files:**
- Modify: `packages/server/src/cron/scheduler.ts:385-408`
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add a failing test**

Append to `packages/server/src/cron/__tests__/scheduler.test.ts` inside the existing top-level `describe('CronScheduler', ...)`:

```ts
  describe('loop mode', () => {
    it('calculateNextRun returns null for loop kind (no deterministic next run)', () => {
      const result = CronScheduler.calculateNextRun({ kind: 'loop', cooldownMs: 1000 })
      expect(result).toBeNull()
    })
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "calculateNextRun returns null for loop"`
Expected: FAIL — currently `calculateNextRun` either throws or returns a Date (the switch default may return null but the typing now flags loop as un-handled).

- [ ] **Step 3: Add the loop branch**

In `packages/server/src/cron/scheduler.ts`, find `static calculateNextRun(schedule: CronSchedule): Date | null` (around line 385). Add a case before the default:

```ts
      case 'loop':
        return null  // No deterministic next run; computed dynamically from turn:close
```

So the switch becomes:

```ts
    switch (schedule.kind) {
      case 'at': { /* unchanged */ }
      case 'every':
        return new Date(now.getTime() + schedule.everyMs)
      case 'cron': { /* unchanged */ }
      case 'loop':
        return null  // No deterministic next run; computed dynamically from turn:close
      default:
        return null
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "calculateNextRun returns null for loop"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/scheduler.ts packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "feat(cron): calculateNextRun handles loop kind"
```

---

## Task 3: `schedule()` — first iteration kicks off immediately for `loop`

**Files:**
- Modify: `packages/server/src/cron/scheduler.ts:106-140`
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add a failing test**

Append to the `describe('loop mode', ...)` block:

```ts
    it('schedule() triggers first iteration immediately for loop kind', async () => {
      const triggerSpy = vi.spyOn(scheduler as any, 'triggerJob').mockImplementation(() => Promise.resolve())
      const job = makeCronJob({ schedule: { kind: 'loop' } })
      const ok = scheduler.schedule(job)
      expect(ok).toBe(true)
      expect(triggerSpy).toHaveBeenCalledTimes(1)
      expect(triggerSpy).toHaveBeenCalledWith(job)
    })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "schedule.. triggers first iteration"`
Expected: FAIL — `schedule()` currently has no `loop` branch and likely returns `false` because `calculateNextRun` returns null.

- [ ] **Step 3: Update `schedule()` so loop bypasses the nextRun gate and triggers immediately**

In `packages/server/src/cron/scheduler.ts`, find the `schedule(job: CronJob)` method (around line 106). The current code computes `nextRun` and returns false if null. For loop, null is expected. Restructure as:

```ts
  schedule(job: CronJob): boolean {
    console.log(`[CronScheduler] Scheduling job: ${job.id} (${job.name})`)
    this.cancel(job.id)

    // Loop kind has no deterministic nextRun — first iteration fires immediately,
    // subsequent ones are scheduled from triggerJob after turn:close.
    if (job.schedule.kind === 'loop') {
      job.nextRunAt = undefined
      this.store.saveJob(job)
      // Reserve the map slot so cancel() during cooldown / first-await can find this job
      this.scheduledTasks.set(job.id, { jobId: job.id })
      void this.triggerJob(job)
      return true
    }

    const nextRun = CronScheduler.calculateNextRun(job.schedule)
    if (!nextRun) {
      console.warn(`[CronScheduler] Cannot calculate next run for job ${job.id}`)
      return false
    }

    job.nextRunAt = nextRun.toISOString()
    this.store.saveJob(job)

    if (job.schedule.kind === 'at') {
      // ... unchanged ...
    } else if (job.schedule.kind === 'cron') {
      // ... unchanged ...
    } else if (job.schedule.kind === 'every') {
      this.scheduleTimeout(job, job.schedule.everyMs)
    }

    return true
  }
```

(Leave the existing `at` / `cron` / `every` branches verbatim.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "schedule.. triggers first iteration"`
Expected: PASS.

- [ ] **Step 5: Run the full cron test suite to make sure existing tests still pass**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/scheduler.ts packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "feat(cron): schedule() fires loop kind immediately"
```

---

## Task 4: `triggerJob` — loop path: subscribe to turn:close, re-schedule on success

**Files:**
- Modify: `packages/server/src/cron/scheduler.ts:168-286`
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

This is the core of the feature. We extract a `triggerJobLoop` private method to keep the existing `triggerJob` retry/backoff path intact for `at` / `every` / `cron` jobs, and dispatch by `kind`.

- [ ] **Step 1: Add the success-path test**

Add to `describe('loop mode', ...)`:

```ts
    it('re-triggers after turn:close success', async () => {
      // Capture the turn:close handler when triggerJob registers it
      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      const job = scheduler.create({
        name: 'Loop Job',
        schedule: { kind: 'loop' },
        prompt: 'do work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' },
        status: 'pending',
      })

      // Wait for first triggerJob to register the listener
      await new Promise((r) => setImmediate(r))
      expect(turnCloseHandler).not.toBeNull()
      expect(core.submitTurn).toHaveBeenCalledTimes(1)

      // Capture the sessionId triggerJob used (passed to submitTurn)
      const firstCall = (core.submitTurn as any).mock.calls[0][0]
      const sessionId = firstCall.sessionId
      expect(sessionId).toMatch(/^cron-/)

      // Fire turn:close success
      turnCloseHandler!({ sessionId, isError: false, projectId: 'proj-1', turnId: 't1', type: 'cron', result: 'ok', usage: {}, costUsd: 0, durationMs: 100 })

      // Allow setImmediate to fire next iteration
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(core.submitTurn).toHaveBeenCalledTimes(2)
      const updated = scheduler.get(job.id)!
      expect(updated.runCount).toBe(1)
      expect(updated.status).toBe('pending')
    })
```

Also add a helper at the top of the `describe('loop mode', ...)` block to make `core.on` chainable in this test (since the default mock doesn't capture handlers). The existing `createMockCore()` already returns `on: vi.fn()` — that's fine for this test because we override it via `mockImplementation`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "re-triggers after turn:close success"`
Expected: FAIL — `submitTurn` is called only once, no listener is registered.

- [ ] **Step 3: Add the loop dispatch in `triggerJob` and the new `triggerJobLoop` method**

In `packages/server/src/cron/scheduler.ts`, find `private async triggerJob(job: CronJob): Promise<void>` (around line 168). At the very top of the method (after the `fresh = this.store.getJob(job.id)` re-read), add a dispatch:

```ts
  private async triggerJob(job: CronJob): Promise<void> {
    // Re-read latest version (existing behavior)
    const fresh = this.store.getJob(job.id)
    if (fresh) job = fresh

    if (job.schedule.kind === 'loop') {
      return this.triggerJobLoop(job)
    }

    // ... existing retry-loop body unchanged ...
  }
```

Then add the new method below `triggerJob`:

```ts
  private async triggerJobLoop(job: CronJob): Promise<void> {
    const runId = this.store.generateRunId()
    console.log(`[CronScheduler] Triggering loop job: ${job.id} (${job.name}), runId=${runId}`)

    job.status = 'running'
    job.lastRunAt = new Date().toISOString()
    this.store.saveJob(job)

    this.store.appendRun(job.id, {
      id: runId,
      jobId: job.id,
      startedAt: job.lastRunAt!,
      status: 'running',
    })

    const startTime = Date.now()
    const projectId = job.context.projectId!
    const cronSessionId = `cron-${job.id}-${Date.now()}`

    // Subscribe BEFORE submitTurn so we never miss the close event
    let handler: ((data: any) => void) | null = null
    const turnClosed = new Promise<{ isError: boolean; result?: string }>((resolve) => {
      handler = (data: any) => {
        if (data.sessionId === cronSessionId) {
          resolve({ isError: data.isError, result: data.result })
        }
      }
      this.core.on('turn:close', handler)
    })

    const cleanup = () => {
      if (handler) this.core.off('turn:close', handler)
      handler = null
    }

    try {
      const project = this.core.projects.get(projectId)
      if (!project) throw new Error(`Project not found: ${projectId}`)

      const sessionMeta = this.core.sessions.create(projectId, project, {
        cronJobId: job.id,
        cronJobName: job.name,
        permissionMode: 'bypassPermissions',
      })
      this.core.sessions.register(cronSessionId, sessionMeta)

      await this.core.submitTurn({
        projectId,
        sessionId: cronSessionId,
        prompt: job.prompt,
        type: 'cron',
        metadata: { cronJobId: job.id, cronJobName: job.name },
      })
    } catch (err) {
      cleanup()
      const durationMs = Date.now() - startTime
      console.error(`[CronScheduler] Loop job ${job.id} submitTurn threw:`, err)
      this.store.appendRun(job.id, {
        id: runId,
        jobId: job.id,
        startedAt: job.lastRunAt!,
        endedAt: new Date().toISOString(),
        status: 'failed',
        error: String(err),
        durationMs,
      })
      job.status = 'failed'
      this.store.saveJob(job)
      this.cancel(job.id)
      return
    }

    let outcome: { isError: boolean; result?: string }
    try {
      outcome = await turnClosed
    } finally {
      cleanup()
    }

    const durationMs = Date.now() - startTime

    // Re-read after await — pause/delete may have flipped status
    const latest = this.store.getJob(job.id)
    if (!latest || latest.status === 'disabled' || latest.status === 'deprecated') {
      this.store.appendRun(job.id, {
        id: runId,
        jobId: job.id,
        startedAt: job.lastRunAt!,
        endedAt: new Date().toISOString(),
        status: 'cancelled',
        durationMs,
      })
      console.log(`[CronScheduler] Loop job ${job.id} stopped (status=${latest?.status ?? 'gone'})`)
      return
    }
    job = latest

    if (outcome.isError) {
      this.store.appendRun(job.id, {
        id: runId,
        jobId: job.id,
        startedAt: job.lastRunAt!,
        endedAt: new Date().toISOString(),
        status: 'failed',
        error: outcome.result ?? 'turn ended with isError',
        durationMs,
      })
      job.status = 'failed'
      this.store.saveJob(job)
      this.cancel(job.id)
      console.log(`[CronScheduler] Loop job ${job.id} stopped (turn errored)`)
      return
    }

    // Success
    job.runCount++
    this.store.appendRun(job.id, {
      id: runId,
      jobId: job.id,
      startedAt: job.lastRunAt!,
      endedAt: new Date().toISOString(),
      status: 'completed',
      output: outcome.result ?? 'ok',
      durationMs,
    })

    if (job.maxRuns && job.runCount >= job.maxRuns) {
      job.status = 'completed'
      this.store.saveJob(job)
      this.cancel(job.id)
      console.log(`[CronScheduler] Loop job ${job.id} reached maxRuns=${job.maxRuns}`)
      return
    }

    job.status = 'pending'
    this.store.saveJob(job)

    // Schedule next iteration
    const cooldown = job.schedule.kind === 'loop' ? job.schedule.cooldownMs ?? 0 : 0
    if (cooldown > 0) {
      this.scheduleTimeout(job, cooldown)
    } else {
      // setImmediate prevents synchronous recursion; tasks map slot stays reserved
      this.scheduledTasks.set(job.id, { jobId: job.id })
      setImmediate(() => void this.triggerJob(job))
    }
  }
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "re-triggers after turn:close success"`
Expected: PASS.

- [ ] **Step 5: Run the full cron test suite**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts`
Expected: all green. (`createMockCore()` doesn't currently expose `off` — if a non-loop test breaks because of that, the failure is unrelated; but loop tests use override anyway.)

- [ ] **Step 6: Make the mock core expose `off` so cleanup() doesn't crash future tests**

Edit `packages/server/src/cron/__tests__/scheduler.test.ts`. Find `createMockCore()` and add `off: vi.fn()` next to the existing `on: vi.fn()`:

```ts
function createMockCore(): CoreEngine {
  const core = {
    submitTurn: vi.fn().mockResolvedValue('query-123'),
    projects: { get: vi.fn().mockReturnValue({ id: 'proj-1', name: 'Test Project' }), getPath: vi.fn(), list: vi.fn() },
    sessions: { getMeta: vi.fn(), create: vi.fn().mockReturnValue({}), register: vi.fn() },
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  }
  return core as any
}
```

- [ ] **Step 7: Run the full cron suite again**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/scheduler.ts packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "feat(cron): loop mode re-triggers on turn:close success"
```

---

## Task 5: `triggerJobLoop` — stop on turn error

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

The error path is already implemented in Task 4. This task adds explicit test coverage and lets us catch any regression separately.

- [ ] **Step 1: Add the failing test**

Add to `describe('loop mode', ...)`:

```ts
    it('stops loop and marks failed when turn:close has isError', async () => {
      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      const job = scheduler.create({
        name: 'Failing Loop',
        schedule: { kind: 'loop' },
        prompt: 'do work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' },
        status: 'pending',
      })

      await new Promise((r) => setImmediate(r))
      const sessionId = (core.submitTurn as any).mock.calls[0][0].sessionId

      turnCloseHandler!({ sessionId, isError: true, result: 'agent crashed', projectId: 'proj-1', turnId: 't1', type: 'cron', usage: {}, costUsd: 0, durationMs: 100 })

      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      const updated = scheduler.get(job.id)!
      expect(updated.status).toBe('failed')
      expect(core.submitTurn).toHaveBeenCalledTimes(1)  // No re-trigger

      const runs = scheduler.getHistory(job.id, 5)
      expect(runs[runs.length - 1].status).toBe('failed')
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "stops loop and marks failed when turn:close has isError"`
Expected: PASS (Task 4 already implemented this).

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): cover loop-mode error termination"
```

---

## Task 6: `triggerJobLoop` — pause / delete during turn does not re-trigger

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add failing tests for pause-mid-turn and delete-mid-turn**

Add to `describe('loop mode', ...)`:

```ts
    it('does not re-trigger when paused while turn was running', async () => {
      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      const job = scheduler.create({
        name: 'Pause Mid', schedule: { kind: 'loop' }, prompt: 'work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
      })

      await new Promise((r) => setImmediate(r))
      const sessionId = (core.submitTurn as any).mock.calls[0][0].sessionId

      // User pauses while the turn is in flight
      scheduler.pause(job.id)

      // Turn finishes successfully afterwards
      turnCloseHandler!({ sessionId, isError: false, result: 'ok', projectId: 'proj-1', turnId: 't1', type: 'cron', usage: {}, costUsd: 0, durationMs: 100 })

      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(core.submitTurn).toHaveBeenCalledTimes(1)  // No re-trigger
      const updated = scheduler.get(job.id)!
      expect(updated.status).toBe('disabled')
    })

    it('does not throw and does not re-trigger when deleted while turn was running', async () => {
      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      const job = scheduler.create({
        name: 'Delete Mid', schedule: { kind: 'loop' }, prompt: 'work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
      })

      await new Promise((r) => setImmediate(r))
      const sessionId = (core.submitTurn as any).mock.calls[0][0].sessionId

      scheduler.delete(job.id)

      // Should not throw
      expect(() => {
        turnCloseHandler!({ sessionId, isError: false, result: 'ok', projectId: 'proj-1', turnId: 't1', type: 'cron', usage: {}, costUsd: 0, durationMs: 100 })
      }).not.toThrow()

      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(core.submitTurn).toHaveBeenCalledTimes(1)
    })
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "does not re-trigger when paused"`
Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "does not throw and does not re-trigger when deleted"`
Expected: both PASS (Task 4 already handles these cases via the `latest` re-read).

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): cover loop-mode pause/delete during turn"
```

---

## Task 7: `triggerJobLoop` — `cooldownMs` gates next start

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add a failing test using fake timers**

Add to `describe('loop mode', ...)`:

```ts
    it('honors cooldownMs between iterations', async () => {
      vi.useFakeTimers()
      try {
        let turnCloseHandler: ((data: any) => void) | null = null
        ;(core.on as any).mockImplementation((event: string, handler: any) => {
          if (event === 'turn:close') turnCloseHandler = handler
        })

        scheduler.create({
          name: 'Cooldown', schedule: { kind: 'loop', cooldownMs: 5000 }, prompt: 'work',
          context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
        })

        // Drain microtasks so the first triggerJob runs
        await vi.advanceTimersByTimeAsync(0)
        expect(core.submitTurn).toHaveBeenCalledTimes(1)
        const sessionId = (core.submitTurn as any).mock.calls[0][0].sessionId

        // Turn closes successfully
        turnCloseHandler!({ sessionId, isError: false, result: 'ok', projectId: 'proj-1', turnId: 't1', type: 'cron', usage: {}, costUsd: 0, durationMs: 100 })
        await vi.advanceTimersByTimeAsync(0)

        // Before cooldown: still 1 call
        await vi.advanceTimersByTimeAsync(4000)
        expect(core.submitTurn).toHaveBeenCalledTimes(1)

        // After cooldown elapses: second call fires
        await vi.advanceTimersByTimeAsync(1500)
        expect(core.submitTurn).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "honors cooldownMs"`
Expected: PASS — Task 4 routes `cooldownMs > 0` to `scheduleTimeout` which uses `setTimeout`.

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): cover loop-mode cooldownMs gating"
```

---

## Task 8: `triggerJobLoop` — `maxRuns` terminates loop

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `describe('loop mode', ...)`:

```ts
    it('stops loop with status=completed when maxRuns reached', async () => {
      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      const job = scheduler.create({
        name: 'Max3', schedule: { kind: 'loop' }, prompt: 'work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
        maxRuns: 3,
      })

      // Drive 3 successful iterations
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setImmediate(r))
        const calls = (core.submitTurn as any).mock.calls
        const sessionId = calls[calls.length - 1][0].sessionId
        turnCloseHandler!({ sessionId, isError: false, result: 'ok', projectId: 'proj-1', turnId: `t${i}`, type: 'cron', usage: {}, costUsd: 0, durationMs: 50 })
        await new Promise((r) => setImmediate(r))
      }

      // Allow any extra setImmediate to fire (there should be none)
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))

      expect(core.submitTurn).toHaveBeenCalledTimes(3)
      const updated = scheduler.get(job.id)!
      expect(updated.runCount).toBe(3)
      expect(updated.status).toBe('completed')
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "stops loop with status=completed when maxRuns reached"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): cover loop-mode maxRuns termination"
```

---

## Task 9: `triggerJobLoop` — listener cleanup (no leak across iterations)

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `describe('loop mode', ...)`:

```ts
    it('removes turn:close listener after each iteration (no leak)', async () => {
      let turnCloseHandler: ((data: any) => void) | null = null
      let onCalls = 0
      let offCalls = 0
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') {
          turnCloseHandler = handler
          onCalls++
        }
      })
      ;(core.off as any).mockImplementation((event: string) => {
        if (event === 'turn:close') offCalls++
      })

      scheduler.create({
        name: 'NoLeak', schedule: { kind: 'loop' }, prompt: 'work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
        maxRuns: 5,
      })

      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setImmediate(r))
        const calls = (core.submitTurn as any).mock.calls
        const sessionId = calls[calls.length - 1][0].sessionId
        turnCloseHandler!({ sessionId, isError: false, result: 'ok', projectId: 'proj-1', turnId: `t${i}`, type: 'cron', usage: {}, costUsd: 0, durationMs: 50 })
        await new Promise((r) => setImmediate(r))
      }

      expect(onCalls).toBe(5)
      expect(offCalls).toBe(5)  // exactly one off per on
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "removes turn:close listener"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): assert no turn:close listener leak in loop mode"
```

---

## Task 10: `triggerJobLoop` — server restart recovers loop job

**Files:**
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `describe('loop mode', ...)`:

```ts
    it('init() resumes a previously-pending loop job', async () => {
      // Persist a loop job to the store, then build a fresh scheduler instance
      const job = scheduler.create({
        name: 'Restart', schedule: { kind: 'loop' }, prompt: 'work',
        context: { projectId: 'proj-1', sessionId: 'sess-1' }, status: 'pending',
      })

      // Simulate restart: destroy the current scheduler, instantiate a new one over same baseDir
      scheduler.destroy()
      const submitBefore = (core.submitTurn as any).mock.calls.length
      const fresh = new CronScheduler(core, tmpDir)

      let turnCloseHandler: ((data: any) => void) | null = null
      ;(core.on as any).mockImplementation((event: string, handler: any) => {
        if (event === 'turn:close') turnCloseHandler = handler
      })

      fresh.init()
      await new Promise((r) => setImmediate(r))

      const submitAfter = (core.submitTurn as any).mock.calls.length
      expect(submitAfter).toBeGreaterThan(submitBefore)
      expect(turnCloseHandler).not.toBeNull()

      // Cleanup so test doesn't dangle
      fresh.destroy()
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "init.. resumes a previously-pending loop job"`
Expected: PASS — `init()`'s existing skip filter passes loop+pending through to `schedule()` which now triggers immediately.

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "test(cron): server-restart recovery for loop jobs"
```

---

## Task 11: `parseSchedule` — keyword fallback for "loop" / "循环"

**Files:**
- Modify: `packages/server/src/cron/scheduler.ts:416-444`
- Test: `packages/server/src/cron/__tests__/scheduler.test.ts`

- [ ] **Step 1: Add the failing test**

Add to `describe('loop mode', ...)`:

```ts
    it('parseSchedule recognizes "loop" / "循环" when recurring', () => {
      expect(CronScheduler.parseSchedule('loop', true).schedule).toEqual({ kind: 'loop' })
      expect(CronScheduler.parseSchedule('loop forever', true).schedule).toEqual({ kind: 'loop' })
      expect(CronScheduler.parseSchedule('循环执行', true).schedule).toEqual({ kind: 'loop' })
    })
```

- [ ] **Step 2: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "parseSchedule recognizes"`
Expected: FAIL — "loop" goes to chrono and either fails or returns garbage.

- [ ] **Step 3: Add the keyword branch in `parseSchedule`**

In `packages/server/src/cron/scheduler.ts`, find `static parseSchedule(when: string, recurring = false)` (around line 416). Insert a new check **after** the `cron.validate` block but **before** the `everyMatch` block:

```ts
  static parseSchedule(
    when: string,
    recurring = false,
  ): { schedule: CronSchedule; isValid: boolean } {
    // Explicit cron expression
    if (recurring && cron.validate(when)) {
      return { schedule: { kind: 'cron', expr: when }, isValid: true }
    }

    // "loop" / "循环" keyword for auto-loop schedules
    if (recurring && /^\s*loop\b|循环/i.test(when)) {
      return { schedule: { kind: 'loop' }, isValid: true }
    }

    // ... rest unchanged ...
```

- [ ] **Step 4: Run the test**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts -t "parseSchedule recognizes"`
Expected: PASS.

- [ ] **Step 5: Run full cron test suite to make sure no regression**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec vitest run src/cron/__tests__/scheduler.test.ts`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/cron/scheduler.ts packages/server/src/cron/__tests__/scheduler.test.ts
git commit -m "feat(cron): parseSchedule recognizes loop/循环 keyword"
```

---

## Task 12: `cron_create` tool — accept `loop` & `cooldownMs`

**Files:**
- Modify: `packages/server/src/agent/extensions/cron/tools.ts:60-156`

- [ ] **Step 1: Read the current `cron_create` tool**

Run: `Read /Users/maxwin/codecrab-v2/packages/server/src/agent/extensions/cron/tools.ts offset=60 limit=100`

- [ ] **Step 2: Update `cron_create`**

Edit `packages/server/src/agent/extensions/cron/tools.ts`. In the `cron_create` tool definition:

1. Update the description string. Replace the current description with:

```
Create a scheduled task that will execute automatically at a specific time, on a recurring schedule, or in an auto-loop.

Use this tool when the user asks to:
- Set a reminder (e.g., "remind me in 5 minutes")
- Schedule a task (e.g., "check email every hour")
- Perform an action later (e.g., "tomorrow morning check the logs")
- Run something in a loop until manually stopped (e.g., "keep monitoring X", "loop this until I say stop")

The 'when' parameter accepts natural language like "1 minute later", "5 minutes from now", "tomorrow at 9am", "every hour", or cron expression "0 9 * * *".

LOOP MODE: set 'loop: true' to create a self-restarting task. Each iteration starts a NEW session as soon as the previous turn closes. The loop stops when manually paused/deleted, when any turn returns an error (including user abort), or when 'maxRuns' is reached. Use 'cooldownMs' to throttle (e.g., wait 30000ms between iterations). When loop is true, 'when' / 'recurring' / 'cronExpression' are ignored.

CRITICAL - The 'prompt' parameter is the instruction that will be executed. For reminders, the prompt MUST explicitly instruct the AI to send a push notification using the push_send tool.
```

2. Add two new fields in the Zod schema (after `description`, before the context fields):

```ts
      loop: z.boolean().optional().describe('Auto-loop mode: re-trigger with a new session each time the previous turn closes. Stops on pause/delete, error, or maxRuns.'),
      cooldownMs: z.number().optional().describe('Loop mode only: ms to wait between iterations (default 0 = immediate).'),
      maxRuns: z.number().optional().describe('Optional cap on total runs (applies to loop / every / cron schedules).'),
```

(`maxRuns` is added too because loop benefits from it and the existing `cron_update` already supports it but `cron_create` does not.)

3. In the handler, **before** the existing `parseSchedule` call, branch on `input.loop`:

```ts
      let parsed: { schedule: CronSchedule; isValid: boolean }
      if (input.loop === true) {
        parsed = {
          schedule: { kind: 'loop', cooldownMs: input.cooldownMs },
          isValid: true,
        }
      } else {
        const isRecurring = input.recurring || !!input.cronExpression
        const scheduleInput = input.cronExpression || input.when
        parsed = CronSchedulerClass.parseSchedule(scheduleInput, isRecurring)
      }
```

(Replace the existing `const isRecurring`, `const scheduleInput`, `const parsed` lines.)

4. The "in the past" check for `kind === 'at'` is unchanged. The `kind === 'cron' && input.timezone` block is unchanged.

5. In the `scheduler.create({...})` call, pass `maxRuns: input.maxRuns`. And change `deleteAfterRun` default to:

```ts
        deleteAfterRun: input.deleteAfterRun ?? (parsed.schedule.kind === 'at'),
```

(Already the default — loop and recurring kinds get false, which is correct.) Also add `maxRuns: input.maxRuns` to the create payload.

6. You'll also need to import `CronSchedule` at the top of the file. Find the existing import line:

```ts
import type { CronJob } from '../../../types/index.js'
```

and replace with:

```ts
import type { CronJob, CronSchedule } from '../../../types/index.js'
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec tsc --noEmit`
Expected: clean (no type errors).

- [ ] **Step 4: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/agent/extensions/cron/tools.ts
git commit -m "feat(cron): cron_create accepts loop, cooldownMs, maxRuns"
```

---

## Task 13: `cron_update` tool — accept `loop` & `cooldownMs`

**Files:**
- Modify: `packages/server/src/agent/extensions/cron/tools.ts:357-450`

- [ ] **Step 1: Read the current `cron_update` tool**

Run: `Read /Users/maxwin/codecrab-v2/packages/server/src/agent/extensions/cron/tools.ts offset=357 limit=100`

- [ ] **Step 2: Update the Zod schema**

In the `cron_update` tool's schema, add two fields next to `recurring` / `cronExpression`:

```ts
      loop: z.boolean().optional().describe('Switch to (or stay in) loop mode. When true, schedule becomes { kind: "loop", cooldownMs }.'),
      cooldownMs: z.number().optional().describe('Loop mode only: ms to wait between iterations (default 0).'),
```

- [ ] **Step 3: Update the handler — schedule resolution**

Currently, `cron_update` parses a new schedule only if `input.when || input.cronExpression` is set. Add a branch for `input.loop === true` **before** that block:

```ts
      let newSchedule: CronSchedule | undefined
      if (input.loop === true) {
        newSchedule = { kind: 'loop', cooldownMs: input.cooldownMs }
        changes.push(`schedule → loop${input.cooldownMs ? ` (cooldown ${input.cooldownMs}ms)` : ''}`)
      } else if (input.when || input.cronExpression) {
        // ... existing parseSchedule path unchanged ...
      } else if (input.timezone && job.schedule.kind === 'cron') {
        // ... existing timezone-only branch unchanged ...
      } else if (input.cooldownMs !== undefined && job.schedule.kind === 'loop') {
        // Allow cooldownMs adjustment without changing kind
        newSchedule = { kind: 'loop', cooldownMs: input.cooldownMs }
        changes.push(`cooldownMs → ${input.cooldownMs}`)
      }
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/agent/extensions/cron/tools.ts
git commit -m "feat(cron): cron_update accepts loop, cooldownMs"
```

---

## Task 14: `formatSchedule` — render loop kind for `cron_list` / `cron_get`

**Files:**
- Modify: `packages/server/src/agent/extensions/cron/tools.ts:39-55`

- [ ] **Step 1: Update `formatSchedule`**

In `packages/server/src/agent/extensions/cron/tools.ts`, find the `formatSchedule` helper. Add a `case 'loop'` branch:

```ts
function formatSchedule(job: CronJob): string {
  const s = job.schedule
  switch (s.kind) {
    case 'at':
      return `at ${new Date(s.at).toLocaleString()}`
    case 'every': {
      // ... unchanged ...
    }
    case 'cron':
      return `cron "${s.expr}"${s.tz ? ` (${s.tz})` : ''}`
    case 'loop': {
      if (!s.cooldownMs || s.cooldownMs <= 0) return 'loop (immediate)'
      const secs = Math.round(s.cooldownMs / 1000)
      if (secs < 60) return `loop (cooldown: ${secs}s)`
      const mins = Math.round(secs / 60)
      return `loop (cooldown: ${mins}m)`
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm exec tsc --noEmit`
Expected: clean — no exhaustiveness errors anywhere now.

- [ ] **Step 3: Commit**

```bash
cd /Users/maxwin/codecrab-v2
git add packages/server/src/agent/extensions/cron/tools.ts
git commit -m "feat(cron): formatSchedule renders loop kind"
```

---

## Task 15: Final verification

**Files:** none (read-only)

- [ ] **Step 1: Run the full server test suite**

Run: `cd /Users/maxwin/codecrab-v2/packages/server && pnpm test`
Expected: all green, including all new loop-mode tests.

- [ ] **Step 2: Run full type-check across the workspace**

Run: `cd /Users/maxwin/codecrab-v2 && pnpm build`
Expected: clean build of all packages (server, shared, app, cli).

- [ ] **Step 3: Smoke test (manual, optional but recommended)**

In a separate terminal:

```bash
cd /Users/maxwin/codecrab-v2
pnpm dev:server
```

Then open the app, ask the AI in any project: "Create a loop task that prints the current time, with cooldown 10 seconds, max 3 runs". Confirm via `cron_list` that the task appears with `loop (cooldown: 10s)` and `runs: 0 → 3 → completed`.

If anything misbehaves, check `.logs/server.log` for `[CronScheduler]` lines.

- [ ] **Step 4: Commit (if any cleanup was needed)**

```bash
cd /Users/maxwin/codecrab-v2
git status
# If there are uncommitted tweaks from verification, stage and commit them with:
# git commit -m "chore(cron): post-verification fixes"
```

---

## Spec Coverage Checklist

| Spec section | Implemented in |
|---|---|
| Schema: `kind: 'loop'` variant | Task 1 |
| `calculateNextRun` returns null for loop | Task 2 |
| `schedule()` fires first iteration immediately | Task 3 |
| `triggerJob` loop dispatch + `triggerJobLoop` (steps 1-10 of spec §2) | Task 4 |
| Stop on `isError` (no retry) | Task 4 (+ Task 5 test) |
| `cooldownMs` between iterations | Task 4 (+ Task 7 test) |
| `maxRuns` termination | Task 4 (+ Task 8 test) |
| Pause / delete during turn | Task 4 (+ Task 6 tests) |
| Listener cleanup (no leak) | Task 4 (+ Task 9 test) |
| Server-restart recovery | Existing `init()` behavior + Task 3 + Task 10 test |
| `parseSchedule` keyword fallback | Task 11 |
| `cron_create` accepts `loop` + `cooldownMs` + `maxRuns` | Task 12 |
| `cron_update` accepts `loop` + `cooldownMs` | Task 13 |
| `formatSchedule` renders loop | Task 14 |
| `cron_pause` / `cron_resume` / `cron_delete` / `cron_trigger` unchanged (reuse) | n/a — verified by Task 6 (pause), Task 4 (resume via re-schedule path) |
| Per-turn timeout — out of scope | n/a |
| Distinguish user abort vs error — out of scope | n/a (Task 5 covers uniform isError handling) |
