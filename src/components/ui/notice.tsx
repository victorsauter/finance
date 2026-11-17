import type { ComponentProps, ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const noticeVariants = cva(
  'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm',
  {
    variants: {
      tone: {
        info: 'border-border bg-muted text-foreground',
        success: 'border-success/30 bg-success-soft text-foreground',
        warning: 'border-warning/30 bg-warning-soft text-foreground',
        error: 'border-destructive/30 bg-destructive-soft text-foreground',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

type Tone = NonNullable<VariantProps<typeof noticeVariants>['tone']>

const icons = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  error: AlertTriangleIcon,
} as const

const iconColors: Record<Tone, string> = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
}

interface NoticeProps
  extends Omit<ComponentProps<'div'>, 'title'>,
    VariantProps<typeof noticeVariants> {
  title?: ReactNode
  /** Button or link aligned to the end of the notice. */
  action?: ReactNode
}

/**
 * Inline message inside a page: info, success, warning or error. Errors are
 * announced as alerts, the other tones as polite status messages (pass `role`
 * to override).
 */
export function Notice({
  tone = 'info',
  title,
  action,
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
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', iconColors[current])}
      />
      <div className="min-w-0 flex-1 basis-40 space-y-0.5 break-words">
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? 'text-muted-foreground' : undefined}>
          {children}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
