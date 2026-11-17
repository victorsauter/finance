import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: ReactNode
  /** Small label above the title, e.g. the section name. */
  eyebrow?: ReactNode
  description?: ReactNode
  /** Buttons or menus aligned to the right on wide screens. */
  actions?: ReactNode
  className?: string
}

/** The one page heading: every route renders its h1 through this. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        // Wraps instead of squeezing the title: the actions drop under it
        // when the row is too narrow for both (e.g. a month toolbar at 481px).
        'flex flex-wrap items-end justify-between gap-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1 basis-72 space-y-1">
        {eyebrow && (
          <p className="text-xs font-semibold tracking-wider text-primary uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="font-heading text-2xl font-bold tracking-tight text-balance">
          {title}
        </h1>
        {description && (
          <p className="max-w-prose text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          {actions}
        </div>
      )}
    </header>
  )
}
