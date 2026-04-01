import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ListOrdered, Play, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QueueItem } from '@/store/types'

export function QueueFab({
  items,
  onDequeue,
  onExecuteNow,
}: {
  items: QueueItem[]
  onDequeue: (queryId: string) => void
  onExecuteNow: (queryId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const queued = items.filter(q => q.status === 'queued')

  if (queued.length === 0) return null

  return (
    <div className="absolute bottom-[72px] right-4 z-20 flex flex-col items-end gap-2">
      {/* Expanded panel */}
      {open && (
        <div className="w-72 rounded-xl border border-border bg-card shadow-xl p-3 space-y-2">
          <div className="flex items-center gap-2 pb-1">
            <ListOrdered className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground flex-1">
              {queued.length} queued {queued.length === 1 ? 'query' : 'queries'}
            </span>
          </div>

          <div className="space-y-1.5">
            {queued.map(q => (
              <div
                key={q.queryId}
                className="flex items-center gap-2 text-xs bg-muted/40 rounded-lg px-2.5 py-2"
              >
                <span className="text-muted-foreground shrink-0 tabular-nums">#{q.position}</span>
                <span className="truncate flex-1 text-foreground/80">{q.prompt}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-green-500 hover:text-green-400 hover:bg-green-500/10"
                  onClick={() => onExecuteNow(q.queryId)}
                  title="Execute now"
                >
                  <Play className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-destructive hover:text-destructive/80 hover:bg-destructive/10"
                  onClick={() => onDequeue(q.queryId)}
                  title="Remove"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'relative h-11 w-11 rounded-full shadow-lg flex items-center justify-center transition-colors',
          open
            ? 'bg-primary/90 text-primary-foreground'
            : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        <ListOrdered className="h-5 w-5" />
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center px-1 leading-none">
          {queued.length}
        </span>
      </button>
    </div>
  )
}
