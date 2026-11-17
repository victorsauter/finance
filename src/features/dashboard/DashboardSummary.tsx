import { TriangleAlert } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/layout/Section'
import type { BudgetSummary } from '@/domain/budget/calculations'
import { formatMoney, formatPercent } from '@/domain/budget/money'
import { cn } from '@/lib/utils'

function Metric({
  label,
  value,
  hint,
  negative = false,
}: {
  label: string
  value: string
  hint: string
  negative?: boolean
}) {
  return (
    <Card
      size="sm"
      className={cn(
        'justify-center',
        negative && 'bg-destructive-soft ring-destructive/25',
      )}
    >
      {/* Rows on narrow widths, stacked tiles once three fit side by side. */}
      <CardContent className="flex items-center justify-between gap-3 @lg:flex-col @lg:items-start @lg:justify-center">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <p
          className={cn(
            'text-xl font-semibold tracking-tight tabular-nums',
            negative && 'text-destructive',
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  )
}

export function DashboardSummary({ summary }: { summary: BudgetSummary }) {
  const warnings = [
    ...summary.accountAllocations
      .filter((allocation) => allocation.balanceCents < 0)
      .map(
        (allocation) =>
          `${allocation.accountName} is over its allocation by ${formatMoney(
            Math.abs(allocation.balanceCents),
          )}.`,
      ),
    ...(summary.unassignedExpenseCents > 0
      ? [
          `${formatMoney(
            summary.unassignedExpenseCents,
          )} of expenses are not assigned to an account.`,
        ]
      : []),
    ...(summary.unallocatedIncomeCents < 0
      ? [
          `Planned transfers exceed income by ${formatMoney(
            Math.abs(summary.unallocatedIncomeCents),
          )}.`,
        ]
      : []),
  ]

  return (
    <>
      <div className="@container">
        <section
          aria-label="Budget summary"
          className="grid gap-4 @4xl:grid-cols-5"
        >
          <Card
            className={cn(
              'justify-between text-white ring-0 @4xl:col-span-2',
              summary.remainingCents < 0 ? 'bg-destructive' : 'bg-brand',
            )}
          >
            <CardContent className="flex h-full flex-col justify-between gap-4">
              <div>
                <p className="text-sm font-semibold">Available balance</p>
                <p className="text-xs text-white/80">
                  After all planned expenses
                </p>
              </div>
              <div className="flex flex-col items-start gap-2">
                <p className="text-3xl font-bold tracking-tight tabular-nums">
                  {formatMoney(summary.remainingCents)}
                </p>
                <p className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium">
                  {formatPercent(summary.savingsRate)} of income
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="@container @4xl:col-span-3">
            <div className="grid h-full gap-4 @lg:grid-cols-3">
              <Metric
                label="Income"
                value={formatMoney(summary.incomeCents)}
                hint="Planned income"
              />
              <Metric
                label="Expenses"
                value={formatMoney(summary.expenseCents)}
                hint="Planned outgoings"
              />
              <Metric
                label="Unallocated"
                value={formatMoney(summary.unallocatedIncomeCents)}
                hint="After transfers"
                negative={summary.unallocatedIncomeCents < 0}
              />
            </div>
          </div>
        </section>
      </div>

      {warnings.length > 0 && (
        <Section
          title={
            <span className="flex items-center gap-2">
              <TriangleAlert
                aria-hidden="true"
                className="size-4 shrink-0 text-warning"
              />
              Things to review
            </span>
          }
          className="bg-warning-soft ring-warning/25"
        >
          <ul className="list-disc space-y-1 pl-5 text-sm marker:text-warning">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
