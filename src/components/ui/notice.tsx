import type { ComponentProps, ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const noticeVariants = cva(
  'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
  {
    variants: {
      tone: {
        error: 'border-destructive/30 bg-destructive-soft text-destructive',
        success: 'border-success/30 bg-success-soft text-success',
        info: 'border-primary/20 bg-accent text-accent-foreground',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

type Tone = NonNullable<VariantProps<typeof noticeVariants>['tone']>

const icons: Record<Tone, LucideIcon> = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
}

interface NoticeProps
  extends Omit<ComponentProps<'div'>, 'children'>,
    VariantProps<typeof noticeVariants> {
  children: ReactNode
}

/**
 * Inline feedback inside a page. Errors are announced as alerts, the rest as
 * polite status messages.
 */
export function Notice({
  tone = 'info',
  className,
  children,
  ...props
}: NoticeProps) {
  const current: Tone = tone ?? 'info'
  const Icon = icons[current]
  return (
    <div
      role={current === 'error' ? 'alert' : 'status'}
      className={cn(noticeVariants({ tone: current }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">{children}</div>
    </div>
  )
}
