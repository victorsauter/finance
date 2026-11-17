import { createFileRoute } from '@tanstack/react-router'
import { TransactionsPage } from '@/features/transactions/TransactionsPage'
import { validateMonthSearch } from '@/lib/month-search'

export const Route = createFileRoute('/transactions')({
  validateSearch: validateMonthSearch,
  component: TransactionsRoute,
})

function TransactionsRoute() {
  const { m } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <TransactionsPage
      month={m}
      onMonthChange={(month) => void navigate({ search: { m: month } })}
    />
  )
}
