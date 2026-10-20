import type { BudgetSummary } from '../../domain/budget/calculations'
import { formatMoney, formatPercent } from '../../domain/budget/money'

export function DashboardSummary({ summary }: { summary: BudgetSummary }) {
  const warnings = [
    ...summary.accountAllocations
      .filter((allocation) => allocation.balanceCents < 0)
      .map(
        (allocation) =>
          `${allocation.accountName} dépasse son enveloppe de ${formatMoney(
            Math.abs(allocation.balanceCents),
          )}.`,
      ),
    ...(summary.unassignedExpenseCents > 0
      ? [
          `${formatMoney(
            summary.unassignedExpenseCents,
          )} de dépenses ne sont affectées à aucun compte.`,
        ]
      : []),
    ...(summary.unallocatedIncomeCents < 0
      ? [
          `Les virements prévus dépassent les revenus de ${formatMoney(
            Math.abs(summary.unallocatedIncomeCents),
          )}.`,
        ]
      : []),
  ]

  return (
    <>
      <section className="summary-dashboard" aria-label="Résumé du budget">
        <article
          className={`summary-hero ${
            summary.remainingCents < 0 ? 'is-negative' : 'is-positive'
          }`}
        >
          <div>
            <span>Reste disponible</span>
            <small>Après toutes les dépenses planifiées</small>
          </div>
          <strong>{formatMoney(summary.remainingCents)}</strong>
          <span className="summary-rate">
            {formatPercent(summary.savingsRate)} des revenus
          </span>
        </article>
        <div className="summary-metrics">
          <article className="summary-card">
            <span>Revenus</span>
            <strong>{formatMoney(summary.incomeCents)}</strong>
            <small>Entrées prévues</small>
          </article>
          <article className="summary-card">
            <span>Dépenses</span>
            <strong>{formatMoney(summary.expenseCents)}</strong>
            <small>Sorties planifiées</small>
          </article>
          <article
            className={`summary-card ${
              summary.unallocatedIncomeCents < 0 ? 'is-negative' : ''
            }`}
          >
            <span>Non affecté</span>
            <strong>{formatMoney(summary.unallocatedIncomeCents)}</strong>
            <small>Après virements</small>
          </article>
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="warning-panel" aria-labelledby="warnings-title">
          <div className="warning-icon" aria-hidden="true">!</div>
          <div>
            <h2 id="warnings-title">Points à vérifier</h2>
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
