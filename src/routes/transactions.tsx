import { createFileRoute } from '@tanstack/react-router'
import { Page } from '@/components/layout/Page'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { validateMonthSearch } from '@/lib/month-search'

export const Route = createFileRoute('/transactions')({
  validateSearch: validateMonthSearch,
  component: TransactionsRoute,
})

function TransactionsRoute() {
  // Wave 2: read the month with Route.useSearch(), drop `as="div"` once the
  // page no longer renders its own <main>.
  return (
    <Page as="div">
      <TransactionsPage />
    </Page>
  )
}
