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

  return { jobs, loading, refresh: fetchJobs }
}
