import type { ComponentProps, ReactNode } from 'react'
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const noticeVariants = cva(
  'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border p-3 text-sm',
  {
    variants: {
      tone: {
        info: 'border-border bg-muted text-foreground',
        success: 'border-success/30 bg-success-soft text-foreground',
        warning: 'border-warning/30 bg-warning-soft text-foreground',
        danger: 'border-destructive/30 bg-destructive-soft text-foreground',
      },
    },
    defaultVariants: { tone: 'info' },
  },
)

const icons = {
  info: InfoIcon,
  success: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  danger: AlertTriangleIcon,
} as const

const iconColors = {
  info: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
} as const

interface NoticeProps
  extends Omit<ComponentProps<'div'>, 'title'>,
    VariantProps<typeof noticeVariants> {
  title?: ReactNode
  /** Button or link aligned to the end of the notice. */
  action?: ReactNode
}

/** Inline message: info, success, warning or danger. */
export function Notice({
  tone = 'info',
  title,
  action,
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = icons[tone ?? 'info']
  return (
    <div className={cn(noticeVariants({ tone }), className)} {...props}>
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 size-4 shrink-0', iconColors[tone ?? 'info'])}
      />
      <div className="min-w-0 flex-1 basis-40 space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        <div className="text-muted-foreground">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
