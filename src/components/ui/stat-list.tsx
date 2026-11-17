import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Small label/value summary used in settings cards (counts, versions). */
export function StatList({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[]
  className?: string
}) {
  return (
    <dl
      className={cn(
        'grid grid-cols-1 gap-3 rounded-lg border bg-muted/40 p-4 sm:grid-cols-3',
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{item.label}</dt>
          <dd className="font-heading text-lg font-semibold tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
