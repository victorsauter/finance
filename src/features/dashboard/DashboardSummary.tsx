import type { BudgetSummary } from '../../domain/budget/calculations'
import { formatMoney, formatPercent } from '../../domain/budget/money'

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
      <section className="summary-dashboard" aria-label="Budget summary">
        <article
          className={`summary-hero ${
            summary.remainingCents < 0 ? 'is-negative' : 'is-positive'
          }`}
        >
          <div>
            <span>Available balance</span>
            <small>After all planned expenses</small>
          </div>
          <strong>{formatMoney(summary.remainingCents)}</strong>
          <span className="summary-rate">
            {formatPercent(summary.savingsRate)} of income
          </span>
        </article>
        <div className="summary-metrics">
          <article className="summary-card">
            <span>Income</span>
            <strong>{formatMoney(summary.incomeCents)}</strong>
            <small>Planned income</small>
          </article>
          <article className="summary-card">
            <span>Expenses</span>
            <strong>{formatMoney(summary.expenseCents)}</strong>
            <small>Planned outgoings</small>
          </article>
          <article
            className={`summary-card ${
              summary.unallocatedIncomeCents < 0 ? 'is-negative' : ''
            }`}
          >
            <span>Unallocated</span>
            <strong>{formatMoney(summary.unallocatedIncomeCents)}</strong>
            <small>After transfers</small>
          </article>
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="warning-panel" aria-labelledby="warnings-title">
          <div className="warning-icon" aria-hidden="true">!</div>
          <div>
            <h2 id="warnings-title">Things to review</h2>
            <ul>
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  )
}
