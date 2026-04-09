import { useState, useRef, useCallback, useEffect } from 'react'
import { AgentAvatar } from '@/components/AgentAvatar'
import { ArrowUp, Square, Paperclip, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ImageAttachment } from '@codecrab/shared'

export interface MentionableAgent {
  id: string
  name: string
  emoji: string
}

/** Resize and compress an image file to base64 */
async function processImage(file: File): Promise<ImageAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const MAX_EDGE = 1568
        let w = img.width
        let h = img.height
        if (Math.max(w, h) > MAX_EDGE) {
          const scale = MAX_EDGE / Math.max(w, h)
          w = Math.round(w * scale)
          h = Math.round(h * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        const data = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]
        resolve({ data, mediaType: 'image/jpeg', name: file.name })
      }
      img.onerror = reject
      img.src = reader.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Parse @mention query from text before cursor */
function getMentionQuery(text: string, cursorPos: number): { query: string; startIndex: number } | null {
  const before = text.slice(0, cursorPos)
  // Match @ preceded by start-of-string or whitespace, followed by optional word chars
  const match = before.match(/(^|[\s])@([\w-]*)$/)
  if (!match) return null
  const query = match[2]
  const startIndex = before.length - query.length - 1 // -1 for @
  return { query, startIndex }
}

async function processFiles(files: FileList | File[]) {
  const results: (ImageAttachment & { preview: string })[] = []
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    try {
      const processed = await processImage(file)
      const preview = URL.createObjectURL(file)
      results.push({ ...processed, preview })
    } catch { /* ignore */ }
  }
  return results
}

export function InputBar({
  isRunning,
  isAborting,
  disabled,
  agents = [],
  onSend,
  onAbort,
}: {
  isRunning: boolean
  isAborting: boolean
  disabled?: boolean
  agents?: MentionableAgent[]
  onSend: (prompt: string, images?: ImageAttachment[]) => void
  onAbort: () => void
}) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<(ImageAttachment & { preview: string })[]>([])
  const [mentionState, setMentionState] = useState<{ query: string; startIndex: number } | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mentionListRef = useRef<HTMLDivElement>(null)
  const isComposingRef = useRef(false)
  const dragCounterRef = useRef(0)

  // Filter agents based on mention query
  const filteredAgents = mentionState
    ? agents.filter(a => a.name.toLowerCase().includes(mentionState.query.toLowerCase()))
    : []

  // Reset selection index when filtered list changes
  useEffect(() => {
    setMentionIndex(0)
  }, [mentionState?.query])

  // Scroll selected item into view
  useEffect(() => {
    if (!mentionListRef.current) return
    const selected = mentionListRef.current.children[mentionIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [mentionIndex])

  const insertMention = useCallback((agent: MentionableAgent) => {
    if (!mentionState) return
    const before = text.slice(0, mentionState.startIndex)
    const after = text.slice(mentionState.startIndex + 1 + mentionState.query.length) // +1 for @
    const newText = `${before}@${agent.name} ${after}`
    setText(newText)
    setMentionState(null)
    // Restore focus and cursor position
    requestAnimationFrame(() => {
      const el = textareaRef.current
      if (el) {
        el.focus()
        const cursorPos = before.length + 1 + agent.name.length + 1 // @name + space
        el.setSelectionRange(cursorPos, cursorPos)
      }
    })
  }, [text, mentionState])

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed && images.length === 0) return
    const imgs = images.length > 0 ? images.map(({ preview, ...rest }) => rest) : undefined
    onSend(trimmed, imgs)
    setText('')
    setImages([])
    setMentionState(null)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, images, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle mention dropdown navigation
    if (mentionState && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => (i + 1) % filteredAgents.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => (i - 1 + filteredAgents.length) % filteredAgents.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredAgents[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionState(null)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setText(value)
    // Check for @mention
    const cursorPos = e.target.selectionStart ?? value.length
    const mention = agents.length > 0 ? getMentionQuery(value, cursorPos) : null
    setMentionState(mention)
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 150) + 'px'
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const processed = await processFiles(files)
    setImages(prev => [...prev, ...processed])
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[index].preview)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.types.includes('Files')) return
    dragCounterRef.current++
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragging(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragging(false)
    const files = e.dataTransfer.files
    const processed = await processFiles(files)
    setImages(prev => [...prev, ...processed])
  }

  const canSend = !disabled && (text.trim().length > 0 || images.length > 0)

  return (
    <div className="bg-background px-4 py-3">
      {/* Input container */}
      <div
        className={cn(
          'relative rounded-xl border bg-muted/30 shadow-sm transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border',
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {/* Drag-and-drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 rounded-xl flex items-center justify-center z-10 pointer-events-none">
            <span className="text-sm font-medium text-primary">Drop images here</span>
          </div>
        )}

        {/* @mention autocomplete dropdown */}
        {mentionState && filteredAgents.length > 0 && (
          <div
            ref={mentionListRef}
            className="absolute bottom-full left-0 mb-1 w-full max-h-48 overflow-y-auto rounded-lg border border-border bg-popover shadow-md z-10"
          >
            {filteredAgents.map((agent, i) => (
              <button
                key={agent.id}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors cursor-pointer',
                  i === mentionIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50',
                )}
                onMouseDown={e => {
                  e.preventDefault() // prevent textarea blur
                  insertMention(agent)
                }}
                onMouseEnter={() => setMentionIndex(i)}
              >
                <AgentAvatar value={agent.emoji || '🤖'} size="sm" />
                <span className="truncate">@{agent.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Image previews */}
        {images.length > 0 && (
          <div className="flex gap-2 px-3 pt-3 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={img.preview}
                  alt={img.name}
                  className="h-14 w-14 object-cover rounded-lg border border-border"
                />
                <button
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-foreground text-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => removeImage(i)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder="Send a message... (type @ to mention an agent)"
          disabled={disabled}
          rows={1}
          className={cn(
            'w-full resize-none bg-transparent px-3 pt-3 pb-2 text-sm',
            'placeholder:text-muted-foreground focus:outline-none',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'max-h-[150px]',
            isDragging && 'opacity-20',
          )}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center justify-between px-2 pb-2">
          {/* Left: image upload */}
          <button
            className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Right: stop / send */}
          {isRunning ? (
            <button
              className="h-8 w-8 flex items-center justify-center rounded-full bg-foreground text-background hover:opacity-75 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              onClick={onAbort}
              disabled={isAborting}
            >
              <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
            </button>
          ) : (
            <button
              className={cn(
                'h-8 w-8 flex items-center justify-center rounded-full transition-all',
                canSend
                  ? 'bg-foreground text-background hover:opacity-75 cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
              )}
              onClick={handleSend}
              disabled={!canSend}
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
