import { cn } from '@/lib/utils'

const SIZE_IMG = { sm: 'w-6 h-6', md: 'w-8 h-8', lg: 'w-9 h-9', xl: 'w-16 h-16' }
const SIZE_FONT = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl', xl: 'text-5xl' }

interface AgentAvatarProps {
  value: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
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
