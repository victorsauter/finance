import { Section } from '@/components/layout/Section'
import {
  allocationUsagePercent,
  type BudgetSummary,
} from '@/domain/budget/calculations'
import { formatMoney } from '@/domain/budget/money'
import { cn } from '@/lib/utils'

export function AllocationStatus({
  summary,
  className,
}: {
  summary: BudgetSummary
  className?: string
}) {
  return (
    <Section title="Allocation status" className={className}>
      {summary.accountAllocations.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts to review.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border">
          {summary.accountAllocations.map((allocation) => {
            const usage = allocationUsagePercent(allocation)
            return (
              <li
                key={allocation.accountId}
                className="flex items-center justify-between gap-4 px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {allocation.accountName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {allocation.usageCents === 0
                      ? 'No assigned expenses'
                      : usage === null
                        ? 'Expenses without a planned transfer'
                        : `${usage}% used`}
                  </p>
                </div>
                <p
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    allocation.balanceCents < 0 && 'text-destructive',
                  )}
                >
                  {formatMoney(allocation.balanceCents)}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
