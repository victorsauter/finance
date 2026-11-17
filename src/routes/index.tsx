import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { BudgetPage } from '@/features/dashboard/BudgetPage'
import { validateMonthSearch } from '@/lib/month-search'

export const Route = createFileRoute('/')({
  validateSearch: validateMonthSearch,
  component: BudgetRoute,
})

function BudgetRoute() {
  // Wave 2: read the month with Route.useSearch(), drop `as="div"` once the
  // page no longer renders its own <main>.
  return (
    <Page as="div">
      <BudgetPage />
    </Page>
  )
}
