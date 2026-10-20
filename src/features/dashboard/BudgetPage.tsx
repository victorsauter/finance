import { useMemo } from 'react'
import { useBudget } from '../../app/budget-context'
import { calculateBudgetSummary } from '../../domain/budget/calculations'
import { buildCashFlowModel } from '../../domain/budget/chart-model'
import { BudgetEditor } from '../budget-editor/BudgetEditor'
import { MonthToolbar } from '../budgets/MonthToolbar'
import { CashFlowChart } from '../cash-flow/CashFlowChart'
import { FlowSummary } from '../cash-flow/FlowSummary'
import { DashboardSummary } from './DashboardSummary'

export function BudgetPage() {
  const { activeBudget } = useBudget()
  const summary = useMemo(
    () => calculateBudgetSummary(activeBudget),
    [activeBudget],
  )
  const flowModel = useMemo(
    () => buildCashFlowModel(activeBudget),
    [activeBudget],
  )

  return (
    <main className="content-page">
      <h1 className="visually-hidden">Budget de {activeBudget.name}</h1>
      <MonthToolbar />
      <DashboardSummary summary={summary} />

      <div className="workspace-grid">
        <BudgetEditor />
        <aside className="visualization-column">
          <section className="chart-card" aria-labelledby="chart-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Vue d’ensemble</p>
                <h2 id="chart-title">Circulation de l’argent</h2>
              </div>
              <p className="chart-legend">
                <span aria-hidden="true"></span>
                Largeur = montant
              </p>
            </div>
            <CashFlowChart model={flowModel} />
            <FlowSummary model={flowModel} />
          </section>

          <section className="allocation-card" aria-labelledby="allocation-title">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Contrôle</p>
                <h2 id="allocation-title">État des enveloppes</h2>
              </div>
            </div>
            {summary.accountAllocations.length === 0 ? (
              <p className="empty-state">Aucun compte à contrôler.</p>
            ) : (
              <div className="allocation-list">
                {summary.accountAllocations.map((allocation) => (
                  <div className="allocation-row" key={allocation.accountId}>
                    <div>
                      <strong>{allocation.accountName}</strong>
                      <span>
                        {allocation.usageCents === 0
                          ? 'Aucune dépense affectée'
                          : `${Math.round(
                              (allocation.usageCents /
                                Math.max(allocation.transferCents, 1)) *
                                100,
                            )} % utilisé`}
                      </span>
                    </div>
                    <strong
                      className={
                        allocation.balanceCents < 0 ? 'negative-text' : ''
                      }
                    >
                      {new Intl.NumberFormat('fr-FR', {
                        style: 'currency',
                        currency: 'EUR',
                      }).format(allocation.balanceCents / 100)}
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </main>
  )
}
