import { useState, useEffect, useRef } from 'react'
import { Dialog } from 'radix-ui'
import { Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { authFetch } from '@/lib/auth'
import { ROLE_AVATARS } from '@/constants/roleAvatars'

const AGENT_EMOJIS = [
  '🤖','✍️','🎬','🔍','📊','🌐','📝','🎨','💻','📱',
  '🧠','🎯','📚','🔬','🎵','🏗️','💡','🔒','🌈','⚡',
  '🚀','🦀','🐍','🦊','🐳','🐧','🦅','🐝','🦋','🍎',
  '💎','🔮','🎪','🏰','🎲','🧩','🔭','🧪','⚙️','🛠️',
  '📡','🗂️','📦','🏷️','✏️','🗃️','💼','🎓','🌍','🌙',
  '☀️','⛅','🌊','🔥','💧','🌿','🍀','🌸','🌺','🎸',
]

interface CreateAgentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (agent: { id: string; name: string; emoji: string }) => void
  onUnauthorized?: () => void
}

export function CreateAgentDialog({ open, onOpenChange, onCreated, onUnauthorized }: CreateAgentDialogProps) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [pickerTab, setPickerTab] = useState<'emoji' | 'avatar'>('emoji')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setEmoji('🤖')
      setShowEmojiPicker(false)
      setPickerTab('emoji')
      setCreating(false)
      setError(null)
      // Focus the name input after open animation
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [open])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return

    setCreating(true)
    setError(null)

    try {
      const res = await authFetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, emoji }),
      }, onUnauthorized)

      if (!res.ok) {
        const data = await res.json()
        if (res.status === 409) {
          setError('An agent with this name already exists')
        } else if (res.status === 400) {
          setError(data.error || 'Invalid agent name')
        } else {
          setError(data.error || 'Failed to create agent')
        }
        setCreating(false)
        return
      }

      const agent = await res.json()
      onOpenChange(false)
      onCreated?.(agent)
    } catch {
      setError('Failed to create agent')
      setCreating(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-xl border bg-card shadow-lg p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]">
          <Dialog.Close asChild>
            <button className="absolute right-3 top-3 rounded-sm opacity-70 hover:opacity-100 transition-opacity cursor-pointer">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          <Dialog.Title className="text-lg font-semibold text-center mb-6">
            New Agent
          </Dialog.Title>

          <div className="flex flex-col items-center gap-4">
            {/* Avatar selector button */}
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className="w-24 h-24 flex items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/30 hover:border-muted-foreground/50 transition-colors cursor-pointer text-5xl overflow-hidden"
            >
              {emoji.startsWith('/avatars/') ? (
                <img src={emoji} alt="" className="w-full h-full object-cover" />
              ) : (
                emoji
              )}
            </button>

            {/* Picker panel */}
            {showEmojiPicker && (
              <div className="w-full rounded-lg border bg-background overflow-hidden">
                {/* Tabs */}
                <div className="flex border-b">
                  <button
                    type="button"
                    onClick={() => setPickerTab('emoji')}
                    className={cn(
                      'flex-1 py-2 text-sm transition-colors cursor-pointer',
                      pickerTab === 'emoji'
                        ? 'font-medium text-foreground border-b-2 border-primary -mb-px'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Emoji
                  </button>
                  <button
                    type="button"
                    onClick={() => setPickerTab('avatar')}
                    className={cn(
                      'flex-1 py-2 text-sm transition-colors cursor-pointer',
                      pickerTab === 'avatar'
                        ? 'font-medium text-foreground border-b-2 border-primary -mb-px'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    角色头像
                  </button>
                </div>

                {/* Emoji grid */}
                {pickerTab === 'emoji' && (
                  <div className="p-2 max-h-44 overflow-y-auto">
                    <div className="grid grid-cols-10 gap-1">
                      {AGENT_EMOJIS.map((e, i) => (
                        <button
                          key={`${e}-${i}`}
                          type="button"
                          onClick={() => { setEmoji(e); setShowEmojiPicker(false) }}
                          className={cn(
                            'p-1.5 rounded hover:bg-accent transition-colors text-lg cursor-pointer',
                            emoji === e && 'bg-primary/10 ring-1 ring-primary/30',
                          )}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Role avatar grid */}
                {pickerTab === 'avatar' && (
                  <div className="p-2 max-h-44 overflow-y-auto">
                    <div className="grid grid-cols-4 gap-2">
                      {ROLE_AVATARS.map((avatar) => (
                        <button
                          key={avatar.id}
                          type="button"
                          onClick={() => { setEmoji(avatar.url); setShowEmojiPicker(false) }}
                          className={cn(
                            'flex flex-col items-center gap-1 p-1 rounded-md hover:bg-accent transition-colors cursor-pointer',
                            emoji === avatar.url && 'bg-primary/10 ring-1 ring-primary/30',
                          )}
                        >
                          <img src={avatar.url} alt={avatar.label} className="w-14 h-14 object-cover rounded" />
                          <span className="text-xs text-muted-foreground truncate w-full text-center leading-tight">
                            {avatar.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Name input */}
            <div className="w-full space-y-1.5">
              <Input
                ref={nameInputRef}
                value={name}
                onChange={e => { setName(e.target.value); setError(null) }}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
                placeholder="Agent Name"
                className="text-center text-lg h-11"
              />
              <p className="text-xs text-muted-foreground text-center">
                Give your agent a unique name
              </p>
            </div>

            {/* Error message */}
            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 w-full pt-2">
              <Button
                variant="ghost"
                className="flex-1"
                onClick={() => onOpenChange(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleCreate}
                disabled={!name.trim() || creating}
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
