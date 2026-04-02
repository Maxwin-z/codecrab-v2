import React, { useEffect, useState } from 'react'
import { FolderOpen, Monitor } from 'lucide-react'
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

function resolveRelative(projectPath: string, relPath: string): string {
  const base = projectPath.replace(/\/$/, '')
  let rel = relPath.startsWith('./') ? relPath.slice(2) : relPath
  if (rel.startsWith('../')) {
    const parts = base.split('/')
    while (rel.startsWith('../')) {
      parts.pop()
      rel = rel.slice(3)
    }
    return parts.join('/') + (rel ? '/' + rel : '')
  }
  return base + '/' + rel
}

export function FilePathLink({
  path,
  projectPath,
  isRelative,
  className: extraClass,
}: {
  path: string
  projectPath?: string
  isRelative?: boolean
  className?: string
}) {
  // For relative paths, resolve to absolute for probing/navigation
  const resolvedPath = isRelative && projectPath ? resolveRelative(projectPath, path) : path
  // If relative but no project path context, can't resolve — render as plain text
  const unresolvable = isRelative && !projectPath
  const cacheKey = resolvedPath

  const [status, setStatus] = useState<'loading' | 'exists' | 'missing'>(
    () => unresolvable ? 'missing' : (probeCache.get(cacheKey) ?? 'loading'),
  )

  useEffect(() => {
    if (unresolvable || probeCache.has(cacheKey)) return
    let cancelled = false

    authFetch(buildApiUrl('/api/files/probe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [resolvedPath] }),
    })
      .then(r => r.json())
      .then((data: { results?: Record<string, { exists?: boolean }> }) => {
        if (cancelled) return
        const exists = data?.results?.[resolvedPath]?.exists ?? false
        const result: 'exists' | 'missing' = exists ? 'exists' : 'missing'
        probeCache.set(cacheKey, result)
        setStatus(result)
      })
      .catch(() => {
        if (!cancelled) {
          probeCache.set(cacheKey, 'missing')
          setStatus('missing')
        }
      })

    return () => { cancelled = true }
  }, [cacheKey, resolvedPath])

  if (status === 'missing') {
    // Relative paths that don't exist: render as plain text to avoid false-positive styling
    if (isRelative) return <span className={extraClass}>{path}</span>
    return (
      <code className={cn('font-mono text-[0.85em]', extraClass)}>
        {path}
      </code>
    )
  }

  const dir = getDirPath(resolvedPath)
  const base = import.meta.env.BASE_URL.replace(/\/$/, '') || ''
  const fileHref = `${base}/file-preview?path=${encodeURIComponent(resolvedPath)}`
  const dirHref = `${base}/files?path=${encodeURIComponent(dir)}`

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.open(fileHref, '_blank')
  }

  const handleOpenDir = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    window.open(dirHref, '_blank')
  }

  const handleOpenNative = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    authFetch(buildApiUrl('/api/files/open'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: resolvedPath }),
    }).catch(() => {})
  }

  return (
    <span className={cn('inline-flex items-center gap-0.5 font-mono text-[0.85em]', extraClass)}>
      <a
        href={fileHref}
        onClick={handleClick}
        title={`Open file: ${path}`}
        className={cn(
          'break-all text-blue-500 hover:text-blue-400 underline underline-offset-2 cursor-pointer',
          status === 'loading' && 'opacity-50',
        )}
      >
        {path}
      </a>
      <button
        onClick={handleOpenDir}
        title={`Go to directory: ${dir}`}
        className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer text-blue-500 hover:text-blue-400 ml-0.5"
      >
        <FolderOpen className="h-3 w-3" />
      </button>
      <button
        onClick={handleOpenNative}
        title="Open on this computer"
        className="shrink-0 opacity-50 hover:opacity-100 cursor-pointer text-muted-foreground hover:text-foreground"
      >
        <Monitor className="h-3 w-3" />
      </button>
    </span>
  )
}
