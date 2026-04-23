# Cron Auto-Loop Mode — Design Spec

**Date:** 2026-04-23
**Scope:** `packages/server` cron subsystem
**Status:** Approved for implementation

## Problem

Today's cron schedules are **time-driven**: `at` (one-shot at a timestamp), `every` (fixed interval from start), `cron` (expression). None of them express "kick off the same task again as soon as the previous run **actually finishes**."

Use case: long-running, indeterminate-duration tasks (monitoring, retry-until-done, generative loops) where the next iteration must wait for the previous turn to actually close, not for a fixed interval — and each iteration runs in a fresh session.

## Solution

Add a fourth schedule kind, `loop`, that re-triggers itself on `turn:close` rather than on a clock event. Each iteration starts a new session (already the cron baseline behavior).

## Decisions

| # | Question | Choice |
|---|---|---|
| 1 | What stops the loop? | Manual pause/delete + any turn error + optional `maxRuns` |
| 2 | Cooldown between iterations? | New `cooldownMs` field on the schedule, default 0 |
| 3 | API surface | New `kind: 'loop'` reusing `cron_create`, `cron_update`, `cron_pause`, `cron_resume`, `cron_delete`, `cron_trigger` |
| 4 | Existing 3-retry/backoff in `triggerJob` | **Not applied to loop** — turn error stops the loop directly |
| 5 | Per-turn hard timeout | **Not added** — turns can legitimately run long |
| 6 | User-initiated abort during a turn | Counts as error → stops the loop (uniform handling) |

## Schema Changes

`packages/server/src/types/index.ts`:

```ts
export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number }
  | { kind: 'cron'; expr: string; tz?: string }
  | { kind: 'loop'; cooldownMs?: number }   // NEW
```

No other type changes — `CronJob`, `CronJobRun`, `CronJobStatus` are reused.

## Scheduler Changes (`packages/server/src/cron/scheduler.ts`)

### `schedule(job)` — new branch

```ts
} else if (job.schedule.kind === 'loop') {
  // First iteration runs immediately; subsequent ones are scheduled from triggerJob
  void this.triggerJob(job)
}
```

No setTimeout/cron registration up front. The `scheduledTasks` map entry is still set (`{ jobId, timeoutId: undefined }`) so `cancel()` can find it during pause/delete in cooldown.

### `triggerJob(job)` — new path for loop

For `kind === 'loop'`, the function follows a different flow than `at`/`every`/`cron`:

1. Re-read latest job from store (existing behavior — preserves prompt/cooldownMs edits).
2. Build a `cronSessionId` (existing format: `cron-${jobId}-${Date.now()}`).
3. **Register a one-shot `core.on('turn:close', handler)` BEFORE calling `submitTurn`**, filtering by `sessionId === cronSessionId`.
4. Wrap the listener in a Promise that resolves with `{ isError: boolean, error?: string }`. Use `try/finally` to guarantee `core.off('turn:close', handler)` runs.
5. Mark `status='running'`, `lastRunAt`, append `running` run record. Call `submitTurn` (still synchronous-ish — returns queryId from queue).
6. Catch any synchronous throw from `submitTurn` (project gone, etc.) → treat as error, stop loop, return.
7. `await turnClosedPromise`.
8. Re-read job from store. If `status` is now `disabled` / `deprecated` or job is gone → write a final run record and return without rescheduling.
9. If `result.isError` → status `failed`, append failed run, `cancel()`, return. **No retry.**
10. Success path:
    - `runCount++`, append `completed` run.
    - If `maxRuns && runCount >= maxRuns` → status `completed`, `cancel()`, return.
    - Else: status `pending`. Save.
    - Schedule next iteration:
      - `cooldownMs > 0` → `scheduleTimeout(job, cooldownMs)` (reuses existing chained-timeout helper, which already handles `>MAX_TIMEOUT_MS` correctly).
      - `cooldownMs === 0 || undefined` → `setImmediate(() => void this.triggerJob(job))` to break sync recursion.

Existing 3-retry/exponential-backoff logic in `triggerJob` is **bypassed** for loop kind — that retry was tailored for transient `submitTurn` enqueue failures of fire-and-forget schedules; for loop the user explicitly asked for "any error stops".

### `calculateNextRun(schedule)` — new branch

```ts
case 'loop':
  return null  // No deterministic next run; computed dynamically from turn:close
```

`nextRunAt` is left undefined for loop jobs in steady state. `cron_get` displays "next: dynamic (after current turn closes)" for loop jobs.

### `parseSchedule` — minimal change

To avoid polluting the natural-language parser, **do not change `parseSchedule`'s signature**. Instead:

- The `cron_create` / `cron_update` tools accept an explicit `loop: boolean` (and `cooldownMs?: number`) from the LLM.
- When `loop === true`, the tool builds `{ kind: 'loop', cooldownMs: input.cooldownMs }` directly and skips `parseSchedule`.
- Optional small addition inside `parseSchedule`: when `recurring === true` and `/^\s*loop\b|循环/i.test(when)` matches, return `{ kind: 'loop' }`. This is convenience only — the explicit `loop` flag is the canonical path.

## Tool API Changes (`packages/server/src/agent/extensions/cron/tools.ts`)

### `cron_create`

Add inputs:

```ts
loop: z.boolean().optional().describe('Run in auto-loop mode: re-trigger immediately after each turn closes, with a new session each time')
cooldownMs: z.number().optional().describe('For loop mode only: ms to wait between iterations (default 0)')
```

Tool description gains:

