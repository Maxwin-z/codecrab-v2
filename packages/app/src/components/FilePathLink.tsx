import React, { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/auth'
import { buildApiUrl } from '@/lib/server'

// Module-level cache so the same path is only probed once per session
const probeCache = new Map<string, 'exists' | 'missing'>()

function getDirPath(filePath: string): string {
  if (filePath.endsWith('/')) return filePath
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : '/'
}

export function FilePathLink({
  path,
  className: extraClass,
}: {
  path: string
  className?: string
}) {
  const [status, setStatus] = useState<'loading' | 'exists' | 'missing'>(
    () => probeCache.get(path) ?? 'loading',
  )

  useEffect(() => {
    if (probeCache.has(path)) return
    let cancelled = false

    authFetch(buildApiUrl('/api/files/probe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [path] }),
    })
      .then(r => r.json())
      .then((data: { results?: Record<string, { exists?: boolean }> }) => {
        if (cancelled) return
        const exists = data?.results?.[path]?.exists ?? false
        const result: 'exists' | 'missing' = exists ? 'exists' : 'missing'
        probeCache.set(path, result)
        setStatus(result)
      })
      .catch(() => {
        if (!cancelled) {
          probeCache.set(path, 'missing')
          setStatus('missing')
        }
      })

    return () => { cancelled = true }
  }, [path])

  if (status === 'missing') {
    return (
      <code className={cn('font-mono text-[0.85em]', extraClass)}>
        {path}
      </code>
    )
  }

  const dir = getDirPath(path)
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || ''
  const href = `${base}/files?path=${encodeURIComponent(dir)}`

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.open(href, '_blank')
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      title={`Open directory: ${dir}`}
      className={cn(
        'inline-flex items-center gap-0.5 font-mono text-[0.85em] break-all',
        'text-blue-500 hover:text-blue-400 underline underline-offset-2 cursor-pointer',
        status === 'loading' && 'opacity-50',
        extraClass,
      )}
    >
      {path}
      <FolderOpen className="inline h-3 w-3 ml-0.5 shrink-0 opacity-60" />
    </a>
  )
}
