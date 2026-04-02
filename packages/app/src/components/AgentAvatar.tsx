import { cn } from '@/lib/utils'

const SIZE_IMG = { sm: 'w-5 h-5', md: 'w-9 h-9', lg: 'w-16 h-16' }
const SIZE_FONT = { sm: 'text-base', md: 'text-lg', lg: 'text-5xl' }

interface AgentAvatarProps {
  value: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function AgentAvatar({ value, size = 'sm', className }: AgentAvatarProps) {
  if (value.startsWith('/avatars/')) {
    return (
      <img
        src={value}
        alt=""
        className={cn('object-cover rounded shrink-0', SIZE_IMG[size], className)}
      />
    )
  }
  return (
    <span className={cn('shrink-0 leading-none', SIZE_FONT[size], className)}>
      {value || '🤖'}
    </span>
  )
}

/** Returns true when the emoji field holds an image URL rather than an emoji character. */
export function isAvatarImage(value: string) {
  return value.startsWith('/avatars/')
}