> **Loop mode**: set `loop: true` to create a self-restarting task that begins a new session each time the previous turn closes. The loop stops when manually paused/deleted, when any turn returns an error (including user abort), or when `maxRuns` is reached. Use `cooldownMs` to throttle.

Handler change: when `input.loop === true`, build `schedule = { kind: 'loop', cooldownMs: input.cooldownMs }` directly. `deleteAfterRun` defaults to `false` for loop kind.

### `cron_update`

Same two new inputs (`loop`, `cooldownMs`). Allows converting an existing job to loop or adjusting cooldown. The existing `cancel + schedule` reschedule path handles the transition.

### `cron_list` / `cron_get` formatting

`formatSchedule()` adds:

```ts
case 'loop':
  return s.cooldownMs && s.cooldownMs > 0
    ? `loop (cooldown: ${formatMs(s.cooldownMs)})`
    : 'loop (immediate)'
```

### Other tools

`cron_pause`, `cron_resume`, `cron_delete`, `cron_trigger` need **no changes** — loop is structurally a CronJob and goes through the same `cancel(jobId)` / `schedule(job)` / `triggerJob(job)` paths.

## Lifecycle Walkthroughs

**Happy path:**
create(loop) → schedule() → triggerJob #1 → submitTurn → ... → turn:close → runCount=1 → setImmediate → triggerJob #2 → ... (forever until pause/error/maxRuns)

**With cooldown 30s:**
... turn:close → runCount++ → scheduleTimeout(30000) → 30s later → triggerJob → ...

**Pause during turn:**
triggerJob awaiting turn:close → user calls cron_pause → store sets status='disabled', `cancel(jobId)` removes timer (none active) → turn:close eventually fires → handler resolves → triggerJob re-reads job, sees `disabled` → returns without rescheduling.

**Pause during cooldown:**
scheduleTimeout active → cron_pause → `cancel(jobId)` clears the timeout → status='disabled'. No turn was running.

**Delete during turn:**
Same as pause-during-turn but job is gone from store. The handler's re-read returns null → return cleanly. The in-flight turn finishes naturally and its session lives on (cron metadata is moot).

**maxRuns reached:**
After successful turn:close on iteration N where N === maxRuns, status='completed', cancel, no next schedule. Behaves identically to a one-shot 'at' job at terminal state.

**Server restart between iterations (cooldown or pending):**
`init()` walks store → loop job has status='pending' → falls through guard (only `disabled`/`failed`/`completed`/`deprecated` are skipped) → `schedule(job)` is called → triggerJob fires immediately. Loop continues.

**Server restart mid-turn:**
status was 'running' on disk. Same `init()` path → `schedule(job)` → triggerJob fires fresh. The lost turn is not recovered, but a new session begins, matching loop's "keep going" intent.

## Edge Cases & Safety

- **Listener leak**: every triggerJob call must `core.off('turn:close', handler)` exactly once. Implemented by `try/finally` around the await.
- **Concurrent `cron_trigger` during loop**: existing guard `if (job.status === 'running') return error` blocks this. No code change needed.
- **No internal concurrency**: triggerJob always returns before scheduling the next call (via `setImmediate` / `scheduleTimeout`). No two iterations overlap.
- **submitTurn synchronous throw**: caught and treated as error → loop stops with status='failed' and a failed run record.

## Testing (`packages/server/src/cron/__tests__/`)

New cases (vitest, following existing scheduler test style):

1. **Schema parse** — `parseSchedule` returns `{ kind: 'loop' }` when `loop:true` flag is honored at the tool layer; "loop"/"循环" keyword fallback in `parseSchedule` returns loop kind.
2. **First iteration immediate** — create loop job → assert triggerJob called once synchronously after schedule().
3. **Re-trigger on turn:close success** — emit fake `turn:close` with `isError:false` and matching sessionId → next triggerJob fires within `cooldownMs + epsilon`.
4. **isError stops loop** — emit `turn:close` with `isError:true` → status becomes 'failed', no subsequent triggerJob.
5. **cooldownMs gating** — cooldownMs=100ms, fake timers; assert at least 100ms between consecutive triggerJobs.
6. **maxRuns terminal** — maxRuns=3, run 3 successful iterations → status='completed', 4th never fires.
7. **Pause mid-turn** — set status='disabled' before resolving turn:close → handler re-reads, no reschedule.
8. **Delete mid-turn** — delete job before resolving turn:close → handler handles null, no throw, no reschedule.
9. **Listener cleanup** — run N=20 iterations → `core.listenerCount('turn:close')` returns to baseline (no leak).
10. **Server restart recovery** — persist a loop job with status='pending', re-init scheduler → triggerJob fires.

## Out of Scope

- Per-turn timeout (rejected — see Decision #5)
- Distinguishing user-abort from agent-error (rejected — see Decision #6)
- Loop-specific telemetry beyond existing `runCount` / run history
- Cross-process loop (loop only runs while server is up; restart resumes naturally)

## Files Touched (forecast)

- `packages/server/src/types/index.ts` — add `loop` to `CronSchedule` union
- `packages/server/src/cron/scheduler.ts` — `schedule()` branch, `triggerJob()` loop path, `calculateNextRun()` branch, optional `parseSchedule` keyword detection
- `packages/server/src/agent/extensions/cron/tools.ts` — `cron_create` & `cron_update` inputs + descriptions, `formatSchedule()` loop branch
- `packages/server/src/cron/__tests__/scheduler.test.ts` (or new file) — test cases above
