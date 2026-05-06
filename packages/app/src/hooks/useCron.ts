import { useState, useEffect, useCallback } from 'react'
import { authFetch } from '@/lib/auth'

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  at?: string
  everyMs?: number
  expr?: string
  tz?: string
}

export interface CronJobItem {
  id: string
  name: string
  description?: string | null
  schedule: CronSchedule
  prompt: string
  context: { projectId?: string; sessionId?: string }
  status: string
  createdAt: string
  updatedAt: string
  lastRunAt?: string | null
  nextRunAt?: string | null
  runCount: number
  maxRuns?: number | null
  deleteAfterRun?: boolean
}

export interface CronSummary {
  totalActive: number
  totalAll: number
  statusCounts: Record<string, number>
  nextJob: { id: string; name: string; nextRunAt?: string; status: string } | null
}

export function useCronSummary(onUnauthorized?: () => void) {
  const [summary, setSummary] = useState<CronSummary | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSummary = useCallback(async () => {
    try {
      const res = await authFetch('/api/cron/summary', {}, onUnauthorized)
      if (res.ok) setSummary(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [onUnauthorized])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  return { summary, loading, refresh: fetchSummary }
}

export function useCronJobs(onUnauthorized?: () => void) {
  const [jobs, setJobs] = useState<CronJobItem[]>([])
  const [loading, setLoading] = useState(true)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/cron/jobs', {}, onUnauthorized)
      if (res.ok) setJobs(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [onUnauthorized])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const mutate = useCallback(async (id: string, action: 'trigger' | 'pause' | 'resume') => {
    const res = await authFetch(`/api/cron/jobs/${id}/${action}`, { method: 'POST' }, onUnauthorized)
    if (!res.ok) {
      let message = `Failed to ${action} job`
      try {
        const body = await res.json()
        if (body?.error) message = body.error
      } catch { /* ignore */ }
      throw new Error(message)
    }
    const updated = (await res.json()) as CronJobItem
    setJobs(prev => prev.map(j => (j.id === id ? { ...j, ...updated } : j)))
    return updated
  }, [onUnauthorized])

  const triggerJob = useCallback((id: string) => mutate(id, 'trigger'), [mutate])
  const pauseJob = useCallback((id: string) => mutate(id, 'pause'), [mutate])
  const resumeJob = useCallback((id: string) => mutate(id, 'resume'), [mutate])

  return { jobs, loading, refresh: fetchJobs, triggerJob, pauseJob, resumeJob }
}
