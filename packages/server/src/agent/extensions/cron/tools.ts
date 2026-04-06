// Cron MCP tool definitions for the Claude Agent SDK (server-v2)
//
// Provides 8 tools: create, list, get, delete, pause, resume, update, trigger.
// The scheduler and per-query context are injected via setters at startup / per-query.

import { z } from 'zod/v4'
import { tool } from '@anthropic-ai/claude-agent-sdk'
import type { CronScheduler } from '../../../cron/scheduler.js'
import { CronScheduler as CronSchedulerClass } from '../../../cron/scheduler.js'
import type { CronJob } from '../../../types/index.js'

// ── Injected state ─────────────────────────────────────────────────────────

let scheduler: CronScheduler | null = null
let queryContext: { projectId?: string; sessionId?: string } = {}

export function setCronScheduler(s: CronScheduler): void {
  scheduler = s
}

export function setCronQueryContext(ctx: { projectId?: string; sessionId?: string }): void {
  queryContext = ctx
}

export function getCronQueryContext(): { projectId?: string; sessionId?: string } {
  return queryContext
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function notReady() {
  return { content: [{ type: 'text' as const, text: 'Cron scheduler not initialized' }], isError: true }
}

function notFound(jobId: string) {
  return { content: [{ type: 'text' as const, text: `Task not found: ${jobId}` }], isError: true }
}

function formatSchedule(job: CronJob): string {
  const s = job.schedule
  switch (s.kind) {
    case 'at':
      return `at ${new Date(s.at).toLocaleString()}`
    case 'every': {
      const mins = Math.round(s.everyMs / 60_000)
      if (mins < 60) return `every ${mins} minute${mins !== 1 ? 's' : ''}`
      const hours = Math.round(mins / 60)
      if (hours < 24) return `every ${hours} hour${hours !== 1 ? 's' : ''}`
      const days = Math.round(hours / 24)
      return `every ${days} day${days !== 1 ? 's' : ''}`
    }
    case 'cron':
      return `cron "${s.expr}"${s.tz ? ` (${s.tz})` : ''}`
  }
}

// ── Tools ───────────────────────────────────────────────────────────────────

export const tools = [
  tool(
    'cron_create',
    `Create a scheduled task that will execute automatically at a specific time or on a recurring schedule.

Use this tool when the user asks to:
- Set a reminder (e.g., "remind me in 5 minutes")
- Schedule a task (e.g., "check email every hour")
- Perform an action later (e.g., "tomorrow morning check the logs")

The 'when' parameter accepts natural language like "1 minute later", "5 minutes from now", "tomorrow at 9am", "every hour", or cron expression "0 9 * * *".

CRITICAL - The 'prompt' parameter is the instruction that will be executed when the scheduled time arrives. For reminders, the prompt MUST explicitly instruct the AI to send a push notification using the push_send tool.`,
    {
      name: z.string().describe('A descriptive name for this scheduled task'),
      when: z.string().describe(
        'When to execute: natural language like "10 minutes later", "tomorrow at 9am", "every hour", or cron expression "0 9 * * *"',
      ),
      prompt: z.string().describe('The instruction to execute at the scheduled time'),
      recurring: z.boolean().optional().describe('Whether this is a recurring task (default: false)'),
      cronExpression: z.string().optional().describe('Optional explicit cron expression for recurring tasks (e.g., "0 9 * * *")'),
      timezone: z.string().optional().describe('Optional timezone for cron schedules (e.g., "Asia/Shanghai")'),
      description: z.string().optional().describe('Optional description or notes about this task'),
      deleteAfterRun: z.boolean().optional().describe('For one-time tasks, auto-delete after execution (default: true for one-shot)'),
      // Context fields — auto-injected via setCronQueryContext
      projectId: z.string().optional().describe('Project ID (auto-injected)'),
      sessionId: z.string().optional().describe('Session ID (auto-injected)'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const projectId = input.projectId || queryContext.projectId
      const sessionId = input.sessionId || queryContext.sessionId

      if (!projectId || !sessionId) {
        return {
          content: [{ type: 'text' as const, text: 'Missing project or session context. Cannot create scheduled task.' }],
          isError: true,
        }
      }

      const isRecurring = input.recurring || !!input.cronExpression
      const scheduleInput = input.cronExpression || input.when
      const parsed = CronSchedulerClass.parseSchedule(scheduleInput, isRecurring)

      if (!parsed.isValid) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Could not parse schedule: "${input.when}". Try formats like "10 minutes later", "tomorrow at 9am", "every hour", or cron expression "0 9 * * *"`,
            },
          ],
          isError: true,
        }
      }

      // Ensure one-shot is in the future
      if (parsed.schedule.kind === 'at') {
        const runTime = new Date(parsed.schedule.at)
        if (runTime.getTime() <= Date.now()) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Scheduled time "${input.when}" is in the past. Please specify a future time.`,
              },
            ],
            isError: true,
          }
        }
      }

      if (parsed.schedule.kind === 'cron' && input.timezone) {
        parsed.schedule.tz = input.timezone
      }

      const job = scheduler.create({
        name: input.name,
        description: input.description,
        schedule: parsed.schedule,
        prompt: input.prompt,
        context: { projectId, sessionId },
        status: 'pending',
        deleteAfterRun: input.deleteAfterRun ?? parsed.schedule.kind === 'at',
      })

      const scheduleDesc = formatSchedule(job)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created scheduled task "${job.name}" (${scheduleDesc}).\n\nTask ID: ${job.id}\nNext run: ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'N/A'}`,
          },
        ],
      }
    },
  ),

  tool(
    'cron_list',
    'List all scheduled tasks, optionally filtered by status.',
    {
      status: z.string().optional().describe(
        'Filter by status: pending, running, completed, failed, disabled, deprecated. Deprecated tasks are hidden by default.',
      ),
      limit: z.number().optional().describe('Maximum number of tasks to return (default: 20)'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const projectId = queryContext.projectId
      const jobs = scheduler.list(projectId)
      const filtered = input.status ? jobs.filter((j) => j.status === input.status) : jobs
      const limited = filtered.slice(0, input.limit || 20)

      if (limited.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No scheduled tasks found.' }] }
      }

      const formatted = limited.map(
        (j) => `- ${j.name} (${j.id}): ${formatSchedule(j)} | status: ${j.status} | runs: ${j.runCount}`,
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${limited.length} scheduled task(s):\n\n${formatted.join('\n')}`,
          },
        ],
      }
    },
  ),

  tool(
    'cron_get',
    'Get detailed information about a specific scheduled task.',
    {
      jobId: z.string().describe('The ID of the task'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      const runs = scheduler.getHistory(input.jobId, 5)

      const details = `Task: ${job.name}
ID: ${job.id}
Status: ${job.status}
Schedule: ${formatSchedule(job)}
Prompt: ${job.prompt}
Next run: ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : 'N/A'}
Last run: ${job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : 'N/A'}
Run count: ${job.runCount}${job.maxRuns ? ` / ${job.maxRuns}` : ''}
Created: ${new Date(job.createdAt).toLocaleString()}

Recent runs (${runs.length}):
${
  runs
    .map(
      (r) =>
        `- ${r.status} at ${new Date(r.startedAt).toLocaleString()}${r.durationMs ? ` (${r.durationMs}ms)` : ''}${r.error ? ` — ${r.error}` : ''}`,
    )
    .join('\n') || 'None'
}`

      return { content: [{ type: 'text' as const, text: details }] }
    },
  ),

  tool(
    'cron_delete',
    'Delete (deprecate) a scheduled task by its ID. The task is marked as deprecated rather than physically removed, preserving it for debugging.',
    {
      jobId: z.string().describe('The ID of the task to delete'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      if (job.status === 'deprecated') {
        return { content: [{ type: 'text' as const, text: `Task "${job.name}" is already deprecated.` }] }
      }

      scheduler.delete(input.jobId)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Deprecated scheduled task "${job.name}" (${job.id}). The task is preserved for debugging but will no longer execute.`,
          },
        ],
      }
    },
  ),

  tool(
    'cron_pause',
    'Pause (disable) a scheduled task. The task will stop executing but can be resumed later.',
    {
      jobId: z.string().describe('The ID of the task to pause'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      if (job.status === 'disabled') {
        return { content: [{ type: 'text' as const, text: `Task "${job.name}" is already paused.` }] }
      }

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'deprecated') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Cannot pause a task with status "${job.status}". Only pending or running tasks can be paused.`,
            },
          ],
          isError: true,
        }
      }

      scheduler.pause(input.jobId)

      return {
        content: [
          { type: 'text' as const, text: `Paused task "${job.name}" (${job.id}). Use cron_resume to re-enable it.` },
        ],
      }
    },
  ),

  tool(
    'cron_resume',
    'Resume a paused (disabled) scheduled task. The task will be rescheduled according to its original schedule.',
    {
      jobId: z.string().describe('The ID of the task to resume'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      if (job.status === 'deprecated') {
        return {
          content: [
            { type: 'text' as const, text: `Task "${job.name}" is deprecated and cannot be resumed.` },
          ],
          isError: true,
        }
      }

      if (job.status !== 'disabled' && job.status !== 'failed') {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Task "${job.name}" is not paused or failed (current status: ${job.status}).`,
            },
          ],
          isError: true,
        }
      }

      const scheduled = scheduler.resume(input.jobId)
      if (!scheduled) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Resumed task "${job.name}" but failed to reschedule. The schedule may have expired.`,
            },
          ],
          isError: true,
        }
      }

      const updated = scheduler.get(input.jobId)
      return {
        content: [
          {
            type: 'text' as const,
            text: `Resumed task "${job.name}" (${job.id}).\nSchedule: ${formatSchedule(job)}\nNext run: ${updated?.nextRunAt ? new Date(updated.nextRunAt).toLocaleString() : 'N/A'}`,
          },
        ],
      }
    },
  ),

  tool(
    'cron_update',
    'Update an existing scheduled task. You can modify the name, prompt, description, schedule, and other properties. Only provide the fields you want to change.',
    {
      jobId: z.string().describe('The ID of the task to update'),
      name: z.string().optional().describe('New name for the task'),
      prompt: z.string().optional().describe('New prompt/instruction for the task'),
      description: z.string().optional().describe('New description'),
      when: z.string().optional().describe(
        'New schedule: natural language like "10 minutes later", "every 2 hours", or cron expression',
      ),
      recurring: z.boolean().optional().describe('Whether this is a recurring task'),
      cronExpression: z.string().optional().describe('New cron expression (e.g., "0 9 * * *")'),
      timezone: z.string().optional().describe('New timezone (e.g., "Asia/Shanghai")'),
      deleteAfterRun: z.boolean().optional().describe('Auto-delete after execution'),
      maxRuns: z.number().optional().describe('Maximum number of runs (0 to remove limit)'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      const changes: string[] = []

      if (input.name !== undefined) changes.push(`name → "${input.name}"`)
      if (input.prompt !== undefined) changes.push('prompt updated')
      if (input.description !== undefined) changes.push('description updated')
      if (input.deleteAfterRun !== undefined) changes.push(`deleteAfterRun → ${input.deleteAfterRun}`)
      if (input.maxRuns !== undefined) changes.push(`maxRuns → ${input.maxRuns === 0 ? 'unlimited' : input.maxRuns}`)

      // Parse new schedule if provided
      let newSchedule = undefined
      if (input.when || input.cronExpression) {
        const isRecurring = input.recurring ?? (job.schedule.kind === 'cron' || job.schedule.kind === 'every')
        const scheduleInput = input.cronExpression || input.when!
        const parsed = CronSchedulerClass.parseSchedule(scheduleInput, isRecurring)

        if (!parsed.isValid) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `Could not parse schedule: "${input.when || input.cronExpression}". Try formats like "10 minutes later", "every 2 hours", or cron expression "0 9 * * *"`,
              },
            ],
            isError: true,
          }
        }

        if (parsed.schedule.kind === 'at' && new Date(parsed.schedule.at).getTime() <= Date.now()) {
          return {
            content: [{ type: 'text' as const, text: 'Scheduled time is in the past. Please specify a future time.' }],
            isError: true,
          }
        }

        if (input.timezone && parsed.schedule.kind === 'cron') {
          parsed.schedule.tz = input.timezone
        }

        newSchedule = parsed.schedule
        changes.push(`schedule → ${formatSchedule({ ...job, schedule: newSchedule })}`)
      } else if (input.timezone && job.schedule.kind === 'cron') {
        newSchedule = { ...job.schedule, tz: input.timezone }
        changes.push(`timezone → ${input.timezone}`)
      }

      if (changes.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No changes specified.' }], isError: true }
      }

      const updated = scheduler.update(input.jobId, {
        name: input.name,
        prompt: input.prompt,
        description: input.description,
        schedule: newSchedule,
        deleteAfterRun: input.deleteAfterRun,
        maxRuns: input.maxRuns,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: `Updated task "${job.name}" (${job.id}):\n${changes.map((c) => `  • ${c}`).join('\n')}${
              newSchedule && updated?.nextRunAt
                ? `\nNext run: ${new Date(updated.nextRunAt).toLocaleString()}`
                : ''
            }`,
          },
        ],
      }
    },
  ),

  tool(
    'cron_trigger',
    'Manually trigger a scheduled task to run immediately, regardless of its schedule. The task remains scheduled as before.',
    {
      jobId: z.string().describe('The ID of the task to trigger'),
    },
    async (input) => {
      if (!scheduler) return notReady()

      const job = scheduler.get(input.jobId)
      if (!job) return notFound(input.jobId)

      if (job.status === 'running') {
        return {
          content: [
            { type: 'text' as const, text: `Task "${job.name}" is already running. Wait for it to complete.` },
          ],
          isError: true,
        }
      }

      scheduler.trigger(input.jobId)

      return {
        content: [
          {
            type: 'text' as const,
            text: `Triggered task "${job.name}" (${job.id}) for immediate execution.`,
          },
        ],
      }
    },
  ),
]
