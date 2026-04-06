import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { CronJob, CronJobRun } from '../types/index.js'

const DEFAULT_CRON_DIR = path.join(os.homedir(), '.codecrab', 'cron')

export class CronStore {
  private jobsFile: string
  private runsDir: string

  constructor(baseDir: string = DEFAULT_CRON_DIR) {
    this.jobsFile = path.join(baseDir, 'jobs.json')
    this.runsDir = path.join(baseDir, 'runs')
    this.ensureDirs(baseDir)
  }

  private ensureDirs(baseDir: string): void {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true })
    }
    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true })
    }
  }

  loadJobs(): Map<string, CronJob> {
    try {
      if (!fs.existsSync(this.jobsFile)) {
        return new Map()
      }
      const data = fs.readFileSync(this.jobsFile, 'utf-8')
      const jobs: CronJob[] = JSON.parse(data)
      return new Map(jobs.map((j) => [j.id, j]))
    } catch (err) {
      console.error('[CronStore] Failed to load jobs:', err)
      return new Map()
    }
  }

  saveJobs(jobs: Map<string, CronJob>): void {
    const jobsArray = Array.from(jobs.values())
    fs.writeFileSync(this.jobsFile, JSON.stringify(jobsArray, null, 2))
  }

  saveJob(job: CronJob): void {
    const jobs = this.loadJobs()
    jobs.set(job.id, job)
    this.saveJobs(jobs)
  }

  /** Soft-delete: marks as deprecated, preserves for debugging */
  deleteJob(jobId: string): boolean {
    const jobs = this.loadJobs()
    const job = jobs.get(jobId)
    if (!job) return false
    job.status = 'deprecated'
    job.deprecatedAt = new Date().toISOString()
    job.updatedAt = new Date().toISOString()
    this.saveJobs(jobs)
    return true
  }

  getJob(jobId: string): CronJob | undefined {
    return this.loadJobs().get(jobId)
  }

  listJobs(options?: {
    projectId?: string
    status?: string
    includeDeprecated?: boolean
    limit?: number
  }): CronJob[] {
    const jobs = this.loadJobs()
    let result = Array.from(jobs.values())

    // Exclude deprecated by default
    if (!options?.includeDeprecated && options?.status !== 'deprecated') {
      result = result.filter((j) => j.status !== 'deprecated')
    }

    if (options?.projectId) {
      result = result.filter((j) => j.context.projectId === options.projectId)
    }
    if (options?.status) {
      result = result.filter((j) => j.status === options.status)
    }

    result.sort((a, b) => {
      const aTime = a.nextRunAt ? new Date(a.nextRunAt).getTime() : Infinity
      const bTime = b.nextRunAt ? new Date(b.nextRunAt).getTime() : Infinity
      return aTime - bTime
    })

    if (options?.limit) {
      result = result.slice(0, options.limit)
    }

    return result
  }

  appendRun(jobId: string, run: CronJobRun): void {
    const runFile = path.join(this.runsDir, `${jobId}.jsonl`)
    fs.appendFileSync(runFile, JSON.stringify(run) + '\n')
  }

  getRuns(jobId: string, limit = 50): CronJobRun[] {
    const runFile = path.join(this.runsDir, `${jobId}.jsonl`)
    if (!fs.existsSync(runFile)) return []
    const content = fs.readFileSync(runFile, 'utf-8')
    return content
      .split('\n')
      .filter((line) => line.trim())
      .slice(-limit)
      .map((line) => JSON.parse(line))
  }

  generateJobId(): string {
    return `cron-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }

  generateRunId(): string {
    return `run-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
  }
}
