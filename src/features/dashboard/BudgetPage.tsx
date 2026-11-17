import { useMemo } from 'react'
import { useBudget } from '@/app/budget-context'
import { Page } from '@/components/layout/Page'
import { PageHeader } from '@/components/layout/PageHeader'
import { buildCashFlowModel } from '@/domain/budget/chart-model'
import { calculateBudgetSummary } from '@/domain/budget/calculations'
import { BudgetEditor } from '../budget-editor/BudgetEditor'
import { MonthToolbar } from '../budgets/MonthToolbar'
import { AllocationStatus } from './AllocationStatus'
import { CashFlowCard } from './CashFlowCard'
import { DashboardSummary } from './DashboardSummary'

interface BudgetPageProps {
  /** Opens a month; the route turns it into the `?m=` search param. */
  onSelectMonth: (year: number, month: number) => void
}

export function BudgetPage({ onSelectMonth }: BudgetPageProps) {
  const { activeBudget, activeBudgetIsVirtual } = useBudget()
  const summary = useMemo(
    () => calculateBudgetSummary(activeBudget),
    [activeBudget],
  )
  const flowModel = useMemo(
    () => buildCashFlowModel(activeBudget),
    [activeBudget],
  )

  return (
    <Page>
      <PageHeader
        eyebrow="Monthly budget"
        title={activeBudget.name}
        description={
          activeBudgetIsVirtual
            ? 'Not saved yet. It starts from the nearest earlier month and is saved with your first change.'
            : undefined
        }
        actions={<MonthToolbar onSelectMonth={onSelectMonth} />}
      />
      <DashboardSummary summary={summary} />

      {/* The workspace answers to its own width, not the window's: the
          sidebar and gutters change how much room it really gets. */}
      <div className="@container">
        <div className="grid items-start gap-6 @5xl:grid-cols-11">
          <div className="min-w-0 @5xl:col-span-5">
            <BudgetEditor />
          </div>
          <div className="grid min-w-0 gap-6 @5xl:col-span-6">
            <CashFlowCard model={flowModel} />
            {/* Stacked layout: the short allocation review comes first. */}
            <AllocationStatus
              summary={summary}
              className="order-first @5xl:order-none"
            />
          </div>
        </div>
      </div>
    </Page>
  )
}
