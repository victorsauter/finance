import { createFileRoute } from '@tanstack/react-router'
import { monthKey } from '@/domain/budget/factory'
import { BudgetPage } from '@/features/dashboard/BudgetPage'
import { useMonthParam } from '@/features/budgets/useMonthParam'
import { validateMonthSearch } from '@/lib/month-search'

export const Route = createFileRoute('/')({
  validateSearch: validateMonthSearch,
  component: BudgetRoute,
})

/**
 * The viewed month is the `m` search param (`YYYY-MM`). Without it the
 * persisted active month is shown and written into the URL (see
 * useMonthParam). Picking a month only navigates; the hook opens it.
 */
function BudgetRoute() {
  const { m } = Route.useSearch()
  const navigate = Route.useNavigate()

  useMonthParam(m, (key) => {
    void navigate({ search: { m: key }, replace: true })
  })

  return (
    <BudgetPage
      onSelectMonth={(year, month) => {
        void navigate({ search: { m: monthKey(year, month) } })
      }}
    />
  )
}
